import { dbError } from '../../errors.js';
import { resolveFrom, writeText } from '../../fs-utils.js';
import { loadProjectSchema } from '../schema/project.js';
import { scanDbUsage } from '../usage/scanner.js';
import {
  buildOperationManifest,
  normalizeOperationRegistry,
  type OperationRef,
  type OperationRefsManifest,
} from '../operations/index.js';
import type { RegisteredOperation } from '../../shared/operations.js';

export type DbContractWrite = boolean | string[];

export type DbContractResource = {
  fields?: string[];
  read?: boolean;
  write?: DbContractWrite;
};

export type DbContractDefinition = {
  resources?: Record<string, DbContractResource>;
  operations?: string[];
  events?: Record<string, unknown>;
};

export type DbContractsConfig = Record<string, DbContractDefinition>;

type ContractsConfig = {
  cwd?: string;
  contracts?: DbContractsConfig;
  outputs?: {
    contractRefs?: string | null;
  };
  [key: string]: unknown;
};

type SchemaResource = {
  name: string;
  kind?: string;
  fields?: Record<string, {
    tags?: string[];
    visibility?: string;
    [key: string]: unknown;
  }>;
};

type SchemaProject = {
  resources?: SchemaResource[];
};

export type DbContractRefsManifest = {
  version: 1;
  kind: 'db.contractRefs';
  generatedAt: string;
  contracts: Record<string, {
    resources: Record<string, DbContractResource>;
    operations: Record<string, OperationRef>;
  }>;
};

export type DbContractsCheckFinding = {
  severity: 'error' | 'warn';
  code: string;
  contract: string;
  operation?: string;
  resource?: string;
  field?: string;
  message: string;
  hint?: string;
};

export type DbContractsCheckResult = {
  version: 1;
  kind: 'db.contractsCheck';
  ok: boolean;
  findings: DbContractsCheckFinding[];
};

export async function buildContractRefsManifest(
  config: ContractsConfig,
  options: {
    generatedAt?: string;
    outFile?: string | null;
    write?: boolean;
  } = {},
): Promise<{
  manifest: DbContractRefsManifest;
  outFiles: string[];
}> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const operations = await buildOperationManifest(config as never, {
    generatedAt,
    createDirectory: false,
    write: false,
  });
  const manifest = contractRefsFromOperationRefs(config.contracts ?? {}, operations.refs, generatedAt);
  const outFiles: string[] = [];
  const outFile = outputPath(config, options.outFile ?? config.outputs?.contractRefs);
  if (options.write !== false && outFile) {
    await writeText(outFile, `${JSON.stringify(manifest, null, 2)}\n`, config.fs as never);
    outFiles.push(outFile);
  }
  return {
    manifest,
    outFiles,
  };
}

export async function inferContractsFromTags(
  config: ContractsConfig,
  options: { generatedAt?: string } = {},
): Promise<{
  version: 1;
  kind: 'db.contractsInference';
  source: 'tags';
  generatedAt: string;
  contracts: DbContractsConfig;
}> {
  const project = await loadProjectSchema(config as never) as SchemaProject;
  const contracts: DbContractsConfig = {};
  for (const resource of project.resources ?? []) {
    for (const [fieldName, field] of Object.entries(resource.fields ?? {})) {
      const tags = normalizeTags(field);
      for (const tag of tags) {
        const contract = contracts[tag] ??= { resources: {} };
        const contractResource = contract.resources![resource.name] ??= {
          fields: [],
          read: true,
          write: false,
        };
        contractResource.fields = uniqueSorted([
          ...(contractResource.fields ?? []),
          fieldName,
        ]);
      }
    }
  }
  return {
    version: 1,
    kind: 'db.contractsInference',
    source: 'tags',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    contracts,
  };
}

export async function inferContractsFromUsage(
  config: ContractsConfig,
  options: {
    target?: string;
    generatedAt?: string;
  } = {},
): Promise<{
  version: 1;
  kind: 'db.contractsInference';
  source: 'usage';
  generatedAt: string;
  contracts: DbContractsConfig;
}> {
  const manifest = await scanDbUsage({
    cwd: config.cwd,
    target: options.target,
    generatedAt: options.generatedAt,
  });
  const operations = uniqueSorted(
    manifest.files
      .flatMap((file) => file.matches)
      .filter((match) => match.surface === 'operations')
      .flatMap((match) => operationRefsFromSnippet(match.snippet)),
  );
  return {
    version: 1,
    kind: 'db.contractsInference',
    source: 'usage',
    generatedAt: options.generatedAt ?? manifest.generatedAt,
    contracts: {
      app: {
        resources: {},
        operations,
      },
    },
  };
}

export async function checkContracts(config: ContractsConfig): Promise<DbContractsCheckResult> {
  const findings: DbContractsCheckFinding[] = [];
  const contracts = config.contracts ?? {};
  const project = await safeLoadProjectSchema(config);
  const resources = new Map((project.resources ?? []).map((resource) => [resource.name, resource]));
  const operationsByNameOrRef = operationLookup(await contractOperationRegistry(config));

  for (const [contractName, contract] of Object.entries(contracts)) {
    for (const [resourceName, contractResource] of Object.entries(contract.resources ?? {})) {
      const resource = resources.get(resourceName);
      if (!resource) {
        findings.push({
          severity: 'error',
          code: 'CONTRACT_UNKNOWN_RESOURCE',
          contract: contractName,
          resource: resourceName,
          message: `Contract "${contractName}" references unknown resource "${resourceName}".`,
          hint: 'Use an existing schema resource name.',
        });
        continue;
      }
      for (const fieldName of contractResource.fields ?? []) {
        if (!resource.fields?.[fieldName]) {
          findings.push({
            severity: 'error',
            code: 'CONTRACT_UNKNOWN_FIELD',
            contract: contractName,
            resource: resourceName,
            field: fieldName,
            message: `Contract "${contractName}" references unknown field "${resourceName}.${fieldName}".`,
            hint: 'Use a field declared in the schema or data-inferred resource.',
          });
        }
      }
    }

    for (const operationName of contract.operations ?? []) {
      const operation = operationsByNameOrRef.get(operationName);
      if (!operation) {
        findings.push({
          severity: 'error',
          code: 'CONTRACT_UNKNOWN_OPERATION',
          contract: contractName,
          operation: operationName,
          message: `Contract "${contractName}" references unknown operation "${operationName}".`,
          hint: 'Run async-db operations build or update contracts.<name>.operations.',
        });
        continue;
      }
      findings.push(...validateOperationContract(operation, contract, contractName, resources));
    }
  }

  return {
    version: 1,
    kind: 'db.contractsCheck',
    ok: findings.every((finding) => finding.severity !== 'error'),
    findings,
  };
}

async function contractOperationRegistry(config: ContractsConfig): Promise<Record<string, RegisteredOperation>> {
  const operationsConfig = config.operations as {
    registry?: Record<string, RegisteredOperation>;
  } | undefined;
  if (operationsConfig?.registry && Object.keys(operationsConfig.registry).length > 0) {
    return normalizeOperationRegistry(operationsConfig.registry);
  }
  const operationManifest = await buildOperationManifest(config as never, {
    createDirectory: false,
    write: false,
  });
  return operationManifest.manifest.operations;
}

export function assertOperationAllowedByContract(
  config: ContractsConfig,
  operation: RegisteredOperation,
  requestedRef: string,
  contractName: string,
): void {
  const contract = config.contracts?.[contractName];
  if (!contract) {
    throw contractError(
      'CONTRACT_NOT_FOUND',
      `Unknown db contract "${contractName}".`,
      {
        contract: contractName,
      },
    );
  }
  if (!operationListedInContract(operation, requestedRef, contract)) {
    throw contractError(
      'CONTRACT_OPERATION_NOT_ALLOWED',
      `Operation "${operation.name ?? requestedRef}" is not callable from contract "${contractName}".`,
      {
        contract: contractName,
        operation: operation.name ?? requestedRef,
        ref: operation.ref ?? requestedRef,
      },
    );
  }

  const resource = operationResource(operation);
  if (!resource) {
    return;
  }
  const allowedResource = contract.resources?.[resource];
  if (!allowedResource) {
    throw contractError(
      'CONTRACT_RESOURCE_NOT_ALLOWED',
      `Operation "${operation.name}" touches resource "${resource}", which is not exposed by contract "${contractName}".`,
      {
        contract: contractName,
        operation: operation.name,
        resource,
      },
    );
  }
  const action = operationWriteAction(operation);
  if (!action && allowedResource.read !== true) {
    throw contractError(
      'CONTRACT_READ_NOT_ALLOWED',
      `Contract "${contractName}" does not allow reads from resource "${resource}".`,
      {
        contract: contractName,
        operation: operation.name,
        resource,
      },
    );
  }
  if (action && !writeAllows(allowedResource.write, action)) {
    throw contractError(
      'CONTRACT_WRITE_NOT_ALLOWED',
      `Contract "${contractName}" does not allow "${action}" writes to resource "${resource}".`,
      {
        contract: contractName,
        operation: operation.name,
        resource,
        action,
      },
    );
  }
  const selectedFields = operationSelectedFields(operation);
  if (selectedFields) {
    const allowed = new Set(allowedResource.fields ?? []);
    for (const field of selectedFields) {
      if (!allowed.has(field)) {
        throw contractError(
          'CONTRACT_FIELD_NOT_ALLOWED',
          `Contract "${contractName}" does not allow field "${resource}.${field}".`,
          {
            contract: contractName,
            operation: operation.name,
            resource,
            field,
          },
        );
      }
    }
  }
}

function contractRefsFromOperationRefs(
  contracts: DbContractsConfig,
  refs: OperationRefsManifest,
  generatedAt: string,
): DbContractRefsManifest {
  return {
    version: 1,
    kind: 'db.contractRefs',
    generatedAt,
    contracts: Object.fromEntries(Object.entries(contracts).map(([contractName, contract]) => [
      contractName,
      {
        resources: contract.resources ?? {},
        operations: Object.fromEntries((contract.operations ?? []).flatMap((operationName) => {
          const operationRef = refs.operations[operationName]
            ?? Object.values(refs.operations).find((candidate) => candidate.ref === operationName);
          return operationRef ? [[operationRef.name, operationRef]] : [];
        })),
      },
    ])),
  };
}

function operationLookup(operations: Record<string, RegisteredOperation>): Map<string, RegisteredOperation> {
  const lookup = new Map<string, RegisteredOperation>();
  for (const [key, operation] of Object.entries(operations)) {
    lookup.set(key, operation);
    lookup.set(operation.name, operation);
    lookup.set(operation.ref, operation);
  }
  return lookup;
}

function validateOperationContract(
  operation: RegisteredOperation,
  contract: DbContractDefinition,
  contractName: string,
  resources: Map<string, SchemaResource>,
): DbContractsCheckFinding[] {
  const findings: DbContractsCheckFinding[] = [];
  const resourceName = operationResource(operation);
  if (!resourceName) {
    return findings;
  }
  const contractResource = contract.resources?.[resourceName];
  if (!contractResource) {
    findings.push({
      severity: 'error',
      code: 'CONTRACT_OPERATION_RESOURCE_NOT_ALLOWED',
      contract: contractName,
      operation: operation.name,
      resource: resourceName,
      message: `Operation "${operation.name}" touches "${resourceName}", which contract "${contractName}" does not expose.`,
      hint: `Add ${resourceName} to contracts.${contractName}.resources or remove the operation from the contract.`,
    });
    return findings;
  }
  const action = operationWriteAction(operation);
  if (!action && contractResource.read !== true) {
    findings.push({
      severity: 'error',
      code: 'CONTRACT_OPERATION_READ_NOT_ALLOWED',
      contract: contractName,
      operation: operation.name,
      resource: resourceName,
      message: `Operation "${operation.name}" reads "${resourceName}", but contract "${contractName}" does not allow reads.`,
    });
  }
  if (action && !writeAllows(contractResource.write, action)) {
    findings.push({
      severity: 'error',
      code: 'CONTRACT_OPERATION_WRITE_NOT_ALLOWED',
      contract: contractName,
      operation: operation.name,
      resource: resourceName,
      message: `Operation "${operation.name}" performs "${action}", but contract "${contractName}" does not allow that write.`,
    });
  }

  const selectedFields = operationSelectedFields(operation);
  const allowedFields = new Set(contractResource.fields ?? []);
  if (selectedFields) {
    for (const field of selectedFields) {
      if (!allowedFields.has(field)) {
        findings.push({
          severity: 'error',
          code: 'CONTRACT_OPERATION_FIELD_NOT_ALLOWED',
          contract: contractName,
          operation: operation.name,
          resource: resourceName,
          field,
          message: `Operation "${operation.name}" selects "${resourceName}.${field}", which contract "${contractName}" does not expose.`,
        });
      }
    }
  } else if (!action && allowedFields.size > 0) {
    const resourceFields = Object.keys(resources.get(resourceName)?.fields ?? {});
    const hidden = resourceFields.filter((field) => !allowedFields.has(field));
    if (hidden.length > 0) {
      findings.push({
        severity: 'error',
        code: 'CONTRACT_OPERATION_SELECT_REQUIRED',
        contract: contractName,
        operation: operation.name,
        resource: resourceName,
        message: `Operation "${operation.name}" reads "${resourceName}" without a select list, but contract "${contractName}" exposes only selected fields.`,
        hint: `Add query.select with allowed fields: ${[...allowedFields].join(', ')}.`,
      });
    }
  }
  return findings;
}

function operationListedInContract(
  operation: RegisteredOperation,
  requestedRef: string,
  contract: DbContractDefinition,
): boolean {
  const allowed = new Set(contract.operations ?? []);
  return allowed.has(operation.name) || allowed.has(operation.ref) || allowed.has(requestedRef);
}

function operationResource(operation: RegisteredOperation): string | null {
  if (operation.kind === 'graphql' || !operation.path) {
    return null;
  }
  const first = operation.path.split(/[/?#]/).filter(Boolean)[0];
  return first ? first.replace(/\.json$/i, '') : null;
}

function operationSelectedFields(operation: RegisteredOperation): string[] | null {
  const query = operation.query;
  const select = typeof query === 'string'
    ? new URLSearchParams(query).get('select')
    : query && typeof query === 'object' && !Array.isArray(query)
      ? String((query as Record<string, unknown>).select ?? '')
      : '';
  const fields = select.split(',').map((field) => field.trim()).filter(Boolean);
  return fields.length > 0 ? fields : null;
}

function operationWriteAction(operation: RegisteredOperation): string | null {
  const method = String(operation.method ?? 'GET').toUpperCase();
  if (method === 'GET') return null;
  if (method === 'POST') return 'create';
  if (method === 'PATCH') return 'patch';
  if (method === 'PUT') return 'replace';
  if (method === 'DELETE') return 'delete';
  return method.toLowerCase();
}

function writeAllows(write: DbContractWrite | undefined, action: string): boolean {
  if (write === true) {
    return true;
  }
  if (write === false || write === undefined) {
    return false;
  }
  return write.includes(action);
}

function normalizeTags(field: { tags?: string[]; visibility?: string; [key: string]: unknown }): string[] {
  const tags = Array.isArray(field.tags) ? field.tags.map(String) : [];
  if (typeof field.visibility === 'string') {
    tags.push(field.visibility);
  }
  return uniqueSorted(tags.filter(Boolean));
}

function operationRefsFromSnippet(snippet: string): string[] {
  const refs: string[] = [];
  for (const match of snippet.matchAll(/\.\s*query\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    refs.push(match[1]);
  }
  return refs;
}

async function safeLoadProjectSchema(config: ContractsConfig): Promise<SchemaProject> {
  try {
    return await loadProjectSchema(config as never) as SchemaProject;
  } catch {
    return { resources: [] };
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function outputPath(config: ContractsConfig, value: string | null | undefined): string | null {
  return value ? resolveFrom(config.cwd, value) : null;
}

function contractError(code: string, message: string, details: Record<string, unknown>): Error {
  return dbError(code, message, {
    status: 403,
    hint: 'Check db.config.js contracts and the generated contract operation refs.',
    details,
  });
}
