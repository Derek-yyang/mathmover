import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

async function moduleFrom(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { fitImage, constrainImage, zoomImage } = await moduleFrom('../lib/image-view.ts');

test('fit keeps the complete question visible, without upscaling a small image', () => {
  assert.equal(fitImage({ width: 2000, height: 1000 }, { width: 800, height: 600 }), 0.4);
  assert.equal(fitImage({ width: 200, height: 100 }, { width: 800, height: 600 }), 1);
  assert.equal(fitImage({ width: 0, height: 0 }, { width: 800, height: 600 }), 1);
});
test('pan cannot lose the image outside the viewport, and zoom is bounded', () => {
  const result = constrainImage({ scale: 2, x: 9000, y: -9000 }, { width: 1000, height: 800 }, { width: 800, height: 600 });
  assert.deepEqual(result, { scale: 2, x: 600, y: -500 });
  assert.equal(constrainImage({ scale: 999, x: 0, y: 0 }, { width: 1000, height: 800 }, { width: 800, height: 600 }).scale, 8);
  const fit = constrainImage({ scale: 0.001, x: 999, y: 999 }, { width: 1000, height: 800 }, { width: 800, height: 600 });
  assert.equal(fit.scale, 0.75);
  assert.equal(Math.abs(fit.x), 0);
  assert.equal(Math.abs(fit.y), 0);
});
test('zoom keeps the image point under the cursor when bounds permit', () => {
  const next = zoomImage({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 80 }, { width: 1000, height: 800 }, { width: 800, height: 600 });
  assert.deepEqual(next, { scale: 2, x: -100, y: -80 });
});
