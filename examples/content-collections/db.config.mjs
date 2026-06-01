// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
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
    blog: {
      store: 'static',
    },
    docs: {
      store: 'static',
    },
  },
});
