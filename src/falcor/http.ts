import { dbError, serializeError } from '../errors.js';
import { readJsonBody, sendJson } from '../features/http/json-endpoint.js';
import { createDbOperationHandler } from '../operations.js';
import { resolveResource } from '../names.js';

type FalcorDb = {
  config: {
    server?: {
      maxBodyBytes?: number;
    };
    [key: string]: unknown;
  };
  resources: Map<string, FalcorResource>;
  collection(name: string): FalcorCollection;
  document(name: string): FalcorDocument;
};

type FalcorResource = {
  name: string;
  kind?: string;
  idField?: string;
  routePath?: string;
  relations?: FalcorRelation[];
  [key: string]: unknown;
};

type FalcorRelation = {
  name: string;
  sourceField: string;
  targetResource: string;
  targetField: string;
  cardinality: string;
};

type FalcorCollection = {
  all(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  patch(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null>;
};

type FalcorDocument = {
  all(): Promise<unknown>;
  put(value: unknown): Promise<unknown>;
  set(pointer: string, value: unknown): Promise<unknown>;
};

type FalcorRequest = {
  method?: string;
  url?: string;
  [key: string]: unknown;
};

type FalcorResponse = Record<string, unknown>;

type JsonGraph = Record<string, unknown>;
type FalcorPath = Array<string | number | boolean>;
type PathSetSegment = string | number | boolean | null | Array<string | number | boolean> | {
  from?: number;
  to?: number;
  length?: number;
};

type FalcorBody = Record<string, unknown> & {
  method?: string;
  paths?: unknown;
  pathSets?: unknown;
  jsonGraph?: unknown;
  jsonGraphEnvelope?: unknown;
  callPath?: unknown;
  functionPath?: unknown;
  args?: unknown;
  arguments?: unknown;
};

const MISSING_ATOM = { $type: 'atom' };

export async function handleFalcorRequest(db: FalcorDb, request: FalcorRequest, response: FalcorResponse): Promise<void> {
  try {
    await handleFalcorRequestUnsafe(db, request, response);
  } catch (error) {
    sendJson(response, (error as Error & { status?: number }).status ?? 500, serializeError(error, 'FALCOR_ERROR'));
  }
}

async function handleFalcorRequestUnsafe(db: FalcorDb, request: FalcorRequest, response: FalcorResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://db.local');

  if (request.method === 'GET') {
    const paths = parsePaths(url.searchParams.get('paths') ?? url.searchParams.get('path'));
    sendJson(response, 200, await executeFalcorGet(db, paths));
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, {
      error: {
        code: 'FALCOR_METHOD_NOT_ALLOWED',
        message: 'Falcor endpoint accepts GET and POST requests.',
        hint: 'Use GET with paths for reads or POST with method, paths, jsonGraph, or callPath.',
      },
    });
    return;
  }

  const body = await readJsonBody(request, {
    maxBytes: Number(db.config.server?.maxBodyBytes ?? 1048576),
  }) as FalcorBody;
  const method = String(body.method ?? inferredFalcorMethod(body)).toLowerCase();

  if (method === 'get') {
    sendJson(response, 200, await executeFalcorGet(db, pathSetsFromBody(body)));
    return;
  }

  if (method === 'set') {
    sendJson(response, 200, await executeFalcorSet(db, body.jsonGraph ?? (body.jsonGraphEnvelope as Record<string, unknown>)?.jsonGraph));
    return;
  }

  if (method === 'call') {
    const result = await executeFalcorCall(db, body);
    sendJson(response, result.status, result.body);
    return;
  }

  throw dbError(
    'FALCOR_UNKNOWN_METHOD',
    `Unknown Falcor method "${method}".`,
    {
      status: 400,
      hint: 'Use method "get", "set", or "call".',
      details: { method },
    },
  );
}

async function executeFalcorGet(db: FalcorDb, pathSets: unknown): Promise<{ jsonGraph: JsonGraph; paths: FalcorPath[] }> {
  const paths = normalizePathSets(pathSets);
  const jsonGraph: JsonGraph = {};

  for (const path of paths) {
    await readFalcorPath(db, jsonGraph, path);
  }

  return {
    jsonGraph,
    paths,
  };
}

async function executeFalcorSet(db: FalcorDb, jsonGraph: unknown): Promise<{ jsonGraph: JsonGraph; paths: FalcorPath[] }> {
  if (!isRecord(jsonGraph)) {
    throw dbError(
      'FALCOR_SET_INVALID_BODY',
      'Falcor set requires a JSONGraph envelope.',
      {
        status: 400,
        hint: 'Send { "method": "set", "jsonGraph": { "usersById": { "u_1": { "name": "Ada" } } } }.',
      },
    );
  }

  const writes = jsonGraphLeaves(jsonGraph);
  for (const write of writes) {
    await writeFalcorPath(db, write.path, write.value);
  }

  return executeFalcorGet(db, writes.map((write) => write.path));
}

async function executeFalcorCall(db: FalcorDb, body: FalcorBody): Promise<{ status: number; body: unknown }> {
  const callPath = normalizePath(body.callPath ?? body.functionPath);
  if (callPath.length === 0) {
    throw dbError(
      'FALCOR_CALL_MISSING_PATH',
      'Falcor call requires a callPath or functionPath.',
      {
        status: 400,
        hint: 'Use { "method": "call", "callPath": ["operations", "users.get"], "arguments": [{ "id": "u_1" }] }.',
      },
    );
  }

  const ref = operationRefFromCallPath(callPath);
  const args = Array.isArray(body.arguments) ? body.arguments : Array.isArray(body.args) ? body.args : [];
  const variables = isRecord(args[0]) ? args[0] : { args };
  const operationHandler = createDbOperationHandler(db as never);
  const result = await operationHandler.execute(ref, variables as never);
  if (result.status < 200 || result.status >= 300) {
    return {
      status: result.status,
      body: result.body,
    };
  }

  if (isRecord(result.body) && isRecord(result.body.jsonGraph)) {
    return {
      status: result.status,
      body: result.body,
    };
  }

  const jsonGraph: JsonGraph = {};
  const resultPath = [...callPath, 'result'];
  setJsonGraphValue(jsonGraph, resultPath, result.body);
  return {
    status: result.status,
    body: {
      jsonGraph,
      paths: [resultPath],
    },
  };
}

async function readFalcorPath(db: FalcorDb, jsonGraph: JsonGraph, path: FalcorPath): Promise<void> {
  const [head, second, ...tail] = path;
  if (head === undefined || head === null) {
    return;
  }

  const byIdResource = byIdResourceForPath(db, String(head));
  if (byIdResource) {
    const id = second;
    if (id === undefined || id === null) {
      return;
    }
    const record = await db.collection(byIdResource.name).get(String(id));
    setJsonGraphValue(jsonGraph, [String(head), String(id), ...tail], valueForPath(record, tail));
    return;
  }

  const resource = resolveFalcorResource(db, String(head));
  if (!resource) {
    return;
  }

  if (resource.kind === 'document') {
    const document = await db.document(resource.name).all();
    setJsonGraphValue(jsonGraph, [resource.name, ...path.slice(1)], valueForPath(document, path.slice(1)));
    return;
  }

  const records = await db.collection(resource.name).all();
  if (second === 'length') {
    setJsonGraphValue(jsonGraph, [resource.name, 'length'], records.length);
    return;
  }

  const index = Number(second);
  if (!Number.isInteger(index) || index < 0 || index >= records.length) {
    setJsonGraphValue(jsonGraph, [resource.name, second as string | number], MISSING_ATOM);
    return;
  }

  const record = records[index];
  const id = record?.[resource.idField ?? 'id'];
  if (id === undefined || id === null) {
    setJsonGraphValue(jsonGraph, [resource.name, index], MISSING_ATOM);
    return;
  }

  const byIdName = byIdNameForResource(resource);
  setJsonGraphValue(jsonGraph, [resource.name, index], {
    $type: 'ref',
    value: [byIdName, String(id)],
  });
  if (tail.length > 0) {
    setJsonGraphValue(jsonGraph, [byIdName, String(id), ...tail], valueForPath(record, tail));
  }
}

async function writeFalcorPath(db: FalcorDb, path: FalcorPath, rawValue: unknown): Promise<void> {
  const [head, second, ...tail] = path;
  if (head === undefined || head === null) {
    throw unsupportedSetPath(path);
  }

  const value = unwrapFalcorValue(rawValue);
  const byIdResource = byIdResourceForPath(db, String(head));
  if (byIdResource) {
    if (second === undefined || second === null) {
      throw unsupportedSetPath(path);
    }
    const patch = patchForFalcorPath(byIdResource, tail, value);
    await db.collection(byIdResource.name).patch(String(second), patch);
    return;
  }

  const resource = resolveFalcorResource(db, String(head));
  if (!resource) {
    throw unsupportedSetPath(path);
  }

  if (resource.kind === 'document') {
    const documentPath = path.slice(1);
    if (documentPath.length === 0) {
      await db.document(resource.name).put(value);
      return;
    }
    await db.document(resource.name).set(jsonPointer(documentPath), value);
    return;
  }

  const records = await db.collection(resource.name).all();
  const index = Number(second);
  if (!Number.isInteger(index) || index < 0 || index >= records.length) {
    throw unsupportedSetPath(path);
  }
  const id = records[index]?.[resource.idField ?? 'id'];
  if (id === undefined || id === null) {
    throw unsupportedSetPath(path);
  }
  const patch = patchForFalcorPath(resource, tail, value);
  await db.collection(resource.name).patch(String(id), patch);
}

function patchForFalcorPath(resource: FalcorResource, path: FalcorPath, rawValue: unknown): Record<string, unknown> {
  if (path.length === 0) {
    if (isRecord(rawValue)) {
      return rawValue;
    }
    throw unsupportedSetPath(path);
  }

  const [head, ...tail] = path;
  const relation = resource.relations?.find((candidate) => candidate.name === head);
  if (relation && isFalcorRef(rawValue)) {
    return {
      [relation.sourceField]: rawValue.value[1],
    };
  }

  const patch: Record<string, unknown> = {};
  setPlainPath(patch, [String(head), ...tail.map(String)], rawValue);
  return patch;
}

function unwrapFalcorValue(value: unknown): unknown {
  if (isRecord(value) && value.$type === 'atom') {
    return value.value;
  }
  return value;
}

function valueForPath(value: unknown, path: FalcorPath): unknown {
  if (value === undefined || value === null) {
    return value === null ? null : MISSING_ATOM;
  }

  let current = value;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return MISSING_ATOM;
    }
    current = (current as Record<string, unknown>)[String(segment)];
    if (current === undefined) {
      return MISSING_ATOM;
    }
  }
  return current;
}

function resolveFalcorResource(db: FalcorDb, value: string): FalcorResource | null {
  return resolveResource(db.resources, value).resource
    ?? [...db.resources.values()].find((candidate) => candidate.routePath?.slice(1) === value)
    ?? null;
}

function byIdResourceForPath(db: FalcorDb, value: string): FalcorResource | null {
  if (!value.endsWith('ById')) {
    return null;
  }
  return resolveFalcorResource(db, value.slice(0, -4));
}

function byIdNameForResource(resource: FalcorResource): string {
  return `${resource.name}ById`;
}

function parsePaths(value: string | null): unknown {
  if (!value) {
    return [];
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw dbError(
      'FALCOR_INVALID_PATHS',
      'Falcor paths must be JSON encoded.',
      {
        status: 400,
        hint: 'Use paths=[["users",0,"name"]] or a JSON-encoded paths query parameter.',
        details: {
          parserMessage: (error as Error).message,
        },
      },
    );
  }
}

function pathSetsFromBody(body: FalcorBody): unknown {
  return body.paths ?? body.pathSets ?? [];
}

function normalizePathSets(pathSets: unknown): FalcorPath[] {
  const rawPaths = Array.isArray(pathSets) ? pathSets : [];
  const pathList = rawPaths.every((item) => Array.isArray(item))
    ? rawPaths
    : [rawPaths];
  return pathList.flatMap((path) => expandPathSet(path as PathSetSegment[]));
}

function expandPathSet(pathSet: PathSetSegment[]): FalcorPath[] {
  const paths: FalcorPath[] = [[]];
  for (const segment of pathSet) {
    const values = expandSegment(segment);
    const next: FalcorPath[] = [];
    for (const path of paths) {
      for (const value of values) {
        next.push([...path, value]);
      }
    }
    paths.splice(0, paths.length, ...next);
  }
  return paths;
}

function expandSegment(segment: PathSetSegment): Array<string | number | boolean> {
  if (Array.isArray(segment)) {
    return segment;
  }
  if (isRecord(segment)) {
    const from = Number(segment.from ?? 0);
    const to = segment.to !== undefined
      ? Number(segment.to)
      : segment.length !== undefined
        ? from + Number(segment.length) - 1
        : from;
    const values: number[] = [];
    for (let index = from; index <= to; index += 1) {
      values.push(index);
    }
    return values;
  }
  if (segment === null) {
    return [];
  }
  return [segment];
}

function normalizePath(value: unknown): FalcorPath {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((segment): segment is string | number | boolean => (
    typeof segment === 'string' || typeof segment === 'number' || typeof segment === 'boolean'
  ));
}

function operationRefFromCallPath(path: FalcorPath): string {
  const parts = path.map(String);
  if (parts[0] === 'operations') {
    return parts.slice(1).join('.');
  }
  return parts.join('.');
}

function inferredFalcorMethod(body: FalcorBody): string {
  if (body.callPath || body.functionPath) {
    return 'call';
  }
  if (body.jsonGraph || body.jsonGraphEnvelope) {
    return 'set';
  }
  return 'get';
}

function jsonGraphLeaves(jsonGraph: Record<string, unknown>): Array<{ path: FalcorPath; value: unknown }> {
  const leaves: Array<{ path: FalcorPath; value: unknown }> = [];
  walkJsonGraph(jsonGraph, [], leaves);
  return leaves;
}

function walkJsonGraph(value: unknown, path: FalcorPath, leaves: Array<{ path: FalcorPath; value: unknown }>): void {
  if (isFalcorLeaf(value)) {
    leaves.push({ path, value });
    return;
  }
  if (!isRecord(value)) {
    leaves.push({ path, value });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    walkJsonGraph(child, [...path, numericKey(key)], leaves);
  }
}

function isFalcorLeaf(value: unknown): boolean {
  return isRecord(value) && typeof value.$type === 'string';
}

function isFalcorRef(value: unknown): value is { $type: 'ref'; value: FalcorPath } {
  return isRecord(value) && value.$type === 'ref' && Array.isArray(value.value);
}

function setJsonGraphValue(jsonGraph: JsonGraph, path: FalcorPath, value: unknown): void {
  let current: Record<string, unknown> = jsonGraph;
  for (const [index, segment] of path.entries()) {
    const key = String(segment);
    if (index === path.length - 1) {
      current[key] = value;
      return;
    }
    if (!isRecord(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
}

function setPlainPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current = target;
  for (const [index, segment] of path.entries()) {
    if (index === path.length - 1) {
      current[segment] = value;
      return;
    }
    if (!isRecord(current[segment])) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
}

function jsonPointer(path: FalcorPath): string {
  return `/${path.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function numericKey(value: string): string | number {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function unsupportedSetPath(path: FalcorPath): Error {
  return dbError(
    'FALCOR_SET_UNSUPPORTED_PATH',
    `Falcor set path is not supported: ${path.join('.')}`,
    {
      status: 400,
      hint: 'Use usersById.{id}.{field}, a document field path, or Falcor call mapped to a registered operation for workflows.',
      details: {
        path,
      },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
