// @ts-check
import { defineConfig } from '@async/db/config';

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
});
