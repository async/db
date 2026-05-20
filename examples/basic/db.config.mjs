// @ts-check
import { defineConfig } from '@async/db/config';

export default defineConfig({
  dbDir: './db',
  stateDir: './.db',
  types: {
    enabled: true,
    outFile: './.db/types/index.ts',
    commitOutFile: './src/generated/db.types.ts',
    emitComments: true,
  },
  schema: {
    unknownFields: 'warn',
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
