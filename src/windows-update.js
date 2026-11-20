'use strict';

const { spawn } = require('node:child_process');
const { createWriteStream, existsSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  assetName, bundleName, linuxAsset, linuxBundleName, repository, verifyInstaller, verifyLinuxArchive
} = require('./verify-update');
const { prepareLinuxUpdate, stageLinuxUpdate, launchLinuxUpdater } = require('./linux-update');

const releaseAPI = 'https://api.github.com/repos/' + repository + '/releases/latest';
const maxInstallerSize = 512 * 1024 * 1024;
const maxProofSize = 512 * 1024;

const portableAsset = 'Local-Twitch-Reporting-Dashboard-Windows-x64.zip';

function supportsUpdates() {
  const { app } = require('electron');
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'linux');
}

function getVersionParts(value) {
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!version) throw new Error('Expected a stable version number.');
  const parts = version.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid release version.');
  return parts;
}

async function getUpdate(currentVersion, assets, request) {
  const response = await request(releaseAPI, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Local-Twitch-Reporting-Dashboard' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error('GitHub returned HTTP ' + response.status);
  const release = await response.json();
  const tag = release.tag_name;
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Unexpected release tag.');
  const version = tag.slice(1);
  const remote = getVersionParts(version);
  const installed = getVersionParts(currentVersion);
  const firstChange = remote.findIndex((part, index) => part !== installed[index]);
  if (firstChange < 0 || remote[firstChange] < installed[firstChange]) return null;
  const bundled = name => release.assets?.some(asset => asset.name === name && asset.state === 'uploaded');
  if (release.draft !== false || release.prerelease !== false || !assets.every(bundled)) {
    throw new Error('The latest release has no update for this platform.');
  }
  return { version, base: 'https://github.com/' + repository + '/releases/download/' + tag + '/' };
}

function getWindowsUpdate(currentVersion, request = fetch) {
  return getUpdate(currentVersion, [assetName, bundleName], request);
}

function getLinuxUpdate(currentVersion, request = fetch) {
  return getUpdate(currentVersion, [linuxAsset, linuxBundleName], request);
}

function sizeLimit(limit) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > limit) return done(new Error('The download exceeded its size limit.'));
      done(null, chunk);
    }
  });
}

async function downloadAsset(base, name) {
  const response = await fetch(base + name, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok || !response.body) throw new Error('Could not download ' + name + '.');
  return Readable.fromWeb(response.body);
}

async function downloadUpdate(update, target, asset, proof, verify) {
  const proofStream = await downloadAsset(update.base, proof);
  const chunks = [];
  const limited = sizeLimit(maxProofSize);
  limited.on('data', chunk => chunks.push(chunk));
  await pipeline(proofStream, limited);
  const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  await pipeline(
    await downloadAsset(update.base, asset),
    sizeLimit(maxInstallerSize),
    createWriteStream(target, { flags: 'wx', mode: 0o600 })
  );
  await verify(target, bundle, update.version);
}

function launchInstaller(installer) {
  return new Promise((resolve, reject) => {
    const child = spawn(installer, ['/S', '--updated', '--force-run'], {
      detached: true, stdio: 'ignore', windowsHide: true
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

let checking = false;
async function checkUpdate(window, canRestart) {
  const { app, dialog, shell } = require('electron');
  if (!supportsUpdates() || checking) return;
  checking = true;
  let folder;
  let started = false;
  let phase = 'check for';
  try {
    const onLinux = process.platform === 'linux';
    const portable = !onLinux && existsSync(path.join(process.resourcesPath, 'portable-mode'));
    const update = portable ? await getUpdate(app.getVersion(), [portableAsset], fetch)
      : await (onLinux ? getLinuxUpdate : getWindowsUpdate)(app.getVersion());
    if (window.isDestroyed()) return;
    if (!update) {
      await dialog.showMessageBox(window, {
        title: 'Dashboard updates',
        message: 'You have the latest version.',
        detail: 'Installed version: ' + app.getVersion()
      });
      return;
    }
    if (portable) {
      const choice = await dialog.showMessageBox(window, {
        title: 'Dashboard updates',
        message: 'Version ' + update.version + ' is available.',
        detail: 'Download the portable ZIP, then close the dashboard before replacing its extracted folder.',
        buttons: ['Download portable ZIP', 'Later'],
        defaultId: 0,
        cancelId: 1
      });
      if (choice.response === 0) await shell.openExternal(update.base + portableAsset);
      return;
    }
    const choice = await dialog.showMessageBox(window, {
      title: 'Dashboard updates',
      message: 'Version ' + update.version + ' is available.',
      detail: 'Save any open report before continuing. The dashboard will download and verify the update, then close and reopen.',
      buttons: ['Update and restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice.response !== 0 || window.isDestroyed()) return;
    phase = 'install';
    window.webContents.send('update:status', 'Downloading and verifying update…');
    const exe = app.getPath('exe');
    folder = onLinux ? await prepareLinuxUpdate(exe)
      : await mkdtemp(path.join(app.getPath('temp'), 'twitch-dashboard-update-'));
    const file = path.join(folder, onLinux ? 'update.tar.gz' : assetName);
    await downloadUpdate(update, file,
      onLinux ? linuxAsset : assetName, onLinux ? linuxBundleName : bundleName,
      onLinux ? verifyLinuxArchive : verifyInstaller);
    const staged = onLinux ? await stageLinuxUpdate(folder, file) : null;
    if (window.isDestroyed()) return;
    if (!canRestart()) throw new Error('Finish the current report before updating.');
    if (onLinux) await launchLinuxUpdater(folder, staged, exe);
    else await launchInstaller(file);
    started = true;
    app.quit();
  } catch (error) {
    console.error('Dashboard update failed:', error);
    if (!window.isDestroyed()) {
      window.webContents.send('update:status', 'Could not ' + phase + ' the update. ' + error.message);
    }
  } finally {
    if (folder && !started) await rm(folder, { recursive: true, force: true }).catch(console.error);
    checking = started;
  }
}

module.exports = { checkUpdate, getWindowsUpdate, getLinuxUpdate, supportsUpdates };
