import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import ts from 'typescript';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source,
  { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText).toString('base64');
const policy = moduleUrl(readFileSync(new URL('../lib/attachment-policy.ts', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../lib/agent-image-payload.ts', import.meta.url), 'utf8')
  .replace("'./attachment-policy'", JSON.stringify(policy));
const { prepareAgentImages } = await import(moduleUrl(source));
const url = '/api/coursewares/assets/' + 'a'.repeat(64) + '.png';
const saved = { url, name: '题目.png', contentType: 'image/png' };
const inline = { ...saved, url: 'data:image/png;base64,eA==' };
after(() => { delete globalThis.FileReader; });

// Node has Blob/File but no FileReader. Preserve its asynchronous browser contract.
class BlobReader {
  abort() { this.aborted = true; }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(bytes => {
      if (this.aborted) return;
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload?.();
    }, () => this.onerror?.());
  }
}
globalThis.FileReader = BlobReader;

test('persisted asset URLs are loaded with their original bytes and cancellation signal', async t => {
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.equal(input, url);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.redirect, 'error');
    return new Response(new Blob(['x'], { type: 'image/png' }));
  });
  const controller = new AbortController();
  assert.deepEqual(await prepareAgentImages([saved], controller.signal),
    [{ mediaType: 'image/png', base64: 'eA==', name: '题目.png' }]);
});

test('fresh File, inline data and text-only turns retain existing behavior', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch inline or File'); });
  const file = new File(['x'], '题目.png', { type: 'image/png' });
  const expected = [{ mediaType: 'image/png', base64: 'eA==', name: '题目.png' }];
  assert.deepEqual(await prepareAgentImages([inline]), expected);
  assert.deepEqual(await prepareAgentImages([{ ...saved, file, url: 'blob:unused' }]), expected);
  assert.deepEqual(await prepareAgentImages([]), []);
});

test('missing or unreadable saved images fail the whole preparation instead of sending a partial question', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(prepareAgentImages([inline, saved]), /题目图片读取失败/);
  globalThis.fetch = async () => { throw new TypeError('network'); };
  await assert.rejects(prepareAgentImages([saved]), /题目图片读取失败/);
  await assert.rejects(prepareAgentImages([{ ...saved, unavailable: true }]), /题目图片读取失败/);
});

test('unsupported URLs and malformed inline data never trigger arbitrary requests', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch arbitrary URLs'); });
  for (const bad of ['https://example.com/image.png', '/api/other.png', 'data:image/png;base64,', 'data:image/png;base64,eA=']) {
    await assert.rejects(prepareAgentImages([{ ...saved, url: bad }]), /题目图片读取失败/);
  }
  await assert.rejects(prepareAgentImages([{ ...inline, url: 'data:image/svg+xml;base64,eA==' }]), /PNG/);
});

test('limits and downloaded MIME type are checked before model submission', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not an image', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(prepareAgentImages([saved]), /PNG/);
  await assert.rejects(prepareAgentImages(Array(5).fill(inline)), /最多添加 4/);
  await assert.rejects(prepareAgentImages([{ ...inline, url: 'data:image/png;base64,' + 'AAAA'.repeat(2 * 1024 * 1024 + 1) }]), /6 MB/);
});

test('stop cancels both asset downloads and file reads without an Agent request', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    controller.abort();
    signal.throwIfAborted();
  });
  await assert.rejects(prepareAgentImages([saved], controller.signal), { name: 'AbortError' });
  const reading = new AbortController();
  const result = prepareAgentImages([{ ...saved, file: new File(['x'], 'x.png', { type: 'image/png' }) }], reading.signal);
  reading.abort();
  await assert.rejects(result, { name: 'AbortError' });
});
