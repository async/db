export type FieldDefinition =
  | ({ type: 'string' } & FieldOptions<string>)
  | ({ type: 'datetime' } & FieldOptions<string>)
  | ({ type: 'bytes'; encoding?: BytesFieldEncoding } & FieldOptions<string>)
  | ({ type: 'number' } & FieldOptions<number>)
  | ({ type: 'boolean' } & FieldOptions<boolean>)
  | ({ type: 'enum'; values: readonly (string | number | boolean)[] } & FieldOptions<string | number | boolean>)
  | ({ type: 'object'; fields?: Record<string, FieldDefinition>; additionalProperties?: boolean } & FieldOptions<Record<string, unknown>>)
  | ({ type: 'array'; items?: FieldDefinition } & FieldOptions<unknown[]>)
  | ({ type: 'unknown' } & FieldOptions<unknown>);

export type DerivedFieldDefinition = {
  source: 'database' | 'external' | string;
  kind: string;
  owner?: string;
  details?: Record<string, unknown>;
};

export type SchemaFieldTag = 'public' | 'internal' | 'private' | string;

export type BytesFieldEncoding = 'base64' | 'base64url' | 'hex';

export type FieldBuilderDefinition = FieldDefinition & {
  tag(tag: SchemaFieldTag): FieldBuilderDefinition;
};

export type FieldOptions<DefaultValue> = {
  required?: boolean;
  nullable?: boolean;
  description?: string;
  default?: DefaultValue;
  tags?: readonly SchemaFieldTag[];
  visibility?: SchemaFieldTag;
  computed?: boolean;
  readOnly?: boolean;
  derived?: DerivedFieldDefinition;
  relation?: RelationDefinition;
  unique?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type FieldMetaOptions = FieldOptions<unknown> & {
  type?: FieldDefinition['type'];
  values?: readonly (string | number | boolean)[];
  fields?: Record<string, FieldDefinition>;
  items?: FieldDefinition;
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type RelationDefinition = {
  /** Output name used by REST expand, such as "author" for authorId. */
  name?: string;
  /** Target collection resource name. */
  to: string;
  /** Target collection field. Defaults to "id". */
  toField?: string;
  /** MVP supports explicit to-one expansion. */
  cardinality?: 'one' | 'many';
};

export type ObjectFieldOptions = FieldOptions<Record<string, unknown>> & {
  additionalProperties?: boolean;
};

export type BytesFieldOptions = FieldOptions<string> & {
  encoding?: BytesFieldEncoding;
  mediaType?: string;
  contentEncoding?: string;
};

export type ResourceIdentityDefinition = {
  fields: readonly string[];
};

export type ResourceLogDefinition = {
  cursorField?: string;
  order?: 'asc' | 'desc';
  payloadField?: string;
};

export type ResourceDefinition = {
  description?: string;
  idField?: string;
  identity?: ResourceIdentityDefinition;
  writePolicy?: 'append-only';
  log?: ResourceLogDefinition;
  source?: FilesSourceDefinition | GitFilesSourceDefinition | string | readonly string[];
  fields: Record<string, FieldDefinition>;
  seed?: unknown;
};

export type StandardSchemaIssue = {
  message?: string;
  path?: readonly unknown[];
  [key: string]: unknown;
};

export type StandardSchemaResult<Value = unknown> = {
  value?: Value;
  issues?: readonly StandardSchemaIssue[];
};

export type StandardSchemaV1<Input = unknown, Output = unknown> = {
  '~standard': {
    version: 1;
    vendor?: string;
    validate(value: Input): StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    jsonSchema?: {
      output?: (options?: Record<string, unknown>) => unknown;
    };
    [key: string]: unknown;
  };
};

export type StandardSchemaResourceOptions = Omit<ResourceDefinition, 'fields'> & {
  fields?: Record<string, FieldDefinition>;
};

export type StandardSchemaMixedResourceDefinition<Input = unknown, Output = unknown> =
  StandardSchemaResourceOptions & {
    /** Preferred object-first validator hook. */
    validator: StandardSchemaV1<Input, Output>;
    /** Compatibility alias for older examples. Prefer validator. */
    standardSchema?: StandardSchemaV1<Input, Output>;
  };

export type StandardSchemaLegacyMixedResourceDefinition<Input = unknown, Output = unknown> =
  StandardSchemaResourceOptions & {
    /** Compatibility alias. Prefer validator. */
    standardSchema: StandardSchemaV1<Input, Output>;
  };

export type FilesSourceDefinition = {
  kind: 'files';
  patterns: readonly string[];
  read?: 'frontmatter' | 'mdx' | 'json' | 'jsonc' | 'text' | string;
  /**
   * Component allow-list for read: 'mdx'. Docs may only use these capitalized
   * JSX tags (plus components they import or export themselves); anything else
   * fails sync with CONTENT_COMPONENT_NOT_ALLOWED.
   */
  components?: readonly string[];
};

export type GitFilesSourceDefinition = {
  kind: 'git-files';
  shape: 'files' | 'file' | 'collection-file';
  remote: string;
  patterns: readonly string[];
  read?: 'frontmatter' | 'md' | 'mdx' | 'json' | 'jsonc' | 'text' | string;
  idField?: string;
  bodyField?: string;
  allowJsoncWrites?: boolean;
  /**
   * Component allow-list for read: 'mdx'. Docs may only use these capitalized
   * JSX tags (plus components they import or export themselves); anything else
   * fails sync with CONTENT_COMPONENT_NOT_ALLOWED.
   */
  components?: readonly string[];
};

export type ComputedResolverThis = {
  get(key: string): unknown;
  has(key: string): boolean;
  value: unknown;
  record: unknown;
  records: unknown[] | undefined;
  args: unknown;
  db: unknown;
  resource: ResourceDefinition & { kind?: 'collection' | 'document' };
  field: FieldDefinition | undefined;
  fieldName: string | undefined;
  config: unknown;
  services: Record<string, unknown>;
  cache: Map<string, unknown>;
  _internal: {
    get(key: string): unknown;
    has(key: string): boolean;
    value: unknown;
    record: unknown;
    records: unknown[] | undefined;
    args: unknown;
    db: unknown;
    resource: ResourceDefinition & { kind?: 'collection' | 'document' };
    field: FieldDefinition | undefined;
    fieldName: string | undefined;
    config: unknown;
    services: Record<string, unknown>;
    cache: Map<string, unknown>;
  };
};

export type ComputedFieldResolver<RecordValue = Record<string, unknown>, Value = unknown> = {
  resolve?: (this: ComputedResolverThis, context: {
    record: RecordValue;
    db: unknown;
    resource: ResourceDefinition & { kind?: 'collection' | 'document' };
    cache: Map<string, unknown>;
    [key: string]: unknown;
  }) => Value | Promise<Value>;
  resolveMany?: (this: ComputedResolverThis, context: {
    records: RecordValue[];
    db: unknown;
    resource: ResourceDefinition & { kind?: 'collection' | 'document' };
    cache: Map<string, unknown>;
    [key: string]: unknown;
  }) => Map<string | number, Value> | Value[] | Record<string, Value> | Promise<Map<string | number, Value> | Value[] | Record<string, Value>>;
};

export function collection(definition: ResourceDefinition): ResourceDefinition & { kind: 'collection' };
export function collection<Input = unknown, Output = unknown>(
  definition: StandardSchemaMixedResourceDefinition<Input, Output>,
): StandardSchemaMixedResourceDefinition<Input, Output> & { kind: 'collection' };
export function collection<Input = unknown, Output = unknown>(
  definition: StandardSchemaLegacyMixedResourceDefinition<Input, Output>,
): StandardSchemaLegacyMixedResourceDefinition<Input, Output> & { kind: 'collection' };
export function collection<Input = unknown, Output = unknown>(
  definition: StandardSchemaV1<Input, Output>,
  options?: StandardSchemaResourceOptions,
): StandardSchemaResourceOptions & { kind: 'collection'; validator: StandardSchemaV1<Input, Output> };
export function document(definition: ResourceDefinition): ResourceDefinition & { kind: 'document' };
export function document<Input = unknown, Output = unknown>(
  definition: StandardSchemaMixedResourceDefinition<Input, Output>,
): StandardSchemaMixedResourceDefinition<Input, Output> & { kind: 'document' };
export function document<Input = unknown, Output = unknown>(
  definition: StandardSchemaLegacyMixedResourceDefinition<Input, Output>,
): StandardSchemaLegacyMixedResourceDefinition<Input, Output> & { kind: 'document' };
export function document<Input = unknown, Output = unknown>(
  definition: StandardSchemaV1<Input, Output>,
  options?: StandardSchemaResourceOptions,
): StandardSchemaResourceOptions & { kind: 'document'; validator: StandardSchemaV1<Input, Output> };
export function files(patterns: string | readonly string[], options?: {
  read?: FilesSourceDefinition['read'];
  components?: FilesSourceDefinition['components'];
}): FilesSourceDefinition;

export const field: {
  string(options?: FieldOptions<string>): FieldBuilderDefinition;
  datetime(options?: FieldOptions<string>): FieldBuilderDefinition;
  bytes(options?: BytesFieldOptions): FieldBuilderDefinition;
  number(options?: FieldOptions<number>): FieldBuilderDefinition;
  boolean(options?: FieldOptions<boolean>): FieldBuilderDefinition;
  enum<const Values extends readonly (string | number | boolean)[]>(
    values: Values,
    options?: FieldOptions<Values[number]>,
  ): FieldBuilderDefinition;
  object(fields?: Record<string, FieldDefinition>, options?: ObjectFieldOptions): FieldBuilderDefinition;
  array(items?: FieldDefinition, options?: FieldOptions<unknown[]>): FieldBuilderDefinition;
  json(options?: FieldOptions<unknown>): FieldBuilderDefinition;
  meta(options?: FieldMetaOptions): FieldBuilderDefinition;
  nullable(definition: FieldDefinition, options?: Omit<FieldOptions<unknown>, 'nullable'>): FieldBuilderDefinition;
  computed(definition: FieldDefinition, resolver?: ComputedFieldResolver['resolve'] | ComputedFieldResolver): FieldBuilderDefinition;
  derived(definition: FieldDefinition, options: DerivedFieldDefinition): FieldBuilderDefinition;
};
