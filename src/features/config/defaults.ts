type NullableOutput = string | null;

type DefaultConfig = {
  dbDir: string;
  sourceDir: string;
  stateDir: string;
  outputs: {
    stateDir: string;
    types: string;
    committedTypes: NullableOutput;
    schemaManifest: NullableOutput;
    viewerManifest: NullableOutput;
    operationRegistry: NullableOutput;
    operationRefs: NullableOutput;
    contractRefs: NullableOutput;
    honoStarterDir: string;
  };
  schemaOutFile: NullableOutput;
  viewerManifestOutFile: NullableOutput;
  schemaManifest: Record<string, unknown>;
  sources: {
    readers: unknown[];
    writePolicy: 'preserve' | string;
  };
  stores: {
    default: string;
    json: {
      driver: string;
    };
  };
  types: {
    enabled: boolean;
    outFile: string;
    commitOutFile: NullableOutput;
    useReadonly: boolean;
    emitComments: boolean;
    exportRuntimeHelpers: boolean;
  };
  schema: {
    source: 'auto' | string;
    allowJsonc: boolean;
    autoModulePackageJson: boolean;
    standardSchema: boolean;
    unknownFields: 'warn' | string;
    additiveChanges: 'auto' | string;
    destructiveChanges: 'manual' | string;
    typeChanges: 'manual' | string;
  };
  defaults: {
    applyOnCreate: boolean;
    applyOnSafeMigration: boolean;
  };
  seed: {
    generateFromSchema: boolean;
    generatedCount: number;
  };
  collections: Record<string, unknown>;
  resources: {
    naming: 'basename' | string;
  };
  server: {
    apiBase: string;
    dataPath: string | false;
    host: string;
    port: number;
    maxBodyBytes: number;
    viewerLinks: unknown[];
  };
  rest: {
    enabled: boolean;
  };
  graphql: {
    enabled: boolean;
    path: string;
  };
  falcor: {
    enabled: boolean;
    path: string;
  };
  operations: {
    enabled: boolean;
    strict: boolean;
    sourceDir: string;
    outFile: NullableOutput;
    refsOutFile: NullableOutput;
    acceptRefs: 'both' | string;
    registry: Record<string, unknown>;
  };
  contracts: Record<string, unknown>;
  mock: {
    delay: [number, number] | number | false;
    errors: unknown;
  };
  generate: {
    hono: {
      outDir: string;
      api: string[];
      db: string;
      app: string;
      runtime: string;
      seed: boolean;
    };
  };
};

export const DEFAULT_CONFIG: DefaultConfig = {
  dbDir: './db',
  sourceDir: './db',
  stateDir: './.db',
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.d.ts',
    committedTypes: null,
    schemaManifest: null,
    viewerManifest: null,
    operationRegistry: null,
    operationRefs: null,
    contractRefs: null,
    honoStarterDir: './db-api',
  },
  schemaOutFile: null,
  viewerManifestOutFile: null,
  schemaManifest: {},
  sources: {
    readers: [],
    writePolicy: 'preserve',
  },
  stores: {
    default: 'json',
    json: {
      driver: 'json',
    },
  },
  types: {
    enabled: true,
    outFile: './.db/types/index.d.ts',
    commitOutFile: null,
    useReadonly: false,
    emitComments: true,
    exportRuntimeHelpers: true,
  },
  schema: {
    source: 'auto',
    allowJsonc: true,
    autoModulePackageJson: true,
    standardSchema: false,
    unknownFields: 'warn',
    additiveChanges: 'auto',
    destructiveChanges: 'manual',
    typeChanges: 'manual',
  },
  defaults: {
    applyOnCreate: true,
    applyOnSafeMigration: true,
  },
  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },
  collections: {},
  resources: {
    naming: 'basename',
  },
  server: {
    apiBase: '/__db',
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
    viewerLinks: [],
  },
  rest: {
    enabled: true,
  },
  graphql: {
    enabled: false,
    path: '/graphql',
  },
  falcor: {
    enabled: false,
    path: '/model.json',
  },
  operations: {
    enabled: false,
    strict: false,
    sourceDir: './db/operations',
    outFile: null,
    refsOutFile: null,
    acceptRefs: 'both',
    registry: {},
  },
  contracts: {},
  mock: {
    delay: [30, 100],
    errors: null,
  },
  generate: {
    hono: {
      outDir: './db-api',
      api: ['rest'],
      db: 'sqlite',
      app: 'standalone',
      runtime: 'node-sqlite',
      seed: false,
    },
  },
};
