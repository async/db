export const DEFAULT_CONFIG = {
  dbDir: './db',
  sourceDir: './db',
  stateDir: './.jsondb',
  schemaOutFile: null,
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
    outFile: './.jsondb/types/index.ts',
    commitOutFile: null,
    useReadonly: false,
    emitComments: true,
    exportRuntimeHelpers: true,
  },
  schema: {
    source: 'auto',
    allowJsonc: true,
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
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },
  rest: {
    enabled: true,
  },
  graphql: {
    enabled: true,
    path: '/graphql',
  },
  mock: {
    delay: [30, 100],
    errors: null,
  },
  forks: {},
  generate: {
    hono: {
      outDir: './jsondb-api',
      api: ['rest'],
      db: 'sqlite',
      app: 'standalone',
      runtime: 'node-sqlite',
      seed: false,
    },
  },
};
