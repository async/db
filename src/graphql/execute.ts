import { camelCase, singularResourceName } from '../names.js';
import { resolveSelectedComputedFields } from '../features/runtime/fanout.js';
import { describeValue, graphqlError, dbError, listChoices } from '../errors.js';
import {
  parseGraphql,
  type GraphqlDocumentNode,
  type GraphqlFragmentDefinition,
  type GraphqlOperationNode,
  type GraphqlSelectionNode,
  type GraphqlValueNode,
} from './parser.js';

type GraphqlVariables = Record<string, unknown>;

type GraphqlRequest = string | {
  query?: string;
  variables?: GraphqlVariables;
  operationName?: string | null;
};

type GraphqlResult = {
  data: unknown;
  errors?: unknown[];
};

type GraphqlDb = Record<string, any>;

type GraphqlField = {
  type?: string;
  required?: boolean;
  description?: string;
  computed?: boolean;
};

type GraphqlResource = {
  name: string;
  kind: string;
  typeName: string;
  idField?: string;
  description?: string;
  fields?: Record<string, GraphqlField>;
};

type GraphqlExecutionContext = {
  db?: GraphqlDb;
  resource?: GraphqlResource | null;
  variables?: GraphqlVariables;
  fragments?: Record<string, GraphqlFragmentDefinition>;
  typeName?: string | null;
  cache?: Map<unknown, unknown>;
  computedResolved?: boolean;
};

type FieldExecutionResult = {
  value: unknown;
  typeName: string;
  resource?: GraphqlResource | null;
};

type MutationDescriptor = {
  action: string;
  resource: GraphqlResource;
};

type IntrospectionTypeRef = {
  kind: string;
  name: string | null;
  ofType: IntrospectionTypeRef | null;
};

export async function executeGraphql(db: GraphqlDb, request: GraphqlRequest | GraphqlRequest[]): Promise<GraphqlResult | GraphqlResult[]> {
  if (Array.isArray(request)) {
    return executeGraphqlBatch(db, request);
  }

  return executeGraphqlSingle(db, request);
}

export async function executeGraphqlBatch(db: GraphqlDb, requests: GraphqlRequest[]): Promise<GraphqlResult[]> {
  const results: GraphqlResult[] = [];

  for (const request of requests) {
    results.push(await executeGraphqlSingle(db, request));
  }

  return results;
}

async function executeGraphqlSingle(db: GraphqlDb, request: GraphqlRequest): Promise<GraphqlResult> {
  try {
    const query = typeof request === 'string' ? request : request.query;
    const variables = typeof request === 'string' ? {} : request.variables ?? {};
    const operationName = typeof request === 'string' ? null : request.operationName ?? null;

    if (!query || typeof query !== 'string') {
      throw dbError(
        'GRAPHQL_MISSING_QUERY',
        'GraphQL request is missing a query string.',
        {
          hint: 'Pass a raw query string or an object like { query: "{ users { id } }", variables: {} }.',
          details: { receivedType: describeValue(request) },
        },
      );
    }

    const document = parseGraphql(query);
    const operation = selectOperation(document, operationName);
    const data = await executeSelectionSet(db, operation.operation, operation.selectionSet, variables, {
      fragments: document.fragments ?? {},
      typeName: operation.operation === 'mutation' ? 'Mutation' : 'Query',
    });
    return { data };
  } catch (error) {
    return {
      data: null,
      errors: [
        graphqlError(error),
      ],
    };
  }
}

function selectOperation(document: GraphqlDocumentNode, operationName: string | null): GraphqlOperationNode {
  const operations: GraphqlOperationNode[] = document.operations?.length
    ? document.operations
    : [{
        kind: 'operation',
        operation: document.operation,
        name: document.name,
        directives: [],
        selectionSet: document.selectionSet,
      }];

  if (operationName) {
    const operation = operations.find((candidate) => candidate.name === operationName);
    if (!operation) {
      throw dbError(
        'GRAPHQL_UNKNOWN_OPERATION',
        `Unknown GraphQL operation "${operationName}".`,
        {
          hint: `Use one of: ${listChoices(operations.map((operation) => operation.name).filter(Boolean))}.`,
          details: {
            operationName,
            availableOperations: operations.map((operation) => operation.name).filter(Boolean),
          },
        },
      );
    }
    return operation;
  }

  if (operations.length === 1) {
    return operations[0];
  }

  throw dbError(
    'GRAPHQL_OPERATION_NAME_REQUIRED',
    'GraphQL operationName is required when a document contains multiple operations.',
    {
      hint: `Pass operationName with one of: ${listChoices(operations.map((operation) => operation.name).filter(Boolean))}.`,
      details: {
        availableOperations: operations.map((operation) => operation.name).filter(Boolean),
      },
    },
  );
}

async function executeSelectionSet(
  db: GraphqlDb,
  operation: string,
  selections: GraphqlSelectionNode[],
  variables: GraphqlVariables,
  context: GraphqlExecutionContext,
) {
  const data: Record<string, unknown> = {};

  for (const selection of selections) {
    await executeRootSelection(db, operation, selection, variables, context, data);
  }

  return data;
}

async function executeRootSelection(
  db: GraphqlDb,
  operation: string,
  selection: GraphqlSelectionNode,
  variables: GraphqlVariables,
  context: GraphqlExecutionContext,
  data: Record<string, unknown>,
): Promise<void> {
  if (!shouldIncludeSelection(selection, variables)) {
    return;
  }

  if (selection.kind === 'fragment_spread') {
    const fragment = requireFragment(context.fragments, selection.name);
    if (typeConditionApplies(fragment.typeCondition, context.typeName) && shouldIncludeSelection(fragment, variables)) {
      for (const fragmentSelection of fragment.selectionSet) {
        await executeRootSelection(db, operation, fragmentSelection, variables, context, data);
      }
    }
    return;
  }

  if (selection.kind === 'inline_fragment') {
    if (typeConditionApplies(selection.typeCondition, context.typeName)) {
      for (const fragmentSelection of selection.selectionSet) {
        await executeRootSelection(db, operation, fragmentSelection, variables, context, data);
      }
    }
    return;
  }

  const key = responseKey(selection);
  if (selection.name === '__typename') {
    data[key] = context.typeName;
    return;
  }

  const result = operation === 'mutation'
    ? await executeMutationField(db, selection, variables)
    : await executeQueryField(db, selection, variables);
  data[key] = await projectValue(result.value, selection.selectionSet, {
    ...context,
    db,
    resource: result.resource ?? null,
    variables,
    typeName: result.typeName,
  });
}

async function executeQueryField(db: GraphqlDb, selection: GraphqlSelectionNode, variables: GraphqlVariables): Promise<FieldExecutionResult> {
  if (selection.name === '__schema') {
    return {
      value: introspectionSchema(db),
      typeName: '__Schema',
    };
  }

  if (selection.name === '__type') {
    return {
      value: introspectionType(db, readArgument(selection, 'name', variables)),
      typeName: '__Type',
    };
  }

  const resource = findQueryResource(db, selection.name);
  if (!resource) {
    throw dbError(
      'GRAPHQL_UNKNOWN_QUERY_FIELD',
      `Unknown GraphQL query field "${selection.name}".`,
      {
        hint: `Use one of: ${listChoices(availableQueryFields(db))}.`,
        details: {
          field: selection.name,
          availableFields: availableQueryFields(db),
        },
      },
    );
  }

  if (resource.kind === 'document') {
    return {
      value: await db.document(resource.name).all(),
      typeName: resource.typeName,
      resource,
    };
  }

  if (selection.name === collectionRootName(resource)) {
    return {
      value: await db.collection(resource.name).all(),
      typeName: resource.typeName,
      resource,
    };
  }

  const id = readRequiredIdArgument(selection, variables);

  return {
    value: await db.collection(resource.name).get(id),
    typeName: resource.typeName,
    resource,
  };
}

async function executeMutationField(db: GraphqlDb, selection: GraphqlSelectionNode, variables: GraphqlVariables): Promise<FieldExecutionResult> {
  const mutation = parseMutationName(db, selection.name);
  if (!mutation) {
    throw dbError(
      'GRAPHQL_UNKNOWN_MUTATION_FIELD',
      `Unknown GraphQL mutation field "${selection.name}".`,
      {
        hint: `Use one of: ${listChoices(availableMutationFields(db))}.`,
        details: {
          field: selection.name,
          availableFields: availableMutationFields(db),
        },
      },
    );
  }

  if (mutation.resource.kind === 'collection') {
    return {
      value: await executeCollectionMutation(db, mutation, selection, variables),
      typeName: mutation.action === 'delete' ? 'Boolean' : mutation.resource.typeName,
      resource: mutation.action === 'delete' ? null : mutation.resource,
    };
  }

  return {
    value: await executeDocumentMutation(db, mutation, selection, variables),
    typeName: mutation.resource.typeName,
    resource: mutation.resource,
  };
}

async function executeCollectionMutation(
  db: GraphqlDb,
  mutation: MutationDescriptor,
  selection: GraphqlSelectionNode,
  variables: GraphqlVariables,
): Promise<unknown> {
  const collection = db.collection(mutation.resource.name);

  if (mutation.action === 'create') {
    const input = readArgument(selection, 'input', variables);
    if (!isObject(input)) {
      throw argumentTypeError(selection.name, 'input', 'object', input);
    }
    return collection.create(input);
  }

  if (mutation.action === 'update') {
    const id = readRequiredIdArgument(selection, variables);
    const patch = readArgument(selection, 'patch', variables);
    if (!isObject(patch)) {
      throw argumentTypeError(selection.name, 'patch', 'object', patch);
    }
    return collection.patch(id, patch);
  }

  if (mutation.action === 'delete') {
    const id = readRequiredIdArgument(selection, variables);
    return collection.delete(id);
  }

  throw dbError('GRAPHQL_UNSUPPORTED_MUTATION', `Unsupported GraphQL collection mutation "${selection.name}".`);
}

async function executeDocumentMutation(
  db: GraphqlDb,
  mutation: MutationDescriptor,
  selection: GraphqlSelectionNode,
  variables: GraphqlVariables,
): Promise<unknown> {
  const document = db.document(mutation.resource.name);

  if (mutation.action === 'update') {
    const patch = readArgument(selection, 'patch', variables);
    if (!isObject(patch)) {
      throw argumentTypeError(selection.name, 'patch', 'object', patch);
    }
    return document.update(patch);
  }

  if (mutation.action === 'set') {
    const path = readArgument(selection, 'path', variables);
    const value = readArgument(selection, 'value', variables);
    await document.set(path, value);
    return document.all();
  }

  throw dbError('GRAPHQL_UNSUPPORTED_MUTATION', `Unsupported GraphQL document mutation "${selection.name}".`);
}

function findQueryResource(db: GraphqlDb, fieldName: string): GraphqlResource | undefined {
  return [...db.resources.values()].find((resource) => {
    if (resource.kind === 'document') {
      return resource.name === fieldName;
    }

    return collectionRootName(resource) === fieldName || singleRootName(resource) === fieldName;
  });
}

function parseMutationName(db: GraphqlDb, fieldName: string): MutationDescriptor | null {
  for (const resource of db.resources.values()) {
    const typeName = resource.typeName;
    for (const action of mutationActions(resource)) {
      if (fieldName === `${action}${typeName}`) {
        return { action, resource };
      }
    }
  }

  return null;
}

function mutationActions(resource) {
  return resource.kind === 'collection'
    ? ['create', 'update', 'delete']
    : ['update', 'set'];
}

async function projectValue(value, selectionSet, context: GraphqlExecutionContext = {}) {
  if (!selectionSet || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    const records = context.resource && !context.computedResolved
      ? await resolveComputedSelection(value, selectionSet, context)
      : value;
    return Promise.all(records.map((item) => projectValue(item, selectionSet, {
      ...context,
      computedResolved: true,
    })));
  }

  if (!isObject(value)) {
    return value;
  }

  const objectValue = context.resource && !context.computedResolved
    ? (await resolveComputedSelection([value], selectionSet, context))[0]
    : value;
  const projected = {};
  for (const selection of selectionSet) {
    await projectObjectSelection(objectValue, selection, projected, context);
  }

  return projected;
}

async function projectObjectSelection(value, selection, projected, context) {
  if (!shouldIncludeSelection(selection, context.variables ?? {})) {
    return;
  }

  if (selection.kind === 'fragment_spread') {
    const fragment = requireFragment(context.fragments ?? {}, selection.name);
    if (typeConditionApplies(fragment.typeCondition, context.typeName) && shouldIncludeSelection(fragment, context.variables ?? {})) {
      for (const fragmentSelection of fragment.selectionSet) {
        await projectObjectSelection(value, fragmentSelection, projected, context);
      }
    }
    return;
  }

  if (selection.kind === 'inline_fragment') {
    if (typeConditionApplies(selection.typeCondition, context.typeName)) {
      for (const fragmentSelection of selection.selectionSet) {
        await projectObjectSelection(value, fragmentSelection, projected, context);
      }
    }
    return;
  }

  const key = responseKey(selection);
  if (selection.name === '__typename') {
    projected[key] = context.typeName ?? 'JSON';
    return;
  }

  projected[key] = await projectValue(value[selection.name], selection.selectionSet, {
    ...context,
    resource: null,
    typeName: null,
  });
}

async function resolveComputedSelection(records, selectionSet, context) {
  const fieldNames = selectedComputedFieldNames(selectionSet, context);
  return resolveSelectedComputedFields(context.db, context.resource, records, fieldNames, {
    cache: context.cache ?? new Map(),
  });
}

function selectedComputedFieldNames(selections, context) {
  const names = [];
  for (const selection of selections ?? []) {
    if (!shouldIncludeSelection(selection, context.variables ?? {})) {
      continue;
    }

    if (selection.kind === 'fragment_spread') {
      const fragment = requireFragment(context.fragments ?? {}, selection.name);
      if (typeConditionApplies(fragment.typeCondition, context.typeName) && shouldIncludeSelection(fragment, context.variables ?? {})) {
        names.push(...selectedComputedFieldNames(fragment.selectionSet, context));
      }
      continue;
    }

    if (selection.kind === 'inline_fragment') {
      if (typeConditionApplies(selection.typeCondition, context.typeName)) {
        names.push(...selectedComputedFieldNames(selection.selectionSet, context));
      }
      continue;
    }

    if (selection.name !== '__typename' && context.resource?.fields?.[selection.name]?.computed) {
      names.push(selection.name);
    }
  }

  return names;
}

function shouldIncludeSelection(selection, variables) {
  for (const directive of selection.directives ?? []) {
    const condition = directiveCondition(directive, variables);

    if (directive.name === 'skip') {
      if (condition === true) {
        return false;
      }
      continue;
    }

    if (directive.name === 'include') {
      if (condition === false) {
        return false;
      }
      continue;
    }

    throw dbError(
      'GRAPHQL_UNSUPPORTED_DIRECTIVE',
      `Unsupported GraphQL directive "@${directive.name}".`,
      {
        hint: 'db supports @include(if: Boolean) and @skip(if: Boolean) executable directives.',
        details: {
          directive: directive.name,
        },
      },
    );
  }

  return true;
}

function directiveCondition(directive, variables) {
  if (!('if' in directive.arguments)) {
    throw dbError(
      'GRAPHQL_DIRECTIVE_MISSING_IF',
      `GraphQL directive "@${directive.name}" requires argument "if".`,
      {
        hint: `Use @${directive.name}(if: true) or pass a Boolean variable.`,
        details: {
          directive: directive.name,
        },
      },
    );
  }

  const value = evaluateValue(directive.arguments.if, variables);
  if (typeof value !== 'boolean') {
    throw dbError(
      'GRAPHQL_DIRECTIVE_INVALID_IF',
      `GraphQL directive "@${directive.name}" requires Boolean argument "if", but received ${describeValue(value)}.`,
      {
        hint: `Pass true, false, or a Boolean variable to @${directive.name}(if: ...).`,
        details: {
          directive: directive.name,
          received: describeValue(value),
        },
      },
    );
  }

  return value;
}

function requireFragment(fragments, name) {
  const fragment = fragments[name];
  if (!fragment) {
    throw dbError(
      'GRAPHQL_UNKNOWN_FRAGMENT',
      `Unknown GraphQL fragment "${name}".`,
      {
        hint: `Define fragment ${name} on TypeName { ... } in the same GraphQL document.`,
        details: {
          fragment: name,
          availableFragments: Object.keys(fragments),
        },
      },
    );
  }
  return fragment;
}

function typeConditionApplies(typeCondition, typeName) {
  return !typeCondition || !typeName || typeCondition === typeName;
}

function readArgument(selection, name, variables) {
  if (!(name in selection.arguments)) {
    return undefined;
  }

  return evaluateValue(selection.arguments[name], variables);
}

function readRequiredIdArgument(selection, variables) {
  const id = readArgument(selection, 'id', variables);
  if (id === undefined || id === null || id === '') {
    throw dbError(
      'GRAPHQL_MISSING_ID_ARGUMENT',
      `GraphQL field "${selection.name}" requires argument "id".`,
      {
        hint: `Use ${selection.name}(id: "example-id") { id } or pass a variable such as ${selection.name}(id: $id).`,
        details: { field: selection.name, argument: 'id' },
      },
    );
  }
  return id;
}

function evaluateValue(valueNode, variables) {
  switch (valueNode.kind) {
    case 'variable':
      if (!(valueNode.name in variables)) {
        throw dbError(
          'GRAPHQL_MISSING_VARIABLE',
          `GraphQL variable "$${valueNode.name}" was referenced but not provided.`,
          {
            hint: `Add "${valueNode.name}" to the variables object for this request.`,
            details: {
              variable: valueNode.name,
              providedVariables: Object.keys(variables),
            },
          },
        );
      }
      return variables[valueNode.name];
    case 'list':
      return valueNode.values.map((value) => evaluateValue(value, variables));
    case 'object':
      return Object.fromEntries(
        Object.entries(valueNode.fields).map(([name, value]) => [name, evaluateValue(value, variables)]),
      );
    case 'literal':
    default:
      return valueNode.value;
  }
}

function collectionRootName(resource) {
  return resource.name;
}

function singleRootName(resource) {
  return camelCase(singularResourceName(resource.name));
}

function responseKey(selection) {
  return selection.alias ?? selection.name;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function argumentTypeError(field, argument, expected, actual) {
  return dbError(
    'GRAPHQL_INVALID_ARGUMENT_TYPE',
    `GraphQL mutation "${field}" requires ${expected} argument "${argument}", but received ${describeValue(actual)}.`,
    {
      hint: `Pass ${field}(${argument}: { ... }) or provide a variable whose value is an object.`,
      details: {
        field,
        argument,
        expected,
        received: describeValue(actual),
      },
    },
  );
}

function introspectionSchema(db) {
  return {
    queryType: namedIntrospectionType('Query'),
    mutationType: namedIntrospectionType('Mutation'),
    subscriptionType: null,
    types: introspectionTypes(db),
    directives: [
      {
        name: 'include',
        description: 'Includes this field or fragment only when the if argument is true.',
        locations: ['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT'],
        args: [
          {
            name: 'if',
            description: null,
            type: nonNullType(scalarType('Boolean')),
            defaultValue: null,
          },
        ],
      },
      {
        name: 'skip',
        description: 'Skips this field or fragment when the if argument is true.',
        locations: ['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT'],
        args: [
          {
            name: 'if',
            description: null,
            type: nonNullType(scalarType('Boolean')),
            defaultValue: null,
          },
        ],
      },
    ],
  };
}

function introspectionType(db, name) {
  if (!name) {
    return null;
  }

  return introspectionTypes(db).find((type) => type.name === name) ?? null;
}

function introspectionTypes(db) {
  const resources = [...db.resources.values()];
  return [
    rootOperationType('Query', queryIntrospectionFields(db)),
    rootOperationType('Mutation', mutationIntrospectionFields(db)),
    scalarIntrospectionType('ID'),
    scalarIntrospectionType('String'),
    scalarIntrospectionType('Float'),
    scalarIntrospectionType('Boolean'),
    scalarIntrospectionType('JSON'),
    ...resources.map(resourceIntrospectionType),
    rootOperationType('__Schema', [
      fieldIntrospection('queryType', namedIntrospectionType('__Type')),
      fieldIntrospection('mutationType', namedIntrospectionType('__Type')),
      fieldIntrospection('subscriptionType', namedIntrospectionType('__Type')),
      fieldIntrospection('types', listType(namedIntrospectionType('__Type'))),
      fieldIntrospection('directives', listType(namedIntrospectionType('__Directive'))),
    ]),
    rootOperationType('__Type', [
      fieldIntrospection('kind', scalarType('String')),
      fieldIntrospection('name', scalarType('String')),
      fieldIntrospection('description', scalarType('String')),
      fieldIntrospection('fields', listType(namedIntrospectionType('__Field'))),
      fieldIntrospection('inputFields', listType(namedIntrospectionType('__InputValue'))),
      fieldIntrospection('interfaces', listType(namedIntrospectionType('__Type'))),
      fieldIntrospection('enumValues', listType(namedIntrospectionType('__EnumValue'))),
      fieldIntrospection('possibleTypes', listType(namedIntrospectionType('__Type'))),
      fieldIntrospection('ofType', namedIntrospectionType('__Type')),
    ]),
    rootOperationType('__Field', [
      fieldIntrospection('name', scalarType('String')),
      fieldIntrospection('description', scalarType('String')),
      fieldIntrospection('args', listType(namedIntrospectionType('__InputValue'))),
      fieldIntrospection('type', namedIntrospectionType('__Type')),
      fieldIntrospection('isDeprecated', scalarType('Boolean')),
      fieldIntrospection('deprecationReason', scalarType('String')),
    ]),
    rootOperationType('__InputValue', [
      fieldIntrospection('name', scalarType('String')),
      fieldIntrospection('description', scalarType('String')),
      fieldIntrospection('type', namedIntrospectionType('__Type')),
      fieldIntrospection('defaultValue', scalarType('String')),
    ]),
    rootOperationType('__EnumValue', [
      fieldIntrospection('name', scalarType('String')),
      fieldIntrospection('description', scalarType('String')),
      fieldIntrospection('isDeprecated', scalarType('Boolean')),
      fieldIntrospection('deprecationReason', scalarType('String')),
    ]),
    rootOperationType('__Directive', [
      fieldIntrospection('name', scalarType('String')),
      fieldIntrospection('description', scalarType('String')),
      fieldIntrospection('locations', listType(scalarType('String'))),
      fieldIntrospection('args', listType(namedIntrospectionType('__InputValue'))),
    ]),
  ];
}

function resourceIntrospectionType(resource) {
  return {
    kind: 'OBJECT',
    name: resource.typeName,
    description: resource.description ?? null,
    fields: Object.entries((resource.fields ?? {}) as Record<string, GraphqlField>).map(([fieldName, field]) => ({
      name: fieldName,
      description: field.description ?? null,
      args: [],
      type: introspectionFieldType(field, fieldName === resource.idField),
      isDeprecated: false,
      deprecationReason: null,
    })),
    inputFields: null,
    interfaces: [],
    enumValues: null,
    possibleTypes: null,
  };
}

function rootOperationType(name, fields) {
  return {
    kind: 'OBJECT',
    name,
    description: null,
    fields,
    inputFields: null,
    interfaces: [],
    enumValues: null,
    possibleTypes: null,
  };
}

function scalarIntrospectionType(name) {
  return {
    kind: 'SCALAR',
    name,
    description: null,
    fields: null,
    inputFields: null,
    interfaces: null,
    enumValues: null,
    possibleTypes: null,
  };
}

function queryIntrospectionFields(db) {
  return [
    fieldIntrospection('__schema', namedIntrospectionType('__Schema')),
    fieldIntrospection('__type', namedIntrospectionType('__Type'), [
      {
        name: 'name',
        description: null,
        type: nonNullType(scalarType('String')),
        defaultValue: null,
      },
    ]),
    ...[...db.resources.values()].flatMap((resource) => {
      if (resource.kind === 'document') {
        return [fieldIntrospection(resource.name, namedIntrospectionType(resource.typeName))];
      }

      return [
        fieldIntrospection(collectionRootName(resource), listType(namedIntrospectionType(resource.typeName))),
        fieldIntrospection(singleRootName(resource), namedIntrospectionType(resource.typeName), [
          {
            name: 'id',
            description: null,
            type: nonNullType(scalarType('ID')),
            defaultValue: null,
          },
        ]),
      ];
    }),
  ];
}

function mutationIntrospectionFields(db) {
  return [...db.resources.values()].flatMap((resource) => mutationActions(resource).map((action) => {
    const type = action === 'delete' ? scalarType('Boolean') : namedIntrospectionType(resource.typeName);
    return fieldIntrospection(`${action}${resource.typeName}`, type);
  }));
}

function fieldIntrospection(name, type, args = []) {
  return {
    name,
    description: null,
    args,
    type,
    isDeprecated: false,
    deprecationReason: null,
  };
}

function introspectionFieldType(field, isIdField = false) {
  const base = isIdField ? scalarType('ID') : scalarType(scalarNameForField(field));
  const type = field.type === 'array'
    ? listType(base)
    : base;
  return field.required ? nonNullType(type) : type;
}

function scalarNameForField(field) {
  switch (field.type) {
    case 'number':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    case 'string':
    case 'datetime':
    case 'enum':
      return 'String';
    case 'array':
    case 'object':
    case 'unknown':
    default:
      return 'JSON';
  }
}

function scalarType(name) {
  return {
    kind: 'SCALAR',
    name,
    ofType: null,
  };
}

function namedIntrospectionType(name) {
  return {
    kind: 'OBJECT',
    name,
    ofType: null,
  };
}

function listType(ofType) {
  return {
    kind: 'LIST',
    name: null,
    ofType,
  };
}

function nonNullType(ofType) {
  return {
    kind: 'NON_NULL',
    name: null,
    ofType,
  };
}

function availableQueryFields(db) {
  return [...db.resources.values()].flatMap((resource) => {
    if (resource.kind === 'document') {
      return [resource.name];
    }

    return [collectionRootName(resource), singleRootName(resource)];
  });
}

function availableMutationFields(db) {
  return [...db.resources.values()].flatMap((resource) => {
    const actions = resource.kind === 'collection'
      ? ['create', 'update', 'delete']
      : ['update', 'set'];
    return actions.map((action) => `${action}${resource.typeName}`);
  });
}
