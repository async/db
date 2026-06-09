#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { startSchemaUiServer } from './src/start-schema-ui-server.js';

const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));

const app = await startSchemaUiServer({
  cwd: exampleRoot,
  host: options.host,
  port: options.port,
  skipSync: options.skipSync,
});

console.log(`Schema UI SSR + db: ${app.url}/`);
console.log(`Built-in viewer: ${app.url}/__db`);
console.log(`Static templates (no records): ${app.url}/templates`);

function parseArgs(argv) {
  let port = 7342;
  let host = '127.0.0.1';
  let skipSync = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--port' && argv[index + 1]) {
      port = Number(argv[++index]);
    } else if (arg === '--host' && argv[index + 1]) {
      host = argv[++index];
    } else if (arg === '--no-sync') {
      skipSync = true;
    }
  }

  return { port, host, skipSync };
}
