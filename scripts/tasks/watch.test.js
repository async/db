import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  startTypeScriptWatchers,
  stopTypeScriptWatchers,
} from './watch.js';

test('watch task starts the TypeScript watcher in a process group', () => {
  const spawned = [];

  const watchers = startTypeScriptWatchers({
    cwd: '/repo',
    stdio: 'ignore',
    spawn: fakeSpawn(spawned),
    useProcessGroups: true,
  });

  assert.equal(watchers.length, 1);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args.slice(1), ['-b', '--watch', '--preserveWatchOutput']);
  assert.equal(spawned[0].options.detached, true);
});

test('watch task stops the TypeScript watcher process group', async () => {
  const spawned = [];
  const killed = [];
  const watchers = startTypeScriptWatchers({
    cwd: '/repo',
    stdio: 'ignore',
    spawn: fakeSpawn(spawned),
    useProcessGroups: true,
  });

  await stopTypeScriptWatchers(watchers, {
    killProcess: fakeKillProcess(spawned, killed),
    useProcessGroups: true,
  });

  assert.deepEqual(killed, [
    { pid: -spawned[0].child.pid, signal: 'SIGTERM' },
  ]);
  assert.deepEqual(spawned[0].child.killSignals, []);
});

test('watch task falls back to direct child signals when a process group is gone', async () => {
  const spawned = [];
  const watchers = startTypeScriptWatchers({
    cwd: '/repo',
    stdio: 'ignore',
    spawn: fakeSpawn(spawned),
    useProcessGroups: true,
  });

  await stopTypeScriptWatchers(watchers, {
    killProcess() {
      const error = new Error('process does not exist');
      error.code = 'ESRCH';
      throw error;
    },
    useProcessGroups: true,
  });

  assert.deepEqual(spawned[0].child.killSignals, ['SIGTERM']);
});

test('watch task avoids terminal raw mode and shell wrappers', async () => {
  const source = await readFile(new URL('./watch.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /setRawMode/u);
  assert.doesNotMatch(source, /process\.stdin/u);
  assert.doesNotMatch(source, /shell:\s*true/u);
  assert.doesNotMatch(source, /\/bin\/zsh|\bzsh\b/u);
});

class FakeChild extends EventEmitter {
  static nextPid = 20_000;

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
