// @ts-check
import { defineConfig, mergeManifest } from '@async/db/config';

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
    customizeResource({ resourceName, defaultManifest }) {
      if (resourceName !== 'pages') {
        return defaultManifest;
      }

      return mergeManifest(defaultManifest, {
        editor: {
          title: 'Pages',
          description: 'CMS pages edited from generated schema metadata.',
        },
      });
    },

    customizeField({ resourceName, fieldName, defaultManifest }) {
      if (resourceName !== 'pages') {
        return defaultManifest;
      }

      if (fieldName === 'bodyMarkdown') {
        return mergeManifest(defaultManifest, {
          ui: {
            label: 'Body',
            component: 'markdown',
          },
        });
      }

      if (fieldName === 'status') {
        return mergeManifest(defaultManifest, {
          ui: {
            component: 'segmented-control',
          },
        });
      }

      return defaultManifest;
    },
  },
});
