// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.ts',
    committedTypes: './src/generated/db.types.ts',
  },
  types: {
    enabled: true,
    emitComments: true,
  },
});
