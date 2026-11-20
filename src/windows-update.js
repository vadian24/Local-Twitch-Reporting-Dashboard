'use strict';

const repository = 'vadian24/Local-Twitch-Reporting-Dashboard';
const releaseAPI = 'https://api.github.com/repos/' + repository + '/releases/latest';
const assetName = 'Local-Twitch-Reporting-Dashboard-Windows-x64-Setup.exe';

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
  if (release.draft !== false || release.prerelease !== false ||
      !release.assets?.some(asset => asset.name === assetName && asset.state === 'uploaded')) {
    throw new Error('Windows Setup is unavailable for the latest release.');
  }
  return { version, url: 'https://github.com/' + repository + '/releases/tag/' + tag };
}

async function checkWindowsUpdate(window) {
  const { app, dialog, shell } = require('electron');
  if (!supportsWindowsUpdates()) return;
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
      type: 'info',
      title: 'Dashboard updates',
      message: 'Version ' + update.version + ' is available.',
      detail: 'Open the GitHub release to download and run Windows Setup.',
      buttons: ['Open GitHub release', 'Later'],
      defaultId: 0,
      cancelId: 1
    });
    if (choice.response === 0) await shell.openExternal(update.url);
  } catch (error) {
    console.error('Dashboard update check failed:', error);
    throw new Error('Could not check GitHub for updates.');
  }
}

module.exports = { checkWindowsUpdate, getWindowsUpdate, supportsWindowsUpdates };
