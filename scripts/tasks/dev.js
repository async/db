#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requiredOutputFiles = [
  'dist/index.js',
  path.join('.tmp', 'test-build', 'scripts', 'serve-examples.js'),
];
const outputWatchRoots = [
  'dist',
  path.join('.tmp', 'test-build', 'src'),
  path.join('.tmp', 'test-build', 'scripts'),
];

export function createDevSupervisor(options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const stdio = options.stdio ?? 'inherit';
  const spawnImpl = options.spawn ?? spawn;
  const watchImpl = options.watch ?? watch;
  const waitForOutputs = options.waitForOutputs ?? defaultWaitForOutputs;
  const setTimeoutImpl = options.setTimeout ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeout ?? clearTimeout;
  const killProcess = options.killProcess ?? process.kill.bind(process);
  const now = options.now ?? Date.now;
  const onFatal = options.onFatal ?? ((error) => {
    console.error(error.stack || error.message);
    void supervisor.shutdown(1);
  });
  const serveExamplesScript = options.serveExamplesScript
    ?? path.join(cwd, '.tmp', 'test-build', 'scripts', 'serve-examples.js');
  const tscBin = options.tscBin ?? path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
  const outputRoots = options.outputWatchRoots ?? outputWatchRoots;
  const requiredFiles = options.requiredOutputFiles ?? requiredOutputFiles;
  const restartDebounceMs = options.restartDebounceMs ?? 500;
  const restartArmMs = options.restartArmMs ?? 3_000;
  const childStopTimeoutMs = options.childStopTimeoutMs ?? 5_000;
  const useProcessGroups = options.useProcessGroups ?? process.platform !== 'win32';
  const argv = options.argv ?? process.argv.slice(2);

  let started = false;
  let shuttingDown = false;
  let restartingExamples = false;
  let restartTimer;
  let restartQueue = Promise.resolve();
  let restartArmedAt = 0;
  let typeScriptChild;
  let examplesChild;
  let outputWatchers = [];

  const supervisor = {
    async start() {
      if (started) {
        return;
      }

      started = true;
      shuttingDown = false;
      typeScriptChild = startTypeScriptWatcher();
      await waitForOutputs({ cwd, requiredFiles });
      outputWatchers = watchCompiledOutputs(outputRoots, cwd, watchImpl, () => {
        supervisor.handleCompiledOutputChange();
      });
      restartArmedAt = now() + restartArmMs;
      startExamples();
    },
    handleCompiledOutputChange() {
      scheduleRestart();
    },
    async shutdown(exitCode = 0) {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      clearTimeoutImpl(restartTimer);
      for (const watcher of outputWatchers) {
        watcher.close();
      }
      outputWatchers = [];
      await stopExamples();
      await stopChild(typeScriptChild, {
        timeoutMs: childStopTimeoutMs,
        setTimeout: setTimeoutImpl,
        clearTimeout: clearTimeoutImpl,
        killProcess,
        useProcessGroups,
      });
      typeScriptChild = undefined;
      return exitCode;
    },
    get typeScriptChild() {
      return typeScriptChild;
    },
    get examplesChild() {
      return examplesChild;
    },
    get outputWatchers() {
      return outputWatchers;
    },
  };

  return supervisor;

  function startTypeScriptWatcher() {
    const child = spawnImpl(process.execPath, [tscBin, '-b', '--watch', '--preserveWatchOutput'], {
      cwd,
      stdio,
      detached: useProcessGroups,
    });

    child.once?.('error', (error) => {
      if (!shuttingDown) {
        onFatal(error);
      }
    });
    child.once?.('exit', (code, signal) => {
      if (shuttingDown || code === 0 || signal) {
        return;
      }

      onFatal(new Error(`[dev] TypeScript build watcher exited with code ${code ?? 1}.`));
    });

    return child;
  }

  function startExamples() {
    examplesChild = spawnImpl(process.execPath, [serveExamplesScript, ...argv], {
      cwd,
      stdio,
      detached: useProcessGroups,
    });

    const child = examplesChild;
    child.once?.('error', (error) => {
      if (!shuttingDown && examplesChild === child) {
        onFatal(error);
      }
    });
    child.once?.('exit', (code, signal) => {
      if (examplesChild === child) {
        examplesChild = undefined;
      }

      if (shuttingDown || restartingExamples || code === 0 || signal) {
        return;
      }

      onFatal(new Error(`[dev] examples host exited with code ${code ?? 1}.`));
    });
  }

  function scheduleRestart() {
    if (shuttingDown || now() < restartArmedAt) {
      return;
    }

    clearTimeoutImpl(restartTimer);
    restartTimer = setTimeoutImpl(() => {
      restartQueue = restartQueue.then(restartExamples).catch(onFatal);
    }, restartDebounceMs);
  }

  async function restartExamples() {
    if (shuttingDown) {
      return;
    }

    console.log('[dev] compiled output changed; restarting examples host...');
    restartingExamples = true;
    try {
      await stopExamples();
      if (!shuttingDown) {
        startExamples();
      }
    } finally {
      restartingExamples = false;
    }
  }

  async function stopExamples() {
    const child = examplesChild;
    if (!child) {
      return;
    }

    examplesChild = undefined;
    await stopChild(child, {
      timeoutMs: childStopTimeoutMs,
      setTimeout: setTimeoutImpl,
      clearTimeout: clearTimeoutImpl,
      killProcess,
      useProcessGroups,
    });
  }
}

export async function runDev(options = {}) {
  const supervisor = createDevSupervisor(options);
  const processImpl = options.process ?? process;
  let shuttingDown = false;
  let stopMessageWritten = false;
  let disposeCancellationHandlers = () => {};
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    disposeCancellationHandlers();
    await supervisor.shutdown(exitCode);
    processImpl.exit(exitCode);
  };
  const requestShutdown = () => {
    if (!stopMessageWritten) {
      stopMessageWritten = true;
      process.stdout.write('\n[dev] stopping...\n');
    }

    void shutdown(0);
  };
  disposeCancellationHandlers = installDevCancellationHandlers({
    process: processImpl,
    onCancel: requestShutdown,
  });

  try {
    await supervisor.start();
  } catch (error) {
    console.error(error.stack || error.message);
    await shutdown(1);
  }
}

export function installDevCancellationHandlers(options) {
  const processImpl = options.process ?? process;
  const onCancel = options.onCancel;
  const cleanups = [];
  let disposed = false;

  const cancel = () => {
    if (!disposed) {
      onCancel();
    }
  };
  const addSignalHandler = (signal) => {
    processImpl.once?.(signal, cancel);
    cleanups.push(() => {
      processImpl.off?.(signal, cancel) ?? processImpl.removeListener?.(signal, cancel);
    });
  };

  addSignalHandler('SIGINT');
  addSignalHandler('SIGTERM');

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    for (const cleanup of cleanups.splice(0).reverse()) {
      cleanup();
    }
  };
}

function watchCompiledOutputs(watchRoots, cwd, watchImpl, onChange) {
  const watchers = [];

  for (const watchRoot of watchRoots) {
    const absolutePath = path.join(cwd, watchRoot);
    try {
      const watcher = watchImpl(absolutePath, { recursive: true }, onChange);
      watcher.once?.('error', (error) => {
        console.warn(`[dev] output watcher for ${watchRoot} disabled: ${error.message}`);
        watcher.close();
        watchers.push(pollCompiledOutput(watchRoot, absolutePath, onChange));
      });
      watchers.push(watcher);
    } catch (error) {
      console.warn(`[dev] could not watch ${watchRoot}: ${error.message}`);
      watchers.push(pollCompiledOutput(watchRoot, absolutePath, onChange));
    }
  }

  return watchers;
}

function pollCompiledOutput(watchRoot, absolutePath, onChange) {
  let previousSignature;
  const poll = async () => {
    try {
      const nextSignature = await treeSignature(absolutePath);
      if (previousSignature === undefined) {
        previousSignature = nextSignature;
        return;
      }

      if (nextSignature !== previousSignature) {
        previousSignature = nextSignature;
        onChange();
      }
    } catch (error) {
      console.warn(`[dev] could not poll ${watchRoot}: ${error.message}`);
    }
  };

  void poll();
  const interval = setInterval(() => {
    void poll();
  }, 1_000);

  return {
    close() {
      clearInterval(interval);
    },
  };
}

async function treeSignature(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const parts = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      parts.push(`${entry.name}/(${await treeSignature(absolutePath)})`);
      continue;
    }

    if (entry.isFile()) {
      const fileStat = await stat(absolutePath);
      parts.push(`${entry.name}:${fileStat.mtimeMs}:${fileStat.size}`);
    }
  }

  return parts.join('|');
}

async function defaultWaitForOutputs({ cwd, requiredFiles }) {
  const pollMs = 250;
  let lastMissingMessage = '';

  while (true) {
    const missing = [];
    for (const requiredFile of requiredFiles) {
      try {
        await access(path.join(cwd, requiredFile));
      } catch {
        missing.push(requiredFile);
      }
    }

    if (missing.length === 0) {
      return;
    }

    const missingMessage = missing.join(', ');
    if (missingMessage !== lastMissingMessage) {
      lastMissingMessage = missingMessage;
      console.log(`[dev] waiting for build outputs: ${missingMessage}`);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
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

    child.once?.('exit', done);
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
  await runDev();
}
