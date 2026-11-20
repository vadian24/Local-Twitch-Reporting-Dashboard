'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getWindowsUpdate, getLinuxUpdate } = require('../src/windows-update');
const { verifyInstaller, assetName, bundleName, predicateType } = require('../src/verify-update');

const release = {
  tag_name: 'v1.10.0',
  draft: false,
  prerelease: false,
  assets: [assetName, bundleName].map(name => ({ name, state: 'uploaded' }))
};
const response = changes => async url => {
  assert.equal(url, 'https://api.github.com/repos/vadian24/Local-Twitch-Reporting-Dashboard/releases/latest');
  return Response.json({ ...release, ...changes });
};

test('offers only a newer stable release with a published Windows installer', async () => {
  assert.deepEqual(await getWindowsUpdate('1.9.0', response()), {
    version: '1.10.0',
    base: 'https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/releases/download/v1.10.0/'
  });
  assert.equal(await getWindowsUpdate('1.10.0', response()), null);
  assert.equal(await getWindowsUpdate('2.0.0', response()), null);
  await assert.rejects(getWindowsUpdate('1.9.0', response({ assets: [] })), /no update for this platform/);
  await assert.rejects(getWindowsUpdate('1.9.0', response({ prerelease: true })), /no update for this platform/);
  await assert.rejects(getWindowsUpdate('1.9.0', response({ tag_name: 'v1.10.0/other' })), /stable version/);
});

test('requires a trusted signature, exact version, and matching installer bytes', async t => {
  const { createHash } = require('node:crypto');
  const { mkdtemp, rm, writeFile } = require('node:fs/promises');
  const path = require('node:path');
  const folder = await mkdtemp(path.join(require('node:os').tmpdir(), 'dashboard-update-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, assetName);
  const contents = Buffer.from('test installer contents');
  await writeFile(file, contents);
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    predicateType,
    predicate: { version: '1.3.0' },
    subject: [{ name: assetName, digest: { sha256: createHash('sha256').update(contents).digest('hex') } }]
  };
  const bundle = { dsseEnvelope: {
    payloadType: 'application/vnd.in-toto+json',
    payload: Buffer.from(JSON.stringify(statement)).toString('base64')
  } };
  const trusted = async (_bundle, policy) => {
    assert.equal(policy.certificateIssuer, 'https://token.actions.githubusercontent.com');
    const identity = new RegExp(policy.certificateIdentityURI);
    assert.match('https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/.github/workflows/release.yml@refs/heads/main', identity);
    assert.doesNotMatch('https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/.github/workflows/release.yml@refs/heads/other', identity);
  };
  await verifyInstaller(file, bundle, '1.3.0', trusted);
  await assert.rejects(verifyInstaller(file, bundle, '1.3.1', trusted), /update version/);
  await assert.rejects(verifyInstaller(file, bundle, '1.3.0', async () => {
    throw new Error('Invalid signature');
  }), /Invalid signature/);
  await writeFile(file, 'tampered installer');
  await assert.rejects(verifyInstaller(file, bundle, '1.3.0', trusted), /does not match/);
});

test('Linux checks for its own archive without requiring Windows release assets', async () => {
  const assets = [{ name: 'Local-Twitch-Reporting-Dashboard-Linux-x64.tar.gz', state: 'uploaded' }];
  assert.equal((await getLinuxUpdate('1.9.0', response({ assets }))).version, '1.10.0');
  await assert.rejects(getLinuxUpdate('1.9.0', response()), /no update for this platform/);
});
