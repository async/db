// @ts-check
// Repo-internal import; a consumer project would write:
// import { defineConfig } from '@async/db/config';
import { defineConfig } from '../dist/config-public.js';

export default defineConfig({
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.d.ts',
    committedTypes: './src/generated/db.types.d.ts',
  },
  types: {
    enabled: true,
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
  },
  resources: {
    pages: {
      store: 'static',
    },
  },
});
