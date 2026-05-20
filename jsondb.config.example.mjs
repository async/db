// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  // Fixture source folder. Defaults to './db'.
  dbDir: './db',

  // Runtime output folder. Defaults to './.jsondb'.
  stateDir: './.jsondb',

  // Optional committed JSON schema manifest for model-driven admin/CMS UIs.
  // Generated during `jsondb sync` when set.
  schemaOutFile: null,

  // Optional visitor hook for changing or omitting generated manifest fields.
  schemaManifest: {
    customizeField({ defaultManifest }) {
      return defaultManifest;
    },
  },

  // Optional custom source readers. Built-in readers handle JSON, JSONC, CSV,
  // .schema.json, .schema.jsonc, and .schema.mjs. Custom readers run first.
  sources: {
    writePolicy: 'preserve',
    readers: [],
  },

  // Runtime stores. The default json store writes app edits to
  // .jsondb/state/<resource>.json while keeping source fixtures unchanged.
  // Bind a resource to sourceFile only when supported writebacks should update
  // a plain .json source fixture.
  stores: {
    default: 'json',
  },

  resources: {
    // users: { store: 'sourceFile' },
    // activityEvents: {
    //   store: 'json',
    //   indexes: [
    //     { fields: ['observedAt'] },
    //     { fields: ['domain', 'observedAt'] },
    //   ],
    // },
  },

  // Generated TypeScript types. The default outFile is gitignored; commitOutFile
  // is useful when app code imports generated types in CI or fresh checkouts.
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: null,
    useReadonly: false,
    emitComments: true,
  },

  // Default local development behavior is permissive: unknown schema-backed
  // fields warn. Use 'error' when you want schema drift to fail sync/writes.
  schema: {
    unknownFields: 'warn',
  },

  // Optional schema-only mock records. Leave off when real fixture data exists.
  seed: {
    generateFromSchema: false,
    generatedCount: 5,
  },

  // Local server settings.
  server: {
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
  },

  // Local latency is on by default so loading states are visible. Use 0 to
  // disable delay, 50 for a fixed 50ms delay, or [50, 300] for a range.
  // Random errors are off by default.
  mock: {
    delay: [30, 100],
    errors: null,
  },

  // Optional database forks for temporary legacy fixture shapes.
  // Each name maps to ./db.forks/<name> unless you use object form.
  forks: [],
});
