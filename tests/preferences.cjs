const assert = require('node:assert/strict');
const { normalize, validImage } = require('../preferences.js');
assert.equal(normalize(null).theme, 'system');
assert.equal(
  normalize({
    plan: '__proto__',
  }).plan,
  'free',
);
assert.equal(
  normalize({
    theme: 'dark',
    accent: '#AABBCC',
  }).theme,
  'dark',
);
assert.equal(
  normalize({
    left: 'false',
  }).left,
  false,
);
assert.equal(validImage('data:image/svg+xml,<svg onload=alert(1)>'), false);
assert.equal(validImage('https://example.com/icon.png'), false);
const icon = {
  id: 'icon-one',
  name: 'Demo',
  data: 'data:image/png;base64,YQ==',
};
assert.equal(
  normalize({
    icons: [icon],
    categoryIcons: {
      hvac: 'icon-one',
    },
  }).categoryIcons.hvac,
  'icon-one',
);
assert.equal(
  normalize({
    icons: [icon],
    categoryIcons: {
      fire: 'missing',
    },
  }).categoryIcons.fire,
  undefined,
);
assert.equal(
  normalize({
    icons: Array.from(
      {
        length: 60,
      },
      (_, i) => ({
        ...icon,
        id: 'icon-' + i,
      }),
    ),
  }).icons.length,
  50,
);
assert.equal(
  normalize({
    icons: [
      {
        ...icon,
        id: '<script>',
      },
    ],
  }).icons.length,
  0,
);
assert.equal(
  normalize({
    icons: [icon],
    categoryIcons: {
      'category-1234-abcd': 'icon-one',
    },
  }).categoryIcons['category-1234-abcd'],
  'icon-one',
);
console.log('preferences validation: 11 assertions passed');
