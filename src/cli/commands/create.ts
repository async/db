import { openDb } from '../../db.js';

type CliConfig = Record<string, unknown>;

export async function runCreate(config: CliConfig, args: string[]): Promise<void> {
  const [collectionName, json] = args;
  if (!collectionName || !json) {
    throw new Error('Usage: async-db create <collection> <json>');
  }

  const db = await openDb({
    ...config,
    syncOnOpen: true,
  });
  const record = await db.collection(collectionName).create(JSON.parse(json));
  console.log(JSON.stringify(record, null, 2));
}
