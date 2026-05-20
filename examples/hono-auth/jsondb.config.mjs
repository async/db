// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.jsondb',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
  },
});
