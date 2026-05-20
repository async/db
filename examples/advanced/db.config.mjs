// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.db',
  types: {
    enabled: true,
    outFile: './.db/types/index.ts',
    commitOutFile: './src/generated/db.types.ts',
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
  },
});
