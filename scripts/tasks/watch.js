#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function startTypeScriptWatchers(options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const stdio = options.stdio ?? 'inherit';
  const spawnImpl = options.spawn ?? spawn;
  const onExit = options.onExit;
  const tscBin = path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
  const useProcessGroups = options.useProcessGroups ?? process.platform !== 'win32';

  return [
    startWatcher('build', ['-b', '--watch', '--preserveWatchOutput']),
  ];

  function startWatcher(name, args) {
    const child = spawnImpl(process.execPath, [tscBin, ...args], {
      cwd,
      stdio,
      detached: useProcessGroups,
    });

    child.once('exit', (code, signal) => {
      onExit?.({ name, code, signal });
    });

    return { name, child };
  }
}

export async function stopTypeScriptWatchers(watchers, options = {}) {
  const stopOptions = {
    timeoutMs: options.childStopTimeoutMs ?? 5_000,
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout: options.clearTimeout ?? clearTimeout,
    killProcess: options.killProcess ?? process.kill.bind(process),
    useProcessGroups: options.useProcessGroups ?? process.platform !== 'win32',
  };

  await Promise.all(watchers.map((watcher) => stopChild(watcher.child, stopOptions)));
}

async function stopChild(child, options) {
  if (!child || child.exitCode != null || child.signalCode != null) {
    return;
  }

  await new Promise((resolve) => {
    let resolved = false;
    let timer;
    const done = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      options.clearTimeout(timer);
      resolve();
    };

    child.once('exit', done);
    signalChild(child, 'SIGTERM', options);

    timer = options.setTimeout(() => {
      if (!resolved) {
        signalChild(child, 'SIGKILL', options);
      }
    }, options.timeoutMs);
    timer?.unref?.();
  });
}

function signalChild(child, signal, options) {
  if (options.useProcessGroups && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      options.killProcess(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        throw error;
      }
    }
  }

  try {
    child.kill?.(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let shuttingDown = false;
  let watchers = [];
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await stopTypeScriptWatchers(watchers);
    process.exit(exitCode);
  };

  watchers = startTypeScriptWatchers({
    onExit({ name, code, signal }) {
      if (shuttingDown || code === 0 || signal) {
        return;
      }

      console.error(`[watch] ${name} watcher exited with code ${code ?? 1}.`);
      void shutdown(code ?? 1);
    },
  });

  process.once('SIGINT', () => {
    void shutdown(0);
  });
  process.once('SIGTERM', () => {
    void shutdown(0);
  });
}
