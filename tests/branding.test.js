import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const brand = 'ドパガキガード';
test('manifest and every visible page use the confirmed Katakana name', () => {
 const manifest = JSON.parse(read('extension/manifest.json'));
 assert.equal(manifest.name, brand);
 assert.equal(manifest.action.default_title, brand);
 for (const page of ['popup', 'options', 'blocked']) {
  const html = read(`extension/${page}.html`);
  assert.match(html, new RegExp(`<title>[^<]*${brand}</title>`));
  assert.match(html, /class="brand-mark" aria-hidden="true">ド<\/div>/);
  assert.ok(html.includes(brand));
 }
 assert.ok(read('README.md').startsWith(`# ${brand} v0.2.0`));
});
test('legacy display name is absent from runtime text', () => {
 for (const name of fs.readdirSync(new URL('../extension/', import.meta.url))) {
  if (/\.(?:js|html|json|css)$/.test(name)) assert.ok(!read(`extension/${name}`).includes('じかんガード'), name);
 }
 const background = read('extension/background.js');
 assert.ok(background.includes(`${brand}: 今日の上限です`));
 assert.ok(background.includes(`${brand}: あと`));
 assert.ok(background.includes(`${brand}:`));
});
