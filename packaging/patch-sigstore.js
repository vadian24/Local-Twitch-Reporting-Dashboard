'use strict';

const { readFileSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

// Backport Sigstore's explicit digest selection for Electron/BoringSSL.
// Apply only to the pinned helper and fail if its implementation changes.
const dependency = createRequire(require.resolve('sigstore'));
const core = path.join(path.dirname(dependency.resolve('@sigstore/core')), 'crypto.js');
const source = readFileSync(core, 'utf8');
const original = 'return crypto_1.default.verify(algorithm, data, key, signature);';
const fixed = [
  'if (algorithm === undefined) {',
  '            const keyType = key instanceof crypto_1.default.KeyObject',
  '                ? key.asymmetricKeyType',
  '                : crypto_1.default.createPublicKey(key).asymmetricKeyType;',
  '            if (keyType === "ec" || keyType === "rsa") algorithm = "sha256";',
  '        }',
  '        ' + original
].join('\n');
if (!source.includes(fixed)) {
  if (source.split(original).length !== 2) throw new Error('Unexpected Sigstore crypto helper; review the compatibility patch.');
  writeFileSync(core, source.replace(original, fixed));
}
