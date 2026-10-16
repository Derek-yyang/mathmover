import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const ts = createRequire(import.meta.url)('typescript');
const { outputText } = ts.transpileModule(readFileSync(new URL('../lib/ggb-view-reset.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { STANDARD_3D_VIEW, patchStandard3DView, resetStandard3DView, read3DCamera } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

/** 一段贴近真实的构造 XML：2D 视图块 + 3D 视图块（相机已被转乱、缩放过）+ 内核块。 */
const xmlWith3D = (coordSystem) => `<geogebra format="5.0">
<euclidianView><coordSystem xZero="549" yZero="349" scale="50" yscale="50"/><evSettings axes="true"/></euclidianView>
<euclidianView3D>
	<coordSystem ${coordSystem}/>
	<evSettings axes="true" grid="false" gridIsBold="false" pointCapturing="3" rightAngleStyle="1" gridType="3"/>
	<axis id="0" show="true" label="x" unitLabel="" tickStyle="1" showNumbers="true"/>
	<projection type="0"/>
</euclidianView3D>
<kernel><continuous val="false"/></kernel>
<construction><element type="point" label="A"><coords x="1" y="1" z="1"/></element></construction>
</geogebra>`;

/** 只取 3D 块——两个块都叫 coordSystem，全局匹配会抓到 2D 那条。 */
const block3d = (xml) => /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(xml ?? '')?.[0] ?? '';
const attr3d = (xml, name) => new RegExp(`${name}="([^"]*)"`).exec(block3d(xml))?.[1];
const without3D = (xml) => (xml ?? '').replace(/<euclidianView3D>[\s\S]*?<\/euclidianView3D>/, '@3D@');
const withoutCamera = (xml) => block3d(xml).replace(/<coordSystem[^>]*\/>/, '@cam@');

test('replaces the whole 3D camera — orientation, centre and zoom', () => {
  const original = xmlWith3D('xZero="7" yZero="-3" zZero="-38.477" scale="150" xAngle="-70" zAngle="-240"');
  const patched = patchStandard3DView(original);
  assert.ok(patched);
  assert.equal(attr3d(patched, 'xAngle'), '20');
  assert.equal(attr3d(patched, 'zAngle'), '-60');
  assert.equal(attr3d(patched, 'zZero'), '-1.5');
  assert.equal(attr3d(patched, 'xZero'), '0');
  assert.equal(attr3d(patched, 'yZero'), '0');
  assert.equal(attr3d(patched, 'scale'), '50', 'zoom goes back to the standard too');
  // 2D 视图的坐标系统原样保留
  assert.match(patched, /<euclidianView><coordSystem xZero="549" yZero="349" scale="50" yscale="50"\/>/);
  // 3D 块内外除相机之外的一切都不动
  assert.equal(without3D(patched), without3D(original));
  assert.equal(withoutCamera(patched), withoutCamera(original));
});

test('already-standard XML is unchanged by the patch', () => {
  const std = `xZero="${STANDARD_3D_VIEW.xZero}" yZero="${STANDARD_3D_VIEW.yZero}" zZero="${STANDARD_3D_VIEW.zZero}" scale="50" xAngle="${STANDARD_3D_VIEW.xAngle}" zAngle="${STANDARD_3D_VIEW.zAngle}"`;
  assert.equal(patchStandard3DView(xmlWith3D(std)), xmlWith3D(std));
});

test('a broken zoom (negative scale from a stray ZoomIn(-10)) falls back to the standard', () => {
  for (const broken of ['scale="-1000"', 'scale="0"', 'scale="oops"', '']) {
    const patched = patchStandard3DView(xmlWith3D(`xZero="0" yZero="0" zZero="0" ${broken} xAngle="90" zAngle="-90"`));
    assert.ok(patched, `patched for ${broken}`);
    assert.equal(attr3d(patched, 'scale'), '50', `scale repaired for ${JSON.stringify(broken)}`);
  }
});

test('degrades to null when there is nothing to patch', () => {
  assert.equal(patchStandard3DView(''), null);
  assert.equal(patchStandard3DView('<geogebra><euclidianView><coordSystem xZero="0"/></euclidianView></geogebra>'), null);
  assert.equal(patchStandard3DView('<euclidianView3D><evSettings axes="true"/></euclidianView3D>'), null);
  assert.equal(patchStandard3DView(undefined), null);
});

/** 手动驱动的帧时钟：`now()` 代表墙钟（setXML 的成本往里加），frame(ts) 推进动画时间线。 */
function fakeClock() {
  let time = 0;
  let nextId = 1;
  let pending = new Map();
  return {
    clock: {
      now: () => time,
      request: (cb) => { const id = nextId++; pending.set(id, cb); return id; },
      cancel: (id) => { pending.delete(id); },
    },
    setTime: (value) => { time = value; },
    get time() { return time; },
    get pendingFrames() { return pending.size; },
    frame(timestamp) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb(timestamp);
    },
  };
}

const cameraOf = (xml) => {
  const coord = /<coordSystem([^>]*)\/?>/.exec(block3d(xml))?.[1] ?? '';
  const out = {};
  for (const [, name, value] of coord.matchAll(/(\w+)="([^"]*)"/g)) out[name] = Number(value);
  return out;
};

/** 一个被转乱、平移过、放大过的 3D 相机。 */
const messyXml = () => xmlWith3D('xZero="0.77" yZero="-0.65" zZero="-38.477" scale="150" xAngle="-67" zAngle="-235"');

test('resetStandard3DView writes the patch back and forces a repaint', () => {
  const writes = [];
  let repaints = 0;
  const api = {
    getXML: () => messyXml(),
    setXML: (xml) => { writes.push(xml); },
    refreshViews: () => { repaints += 1; },
  };
  const c = fakeClock();
  assert.equal(resetStandard3DView(api, { clock: c.clock, reducedMotion: true }), null, 'no animation to cancel');
  assert.equal(writes.length, 1, 'reduced motion = one jump');
  assert.equal(repaints, 1, 'and it repaints, or the canvas stays on the old camera');
  assert.equal(attr3d(writes[0], 'xAngle'), '20');
  assert.equal(attr3d(writes[0], 'scale'), '50', 'zoom is part of the reset');
});

test('a view that only differs in zoom still animates back', () => {
  const frames = [];
  const c = fakeClock();
  const api = {
    getXML: () => xmlWith3D('xZero="0" yZero="0" zZero="-1.5" scale="400" xAngle="20" zAngle="-60"'),
    setXML: (xml) => { frames.push(cameraOf(xml)); },
    refreshViews: () => {},
  };
  const cancel = resetStandard3DView(api, { clock: c.clock });
  assert.equal(typeof cancel, 'function', 'zoom alone is enough to need a reset');
  for (const ts of [0, 100, 200, 300, 340]) { if (c.pendingFrames) c.frame(ts); }
  const last = frames.at(-1);
  assert.equal(last.scale, 50);
  assert.deepEqual({ ...last, scale: 0 }, { ...cameraOf(xmlWith3D('xZero="0" yZero="0" zZero="-1.5" scale="50" xAngle="20" zAngle="-60"')), scale: 0 },
    'and the orientation is left exactly as it was');
});

test('animates frame by frame toward the standard view and lands exactly on it', () => {
  const frames = [];
  const c = fakeClock();
  const api = {
    getXML: () => messyXml(),
    setXML: (xml) => { frames.push(cameraOf(xml)); c.setTime(c.time + 5); },
    refreshViews: () => {},
  };
  const cancel = resetStandard3DView(api, { clock: c.clock });
  assert.equal(typeof cancel, 'function');
  for (const ts of [0, 60, 120, 180, 240, 300, 360]) {
    if (!c.pendingFrames) break;
    c.setTime(ts);
    c.frame(ts);
  }
  assert.ok(frames.length >= 4, `several frames drawn (got ${frames.length})`);
  // 朝向单调逼近目标，且没有绕远路：zAngle 从 -235 走 175° 到 -60，
  // 而不是绕 185° 到同余的 -420（角是连续累加量，两种走法终点画面相同）
  const xAngles = frames.map((f) => f.xAngle);
  const zAngles = frames.map((f) => f.zAngle);
  assert.deepEqual(xAngles, [...xAngles].sort((a, b) => a - b), 'xAngle approaches 20 monotonically');
  assert.deepEqual(zAngles, [...zAngles].sort((a, b) => a - b), 'zAngle approaches -60 monotonically');
  assert.ok(zAngles.every((z) => z >= -235 - 1e-9 && z <= -60 + 1e-9), 'and never overshoots onto the long way round');
  const last = frames.at(-1);
  assert.deepEqual(last, { xZero: 0, yZero: 0, zZero: -1.5, scale: 50, xAngle: 20, zAngle: -60 },
    `final frame is the exact standard camera (got ${JSON.stringify(last)})`);
  const scales = frames.map((f) => f.scale);
  assert.deepEqual(scales, [...scales].sort((a, b) => b - a), 'zoom eases back toward the standard too');
  assert.equal(c.pendingFrames, 0, 'no frame left scheduled after finishing');
});

test('an already-standard view does nothing at all', () => {
  let writes = 0;
  const api = {
    getXML: () => xmlWith3D(`xZero="0" yZero="0" zZero="-1.5" scale="50" xAngle="20" zAngle="-60"`),
    setXML: () => { writes += 1; },
    refreshViews: () => {},
  };
  assert.equal(resetStandard3DView(api, { clock: fakeClock().clock }), null);
  assert.equal(writes, 0);
});

test('a frame costing more than the budget collapses to a single jump', () => {
  const frames = [];
  const c = fakeClock();
  const api = {
    getXML: () => messyXml(),
    setXML: (xml) => { frames.push(cameraOf(xml)); c.setTime(c.time + 120); }, // 大构造：每帧 120ms
    refreshViews: () => {},
  };
  const cancel = resetStandard3DView(api, { clock: c.clock });
  c.frame(16);          // 首帧（含预热，不计预算）
  c.frame(32);          // 第二帧超预算 → 画完这一帧再收尾
  assert.equal(typeof cancel, 'function');
  assert.equal(frames.length, 3, `two animated frames then the exact target (drew ${frames.length})`);
  assert.equal(frames.at(-1).xAngle, 20, 'lands on the standard view nonetheless');
  assert.equal(c.pendingFrames, 0, 'and stops there');
});

test('cancel stops the animation mid-flight', () => {
  const frames = [];
  const c = fakeClock();
  const api = {
    getXML: () => messyXml(),
    setXML: (xml) => { frames.push(cameraOf(xml)); },
    refreshViews: () => {},
  };
  const cancel = resetStandard3DView(api, { clock: c.clock });
  c.frame(16);
  cancel();
  assert.equal(c.pendingFrames, 0, 'cancel clears the scheduled frame');
});

test('an expensive frame stretches the animation instead of dropping frames', () => {
  // 30ms/帧 ≈ 80 个对象的真实画板：基准 300ms 只够切 10 帧，每帧跨一大步就显顿。
  const frames = [];
  const c = fakeClock();
  const api = {
    getXML: () => messyXml(),
    setXML: (xml) => { frames.push(cameraOf(xml)); c.setTime(c.time + 30); },
    refreshViews: () => {},
  };
  resetStandard3DView(api, { clock: c.clock });
  for (let i = 0; i < 80 && c.pendingFrames; i++) c.frame(c.time);
  assert.ok(frames.length > 12, `stretched past the base 300ms (drew ${frames.length} frames)`);
  assert.deepEqual(frames.at(-1), { xZero: 0, yZero: 0, zZero: -1.5, scale: 50, xAngle: 20, zAngle: -60 });
});

test('resetStandard3DView reports failure instead of throwing', () => {
  const c = fakeClock();
  assert.equal(resetStandard3DView({}, { clock: c.clock }), null);
  assert.equal(resetStandard3DView({ getXML: () => '<geogebra/>', setXML: () => {} }, { clock: c.clock }), null);
  assert.equal(resetStandard3DView({ getXML: () => { throw new Error('boom'); }, setXML: () => {} }, { clock: c.clock }), null);
  assert.equal(resetStandard3DView({ getXML: () => { throw new Error('boom'); }, setXML: () => {}, refreshViews: () => {} }, { clock: c.clock }), null);
});

test('read3DCamera reads the 3D camera and refuses incomplete ones', () => {
  assert.deepEqual(read3DCamera(xmlWith3D('xZero="0" yZero="0" zZero="-1.5" scale="50" xAngle="20" zAngle="-60"')),
    { xZero: 0, yZero: 0, zZero: -1.5, scale: 50, xAngle: 20, zAngle: -60 });
  assert.equal(read3DCamera('<geogebra><euclidianView><coordSystem xZero="0"/></euclidianView></geogebra>'), null);
  assert.equal(read3DCamera(xmlWith3D('xZero="0" yZero="0" zZero="-1.5" scale="50" xAngle="20"')), null);
});
