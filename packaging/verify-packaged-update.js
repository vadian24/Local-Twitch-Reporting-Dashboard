'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

async function check() {
  assert.ok(process.versions.electron, 'Use the packaged Electron runtime.');
  const requirePackaged = createRequire(path.join(process.env.DASHBOARD_ASAR, 'src', 'main.js'));
  const { verifyInstaller, assetName, bundleName, verifyLinuxArchive, linuxAsset, linuxBundleName } =
    requirePackaged('./verify-update');
  const bundle = JSON.parse(readFileSync(path.join(process.env.UPDATE_ASSETS, bundleName), 'utf8'));
  await verifyInstaller(path.join(process.env.UPDATE_ASSETS, assetName), bundle, process.env.RELEASE_VERSION);
  const linuxProof = path.join(process.env.UPDATE_ASSETS, linuxBundleName);
  if (existsSync(linuxProof)) {
    const archive = path.join(process.env.UPDATE_ASSETS, linuxAsset);
    await verifyLinuxArchive(archive, JSON.parse(readFileSync(linuxProof, 'utf8')), process.env.RELEASE_VERSION);
    const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
    const folder = await mkdtemp(path.join(require('node:os').tmpdir(), 'dashboard-release-test-'));
    try {
      const { stageLinuxUpdate, applyLinuxUpdate } = requirePackaged('./linux-update');
      const bundle = await stageLinuxUpdate(folder, archive);
      const install = path.join(folder, 'old dashboard');
      await mkdir(install);
      await writeFile(path.join(install, 'old-marker'), 'previous version');
      const exe = path.join(install, 'Local-Twitch-Reporting-Dashboard');
      await applyLinuxUpdate(folder, bundle, exe, async installed => {
        assert.equal(installed, exe);
        assert.ok(existsSync(exe));
      });
      assert.equal(await readFile(path.join(folder, 'previous', 'old-marker'), 'utf8'), 'previous version');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    console.log('Packaged Electron verified and staged the signed Linux update and replaced a test installation.');
  }
  const { verify } = requirePackaged('sigstore');
  await assert.rejects(verify(bundle, {
    certificateIssuer: 'https://token.actions.githubusercontent.com',
    certificateIdentityURI: '^https://github[.]com/wrong-workflow$'
  }));
  console.log('Packaged Electron verified the Windows update and rejected a wrong workflow identity.');
}

check().catch(error => { console.error(error); process.exitCode = 1; });
