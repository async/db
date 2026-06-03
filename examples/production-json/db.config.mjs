// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.d.ts',
    committedTypes: './src/generated/db.types.d.ts',
    operationRefs: './src/generated/db.operation-refs.json',
  },
  types: {
    enabled: true,
    emitComments: true,
  },
  schema: {
    unknownFields: 'error',
  },
  operations: {
    enabled: true,
    acceptRefs: 'ref',
    sourceDir: './db/operations',
  },
  server: {
    expose: {
      rest: 'registered-only',
      graphql: false,
      viewer: 'dev',
      schema: 'dev',
      manifest: 'dev',
    },
  },
});
