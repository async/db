// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  outputs: {
    stateDir: './.db',
    types: './.db/types/index.d.ts',
    committedTypes: './src/generated/db.types.d.ts',
    operationRegistry: './src/generated/db.operations.json',
    operationRefs: './src/generated/db.operation-refs.json',
  },
  types: {
    enabled: true,
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
  },
  operations: {
    enabled: false,
    sourceDir: './db/operations',
  },
  rest: {
    formats: {
      yaml: {
        mediaTypes: ['application/yaml', 'text/yaml'],
        contentType: 'application/yaml; charset=utf-8',
        render({ data }) {
          return `${toYaml(data)}\n`;
        },
      },
    },
  },
});

function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') {
        return `${pad}-\n${toYaml(item, indent + 2)}`;
      }
      return `${pad}- ${formatYamlScalar(item)}`;
    }).join('\n');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      if (item && typeof item === 'object') {
        return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
      }
      return `${pad}${key}: ${formatYamlScalar(item)}`;
    }).join('\n');
  }

  return `${pad}${formatYamlScalar(value)}`;
}

function formatYamlScalar(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === null) {
    return 'null';
  }
  return String(value);
}
