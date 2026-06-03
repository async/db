// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  // Generated output locations. Most committed outputs are opt-in.
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.ts',
    committedTypes: null,
    schemaManifest: null,
    viewerManifest: null,
    operationRegistry: null,
    operationRefs: null,
    honoStarterDir: './db-api',
  },

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
  // .db/state/<resource>.json while keeping source fixtures unchanged.
  // Set stores.default to sourceFile when every plain .json resource should
  // save directly back into db/<resource>.json. Optional database stores such as
  // @async/db/postgres, @async/db/kv, and @async/db/redis accept injected
  // clients so the core package stays dependency-light.
  stores: {
    default: 'json',
    // postgres: postgresStore({ client: pgPool }),
    // redis: redisStore({ client: redisClient, prefix: 'my-app:' }),
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

  // Generated TypeScript type behavior. Paths live under `outputs`.
  types: {
    enabled: true,
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
    // Dev-tool route base for the viewer, schema, batch, import, events, and log.
    // Defaults to '/__db'.
    apiBase: '/__db',
    // App-facing REST data route alias. Defaults to '/db'; set false to only
    // use scoped REST under /__db/rest and standalone root REST routes.
    dataPath: '/db',
    host: '127.0.0.1',
    port: 7331,
    maxBodyBytes: 1048576,
    // Opt-in request tracing. When enabled, traces are written to /__db/log,
    // concise console lines are printed, and responses get a request id header.
    // Trace metadata includes query keys only, never request bodies, response
    // bodies, cookie headers, authorization headers, or query values.
    trace: {
      enabled: false,
      slowMs: 100,
      console: true,
      events: true,
      header: 'x-async-db-request-id',
    },
    // Optional custom data viewer links shown in discovery and manifest output.
    viewerLinks: [
      // { label: 'My Viewer', href: 'http://127.0.0.1:5173/db' },
    ],
  },

  // REST and manifest response formats. Built-ins are json, html, and md.
  // Object entries can register media types for Accept negotiation and can
  // render both resource routes and /__db/manifest.<extension>.
  rest: {
    formats: {
      default: 'json',
      // yaml: {
      //   mediaTypes: ['application/yaml', 'text/yaml'],
      //   contentType: 'application/yaml; charset=utf-8',
      //   render({ data }) {
      //     return stringifyYaml(data);
      //   },
      // },
    },
  },

  // Local latency is on by default so loading states are visible. Use 0 to
  // disable delay, 50 for a fixed 50ms delay, or [50, 300] for a range.
  // Random errors are off by default.
  mock: {
    delay: [30, 100],
    errors: null,
  },

});
