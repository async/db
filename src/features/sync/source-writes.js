import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeText } from '../../fs-utils.js';
import { resourceConfigValue } from '../../names.js';

export async function writeGeneratedIdsToSources(config, resources, logs) {
  for (const resource of resources) {
    if (!usesSourceFileStore(config, resource) || !resource.generatedIds || resource.dataFormat !== 'json' || !resource.dataPath) {
      continue;
    }

    const text = `${JSON.stringify(resource.seed, null, 2)}\n`;
    await writeText(resource.dataPath, text);
    resource.dataHash = createHash('sha256').update(text).digest('hex');
    resource.generatedIds = false;
    logs.push(`Updated ${path.relative(config.cwd, resource.dataPath)} with generated ids`);
  }
}

function usesSourceFileStore(config, resource) {
  const resourceConfig = resourceConfigValue(config.resources, resource.name);
  const storeName = resourceConfig?.store ?? config.stores?.default ?? 'json';
  const configured = config.stores?.[storeName] ?? storeName;
  const driver = typeof configured === 'string' ? configured : configured?.driver ?? storeName;
  return driver === 'sourceFile';
}
