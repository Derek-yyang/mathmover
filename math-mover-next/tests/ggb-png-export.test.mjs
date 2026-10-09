import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../lib/ggb-png-export.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { getCoursewarePNG } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('uses the supported GeoGebra 2x export API without DPI conversion', () => {
  const api = { getPNGBase64: (...args) => { assert.deepEqual(args, [2, false]); return 'iVBORw0KGgo='; } };
  assert.equal(getCoursewarePNG(api, () => { throw new Error('fallback should not run'); }), 'data:image/png;base64,iVBORw0KGgo=');
});

test('older APIs use the actual canvas data URL without duplicating the prefix', () => {
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(getCoursewarePNG({}, () => data), data);
  assert.equal(getCoursewarePNG({ getPNGBase64: () => '' }, () => data), data);
});

test('missing image data reports a failure instead of silently doing nothing', () => {
  assert.throws(() => getCoursewarePNG({}, () => null), /无法获取画板截图/);
});
