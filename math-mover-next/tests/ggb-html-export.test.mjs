import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const ts = createRequire(import.meta.url)('typescript');
const source = readFileSync(new URL('../lib/ggb-html-export.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { createCoursewareHTML } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function execute(html, { loaderMissing = false, injectionFails = false } = {}) {
  const stage = { clientWidth: 800, clientHeight: 500 };
  const status = { hidden: false, textContent: '' };
  const sizes = [];
  const callbacks = [];
  const api = { setSize: (...size) => sizes.push(size) };
  let params;
  let observer;
  const context = {
    document: { querySelector: () => stage, getElementById: () => status },
    window: { addEventListener() {} },
    requestAnimationFrame: callback => { callbacks.push(callback); return callbacks.length; },
    ResizeObserver: class { constructor(callback) { observer = callback; } observe() {} },
    console: { error() {} },
  };
  if (!loaderMissing) context.GGBApplet = class {
    constructor(config) { params = config; }
    inject(id) {
      assert.equal(id, 'ggb-element');
      if (injectionFails) throw new Error('failed');
      params.appletOnLoad(api);
    }
  };
  vm.runInNewContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], context);
  return { stage, status, sizes, callbacks, api, context, params, resize: () => observer() };
}

test('embeds the exact snapshot, preserves saved views, and uses the standalone runtime', () => {
  const html = createCoursewareHTML('UEsDBAoAAA==', '三角形课件');
  const run = execute(html);
  assert.equal(run.params.ggbBase64, 'UEsDBAoAAA==');
  assert.equal(run.params.randomize, false);
  assert.equal('perspective' in run.params, false);
  assert.equal('showAxes' in run.params, false);
  assert.equal('showGrid' in run.params, false);
  assert.equal(run.context.window.ggbApplet, run.api);
  assert.equal(run.status.hidden, true);
  assert.match(html, /https:\/\/www\.geogebra\.org\/apps\/deployggb\.js/);
  assert.doesNotMatch(html, /localhost|127\.0\.0\.1|\/api\/agent/);
  assert.match(html, /需联网加载 GeoGebra/);
});

test('escapes titles and script-breaking snapshot content', () => {
  const hostile = '</script><script>window.hacked=true</script>\u2028\u2029&';
  const html = createCoursewareHTML(hostile, '<img src=x onerror="alert(1)">&课件');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.equal((html.match(/<script(?: |>|\n)/g) || []).length, 2);
  const run = execute(html);
  assert.equal(run.params.ggbBase64, hostile);
  assert.equal(run.context.window.hacked, undefined);
});

test('observes the independent layout stage and deduplicates actual size updates', () => {
  const run = execute(createCoursewareHTML('AQID'));
  assert.deepEqual(run.sizes, [[800, 500]]);
  run.resize();
  run.resize();
  assert.equal(run.callbacks.length, 1);
  run.callbacks.shift()();
  assert.equal(run.sizes.length, 1);
  run.stage.clientWidth = 400;
  run.stage.clientHeight = 250;
  run.resize();
  run.callbacks.shift()();
  assert.deepEqual(run.sizes.at(-1), [400, 250]);
  run.stage.clientHeight = 0;
  run.resize();
  run.callbacks.shift()();
  assert.equal(run.sizes.length, 2);
});

test('missing runtime and failed initialization show a visible load error', () => {
  for (const options of [{ loaderMissing: true }, { injectionFails: true }]) {
    const run = execute(createCoursewareHTML('AQID'), options);
    assert.equal(run.status.hidden, false);
    assert.match(run.status.textContent, /加载失败/);
  }
});

test('empty snapshots cannot produce a misleading downloadable courseware', () => {
  assert.throws(() => createCoursewareHTML(''), /无法获取画板数据/);
  assert.throws(() => createCoursewareHTML('   '), /无法获取画板数据/);
});
