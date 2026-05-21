// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.ts',
  },
  types: {
    enabled: true,
  },
  schema: {
    unknownFields: 'warn',
  },
});
