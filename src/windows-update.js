'use strict';

const { spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { assetName, bundleName, repository, verifyInstaller } = require('./verify-update');

const releaseAPI = 'https://api.github.com/repos/' + repository + '/releases/latest';
const maxInstallerSize = 512 * 1024 * 1024;
const maxProofSize = 512 * 1024;

function supportsWindowsUpdates() {
  const { app } = require('electron');
  return process.platform === 'win32' && app.isPackaged;
}

function getVersionParts(value) {
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!version) throw new Error('Expected a stable version number.');
  const parts = version.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid release version.');
  return parts;
}

async function getWindowsUpdate(currentVersion, request = fetch) {
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
  if (release.draft !== false || release.prerelease !== false || !bundled(assetName) || !bundled(bundleName)) {
    throw new Error('The latest release has no verified Windows update.');
  }
  return { version, base: 'https://github.com/' + repository + '/releases/download/' + tag + '/' };
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

async function downloadUpdate(update, installer) {
  const proofStream = await downloadAsset(update.base, bundleName);
  const chunks = [];
  const limited = sizeLimit(maxProofSize);
  limited.on('data', chunk => chunks.push(chunk));
  await pipeline(proofStream, limited);
  const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  await pipeline(
    await downloadAsset(update.base, assetName),
    sizeLimit(maxInstallerSize),
    createWriteStream(installer, { flags: 'wx', mode: 0o600 })
  );
  await verifyInstaller(installer, bundle, update.version);
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
async function checkWindowsUpdate(window, canRestart) {
  const { app, dialog } = require('electron');
  if (!supportsWindowsUpdates() || checking) return;
  checking = true;
  let folder;
  let started = false;
  let phase = 'check for';
  try {
    const update = await getWindowsUpdate(app.getVersion());
    if (window.isDestroyed()) return;
    if (!update) {
      await dialog.showMessageBox(window, {
        title: 'Dashboard updates',
        message: 'You have the latest version.',
        detail: 'Installed version: ' + app.getVersion()
      });
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
    folder = await mkdtemp(path.join(app.getPath('temp'), 'twitch-dashboard-update-'));
    const installer = path.join(folder, assetName);
    await downloadUpdate(update, installer);
    if (window.isDestroyed()) return;
    if (!canRestart()) throw new Error('Finish the current report before updating.');
    await launchInstaller(installer);
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

module.exports = { checkWindowsUpdate, getWindowsUpdate, supportsWindowsUpdates };
