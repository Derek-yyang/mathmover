import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const ts = createRequire(import.meta.url)('typescript');
const { outputText } = ts.transpileModule(readFileSync(new URL('../lib/ggb-graphics-state.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { ggbClientEventType, readGgbGraphics, watchGgbGraphics, beginGgbRestore, isRestoringGgb } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const options = { grid: true, axes: { x: { visible: true }, y: { visible: true }, z: { visible: false } }, gridColor: '#aaa' };
const perspective = '<perspective><views><view id="1" visible="true"/><view id="512" visible="false"/><view id="4097" visible="true"/></views></perspective>';

test('normalizes bundled array events and object events without guessing unknown values', () => {
  assert.equal(ggbClientEventType(['viewPropertiesChanged', '', '1']), 'viewPropertiesChanged');
  assert.equal(ggbClientEventType({ type: 'viewChanged2D' }), 'viewChanged2D');
  for (const event of [null, [], [4], {}, { type: 3 }]) assert.equal(ggbClientEventType(event), null);
});
test('reads actual one-axis, grid and native panel state from both JSON formats', () => {
  const partial = { ...options, grid: false, axes: { ...options.axes, x: { visible: false } } };
  for (const raw of [partial, JSON.stringify(partial)]) {
    const state = readGgbGraphics({ getGraphicsOptions: () => raw, getPerspectiveXML: () => perspective });
    assert.equal(state.axes, 'mixed'); assert.equal(state.showGrid, false); assert.equal(state.settingsOpen, true);
  }
  assert.equal(readGgbGraphics({ getGraphicsOptions: () => '{' }), null);
  assert.equal(readGgbGraphics({ getGraphicsOptions: () => ({ grid: true, axes: {} }) }), null);
});
test('3D uses its own graphics view and includes the z axis', () => {
  let view;
  const state = readGgbGraphics({ getPerspectiveXML: () => '<view id="1" visible="false"/><view id="512" visible="true"/>',
    getGraphicsOptions: id => { view = id; return options; } });
  assert.equal(view, -1); assert.equal(state.axes, 'mixed'); assert.equal(state.mode, '3D');
});
test('coalesces a settings burst, notices style-only changes and releases listeners', async () => {
  let data = options; let xml = perspective; let listener; let reads = 0; const seen = [];
  const api = { getGraphicsOptions: () => { reads++; return data; }, getPerspectiveXML: () => xml,
    registerClientListener: fn => { listener = fn; }, unregisterClientListener: fn => { assert.equal(fn, listener); listener = null; } };
  const stop = watchGgbGraphics(api, state => seen.push(state));
  for (let frame = 0; frame < 100; frame++) listener(['viewChanged2D']);
  await Promise.resolve(); assert.equal(reads, 1);
  data = { ...options, gridColor: '#00aa00' };
  listener(['viewPropertiesChanged']); listener({ type: 'viewChanged2D' });
  await Promise.resolve(); assert.equal(seen.length, 2); assert.notEqual(seen[0].signature, seen[1].signature);
  xml = '<view id="1" visible="true"/>'; listener(['perspectiveChange']);
  await Promise.resolve(); assert.equal(seen.length, 3); assert.equal(seen[2].settingsOpen, false);
  listener(['viewPropertiesChanged']); stop(); await Promise.resolve();
  assert.equal(seen.length, 3); assert.equal(listener, null);
});
test('snapshot restore has an explicit lifetime for layout preservation', () => {
  const api = {}; const finish = beginGgbRestore(api);
  assert.equal(isRestoringGgb(api), true); finish(); assert.equal(isRestoringGgb(api), false);
});
