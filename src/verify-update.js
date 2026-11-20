'use strict';

const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');

const repository = 'vadian24/Local-Twitch-Reporting-Dashboard';
const assetName = 'Local-Twitch-Reporting-Dashboard-Windows-x64-Setup.exe';
const bundleName = 'windows-update.sigstore.json';
const predicateType = 'https://github.com/' + repository + '/windows-update/v1';
const verificationPolicy = {
  certificateIssuer: 'https://token.actions.githubusercontent.com',
  certificateIdentityURI: '^https://github\\.com/' + repository + '/\\.github/workflows/release\\.yml@refs/heads/main$'
};

async function verifyInstaller(file, bundle, version, verify = require('sigstore').verify) {
  // A DSSE bundle signs the statement. The updater separately matches its
  // signed subject digest to the actual installer bytes before execution.
  if (bundle.messageSignature || bundle.dsseEnvelope?.payloadType !== 'application/vnd.in-toto+json') {
    throw new Error('Expected a signed update statement.');
  }
  await verify(bundle, verificationPolicy);
  const signed = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  if (signed._type !== 'https://in-toto.io/Statement/v1' ||
      signed.predicateType !== predicateType || signed.predicate?.version !== version ||
      signed.subject?.length !== 1) {
    throw new Error('The signed statement does not identify this update version.');
  }
  const [subject] = signed.subject;
  if (subject.name !== assetName || !/^[0-9a-f]{64}$/.test(subject.digest?.sha256)) {
    throw new Error('The signed update has no valid installer digest.');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== subject.digest.sha256) {
    throw new Error('The installer does not match the signed update digest.');
  }
}

module.exports = { assetName, bundleName, predicateType, repository, verifyInstaller };
