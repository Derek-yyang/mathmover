import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const { buildSync } = createRequire(import.meta.url)('esbuild');
function compile(minify = false) {
  const { outputFiles } = buildSync({
    entryPoints: [fileURLToPath(new URL('../lib/ggb-html-export.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'cjs', target: 'es2017', minify,
  });
  const compiledModule = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, { module: compiledModule, exports: compiledModule.exports });
  return compiledModule.exports.createCoursewareHTML;
}
const createCoursewareHTML = compile();

function execute(html, { loaderMissing = false, injectionFails = false, deferLoad = false, mode3D = false, viewport = false, reducedMotion = false } = {}) {
  function element() {
    const attributes = new Map();
    const events = new Map();
    return {
      hidden: false, disabled: false, textContent: '', open: false, events,
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: key => attributes.get(key),
      removeAttribute: key => attributes.delete(key),
      addEventListener: (key, value) => events.set(key, value),
      click() { if (!this.disabled) events.get('click')?.(); },
    };
  }
  const stage = Object.assign(element(), { clientWidth: 800, clientHeight: 500 });
  const elements = Object.fromEntries(['load-status', 'load-message', 'load-progress', 'retry', 'axes', 'grid', 'reset', 'fullscreen', 'info', 'action-status'].map(id => [id, element()]));
  elements['load-message'].hidden = elements.retry.hidden = true;
  const root = element();
  for (const id of ['axes', 'grid', 'reset']) elements[id].disabled = true;
  const sizes = [], callbacks = [], setters = [], timers = new Map();
  const coordinates = [];
  const metrics = { xMin: -4, yMin: -2.5, width: 800, height: 500, invXscale: .01, invYscale: .01 };
  const options = { grid: true, axes: { x: { visible: true }, y: { visible: false }, z: { visible: true } } };
  let params, observer, loader, client, restore;
  let time = 0, nextFrame = 0;
  const cancelledFrames = new Set(), xmlWrites = [];
  let xml = '<geogebra><euclidianView3D><coordSystem xZero="4" yZero="2" zZero="1" scale="80" xAngle="40" zAngle="-10"/></euclidianView3D><construction><element label="P"/></construction></geogebra>';
  const api = {
    setSize: (...size) => { sizes.push(size); [metrics.width, metrics.height] = size; },
    getViewProperties: viewport ? () => JSON.stringify(metrics) : undefined,
    setCoordSystem: viewport ? (xMin, xMax, yMin, yMax) => {
      coordinates.push([xMin, xMax, yMin, yMax]);
      Object.assign(metrics, { xMin, yMin, invXscale: (xMax - xMin) / metrics.width, invYscale: (yMax - yMin) / metrics.height });
    } : undefined,
    getPerspectiveXML: () => mode3D ? '3D' : '2D',
    getGraphicsOptions: view => { assert.equal(view, mode3D ? -1 : 1); return JSON.stringify(options); },
    setAxesVisible: (...args) => {
      setters.push(['axes', ...args]);
      const values = mode3D ? args.slice(1) : args;
      ['x', 'y', 'z'].slice(0, values.length).forEach((axis, index) => { options.axes[axis].visible = values[index]; });
    },
    setGridVisible: (...args) => { setters.push(['grid', ...args]); options.grid = args.at(-1); },
    setBase64: (snapshot, callback) => { restore = { snapshot, callback }; },
    getXML: () => xml,
    setXML: next => { xmlWrites.push(next); xml = next; },
    refreshViews() {},
    registerClientListener: callback => { client = callback; },
  };
  const document = {
    documentElement: root, querySelector: () => stage, getElementById: id => elements[id],
    addEventListener: root.addEventListener, createElement: () => ({}),
    body: { appendChild(script) { loader = script; script.onload(); } },
  };
  const context = {
    document, window: { addEventListener() {}, matchMedia: query => ({ matches: query.includes('reduced-motion') && reducedMotion }) },
    performance: { now: () => time },
    DOMParser: class {
      parseFromString() { return { querySelector: selector => selector.includes('512') ? mode3D : !mode3D }; }
    },
    setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++nextFrame; callbacks.push(timestamp => { if (!cancelledFrames.has(id)) callback(timestamp ?? time); }); return id; },
    cancelAnimationFrame: id => cancelledFrames.add(id),
    ResizeObserver: class { constructor(callback) { observer = callback; } observe() {} },
  };
  if (!loaderMissing) context.GGBApplet = class {
    constructor(config) { params = config; }
    inject(id) {
      assert.equal(id, 'ggb-element');
      if (injectionFails) throw new Error('failed');
      if (!deferLoad) params.appletOnLoad(api);
    }
  };
  vm.runInNewContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], context);
  return { stage, status: elements['load-status'], elements, root, sizes, callbacks, api, context, params,
    setters, options, timers, loader, coordinates, metrics, xmlWrites,
    advance: timestamp => { time = timestamp; callbacks.splice(0).forEach(callback => callback(time)); },
    get restore() { return restore; },
    client: event => client(event), resize: () => observer() };
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
  assert.equal(run.status.getAttribute('data-complete'), '');
  run.timers.get(180)();
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
  assert.equal((html.match(/<script(?: |>|\n)/g) || []).length, 1);
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
    assert.match(run.elements['load-message'].textContent, /加载失败/);
    assert.equal(run.elements.retry.hidden, false);
    assert.equal(run.elements.axes.disabled, true);
  }
});

test('loading stays text-free, fades only when ready, and recovers after a slow load', () => {
  const run = execute(createCoursewareHTML('AQID'), { deferLoad: true });
  assert.equal(run.status.hidden, false);
  assert.equal(run.elements['load-message'].hidden, true);
  assert.equal(run.elements.retry.hidden, true);
  assert.equal(run.status.getAttribute('data-complete'), undefined);
  run.timers.get(30000)();
  assert.equal(run.elements['load-progress'].hidden, true);
  assert.equal(run.elements['load-message'].hidden, false);
  assert.equal(run.elements.retry.hidden, false);
  run.params.appletOnLoad(run.api);
  assert.equal(run.elements['load-message'].hidden, true);
  assert.equal(run.elements.retry.hidden, true);
  assert.equal(run.stage.getAttribute('aria-busy'), 'false');
  assert.equal(run.status.getAttribute('data-complete'), '');
  run.timers.get(180)();
  assert.equal(run.status.hidden, true);
  const reduced = execute(createCoursewareHTML('AQID'), { reducedMotion: true });
  assert.equal(reduced.status.hidden, true);
  assert.equal(reduced.timers.has(180), false);
});

test('empty snapshots cannot produce a misleading downloadable courseware', () => {
  assert.throws(() => createCoursewareHTML(''), /无法获取画板数据/);
  assert.throws(() => createCoursewareHTML('   '), /无法获取画板数据/);
});


test('reads mixed axes and grid state without overwriting the embedded courseware', () => {
  for (const mode3D of [false, true]) {
    const run = execute(createCoursewareHTML('AQID'), { mode3D });
    assert.equal(run.elements.axes.getAttribute('aria-pressed'), 'mixed');
    assert.equal(run.elements.grid.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(run.setters, []);
    run.elements.axes.click();
    assert.deepEqual(run.setters.at(-1), mode3D ? ['axes', 3, true, true, true] : ['axes', true, true]);
    assert.equal(run.elements.axes.getAttribute('aria-pressed'), 'true');
    run.elements.axes.click();
    assert.equal(run.elements.axes.getAttribute('aria-pressed'), 'false');
    run.elements.grid.click();
    assert.deepEqual(run.setters.at(-1), mode3D ? ['grid', 3, false] : ['grid', false]);
    run.options.grid = true;
    run.client({ type: 'viewPropertiesChanged' });
    assert.equal(run.elements.grid.getAttribute('aria-pressed'), 'true');
  }
});

test('viewer uses a fixed light shell without theme controls or overriding the applet colors', () => {
  const html = createCoursewareHTML('AQID');
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.doesNotMatch(html, /id="theme"|data-theme|prefers-color-scheme|localStorage|界面主题/);
  const run = execute(html);
  assert.deepEqual(run.setters, []);
  assert.equal(run.restore, undefined);
});

test('centering has intermediate frames, preserves zoom and parameters, and never reloads the snapshot', () => {
  const run = execute(createCoursewareHTML('original'), { viewport: true });
  run.api.setCoordSystem(4, 12, -4, 1);
  run.coordinates.length = 0;
  run.elements.reset.click();
  run.advance(75);
  const middle = run.coordinates.at(-1);
  assert.ok(middle[0] > -4 && middle[0] < 4);
  assert.equal(middle[1] - middle[0], 8);
  assert.equal(middle[3] - middle[2], 5);
  run.advance(300);
  assert.deepEqual(run.coordinates.at(-1), [-4, 4, -2.5, 2.5]);
  assert.equal(run.restore, undefined);
  assert.equal(run.elements.reset.disabled, false);
});

test('pointer, wheel, Esc, resize and repeated reset interrupt the old animation', () => {
  for (const action of ['pointerdown', 'wheel', 'Escape', 'resize', 'restart']) {
    const run = execute(createCoursewareHTML('original'), { viewport: true });
    run.api.setCoordSystem(4, 12, -4, 1);
    run.elements.reset.click(); run.advance(75);
    if (action === 'Escape') run.root.events.get('keydown')({ key: 'Escape' });
    else if (action === 'resize') {
      run.stage.clientWidth = 600; run.resize(); run.advance(100);
    } else if (action === 'restart') run.elements.reset.click();
    else run.stage.events.get(action)();
    const count = run.coordinates.length;
    run.advance(300);
    if (action === 'restart') {
      const current = run.coordinates.at(-1);
      assert.ok(current[0] > -4);
      run.advance(375);
      assert.deepEqual(run.coordinates.at(-1), [-4, 4, -2.5, 2.5]);
    } else assert.equal(run.coordinates.length, count);
    assert.equal(run.restore, undefined);
  }
});

test('reduced motion centers immediately and an already-centered view does not repaint', () => {
  const run = execute(createCoursewareHTML('original'), { viewport: true, reducedMotion: true });
  run.api.setCoordSystem(4, 12, -4, 1); run.coordinates.length = 0;
  run.elements.reset.click();
  assert.deepEqual(run.coordinates, [[-4, 4, -2.5, 2.5]]);
  run.elements.reset.click();
  assert.equal(run.coordinates.length, 1);
  assert.equal(run.callbacks.length, 0);
});

test('the embedded 3D animation preserves construction and can be cancelled', () => {
  const run = execute(createCoursewareHTML('original'), { mode3D: true });
  run.elements.reset.click(); run.advance(75);
  assert.equal(run.xmlWrites.length, 1);
  assert.match(run.xmlWrites[0], /<construction><element label="P"\/><\/construction>/);
  run.stage.events.get('pointerdown')();
  run.advance(300);
  assert.equal(run.xmlWrites.length, 1);
  run.elements.reset.click(); run.advance(600);
  assert.match(run.xmlWrites.at(-1), /xZero="0" yZero="0" zZero="-0.5" scale="50" xAngle="20" zAngle="-60"/);
  assert.equal(run.restore, undefined);
});

test('production-minified exports embed self-contained 2D and 3D animation functions', () => {
  const minifiedHTML = compile(true);
  for (const mode3D of [false, true]) {
    const run = execute(minifiedHTML('original'), { viewport: true, mode3D });
    if (!mode3D) run.api.setCoordSystem(4, 12, -4, 1);
    run.elements.reset.click();
    run.advance(75); run.advance(600);
    assert.equal(run.elements['action-status'].textContent, '');
    if (mode3D) assert.match(run.xmlWrites.at(-1), /zZero="-0.5"/);
    else assert.deepEqual(run.coordinates.at(-1), [-4, 4, -2.5, 2.5]);
  }
});

test('preserves workbench pixels per unit on opening and resizing instead of fitting the saved viewport', () => {
  const view = { xMin: -8, yMin: -5, width: 1600, height: 1000, invXscale: .01, invYscale: .01 };
  const run = execute(createCoursewareHTML('AQID', '课件', JSON.stringify(view)), { viewport: true });
  assert.deepEqual(run.coordinates.at(-1), [-4, 4, -2.5, 2.5]);
  run.stage.clientWidth = 400;
  run.stage.clientHeight = 250;
  run.resize(); run.callbacks.shift()();
  assert.deepEqual(run.coordinates.at(-1), [-2, 2, -1.25, 1.25]);
  const three = execute(createCoursewareHTML('AQID', '课件', view), { viewport: true, mode3D: true });
  assert.deepEqual(three.coordinates, []);
});

test('retains a panned view center and unequal axis scales across different aspect ratios', () => {
  const view = { xMin: 10, yMin: -8, width: 1600, height: 1000, invXscale: .01, invYscale: .02 };
  const run = execute(createCoursewareHTML('AQID', '课件', view), { viewport: true });
  assert.deepEqual(run.coordinates.at(-1), [14, 22, -3, 7]);
  run.stage.clientWidth = 1200;
  run.stage.clientHeight = 300;
  run.resize(); run.callbacks.shift()();
  assert.deepEqual(run.coordinates.at(-1), [12, 24, -1, 5]);
});

test('ignores malformed viewport metadata and never embeds its arbitrary properties', () => {
  for (const view of [null, '</script>', { width: 0 }, { xMin: NaN }]) {
    const run = execute(createCoursewareHTML('AQID', '课件', view), { viewport: true });
    run.timers.get(180)();
    assert.equal(run.status.hidden, true);
  }
  const html = createCoursewareHTML('AQID', '课件', {
    xMin: 0, yMin: 0, width: 800, height: 500, invXscale: 1, invYscale: 1, malicious: '</script><script>bad()</script>',
  });
  assert.doesNotMatch(html, /bad\(\)/);
});
