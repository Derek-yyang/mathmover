import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const ts = createRequire(import.meta.url)('typescript');
const { outputText } = ts.transpileModule(readFileSync(new URL('../lib/ggb-settings-refresh.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { perspectiveForSettingsReopen, registerGgbSettingsPanel, refreshGgbSettings } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);
const xml = '<perspective><panes><pane location="" divider="1" orientation="1"/></panes><views><view id="512" visible="true"/><view id="4097" visible="false" size="392"/></views><toolbar show="false"/></perspective>';
test('overlay and split layouts retain every field except the hidden panel size', () => {
  for (const divider of ['1', '0.2']) {
    const input = xml.replace('divider="1"', `divider="${divider}"`);
    assert.equal(perspectiveForSettingsReopen(input, 392), input.replace('size="392"', 'size="400"'));
  }
  assert.equal(perspectiveForSettingsReopen(xml.replace('id="512"', 'id="1"'), 183),
    xml.replace('id="512"', 'id="1"').replace('size="392"', 'size="191"'));
});
test('open layouts and invalid widths cannot replace native opening', () => {
  assert.equal(perspectiveForSettingsReopen(xml.replace('id="4097" visible="false"', 'id="4097" visible="true"'), 392), null);
  assert.equal(perspectiveForSettingsReopen(xml.replace(' size="392"', ''), 392), null);
  for (const width of [0, -1, NaN, Infinity]) assert.equal(perspectiveForSettingsReopen(xml, width), null);
});
test('refresh closes, updates hidden size, and opens through the native lifecycle', () => {
  const calls = [];
  const api = { getPerspectiveXML: () => { assert.equal(calls.at(-1), '-P'); return xml; }, setPerspective: value => calls.push(value) };
  const release = registerGgbSettingsPanel(api, () => 392);
  refreshGgbSettings(api, false); assert.equal(calls.length, 0);
  refreshGgbSettings(api, true);
  assert.deepEqual(calls, ['-P', xml.replace('size="392"', 'size="400"'), '+P']);
  release(); refreshGgbSettings(api, true); assert.equal(calls.length, 3);
});
test('rapid clicks retain the last rendered width; unknown instances are untouched', () => {
  const calls = []; let width = 392;
  const api = { getPerspectiveXML: () => xml, setPerspective: value => calls.push(value) };
  refreshGgbSettings(api, true); assert.equal(calls.length, 0);
  const release = registerGgbSettingsPanel(api, () => width);
  refreshGgbSettings(api, true); width = 0; refreshGgbSettings(api, true);
  assert.equal(calls[1], calls[4]); release();
});
test('native opening runs even when reading or importing the closed layout fails', () => {
  for (const failure of ['read', 'import']) {
    const calls = [];
    const api = { getPerspectiveXML: () => { if (failure === 'read') throw Error('read'); return xml; },
      setPerspective: value => { calls.push(value); if (failure === 'import' && value.startsWith('<')) throw Error('import'); } };
    const release = registerGgbSettingsPanel(api, () => 392);
    assert.throws(() => refreshGgbSettings(api, true)); assert.equal(calls.at(-1), '+P'); release();
  }
});
test('disposing an older registration does not remove its replacement', () => {
  const calls = [];
  const api = { getPerspectiveXML: () => xml, setPerspective: value => calls.push(value) };
  const old = registerGgbSettingsPanel(api, () => 0);
  const release = registerGgbSettingsPanel(api, () => 392);
  old(); refreshGgbSettings(api, true); assert.equal(calls.length, 3); release();
});
