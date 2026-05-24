export type FieldDefinition =
  | ({ type: 'string' } & FieldOptions<string>)
  | ({ type: 'datetime' } & FieldOptions<string>)
  | ({ type: 'number' } & FieldOptions<number>)
  | ({ type: 'boolean' } & FieldOptions<boolean>)
  | ({ type: 'enum'; values: readonly (string | number | boolean)[] } & FieldOptions<string | number | boolean>)
  | ({ type: 'object'; fields?: Record<string, FieldDefinition>; additionalProperties?: boolean } & FieldOptions<Record<string, unknown>>)
  | ({ type: 'array'; items?: FieldDefinition } & FieldOptions<unknown[]>)
  | ({ type: 'unknown' } & FieldOptions<unknown>);

export type FieldOptions<DefaultValue> = {
  required?: boolean;
  nullable?: boolean;
  description?: string;
  default?: DefaultValue;
  computed?: boolean;
  readOnly?: boolean;
  relation?: RelationDefinition;
  unique?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
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

export type ResourceDefinition = {
  description?: string;
  idField?: string;
  source?: FilesSourceDefinition | string | readonly string[];
  fields: Record<string, FieldDefinition>;
  seed?: unknown;
};

export type FilesSourceDefinition = {
  kind: 'files';
  patterns: readonly string[];
  read?: 'frontmatter' | 'json' | 'jsonc' | 'text' | string;
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
export function document(definition: ResourceDefinition): ResourceDefinition & { kind: 'document' };
export function files(patterns: string | readonly string[], options?: { read?: FilesSourceDefinition['read'] }): FilesSourceDefinition;

export const field: {
  string(options?: FieldOptions<string>): FieldDefinition;
  datetime(options?: FieldOptions<string>): FieldDefinition;
  number(options?: FieldOptions<number>): FieldDefinition;
  boolean(options?: FieldOptions<boolean>): FieldDefinition;
  enum<const Values extends readonly (string | number | boolean)[]>(
    values: Values,
    options?: FieldOptions<Values[number]>,
  ): FieldDefinition;
  object(fields?: Record<string, FieldDefinition>, options?: ObjectFieldOptions): FieldDefinition;
  array(items?: FieldDefinition, options?: FieldOptions<unknown[]>): FieldDefinition;
  json(options?: FieldOptions<unknown>): FieldDefinition;
  nullable(definition: FieldDefinition, options?: Omit<FieldOptions<unknown>, 'nullable'>): FieldDefinition;
  computed(definition: FieldDefinition, resolver?: ComputedFieldResolver['resolve'] | ComputedFieldResolver): FieldDefinition;
};
