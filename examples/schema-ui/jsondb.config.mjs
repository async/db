// @ts-check
import { defineConfig, mergeManifest } from 'jsondb/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.jsondb',
  schemaOutFile: './src/generated/jsondb.schema.json',
  mode: 'mirror',
  types: {
    enabled: true,
    outFile: './.jsondb/types/index.ts',
    commitOutFile: './src/generated/jsondb.types.ts',
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
