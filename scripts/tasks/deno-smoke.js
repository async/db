#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const denoVersion = '2.7.14';
const commandTimeoutMs = 120_000;
const localCliPath = './node_modules/@async/db/dist/cli.js';
const sysPermission = '--allow-sys=hostname,uid';

const registryEnv = {
  ...process.env,
  NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY ?? 'https://registry.npmjs.org',
};

const denoCommand = resolveDenoCommand();
let tempRoot;

try {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'async-db-deno-'));
  const packageDir = path.join(tempRoot, 'package');
  const appDir = path.join(tempRoot, 'app');

  await mkdir(packageDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await run('pnpm', ['pack', '--pack-destination', packageDir], { cwd: repoRoot });
  const tarball = await findTarball(packageDir);

  await writeFile(path.join(appDir, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      '@async/db': `file:${tarball}`,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(appDir, 'deno.json'), `${JSON.stringify({
    nodeModulesDir: 'manual',
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(appDir, 'check.ts'), `import { openDb } from '@async/db';
import { createDbClient } from '@async/db/client';
import { collection, field } from '@async/db/schema';
import { gitFiles } from '@async/db/git';

console.log(typeof openDb, typeof createDbClient, typeof collection, typeof field.string, typeof gitFiles);
`, 'utf8');

  await run('npm', ['install', '--ignore-scripts', '--package-lock=false'], { cwd: appDir });
  await runDeno(['check', 'check.ts'], { cwd: appDir });

  const packageJsonBeforeInit = await readFile(path.join(appDir, 'package.json'), 'utf8');
  await runDeno([
    'run',
    '--allow-read=.',
    '--allow-write=.',
    sysPermission,
    localCliPath,
    'init',
    '--workflow',
    'deno',
    '--template',
    'data-first',
  ], { cwd: appDir });
  const packageJsonAfterInit = await readFile(path.join(appDir, 'package.json'), 'utf8');
  if (packageJsonAfterInit !== packageJsonBeforeInit) {
    throw new Error('Deno init modified package.json in the smoke project.');
  }

  await runDeno([
    'run',
    '--allow-read=.',
    '--allow-write=.',
    sysPermission,
    localCliPath,
    'sync',
  ], { cwd: appDir });
  await runDeno([
    'run',
    '--allow-read=.',
    '--allow-write=.',
    sysPermission,
    localCliPath,
    'schema',
    'validate',
  ], { cwd: appDir });

  const server = spawnDeno([
    'run',
    '--allow-read=.',
    '--allow-write=.',
    sysPermission,
    '--allow-net=127.0.0.1',
    localCliPath,
    'serve',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], { cwd: appDir });

  try {
    const url = await waitForServeUrl(server);
    const response = await fetch(`${url}/db/users.json`);
    if (!response.ok) {
      throw new Error(`Deno serve request failed with HTTP ${response.status}.`);
    }
    const body = await response.text();
    if (!body.includes('Ada Lovelace')) {
      throw new Error('Deno serve response did not include initialized fixture data.');
    }
  } finally {
    await stopChild(server.child);
  }

  console.log(`Deno smoke passed with ${formatDenoCommand(denoCommand)}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (tempRoot && process.env.ASYNC_DB_KEEP_DENO_SMOKE !== '1') {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function resolveDenoCommand() {
  if (process.env.DENO_BIN) {
    return { command: process.env.DENO_BIN, prefix: [] };
  }

  const denoProbe = spawnSync('deno', ['--version'], { stdio: 'ignore' });
  if (denoProbe.status === 0) {
    return { command: 'deno', prefix: [] };
  }

  return { command: 'pnpm', prefix: ['dlx', `deno@${denoVersion}`] };
}

async function findTarball(packageDir) {
  const files = await readdir(packageDir);
  const tarball = files.find((file) => file.endsWith('.tgz'));
  if (!tarball) {
    throw new Error(`pnpm pack did not create a tarball in ${packageDir}.`);
  }
  return path.join(packageDir, tarball);
}

async function runDeno(args, options) {
  return run(denoCommand.command, [...denoCommand.prefix, ...args], options);
}

function spawnDeno(args, options) {
  const child = spawn(denoCommand.command, [...denoCommand.prefix, ...args], {
    cwd: options.cwd,
    env: registryEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  return {
    child,
    stdout: '',
    stderr: '',
  };
}

async function run(command, args, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: registryEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} ${args.join(' ')} timed out after ${commandTimeoutMs}ms.`));
    }, commandTimeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error([
        `${command} ${args.join(' ')} exited with code ${code ?? 1}.`,
        tail(stdout),
        tail(stderr),
      ].filter(Boolean).join('\n')));
    });
  });
}

async function waitForServeUrl(server) {
  const deadline = Date.now() + commandTimeoutMs;

  server.child.stdout?.setEncoding('utf8');
  server.child.stderr?.setEncoding('utf8');
  server.child.stdout?.on('data', (chunk) => {
    server.stdout += chunk;
  });
  server.child.stderr?.on('data', (chunk) => {
    server.stderr += chunk;
  });

  while (Date.now() < deadline) {
    const match = server.stdout.match(/http:\/\/127\.0\.0\.1:\d+/u);
    if (match) {
      return match[0];
    }

    if (server.child.exitCode !== null) {
      throw new Error(`Deno serve exited before listening.\n${tail(server.stdout)}\n${tail(server.stderr)}`);
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for Deno serve URL.\n${tail(server.stdout)}\n${tail(server.stderr)}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  if (child.pid) {
    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      child.kill('SIGTERM');
    }
  }

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(5_000).then(() => {
      child.kill('SIGKILL');
    }),
  ]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tail(output) {
  const trimmed = output.trim();
  return trimmed.split('\n').slice(-30).join('\n');
}

function formatDenoCommand(command) {
  return [command.command, ...command.prefix].join(' ');
}
