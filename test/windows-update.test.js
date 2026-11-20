'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getWindowsUpdate } = require('../src/windows-update');

const release = {
  tag_name: 'v1.10.0',
  draft: false,
  prerelease: false,
  assets: [{ name: 'Local-Twitch-Reporting-Dashboard-Windows-x64-Setup.exe', state: 'uploaded' }]
};
const response = changes => async url => {
  assert.equal(url, 'https://api.github.com/repos/vadian24/Local-Twitch-Reporting-Dashboard/releases/latest');
  return Response.json({ ...release, ...changes });
};

test('offers only a newer stable release with a published Windows installer', async () => {
  assert.deepEqual(await getWindowsUpdate('1.9.0', response()), {
    version: '1.10.0',
    url: 'https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/releases/tag/v1.10.0'
  });
  assert.equal(await getWindowsUpdate('1.10.0', response()), null);
  assert.equal(await getWindowsUpdate('2.0.0', response()), null);
  await assert.rejects(getWindowsUpdate('1.9.0', response({ assets: [] })), /Setup is unavailable/);
  await assert.rejects(getWindowsUpdate('1.9.0', response({ prerelease: true })), /Setup is unavailable/);
  await assert.rejects(getWindowsUpdate('1.9.0', response({ tag_name: 'v1.10.0/other' })), /stable version/);
});
