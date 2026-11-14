/**
 * 旧OIDCコンソールのURL、nonce、issuer、audience、有効期限の入力検証。
 * 署名検証はAPI側のテストで扱い、ここでは画面側の設定とクレームの検証を確認します。
 */
const assert = require('node:assert/strict');
const {
  secureURL,
  validateConfig,
  claims,
  verifyClaims,
} = require('../legacy/oidc-console/saas.js');
assert.equal(secureURL('https://example.org/auth').protocol, 'https:');
assert.equal(secureURL('http://localhost:8080/auth').protocol, 'http:');
for (const url of [
  'http://example.org',
  'javascript:alert(1)',
  'https://user:pass@example.org',
  'https://example.org/#x',
]) {
  assert.throws(() => secureURL(url));
}
const config = {
  enabled: true,
  issuer: 'https://identity.example.org',
  authorizationEndpoint: 'https://identity.example.org/auth',
  tokenEndpoint: 'https://identity.example.org/token',
  clientId: 'public-client',
};
const cfg = validateConfig(config, 'https://app.example.org', '/saas.html');
assert.equal(cfg.redirectUri, 'https://app.example.org/saas.html');
assert.throws(() =>
  validateConfig(
    {
      ...config,
      enabled: false,
    },
    'https://app.example.org',
    '/saas.html',
  ),
);
assert.throws(() =>
  validateConfig(
    {
      ...config,
      authorizationEndpoint: 'https://identity.example.org/auth?client_id=other',
    },
    'https://app.example.org',
    '/saas.html',
  ),
);
const c = {
  iss: cfg.issuer,
  aud: cfg.clientId,
  sub: 'test-user',
  nonce: 'one-time',
  exp: Date.now() / 1000 + 60,
};
verifyClaims(
  c,
  {
    nonce: 'one-time',
  },
  cfg,
);
for (const bad of [
  {
    ...c,
    nonce: 'wrong',
  },
  {
    ...c,
    exp: 0,
  },
  {
    ...c,
    iss: 'https://evil.example',
  },
  {
    ...c,
    aud: 'other',
  },
  {
    ...c,
    aud: [cfg.clientId, 'other'],
  },
  {
    ...c,
    azp: 'other',
  },
]) {
  assert.throws(() =>
    verifyClaims(
      bad,
      {
        nonce: 'one-time',
      },
      cfg,
    ),
  );
}
const jwt = 'e30.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.dummy';
assert.equal(claims(jwt).sub, 'test-user');
assert.throws(() => claims('not-a-jwt'));
console.log(
  'SaaS pure validation: HTTPS endpoints, config, nonce, issuer, audience, expiry, azp, JWT checks passed',
);
