#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createExampleRuntime } from './example-launcher.js';

const root = process.cwd();
const execFileAsync = promisify(execFile);
type ServeExamplesOptions = {
  host?: string;
  port?: number | string;
  tailscaleServe?: boolean;
  createRuntime?: typeof createExampleRuntime;
  detectTailscaleHost?: () => Promise<string | undefined> | string | undefined;
  detectTailscaleNetwork?: () => Promise<TailscaleNetwork | undefined> | TailscaleNetwork | undefined;
  runTailscaleServe?: TailscaleServeRunner;
};
type TailscaleNetwork = {
  ipv4?: string;
  dnsName?: string;
};
type TailscaleServeRunner = (options: { port: number }) => Promise<TailscaleServeCommandResult> | TailscaleServeCommandResult;
type TailscaleServeCommandResult = {
  stdout?: string;
  stderr?: string;
};

const options = parseArgs(process.argv.slice(2));

if (import.meta.url === `file://${process.argv[1]}`) {
  let stack: Awaited<ReturnType<typeof serveExamples>> | undefined;
  const shutdown = async () => {
    await stopExamplesStack(stack);
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  serveExamples(options).then((started) => {
    stack = started;
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export async function serveExamples(options: ServeExamplesOptions = {}) {
  const examplesAddress = await resolveExamplesAddress({
    host: options.host,
    detectTailscaleHost: options.detectTailscaleHost,
    detectTailscaleNetwork: options.detectTailscaleNetwork,
  });
  const host = examplesAddress.host;
  const indexPort = Number(options.port ?? 7329);
  const runtimeFactory = options.createRuntime ?? createExampleRuntime;
  const discoveredExamples = await findExamples(path.join(root, 'examples'));

  if (discoveredExamples.length === 0) {
    throw new Error('No examples found.');
  }

  const runtimes = new Map();
  const examplesByName = new Map();
  let routeExamples = [];
  let examples = [];
  let indexUrl = '';
  const indexServer = http.createServer(async (request, response) => {
    try {
      const publicOrigin = resolveRequestOrigin(request, indexUrl);
      const publicExamples = describeHostedExamples(routeExamples, publicOrigin);

      if (request.url === '/examples.json') {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(`${JSON.stringify(publicExamples.map(publicExample), null, 2)}\n`);
        return;
      }

      if (isIndexRequest(request.url)) {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
        });
        response.end(renderExamplesIndex(publicExamples));
        return;
      }

      const route = resolveExampleRoute(request.url, examplesByName);
      if (!route) {
        sendNotFound(response);
        return;
      }

      let runtime = runtimes.get(route.example.name);
      if (!runtime) {
        const publicExample = describeHostedExample(route.example, publicOrigin);
        runtime = await runtimeFactory({
          example: publicExample,
          cwd: route.example.cwd,
          repoRoot: root,
          basePath: route.example.basePath,
          url: publicExample.url,
        });
        runtimes.set(route.example.name, runtime);
      }

      await runtime.handleRequest(request, response);
    } catch (error) {
      sendHostError(response, error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    indexServer.once('error', reject);
    indexServer.listen(indexPort, host, () => resolve());
  });

  const serverAddress = indexServer.address();
  const boundPort = serverAddress && typeof serverAddress === 'object' ? serverAddress.port : indexPort;
  indexUrl = `http://${host}:${boundPort}`;
  let tailscaleServeResult: Awaited<ReturnType<typeof startTailscaleServe>> | undefined;
  if (options.tailscaleServe) {
    try {
      tailscaleServeResult = await startTailscaleServe({
        port: boundPort,
        runTailscaleServe: options.runTailscaleServe,
        detectTailscaleNetwork: options.detectTailscaleNetwork,
      });
    } catch (error) {
      await closeServer(indexServer);
      throw error;
    }
  }
  routeExamples = discoveredExamples.map(describeRoutableExample);
  examples = describeHostedExamples(routeExamples, indexUrl);
  for (const example of routeExamples) {
    examplesByName.set(example.name, example);
  }

  for (const line of formatExamplesConsoleSummary({
    indexUrl,
    tailscaleServeUrl: tailscaleServeResult?.httpsUrl,
    tailscaleOutput: tailscaleServeResult?.output,
    examples,
  })) {
    console.log(line);
  }

  const stack = {
    get indexUrl() {
      return indexUrl;
    },
    get tailscaleServeUrl() {
      return tailscaleServeResult?.httpsUrl;
    },
    indexServer,
    examples,
    runtimes,
    startedExampleNames() {
      return [...runtimes.keys()];
    },
    async close() {
      await stopExamplesStack(stack);
    },
  };

  return stack;
}

export async function resolveExamplesHost(options: {
  host?: string;
  detectTailscaleHost?: () => Promise<string | undefined> | string | undefined;
} = {}) {
  return (await resolveExamplesAddress(options)).host;
}

export async function resolveExamplesAddress(options: {
  host?: string;
  detectTailscaleHost?: () => Promise<string | undefined> | string | undefined;
  detectTailscaleNetwork?: () => Promise<TailscaleNetwork | undefined> | TailscaleNetwork | undefined;
} = {}) {
  const host = options.host ?? '127.0.0.1';
  const network = options.detectTailscaleNetwork
    ? await options.detectTailscaleNetwork()
    : undefined;
  const tailscaleHostname = cleanTailscaleDnsName(network?.dnsName);

  return {
    host,
    ...(tailscaleHostname ? { tailscaleHostname } : {}),
  };
}

export function formatExamplesConsoleSummary({ indexUrl, tailscaleServeUrl, tailscaleOutput, examples }: {
  indexUrl: string;
  tailscaleServeUrl?: string;
  tailscaleOutput?: string;
  examples: Array<{ name: string } & Record<string, unknown>>;
}) {
  const lines = [
    `db examples directory: ${indexUrl}`,
  ];

  if (tailscaleServeUrl) {
    lines.push(`tailscale serve HTTPS: ${tailscaleServeUrl}`);
  }

  const visibleOutput = String(tailscaleOutput ?? '').trim();
  if (visibleOutput) {
    lines.push(
      'tailscale serve output:',
      ...visibleOutput.split(/\r?\n/u).map((line) => `  ${line}`),
    );
  }

  lines.push(
    'examples:',
    ...examples.map((example) => `  ${example.name}`),
    'Press Ctrl+C to stop.',
  );

  return lines;
}

export async function startTailscaleServe(options: {
  port: number;
  runTailscaleServe?: TailscaleServeRunner;
  detectTailscaleNetwork?: () => Promise<TailscaleNetwork | undefined> | TailscaleNetwork | undefined;
}) {
  const runTailscaleServe = options.runTailscaleServe ?? defaultRunTailscaleServe;
  const result = await runTailscaleServe({ port: options.port });
  const output = formatTailscaleOutput(result);
  const outputUrl = findTailscaleHttpsUrl(output);
  const network = outputUrl
    ? undefined
    : await (options.detectTailscaleNetwork ?? defaultDetectTailscaleNetwork)();
  const tailscaleHostname = cleanTailscaleDnsName(network?.dnsName);
  const httpsUrl = outputUrl ?? (tailscaleHostname ? `https://${tailscaleHostname}` : undefined);

  return {
    ...(httpsUrl ? { httpsUrl } : {}),
    output,
  };
}

export function tailscaleServeArgs(port: number) {
  return ['serve', '--bg', String(port)];
}

export function resolveRequestOrigin(request, fallbackOrigin) {
  const forwardedHost = firstHeaderValue(request.headers?.['x-forwarded-host']);
  const host = forwardedHost ?? firstHeaderValue(request.headers?.host);
  if (!host) {
    return fallbackOrigin;
  }

  const forwardedProto = firstHeaderValue(request.headers?.['x-forwarded-proto']);
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : 'http';

  return `${protocol}://${host}`;
}

export async function stopExamplesStack(stack: Awaited<ReturnType<typeof serveExamples>> | undefined) {
  if (!stack) {
    return;
  }

  await closeServer(stack.indexServer);
  if (stack.runtimes instanceof Map) {
    for (const runtime of stack.runtimes.values()) {
      await runtime.close?.();
    }
  }
}

export async function findExamples(examplesDir) {
  const entries = await readdir(examplesDir, { withFileTypes: true });
  const examples = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const cwd = path.join(examplesDir, entry.name);
    const metadata = await readExampleMetadata(cwd, entry.name);
    examples.push({
      name: entry.name,
      ...metadata,
      cwd,
      relativePath: path.relative(root, cwd),
      hasCustomRuntime: await fileExists(path.join(cwd, 'serve-example.mjs')),
    });
  }

  return examples.sort((left, right) => left.name.localeCompare(right.name));
}

export function renderExamplesIndex(examples) {
  const rows = examples.map((example) => `
        <article class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="text-base font-semibold text-slate-950">${escapeHtml(example.title ?? titleFromName(example.name))}</h2>
              <p class="mt-1 text-sm text-slate-600">${escapeHtml(example.relativePath)}</p>
            </div>
            <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">${escapeHtml(example.starterKind ?? 'db')}</span>
          </div>
          <p class="mt-3 text-sm text-slate-700">${escapeHtml(example.description ?? '')}</p>
          <div class="mt-3 flex flex-wrap gap-1.5">${renderTags(example.tags ?? [])}</div>
          <div class="mt-4 flex flex-wrap gap-2">
            <a class="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800" href="${escapeHtml(example.demoUrl ?? example.viewerUrl)}">${escapeHtml(example.demoUrl ? 'Open demo' : 'Open viewer')}</a>
            ${example.demoUrl ? `<a class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-700" href="${escapeHtml(example.viewerUrl)}">Built-in viewer</a>` : ''}
            ${renderDemoLinks(example)}
            <a class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-700" href="${escapeHtml(example.url)}/__db/schema">Schema JSON</a>
            <a class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-700" href="${escapeHtml(example.url)}/graphql">GraphQL SDL</a>
          </div>
        </article>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>db examples</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="bg-slate-50 text-slate-950">
  <main class="mx-auto max-w-5xl px-5 py-8">
    <header class="mb-6">
      <h1 class="text-2xl font-bold tracking-normal">db examples</h1>
      <p class="mt-2 text-sm text-slate-600">Examples run through this single host and start lazily when opened. Examples may ship <code class="rounded bg-slate-100 px-1 py-0.5 text-xs">serve-example.mjs</code> to mount custom middleware ahead of the db REST stack.</p>
    </header>
    <section class="grid gap-4 sm:grid-cols-2">
${rows}
    </section>
  </main>
</body>
</html>`;
}

function renderDemoLinks(example) {
  const links = example.demoLinks ?? [];
  return links.map((link) => {
    const href = resolveAgainstExample(example.url, link.href);
    return `<a class="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-emerald-700" href="${escapeHtml(href)}">${escapeHtml(link.label)}</a>`;
  }).join('');
}

function resolveAgainstExample(baseUrl, href) {
  if (/^https?:\/\//u.test(href)) {
    return href;
  }
  if (href.startsWith('/')) {
    return `${baseUrl.replace(/\/$/u, '')}${href}`;
  }
  try {
    return new URL(href, `${baseUrl.replace(/\/$/u, '')}/`).href;
  } catch {
    return `${baseUrl}${href}`;
  }
}

function publicExample(example) {
  return {
    name: example.name,
    title: example.title,
    description: example.description,
    tags: example.tags,
    relativePath: example.relativePath,
    url: example.url,
    viewerUrl: example.viewerUrl,
    demoUrl: example.demoUrl,
    demoLinks: example.demoLinks ?? [],
    starterKind: example.starterKind,
    basePath: example.basePath,
  };
}

export function parseArgs(args) {
  return {
    host: valueAfter(args, '--host'),
    port: valueAfter(args, '--port'),
    tailscaleServe: args.includes('--tailscale-serve'),
  };
}

function describeRoutableExample(example) {
  const basePath = `/examples/${encodeURIComponent(example.name)}`;
  const starterKind = example.hasCustomRuntime ? 'custom' : 'db';

  return {
    ...example,
    basePath,
    demoLinks: [],
    starterKind,
  };
}

export function describeHostedExamples(examples, origin) {
  return examples.map((example) => describeHostedExample(example, origin));
}

function describeHostedExample(example, origin) {
  const basePath = example.basePath ?? `/examples/${encodeURIComponent(example.name)}`;
  const url = `${normalizeOrigin(origin)}${basePath}`;
  const starterKind = example.starterKind ?? (example.hasCustomRuntime ? 'custom' : 'db');

  return {
    ...example,
    basePath,
    url,
    viewerUrl: `${url}/__db`,
    demoUrl: starterKind === 'custom' ? `${url}/` : undefined,
    demoLinks: example.demoLinks ?? [],
    starterKind,
  };
}

function isIndexRequest(rawUrl) {
  const url = new URL(rawUrl ?? '/', 'http://db.local');
  return url.pathname === '/' || url.pathname === '/index.html';
}

function resolveExampleRoute(rawUrl, examplesByName) {
  const url = new URL(rawUrl ?? '/', 'http://db.local');
  const segments = url.pathname.split('/');
  if (segments[1] !== 'examples' || !segments[2]) {
    return null;
  }

  let name;
  try {
    name = decodeURIComponent(segments[2]);
  } catch {
    return null;
  }

  const example = examplesByName.get(name);
  if (!example) {
    return null;
  }

  const innerSegments = segments.slice(3).join('/');
  const runtimePath = innerSegments ? `/${innerSegments}` : '/';
  return {
    example,
    runtimeUrl: `${runtimePath}${url.search}`,
  };
}

function sendNotFound(response) {
  response.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end('Not found');
}

function sendHostError(response, error) {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.writeHead(error.status ?? 500, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify({
    error: {
      message: error.message ?? String(error),
    },
  })}\n`);
}

async function readExampleMetadata(cwd, name) {
  const defaults = {
    title: titleFromName(name),
    description: 'Local db example.',
    tags: [],
  };

  try {
    const metadata = JSON.parse(await readFile(path.join(cwd, 'example.json'), 'utf8'));
    return {
      title: String(metadata.title ?? defaults.title),
      description: String(metadata.description ?? defaults.description),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map((tag) => String(tag)) : defaults.tags,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return defaults;
    }
    throw new Error(`Could not read ${path.join(cwd, 'example.json')}: ${error.message}`);
  }
}

function renderTags(tags) {
  if (tags.length === 0) {
    return '';
  }

  return tags.map((tag) => (
    `<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">${escapeHtml(tag)}</span>`
  )).join('');
}

function titleFromName(name) {
  return String(name)
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function firstHeaderValue(value) {
  const header = Array.isArray(value) ? value[0] : value;
  const firstValue = String(header ?? '').split(',')[0]?.trim();
  return firstValue || undefined;
}

function normalizeOrigin(origin) {
  return String(origin).replace(/\/+$/u, '');
}

async function defaultDetectTailscaleHost() {
  try {
    const { stdout } = await execFileAsync('tailscale', ['ip', '-4'], {
      timeout: 1_000,
    });
    return stdout
      .split(/\s+/u)
      .find((candidate) => isTailscaleIpv4Host(candidate));
  } catch {
    return undefined;
  }
}

async function defaultRunTailscaleServe({ port }: { port: number }): Promise<TailscaleServeCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn('tailscale', tailscaleServeArgs(port), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const result = { stdout, stderr };
      if (code === 0) {
        resolve(result);
        return;
      }

      const output = formatTailscaleOutput(result);
      const detail = output ? `\n${output}` : '';
      reject(new Error(`tailscale serve exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}.${detail}`));
    });
  });
}

async function defaultDetectTailscaleNetwork() {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: 1_000,
    });
    const status = JSON.parse(stdout);
    const self = status?.Self;
    const addresses = Array.isArray(self?.TailscaleIPs)
      ? self.TailscaleIPs
      : Array.isArray(self?.Addresses)
        ? self.Addresses
        : [];
    const ipv4 = addresses.find((candidate) => isTailscaleIpv4Host(String(candidate)));
    const dnsName = typeof self?.DNSName === 'string' ? self.DNSName : undefined;

    if (ipv4 || dnsName) {
      return {
        ipv4: ipv4 ? String(ipv4) : undefined,
        dnsName,
      };
    }
  } catch {
    // Fall through to the smaller `tailscale ip -4` fallback for older clients.
  }

  const ipv4 = await defaultDetectTailscaleHost();
  return ipv4 ? { ipv4 } : undefined;
}

function cleanTailscaleDnsName(value) {
  const hostname = String(value ?? '').trim().replace(/\.+$/u, '');
  return hostname.endsWith('.ts.net') ? hostname : undefined;
}

function findTailscaleHttpsUrl(output: string) {
  return output.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.ts\.net(?::\d+)?/iu)?.[0];
}

function formatTailscaleOutput(result: TailscaleServeCommandResult) {
  return [result.stdout, result.stderr]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

function isTailscaleIpv4Host(value) {
  const parts = value.split('.').map((part) => Number(part));
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100
    && parts[1] >= 64
    && parts[1] <= 127;
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function closeServer(server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        if (error.code === 'ERR_SERVER_NOT_RUNNING') {
          resolve();
          return;
        }
        reject(error);
        return;
      }

      resolve();
    });
  });
}
