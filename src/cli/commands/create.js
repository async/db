import { openDb } from '../../db.js';

export async function runCreate(config, args) {
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
