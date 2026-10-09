import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../lib/ggb-view-transition.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
});
const { readViewBounds, animateViewToCenter } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

function harness() {
  let time = 0;
  let nextId = 0;
  const pending = new Map();
  const views = [];
  const clock = {
    now: () => time,
    request: callback => { pending.set(++nextId, callback); return nextId; },
    cancel: id => pending.delete(id),
  };
  return {
    views, clock, pending,
    apply: view => views.push(view),
    advance: timestamp => {
      time = timestamp;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach(callback => callback(time));
    },
  };
}
const from = { xMin: -6, xMax: 18, yMin: -12, yMax: 4 };
const target = { xMin: -12, xMax: 12, yMin: -8, yMax: 8 };

test('parses both GeoGebra JSON and objects into world bounds', () => {
  const view = { xMin: -6, yMin: -12, width: 1200, height: 800, invXscale: 0.02, invYscale: 0.02 };
  assert.deepEqual(readViewBounds(view), from);
  assert.deepEqual(readViewBounds(JSON.stringify(view)), from);
});

test('invalid, zero-sized, and overflowing view properties fail safely', () => {
  const valid = { xMin: 0, yMin: 0, width: 100, height: 100, invXscale: 1, invYscale: 1 };
  for (const value of [null, '{', {}, { ...valid, width: 0 }, { ...valid, invXscale: -1 },
    { ...valid, width: '100' }, { ...valid, xMin: Infinity }, { ...valid, invXscale: Number.MAX_VALUE }]) {
    assert.equal(readViewBounds(value), null);
  }
});

test('300ms ease-out has intermediate positions and preserves zoom/aspect', () => {
  const h = harness();
  animateViewToCenter(h.apply, from, { clock: h.clock });
  for (const timestamp of [0, 50, 100, 150, 200, 250, 300]) h.advance(timestamp);
  assert.deepEqual(h.views[0], from);
  assert.deepEqual(h.views.at(-1), target);
  const centers = h.views.map(view => (view.xMin + view.xMax) / 2);
  assert(centers[1] > centers[2] && centers[2] > 0);
  assert(centers[0] - centers[1] > centers[1] - centers[2], 'motion should slow down');
  for (const view of h.views) {
    assert(Math.abs(view.xMax - view.xMin - 24) < 1e-10);
    assert(Math.abs(view.yMax - view.yMin - 16) < 1e-10);
  }
  assert.equal(h.pending.size, 0);
});

test('cancellation stops updates without snapping to the target', () => {
  const h = harness();
  const cancel = animateViewToCenter(h.apply, from, { clock: h.clock });
  h.advance(100);
  cancel();
  cancel();
  h.advance(500);
  assert.equal(h.views.length, 1);
  assert.notDeepEqual(h.views[0], target);
  assert.equal(h.pending.size, 0);
});

test('restart begins at the current position, with no old frames competing', () => {
  const h = harness();
  const cancel = animateViewToCenter(h.apply, from, { clock: h.clock });
  h.advance(100);
  const interrupted = h.views.at(-1);
  cancel();
  animateViewToCenter(h.apply, interrupted, { clock: h.clock });
  h.advance(100);
  assert.deepEqual(h.views.at(-1), interrupted);
  h.advance(400);
  assert.deepEqual(h.views.at(-1), target);
  assert.equal(h.pending.size, 0);
});

test('reduced motion is immediate; already centered views do not repaint', () => {
  const h = harness();
  animateViewToCenter(h.apply, from, { reducedMotion: true, clock: h.clock });
  assert.deepEqual(h.views, [target]);
  assert.equal(h.pending.size, 0);
  animateViewToCenter(h.apply, target, { clock: h.clock });
  assert.equal(h.views.length, 1);
  assert.equal(h.pending.size, 0);
});

test('an applet failure during a frame stops the transition', () => {
  const h = harness();
  animateViewToCenter(() => { throw new Error('applet disposed'); }, from, { clock: h.clock });
  assert.doesNotThrow(() => h.advance(50));
  assert.equal(h.pending.size, 0);
});
