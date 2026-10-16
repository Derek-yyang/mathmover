import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from '../math-mover-next/node_modules/typescript/lib/typescript.js';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const source = await readFile(new URL('../math-mover-next/lib/ggb-grid-renderer.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1560, height: 1040 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixtures = await page.evaluate(async url => {
    const { optimizeParallelGridStrokes } = await import(url);
    const results = [];
    for (const name of ['horizontal', 'vertical-alpha-dashed', 'duplicate-lines', 'split-line',
      'connected', 'curves', 'path2d', 'clip-fill-reuse', 'overlap', 'shadow', 'rotated', 'small-canvas']) {
      const canvas = document.createElement('canvas');
      canvas.width = name === 'small-canvas' ? 800 : 2300;
      canvas.height = 1400;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let strokes = 0;
      const nativeStroke = context.stroke;
      const previousDescriptor = Object.getOwnPropertyDescriptor(context, 'stroke');
      context.stroke = function(...args) { strokes++; return nativeStroke.apply(this, args); };
      const instrumentedStroke = context.stroke;
      const draw = () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.scale(2, 2);
        context.strokeStyle = 'rgba(125,130,135,0.6)';
        context.lineWidth = 1;
        if (name === 'shadow') { context.shadowBlur = 4; context.shadowColor = '#777'; }
        if (name === 'rotated') context.rotate(.1);
        if (name === 'vertical-alpha-dashed') { context.globalAlpha = .7; context.setLineDash([5, 3]); }
        context.beginPath();
        for (let i = 0; i < 48; i++) {
          const position = 10.5 + i * (name === 'overlap' ? .4 : 10);
          if (name === 'vertical-alpha-dashed') {
            context.moveTo(position, 0); context.lineTo(position, 600);
          } else {
            context.moveTo(0, position); context.lineTo(1000, position);
            if (name === 'duplicate-lines' && i === 0) { context.moveTo(0, position); context.lineTo(1000, position); }
            if (name === 'split-line') { context.moveTo(1030, position); context.lineTo(1100, position); }
            if (name === 'connected') context.lineTo(1000, position + 4);
            if (name === 'curves') context.bezierCurveTo(100, position, 500, position + 6, 1000, position + 6);
          }
        }
        if (name === 'path2d') {
          const path = new Path2D(); path.rect(10, 10, 100, 100); context.stroke(path);
        } else context.stroke();
        if (name === 'clip-fill-reuse') {
          context.stroke(); context.clip(); context.fillStyle = '#a45'; context.fill();
          context.fillRect(0, 0, 100, 100);
        }
        context.restore();
      };
      draw();
      const baseline = context.getImageData(0, 0, canvas.width, canvas.height).data;
      strokes = 0;
      const release = optimizeParallelGridStrokes(context);
      draw();
      const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let changedBytes = 0;
      for (let i = 0; i < actual.length; i++) if (actual[i] !== baseline[i]) changedBytes++;
      const optimizedStrokes = strokes;
      release();
      results.push({ name, changedBytes, optimizedStrokes, restored: context.stroke === instrumentedStroke
        && !Object.hasOwn(context, 'moveTo') && !Object.hasOwn(context, 'beginPath') });
      if (previousDescriptor) Object.defineProperty(context, 'stroke', previousDescriptor);
      else delete context.stroke;
    }
    return results;
  }, moduleUrl);
  for (const fixture of fixtures) {
    assert.equal(fixture.changedBytes, 0, `${fixture.name}: visual difference`);
    assert(fixture.restored, `${fixture.name}: incomplete cleanup`);
  }
  assert(fixtures.find(item => item.name === 'horizontal').optimizedStrokes > 1, 'batching did not run');
  for (const name of ['connected', 'curves', 'path2d', 'overlap', 'shadow', 'rotated', 'small-canvas']) {
    assert.equal(fixtures.find(item => item.name === name).optimizedStrokes, 1, `${name}: native fallback failed`);
  }

  // Run this against the unmodified production baseline to compare exact native
  // and adapted pixels in the same actual GeoGebra instance.
  await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], ok: true } }));
  await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
  await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.close());
  await stubConstructionDraft(page);
  await page.goto((process.argv[2] || 'http://localhost:3102') + '/dashboard');
  await page.waitForFunction(() => !!window.ggbApplet?.getViewProperties, null, { timeout: 90000 });
  await page.getByRole('button', { name: '全屏演示', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const api = window.ggbApplet;
    api.evalCommand('A=(1,2)'); api.evalCommand('f(x)=x^2'); api.evalCommand('c=Circle(A,2)');
    api.setMode(40);
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => window.ggbApplet.setCoordSystem(-16, 16, -10, 10));
  const capture = async () => {
    await page.waitForTimeout(350);
    const image = await page.locator('.EuclidianPanel canvas').first().screenshot({ animations: 'disabled' });
    const properties = await page.evaluate(() => {
      const canvas = document.querySelector('.EuclidianPanel canvas');
      return { width: canvas.width, height: canvas.height, png: window.ggbApplet.getPNGBase64(1, false, false) };
    });
    return { ...properties, image, view: await page.evaluate(() => window.ggbApplet.getViewProperties(1)), hash: createHash('sha256').update(image).digest('hex') };
  };
  const runtime = [];
  for (const gridType of [3, 0, 1, 2]) {
    await page.evaluate(type => window.ggbApplet.setGraphicsOptions(1, { gridType: type }), gridType);
    await page.evaluate(() => window.ggbApplet.setCoordSystem(-16, 16, -10, 10));
    await page.waitForTimeout(350);
    await page.evaluate(() => window.ggbApplet.setCoordSystem(-16, 16, -10, 10));
    const native = await capture();
    await page.evaluate(async url => {
      const module = await import(url);
      window.__releaseGridRenderer = module.attachGgbGridRenderer(document.querySelector('#ggb-element'));
      window.ggbApplet.setCoordSystem(-15, 17, -10, 10);
    }, moduleUrl);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.ggbApplet.setCoordSystem(-16, 16, -10, 10));
    const adapted = await capture();
    assert.equal(adapted.view, native.view, `runtime grid ${gridType}: view changed`);
    const difference = await page.evaluate(async images => {
      const read = async data => {
        const response = await fetch('data:image/png;base64,' + data);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0); bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = await read(images[0]), b = await read(images[1]);
      let changedPixels = 0, maxChannelDelta = 0;
      for(let i=0;i<a.length;i+=4) {
        let changed = false;
        for(let c=0;c<4;c++) { const delta = Math.abs(a[i+c]-b[i+c]); if(delta) changed = true; maxChannelDelta = Math.max(maxChannelDelta, delta); }
        if(changed) changedPixels++;
      }
      return { changedPixels, maxChannelDelta, pixels: a.length / 4 };
    }, [native.image.toString('base64'), adapted.image.toString('base64')]);
    // Chrome may round antialias coverage by one channel level at canvas edges
    // when the same lines are submitted as smaller GPU paths.
    assert(difference.maxChannelDelta <= 1 && difference.changedPixels <= difference.pixels * .0001,
      `runtime grid ${gridType}: visible difference ${JSON.stringify(difference)}`);
    assert.equal(adapted.png, native.png, `runtime grid ${gridType}: exported PNG changed`);
    await page.evaluate(() => window.__releaseGridRenderer());
    runtime.push({ gridType, difference, exportIdentical: true, width: adapted.width, height: adapted.height });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixtures, runtime, errors }));
} finally { await browser.close(); }
