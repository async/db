#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDocsPreviewServer } from '../../website/serve.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = parseArgs(process.argv.slice(2));

const app = await startDocsPreviewServer({
  cwd: path.join(repoRoot, 'website'),
  host: options.host,
  port: options.port,
  skipSync: options.skipSync,
});

console.log(`Docs preview: ${app.url}/`);
console.log(`Built-in viewer: ${app.url}/__db`);

function parseArgs(argv) {
  let port = 7340;
  let host = '127.0.0.1';
  let skipSync = false;
  for (let index = 0; index < argv.length; index += 1) {
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
