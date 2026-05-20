// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.jsondb',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
  },
});
