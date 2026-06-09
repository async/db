import { readFile } from 'node:fs/promises';
import { createDbClient } from '@async/db/client';

const baseUrl = process.env.ASYNC_DB_URL ?? 'http://127.0.0.1:7331';
const refsUrl = new URL('./generated/db.operation-refs.json', import.meta.url);
const operationRefs = await readOperationRefs(refsUrl);
const client = createDbClient({ baseUrl });

const controlPlane = await client.query(operationRefs.operations.GetControlPlane.ref);
const billingFlag = await client.query(operationRefs.operations.GetFeatureFlag.ref, {
  id: 'flag_billing_v2',
});

console.log(JSON.stringify({
  controlPlane,
  billingFlag,
}, null, 2));

async function readOperationRefs(url) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Run `npm run db -- operations build --cwd ./examples/production-json` before running this demo.');
    }
    throw error;
  }
}
