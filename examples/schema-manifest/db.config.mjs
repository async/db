// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.d.ts',
    committedTypes: './src/generated/db.types.d.ts',
    schemaManifest: './src/generated/db.schema.json',
  },
  types: {
    enabled: true,
    emitComments: true,
  },
  schemaManifest: {
    customizeField({ resourceName, fieldName, defaultManifest }) {
      if (resourceName === 'projects' && fieldName === 'status') {
        return {
          ...defaultManifest,
          ui: {
            ...defaultManifest.ui,
            component: 'segmented-control',
          },
        };
      }

      if (resourceName === 'users' && fieldName === 'bio') {
        return {
          ...defaultManifest,
          ui: {
            ...defaultManifest.ui,
            component: 'markdown',
          },
        };
      }

      return defaultManifest;
    },
  },
});
