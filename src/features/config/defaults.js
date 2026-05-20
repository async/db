export const DEFAULT_CONFIG = {
  dbDir: './db',
  sourceDir: './db',
  stateDir: './.db',
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
    outFile: './.db/types/index.ts',
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
      outDir: './db-api',
      api: ['rest'],
      db: 'sqlite',
      app: 'standalone',
      runtime: 'node-sqlite',
      seed: false,
    },
  },
};
