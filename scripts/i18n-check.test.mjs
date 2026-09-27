import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const checker = path.join(scriptsDir, 'i18n-check.mjs');
const fixtures = path.join(scriptsDir, '__fixtures__', 'i18n-contract');

function runFixture(name) {
  return spawnSync(process.execPath, [checker, '--catalog-dir', path.join(fixtures, name)], {
    cwd: path.join(scriptsDir, '..'),
    encoding: 'utf8',
  });
}

test('accepts locale-specific categories and safe zero-offset plural flattening', () => {
  const result = runFixture('valid');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All 2 locales in parity with valid ICU contracts/);
});

test('rejects argument type, plural kind, offset, and selector drift', () => {
  const result = runFixture('invalid');
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1, output);
  assert.match(output, /argumentType: expected \[arg:value:number\], got \[arg:value:argument\]/);
  assert.match(output, /pluralKind: expected \[arg:position:argument,plural:position/);
  assert.match(output, /got \[arg:position:argument,selectordinal:position/);
  assert.match(output, /pluralOffset: expected .*offset=1.*got .*offset=2/);
  assert.match(output, /exactSelectors: expected .*exact==0\|=2.*got .*exact==0\|=3/);
  assert.match(output, /selectSelectors: expected .*closed\|open\|other.*got .*open\|other/);
});

test('rejects obsolete public marketing claim keys in every catalog', () => {
  const result = runFixture('stale-marketing');
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1, output);
  assert.match(
    output,
    /en: obsolete marketing claim key\(s\): publicPages\.landing\.migrate\.description/
  );
  assert.match(
    output,
    /tr: obsolete marketing claim key\(s\): publicPages\.landing\.migrate\.description/
  );
});
