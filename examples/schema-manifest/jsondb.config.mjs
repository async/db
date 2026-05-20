// @ts-check
import { defineConfig } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.jsondb',
  schemaOutFile: './src/generated/jsondb.schema.json',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
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
