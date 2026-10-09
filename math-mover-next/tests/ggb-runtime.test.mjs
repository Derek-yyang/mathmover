import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const config = JSON.parse(readFileSync(new URL('../geogebra-runtime.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../lib/ggb-runtime.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

function harness() {
  const scripts = [];
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  };
  const context = vm.createContext({
    window, exports: {},
    require(name) { assert.equal(name, '../geogebra-runtime.json'); return config; },
    document: {
      createElement(name) {
        assert.equal(name, 'script');
        return { remove() { scripts.splice(scripts.indexOf(this), 1); } };
      },
      body: { appendChild(script) { scripts.push(script); } },
    },
  });
  vm.runInContext(compiled, context);
  return { ...context.exports, window, scripts, timers };
}

test('pinned runtime paths stay same-origin and match the actual bundle layout', () => {
  const h = harness();
  assert.equal(h.GGB_SCRIPT, `/vendor/geogebra/${config.version}/deployggb.js`);
  assert.equal(h.GGB_CODEBASE, `/vendor/geogebra/${config.version}/${config.codebase}`);
  assert.match(config.sha256, /^[a-f0-9]{64}$/);
  const board = readFileSync(new URL('../components/GeoGebraBoard.tsx', import.meta.url), 'utf8');
  assert.ok(board.indexOf('setHTML5Codebase(GGB_CODEBASE, true)') < board.indexOf('applet.inject(container)'));
  assert.doesNotMatch(board, /https:\/\/www\.geogebra/);
});

test('concurrent mounts share one local script; an initialized engine needs no reload', async () => {
  const h = harness();
  const first = h.ensureGGBLoaded();
  assert.equal(first, h.ensureGGBLoaded());
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].src, h.GGB_SCRIPT);
  h.window.GGBApplet = function () {};
  h.scripts[0].onload();
  await first;
  await h.ensureGGBLoaded();
  assert.equal(h.scripts.length, 1);
  assert.equal(h.timers.size, 0);
});

test('missing local resources fail visibly and allow a fresh attempt without CDN fallback', async () => {
  const h = harness();
  const pending = h.ensureGGBLoaded();
  h.scripts[0].onerror();
  await assert.rejects(pending, /本地 GeoGebra/);
  assert.equal(h.window.__GGB_LOAD_PROMISE__, undefined);
  assert.equal(h.scripts.length, 0);
  const retry = h.ensureGGBLoaded();
  h.window.GGBApplet = function () {};
  h.scripts[0].onload();
  await retry;
});

test('HTTP success without the runtime constructor is still a load failure', async () => {
  const h = harness();
  const pending = h.ensureGGBLoaded();
  h.scripts[0].onload();
  await assert.rejects(pending, /加载失败/);
  assert.equal(h.scripts.length, 0);
});

test('a stalled loader times out and resets its pending promise', async () => {
  const h = harness();
  const pending = h.ensureGGBLoaded();
  [...h.timers.values()][0]();
  await assert.rejects(pending, /加载失败/);
  assert.equal(h.window.__GGB_LOAD_PROMISE__, undefined);
});
