'use strict';

const { execFile, spawn } = require('node:child_process');
const { constants } = require('node:fs');
const { access, lstat, mkdir, mkdtemp, realpath, rename, rm, rmdir, writeFile } =
  (process.versions.electron ? require('original-fs') : require('node:fs')).promises;
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');

const executable = 'Local-Twitch-Reporting-Dashboard';
const archiveDirectory = executable + '-linux-x64';
const run = promisify(execFile);

async function prepareLinuxUpdate(exePath) {
  const install = path.dirname(exePath);
  const uid = process.getuid();
  if (uid === 0 || path.basename(exePath) !== executable || await realpath(install) !== install ||
      (await lstat(install)).uid !== uid) {
    throw new Error('In-app updates require a user-owned extracted Linux bundle.');
  }
  const sandbox = await lstat(path.join(install, 'chrome-sandbox'));
  if (sandbox.mode & 0o4000) {
    throw new Error('This installation uses a privileged sandbox helper. Update it manually.');
  }
  try {
    await access(path.dirname(install), constants.W_OK | constants.X_OK);
  } catch {
    throw new Error('The folder containing the dashboard must be writable to update it.');
  }
  return mkdtemp(path.join(path.dirname(install), '.twitch-dashboard-update-'));
}

async function stageLinuxUpdate(folder, archive) {
  const unpack = path.join(folder, 'unpack');
  await mkdir(unpack, { mode: 0o700 });
  await run('tar', ['--extract', '--gzip', '--file', archive, '--directory', unpack,
    '--no-same-owner', '--no-same-permissions'], { timeout: 60_000 });
  const bundle = path.join(unpack, archiveDirectory);
  for (const file of [executable, 'resources/app.asar', 'install-launcher.sh']) {
    if (!(await lstat(path.join(bundle, file))).isFile()) throw new Error('The Linux update bundle is incomplete.');
  }
  await access(path.join(bundle, executable), constants.X_OK);
  return bundle;
}

function spawnDetached(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { detached: true, stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function launchLinuxUpdater(folder, bundle, exePath) {
  const helper = path.join(folder, 'apply-update.js');
  await writeFile(helper, await readFile(__filename), { flag: 'wx', mode: 0o600 });
  const original = await installationIdentity(path.dirname(exePath));
  await spawnDetached(exePath, [helper, String(process.pid), bundle, exePath, original], {
    cwd: folder,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
}

async function waitForExit(pid) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(250);
  }
  throw new Error('The dashboard did not close before the update timed out.');
}

async function installationIdentity(folder) {
  const info = await lstat(folder, { bigint: true });
  return info.dev + ':' + info.ino;
}

async function applyLinuxUpdate(folder, bundle, exePath, reopen, original) {
  const install = path.dirname(exePath);
  const backup = path.join(folder, 'previous');
  const lock = path.join(path.dirname(install), '.' + path.basename(install) + '.update-lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    if (original && await installationIdentity(install) !== original) {
      throw new Error('The dashboard folder changed while the update was preparing.');
    }
    await rename(install, backup);
    try {
      await rename(bundle, install);
      try {
        await reopen(exePath);
      } catch (error) {
        await rename(install, bundle);
        throw error;
      }
    } catch (error) {
      await rename(backup, install);
      throw error;
    }
  } finally {
    await rmdir(lock).catch(() => {});
  }
}

async function runHelper() {
  const [, helper, pid, bundle, exePath, original] = process.argv;
  const folder = path.dirname(helper);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let exited = false;
  try {
    await waitForExit(Number(pid));
    exited = true;
    await applyLinuxUpdate(folder, bundle, exePath, exe => spawnDetached(exe, [], { env, cwd: path.dirname(exe) }), original);
    for (const item of ['unpack', 'update.tar.gz', 'apply-update.js']) {
      await rm(path.join(folder, item), { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    await writeFile(path.join(folder, 'update-error.txt'), error.message + '\n').catch(() => {});
    if (exited) await spawnDetached(exePath, [], { env, cwd: path.dirname(exePath) }).catch(() => {});
    process.exitCode = 1;
  }
}

if (require.main === module) void runHelper();
module.exports = { prepareLinuxUpdate, stageLinuxUpdate, launchLinuxUpdater, applyLinuxUpdate };
