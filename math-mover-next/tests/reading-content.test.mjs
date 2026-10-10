import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

async function moduleFrom(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { fitImage, constrainImage, zoomImage } = await moduleFrom('../lib/image-view.ts');
const { codePreview, rehypeMathSource } = await moduleFrom('../lib/reading-content.ts');

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
test('long-code preview changes display only, retaining complete source and unicode', () => {
  const source = Array.from({ length: 40 }, (_, i) => `Line ${i}`).join(String.fromCharCode(10));
  const preview = codePreview(source);
  assert.equal(preview.lines, 40);
  assert.equal(preview.long, true);
  assert.equal(preview.preview.split(String.fromCharCode(10)).length, 12);
  assert.equal(codePreview('a').long, false);
  assert.equal(codePreview('😀'.repeat(3000)).preview, '😀'.repeat(2000));
  assert.equal(source.split(String.fromCharCode(10)).length, 40);
});
test('formula source is original TeX, not rendered text, with one control per display formula', () => {
  const element = (tagName, properties = {}, children = []) => ({ type: 'element', tagName, properties, children });
  const annotation = element('annotation', { encoding: 'application/x-tex' }, [{ type: 'text', value: 'x^{2}+1' }]);
  const inline = element('span', { className: ['katex'] }, [annotation]);
  const nested = element('span', { className: ['katex'] }, [annotation]);
  const display = element('span', { className: ['katex-display'] }, [nested]);
  const plain = element('span', {}, [{ type: 'text', value: 'not math' }]);
  const tree = { type: 'root', children: [inline, display, plain] };
  rehypeMathSource()(tree);
  assert.equal(inline.properties['data-math-source'], 'x^{2}+1');
  assert.equal(display.properties['data-math-source'], 'x^{2}+1');
  assert.equal(nested.properties['data-math-source'], undefined);
  assert.equal(plain.properties['data-math-source'], undefined);
});
