'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { applyLinuxUpdate } = require('../src/linux-update');

test('Linux updater restores the original bundle if relaunch fails', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'dashboard-swap-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const current = path.join(folder, 'Dashboard with spaces');
  const staged = path.join(folder, 'staged');
  const marker = 'Local-Twitch-Reporting-Dashboard';
  const exe = path.join(current, marker);
  await mkdir(current);
  await mkdir(staged);
  await writeFile(exe, 'original');
  await writeFile(path.join(staged, marker), 'update');
  await assert.rejects(applyLinuxUpdate(folder, staged, exe, async () => {
    assert.equal(await readFile(exe, 'utf8'), 'update');
    throw new Error('Could not launch');
  }), /Could not launch/);
  assert.equal(await readFile(exe, 'utf8'), 'original');
  assert.equal(await readFile(path.join(staged, marker), 'utf8'), 'update');
  await applyLinuxUpdate(folder, staged, exe, async () => {
    assert.equal(await readFile(exe, 'utf8'), 'update');
  });
  assert.equal(await readFile(path.join(folder, 'previous', marker), 'utf8'), 'original');
});
