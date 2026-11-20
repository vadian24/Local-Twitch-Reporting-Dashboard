'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

async function check() {
  assert.ok(process.versions.electron, 'Use the packaged Electron runtime.');
  const requirePackaged = createRequire(path.join(process.env.DASHBOARD_ASAR, 'src', 'main.js'));
  const { verifyInstaller, assetName, bundleName } = requirePackaged('./verify-update');
  const bundle = JSON.parse(readFileSync(path.join(process.env.UPDATE_ASSETS, bundleName), 'utf8'));
  await verifyInstaller(path.join(process.env.UPDATE_ASSETS, assetName), bundle, process.env.RELEASE_VERSION);
  const { verify } = requirePackaged('sigstore');
  await assert.rejects(verify(bundle, {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI: '^https://github[.]com/wrong-workflow$'
  }));
  console.log('Packaged Electron verified the Windows update and rejected a wrong workflow identity.');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
