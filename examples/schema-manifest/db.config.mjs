// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.db',
  schemaOutFile: './src/generated/db.schema.json',
  types: {
    enabled: true,
    outFile: './.db/types/index.ts',
    commitOutFile: './src/generated/db.types.ts',
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
