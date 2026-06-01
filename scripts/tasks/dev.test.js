import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as devTask from './dev.js';

const { createDevSupervisor } = devTask;

test('dev supervisor starts one TypeScript build watcher and one examples host', async () => {
  const spawned = [];
  const watches = [];
  const killed = [];
  const supervisor = createDevSupervisor({
    cwd: '/repo',
    stdio: 'ignore',
    spawn: fakeSpawn(spawned),
    watch: fakeWatch(watches),
    killProcess: fakeKillProcess(spawned, killed),
    waitForOutputs: async () => {},
    useProcessGroups: true,
  });

  await supervisor.start();

  assert.equal(spawned.length, 2);
  assert.deepEqual(spawned[0].args.slice(1), ['-b', '--watch', '--preserveWatchOutput']);
  assert.equal(spawned[0].options.detached, true);
  assert.match(spawned[1].args[0], /\.tmp\/test-build\/scripts\/serve-examples\.js$/);
  assert.equal(spawned[1].options.detached, true);
  assert.equal(watches.length, 3);

  await supervisor.shutdown();
  assert.deepEqual(killed, [
    { pid: -spawned[1].child.pid, signal: 'SIGTERM' },
    { pid: -spawned[0].child.pid, signal: 'SIGTERM' },
  ]);
  assert.deepEqual(spawned.map((entry) => entry.child.killSignals), [[], []]);
});

test('dev supervisor debounces compiled-output changes into one examples restart', async () => {
  const spawned = [];
  const killed = [];
  const timers = [];
  let now = 1_000;
  const supervisor = createDevSupervisor({
    cwd: '/repo',
    stdio: 'ignore',
    spawn: fakeSpawn(spawned),
    watch: fakeWatch([]),
    killProcess: fakeKillProcess(spawned, killed),
    waitForOutputs: async () => {},
    useProcessGroups: true,
    restartArmMs: 0,
    restartDebounceMs: 25,
    now: () => now,
    setTimeout: fakeSetTimeout(timers),
    clearTimeout: fakeClearTimeout,
  });

  await supervisor.start();
  assert.equal(spawned.length, 2);

  now += 1;
  supervisor.handleCompiledOutputChange();
  supervisor.handleCompiledOutputChange();

  const activeRestartTimers = timers.filter((timer) => timer.ms === 25 && !timer.canceled);
  assert.equal(activeRestartTimers.length, 1);
  activeRestartTimers[0].run();
  await flushAsyncWork();

  assert.equal(spawned.length, 3);
  assert.deepEqual(killed, [
    { pid: -spawned[1].child.pid, signal: 'SIGTERM' },
  ]);
  assert.deepEqual(spawned[1].child.killSignals, []);
  assert.match(spawned[2].args[0], /\.tmp\/test-build\/scripts\/serve-examples\.js$/);

  await supervisor.shutdown();
  assert.deepEqual(killed, [
    { pid: -spawned[1].child.pid, signal: 'SIGTERM' },
    { pid: -spawned[2].child.pid, signal: 'SIGTERM' },
    { pid: -spawned[0].child.pid, signal: 'SIGTERM' },
  ]);
  assert.deepEqual(spawned[0].child.killSignals, []);
  assert.deepEqual(spawned[2].child.killSignals, []);
});

test('dev supervisor shutdown is idempotent', async () => {
  const spawned = [];
  const supervisor = createDevSupervisor({
    cwd: '/repo',
    stdio: 'ignore',
    spawn: fakeSpawn(spawned),
    watch: fakeWatch([]),
    waitForOutputs: async () => {},
  });

  await supervisor.start();
  await supervisor.shutdown();
  await supervisor.shutdown();

  assert.deepEqual(spawned.map((entry) => entry.child.killSignals), [['SIGTERM'], ['SIGTERM']]);
});

test('dev cancellation handlers use process signals without changing terminal raw mode', () => {
  const stdin = new FakeStdin();
  const process = new FakeProcess();
  let cancelCount = 0;

  assert.equal(typeof devTask.installDevCancellationHandlers, 'function');
  const dispose = devTask.installDevCancellationHandlers({
    stdin,
    process,
    onCancel: () => {
      cancelCount += 1;
    },
  });

  assert.equal(stdin.rawMode, false);
  assert.equal(stdin.resumed, false);

  process.emit('SIGINT');

  assert.equal(cancelCount, 1);

  dispose();

  assert.equal(stdin.rawMode, false);
  assert.equal(stdin.listenerCount('data'), 0);
  assert.equal(process.listenerCount('SIGINT'), 0);
  assert.equal(process.listenerCount('SIGTERM'), 0);
});

test('dev task avoids terminal raw mode and shell wrappers', async () => {
  const source = await readFile(new URL('./dev.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /setRawMode/u);
  assert.doesNotMatch(source, /process\.stdin/u);
  assert.doesNotMatch(source, /shell:\s*true/u);
  assert.doesNotMatch(source, /\/bin\/zsh|\\bzsh\\b/u);
});

class FakeChild extends EventEmitter {
  static nextPid = 10_000;

  pid = FakeChild.nextPid++;
  exitCode = null;
  signalCode = null;
  killSignals = [];

  kill(signal) {
    this.killSignals.push(signal);
    if (this.exitCode !== null || this.signalCode !== null) {
      return true;
    }

    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit('exit', null, signal);
    });
    return true;
  }
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  rawMode = false;
  resumed = false;

  setRawMode(rawMode) {
    this.rawMode = rawMode;
  }

  resume() {
    this.resumed = true;
  }
}

class FakeProcess extends EventEmitter {
  once(eventName, listener) {
    super.once(eventName, listener);
    return this;
  }
}

function fakeSpawn(spawned) {
  return (command, args, options) => {
    const child = new FakeChild();
    spawned.push({ command, args, options, child });
    return child;
  };
}

function fakeKillProcess(spawned, killed) {
  return (pid, signal) => {
    killed.push({ pid, signal });
    const child = spawned.find((entry) => -entry.child.pid === pid || entry.child.pid === pid)?.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      const error = new Error('process does not exist');
      error.code = 'ESRCH';
      throw error;
    }

    child.signalCode = signal;
    queueMicrotask(() => {
      child.emit('exit', null, signal);
    });
    return true;
  };
}

function fakeWatch(watches) {
  return (filePath, options, listener) => {
    const watcher = new EventEmitter();
    watcher.closed = false;
    watcher.close = () => {
      watcher.closed = true;
    };
    watches.push({ filePath, options, listener, watcher });
    return watcher;
  };
}

function fakeSetTimeout(timers) {
  return (callback, ms) => {
    const timer = {
      ms,
      canceled: false,
      run() {
        if (!this.canceled) {
          this.canceled = true;
          callback();
        }
      },
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
}

function fakeClearTimeout(timer) {
  if (timer) {
    timer.canceled = true;
  }
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await Promise.resolve();
}
