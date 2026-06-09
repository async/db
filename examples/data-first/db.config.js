// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.d.ts',
  },
  types: {
    enabled: true,
  },
});
