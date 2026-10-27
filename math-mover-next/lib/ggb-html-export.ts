import { animateViewToCenter, readViewBounds } from './ggb-view-transition';
import { create3DViewReset } from './ggb-view-reset';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function icon(paths: string, className = '', strokeWidth = 1.75): string {
  return '<svg class="' + className + '" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}

/** Keep only numeric viewport metrics; never interpolate arbitrary runtime data. */
function exportView(value: unknown): string {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const keys = ['xMin', 'yMin', 'width', 'height', 'invXscale', 'invYscale'];
    if (!parsed || !keys.every(key => typeof parsed[key] === 'number' && Number.isFinite(parsed[key]))) return 'null';
    if (['width', 'height', 'invXscale', 'invYscale'].some(key => parsed[key] <= 0)) return 'null';
    return JSON.stringify(Object.fromEntries(keys.map(key => [key, parsed[key]])));
  } catch { return 'null'; }
}

/** Embed the current .ggb snapshot, rather than replaying construction commands. */
export function createCoursewareHTML(base64: string, title = 'MathMover 交互课件', view?: unknown): string {
  if (!base64.trim()) throw new Error('无法获取画板数据，请等待画板加载完成后重试。');
  const safeTitle = escapeHtml(title || 'MathMover 交互课件');
  const snapshot = JSON.stringify(base64).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${safeTitle} · MathMover</title>
  <style>
    :root { color-scheme:light; --shell:#fdfcf8; --ink:#292524; --muted:#78716c; --line:#e7e5e4; --hover:#f5f5f4; --active:#ecfdf5; --accent:#047857; --panel:#fff; }
    * { box-sizing:border-box; }
    [hidden] { display:none !important; }
    body { margin:0; height:100vh; height:100dvh; min-height:240px; padding:20px 24px; display:flex; align-items:center; justify-content:center;
      background:var(--shell); color:var(--ink); font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; font-size:13px; }
    .viewer { display:flex; flex-direction:column; width:100%; max-width:1440px; height:100%; max-height:1040px; min-height:0; }
    button, summary, a { -webkit-tap-highlight-color:transparent; }
    button { font:inherit; }
    button, summary { cursor:pointer; }
    button:disabled { cursor:default; opacity:.38; }
    button:focus-visible, summary:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
    header { min-height:46px; padding:0 0 14px; display:flex; align-items:center; gap:20px; }
    .identity { display:flex; align-items:center; gap:10px; min-width:0; flex:1; }
    .logo { width:28px; height:28px; flex:none; display:grid; place-items:center; border-radius:7px; background:#059669;
      color:white; text-decoration:none; font-size:19px; font-weight:750; }
    h1 { margin:0; font-size:15px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tools { display:flex; align-items:center; gap:4px; flex:none; }
    .tool { width:32px; height:32px; display:grid; place-items:center; padding:0; border:0; border-radius:8px; color:var(--muted); background:transparent; transition:background .15s,color .15s; }
    .tool:hover:not(:disabled), summary:hover { background:var(--hover); color:var(--ink); }
    .tool[aria-pressed="true"], .tool[aria-pressed="mixed"] { color:var(--accent); background:var(--active); }
    .xy { font-size:11px; font-weight:650; letter-spacing:.3px; }
    .divider { height:16px; width:1px; margin:0 6px; background:var(--line); }
    .exit-fullscreen, :root[data-fullscreen] .enter-fullscreen { display:none; }
    :root[data-fullscreen] .exit-fullscreen { display:block; }
    main { flex:1; min-height:0; position:relative; overflow:hidden; border:1px solid var(--line); border-radius:12px; background:white; color-scheme:light; }
    /* Keep GeoGebra's own preview and popup layers below viewer feedback. */
    #ggb-element { position:absolute; z-index:0; inset:0; width:100% !important; height:100% !important; }
    #load-status { position:absolute; z-index:1; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column;
      gap:14px; padding:24px; background:var(--shell); color:var(--muted); text-align:center; opacity:1; transition:opacity .18s ease-out; }
    #load-status[data-complete] { opacity:0; pointer-events:none; }
    #load-message { margin:0; line-height:1.7; }
    .load-progress { width:160px; max-width:100%; height:3px; border-radius:2px; overflow:hidden; background:var(--line); }
    .load-fill { display:block; width:40%; height:100%; border-radius:inherit; background:var(--accent); animation:loading 1.2s cubic-bezier(.4,0,.2,1) infinite; }
    #load-status[data-complete] .load-fill { animation:none; width:100%; transform:none; }
    @keyframes loading { from { transform:translateX(-100%); } to { transform:translateX(250%); } }
    #retry { border:1px solid var(--line); border-radius:7px; padding:6px 12px; color:var(--ink); background:var(--panel); }
    #action-status { position:absolute; z-index:2; bottom:16px; left:50%; transform:translateX(-50%); max-width:calc(100% - 32px);
      margin:0; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--ink); font-size:12px; }
    #action-status:empty { display:none; }
    footer { min-height:32px; padding:8px 2px 0; display:flex; align-items:center; justify-content:space-between; gap:12px; color:var(--muted); font-size:11px; }
    footer a { color:inherit; text-decoration:none; }
    footer a:hover { color:var(--accent); }
    .footer-right { display:flex; align-items:center; gap:8px; }
    details { position:relative; }
    summary { display:grid; place-items:center; width:24px; height:24px; border-radius:6px; list-style:none; }
    summary::-webkit-details-marker { display:none; }
    .info-panel { position:absolute; right:0; bottom:32px; z-index:5; width:288px; max-width:calc(100vw - 32px); padding:16px;
      max-height:calc(100dvh - 56px); overflow:auto; overscroll-behavior:contain;
      border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--muted); font-size:12px; line-height:1.8; box-shadow:0 4px 8px #00000012; }
    .info-panel strong { color:var(--ink); font-size:13px; font-weight:600; }
    .info-panel p { margin:8px 0 0; }
    :root[data-fullscreen] body { padding:0; }
    :root[data-fullscreen] .viewer { max-width:none; max-height:none; }
    :root[data-fullscreen] header { min-height:52px; padding:10px 16px; }
    :root[data-fullscreen] main { border:0; border-radius:0; }
    :root[data-fullscreen] footer { padding:4px 16px; }
    @media (max-width:600px) {
      body { padding:16px; }
      header { padding:0 0 10px; gap:8px; flex-wrap:wrap; }
      .identity { flex-basis:100%; }
      .tools { margin-left:auto; }
      main { border-radius:10px; }
    }
    @media (prefers-reduced-motion:reduce) { .tool, #load-status { transition:none; } .load-fill { animation:none; } }
  </style>
</head>
<body>
  <div class="viewer">
  <header>
    <div class="identity">
      <a class="logo" href="https://mathmover.top" target="_blank" rel="noopener noreferrer" aria-label="MathMover 官网">M</a>
      <h1 title="${safeTitle}">${safeTitle}</h1>
    </div>
    <nav class="tools" aria-label="画板工具">
      <button id="axes" class="tool xy" type="button" title="显示坐标轴" aria-label="显示坐标轴" aria-pressed="false" disabled>XY</button>
      <button id="grid" class="tool" type="button" title="显示网格" aria-label="显示网格" aria-pressed="false" disabled>${icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>')}</button>
      <button id="reset" class="tool" type="button" title="重置视图居中" aria-label="重置视图居中" disabled>${icon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', '', 2)}</button>
      <span class="divider" aria-hidden="true"></span>
      <button id="fullscreen" class="tool" type="button" title="进入全屏" aria-label="进入全屏">${icon('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>', 'enter-fullscreen')}${icon('<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>', 'exit-fullscreen')}</button>
    </nav>
  </header>
  <main aria-label="数学交互课件" aria-busy="true">
    <div id="ggb-element"></div>
    <div id="load-status"><div id="load-progress" class="load-progress" role="progressbar" aria-label="正在加载交互课件"><span class="load-fill"></span></div><p id="load-message" role="alert" hidden></p><button id="retry" type="button" hidden>重新加载</button></div>
    <p id="action-status" role="status" aria-live="polite"></p>
  </main>
  <footer>
    <a href="https://mathmover.top" target="_blank" rel="noopener noreferrer">由 MathMover 创建</a>
    <div class="footer-right"><span>打开时需联网</span>
      <details id="info"><summary aria-label="课件使用说明" title="课件使用说明">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>')}</summary>
        <div class="info-panel"><strong>探索这份课件</strong>
          <p>可拖动对象、调整滑块，也可滚动缩放或按住 Shift 拖动画板。使用右上角工具调整坐标轴和网格。</p>
          <p>“重置视图居中”会平滑调整视图，保留当前图形和参数。拖动画板或按 Esc 可打断动画。本页修改不会写回 HTML 文件。</p>
          <p>课件数据已包含在此文件中；打开时需联网加载 GeoGebra。</p>
        </div>
      </details>
    </div>
  </footer>
  </div>
  <script>
    (function () {
      var root = document.documentElement;
      var stage = document.querySelector('main');
      var status = document.getElementById('load-status');
      var message = document.getElementById('load-message');
      var progress = document.getElementById('load-progress');
      var retry = document.getElementById('retry');
      var axesButton = document.getElementById('axes');
      var gridButton = document.getElementById('grid');
      var resetButton = document.getElementById('reset');
      var fullscreenButton = document.getElementById('fullscreen');
      var info = document.getElementById('info');
      var actionStatus = document.getElementById('action-status');
      var original = ${snapshot};
      var savedView = ${exportView(view)};
      var animateViewToCenter = ${animateViewToCenter.toString()};
      var readViewBounds = ${readViewBounds.toString()};
      var reset3D = (${create3DViewReset.toString()})().resetStandard3DView;
      var api = null, frame = 0, lastWidth = 0, lastHeight = 0, cancelReset = null;
      function cancelViewReset() {
        if (cancelReset) cancelReset();
        cancelReset = null;
      }
      function label(button, value) { button.title = value; button.setAttribute('aria-label', value); }
      function readView() {
        try {
          var state = graphics();
          if (!state || state.is3D || typeof api.getViewProperties !== 'function') return null;
          var value = api.getViewProperties(1);
          if (typeof value === 'string') value = JSON.parse(value);
          var fields = ['xMin','yMin','width','height','invXscale','invYscale'];
          if (!value || !fields.every(function (key) { return typeof value[key] === 'number' && Number.isFinite(value[key]); })) return null;
          if (value.width <= 0 || value.height <= 0 || value.invXscale <= 0 || value.invYscale <= 0) return null;
          return value;
        } catch (_) { return null; }
      }
      function centerView(before, after) {
        if (!before || !after || typeof api.setCoordSystem !== 'function') return;
        var x = before.xMin + before.width * before.invXscale / 2;
        var y = before.yMin + before.height * before.invYscale / 2;
        var halfWidth = after.width * before.invXscale / 2;
        var halfHeight = after.height * before.invYscale / 2;
        api.setCoordSystem(x - halfWidth, x + halfWidth, y - halfHeight, y + halfHeight);
      }
      // Match the workbench's pixels per unit; fitting the whole saved viewport
      // changes zoom and can make GeoGebra choose different automatic grid steps.
      function restoreSavedView() {
        var current = readView();
        if (savedView && current) centerView(savedView, current);
      }
      function resize() {
        if (!api) return;
        var width = stage.clientWidth, height = stage.clientHeight;
        if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
          cancelViewReset();
          var before = readView();
          api.setSize(width, height);
          centerView(before, readView());
          lastWidth = width; lastHeight = height;
        }
      }
      function scheduleResize() {
        if (!frame) frame = requestAnimationFrame(function () { frame = 0; resize(); });
      }
      function graphics() {
        if (!api || typeof api.getGraphicsOptions !== 'function') return null;
        try {
          var is3D = false;
          if (typeof api.getPerspectiveXML === 'function') {
            var xml = new DOMParser().parseFromString(api.getPerspectiveXML(), 'application/xml');
            is3D = !!xml.querySelector('view[id="512"][visible="true"]') && !xml.querySelector('view[id="1"][visible="true"]');
          }
          var options = api.getGraphicsOptions(is3D ? -1 : 1);
          if (typeof options === 'string') options = JSON.parse(options);
          if (!options || !options.axes) return null;
          var names = is3D ? ['x', 'y', 'z'] : ['x', 'y'];
          var visible = names.map(function (name) { return !!(options.axes[name] && options.axes[name].visible); });
          return { is3D:is3D, axes:visible.every(Boolean) ? 'true' : visible.some(Boolean) ? 'mixed' : 'false',
            grid:typeof options.grid === 'boolean' ? options.grid : null };
        } catch (_) { return null; }
      }
      function syncGraphics() {
        var state = graphics();
        axesButton.disabled = !state || typeof api.setAxesVisible !== 'function';
        gridButton.disabled = !state || state.grid === null || typeof api.setGridVisible !== 'function';
        resetButton.disabled = !state || (state.is3D
          ? typeof api.getXML !== 'function' || typeof api.setXML !== 'function'
          : typeof api.getViewProperties !== 'function' || typeof api.setCoordSystem !== 'function');
        if (!state) return;
        axesButton.setAttribute('aria-pressed', state.axes);
        gridButton.setAttribute('aria-pressed', String(state.grid === true));
        label(axesButton, state.axes === 'true' ? '隐藏坐标轴' : '显示坐标轴');
        label(gridButton, state.grid ? '隐藏网格' : '显示网格');
      }
      axesButton.addEventListener('click', function () {
        cancelViewReset();
        var state = graphics(); if (!state) return;
        try {
          var show = state.axes !== 'true';
          if (state.is3D) api.setAxesVisible(3, show, show, show); else api.setAxesVisible(show, show);
          actionStatus.textContent = '';
          syncGraphics();
        } catch (_) { actionStatus.textContent = '无法切换坐标轴，请重试。'; }
      });
      gridButton.addEventListener('click', function () {
        cancelViewReset();
        var state = graphics(); if (!state || state.grid === null) return;
        try {
          if (state.is3D) api.setGridVisible(3, !state.grid); else api.setGridVisible(!state.grid);
          actionStatus.textContent = '';
          syncGraphics();
        } catch (_) { actionStatus.textContent = '无法切换网格，请重试。'; }
      });
      resetButton.addEventListener('click', function () {
        if (!api) return;
        cancelViewReset();
        actionStatus.textContent = '';
        var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        try {
          var state = graphics();
          if (state && state.is3D) { cancelReset = reset3D(api, { reducedMotion:reducedMotion }); return; }
          var bounds = readViewBounds(readView());
          if (!bounds || typeof api.setCoordSystem !== 'function') throw new Error('View unavailable');
          cancelReset = animateViewToCenter(function (view) {
            api.setCoordSystem(view.xMin, view.xMax, view.yMin, view.yMax);
          }, bounds, { reducedMotion:reducedMotion });
        } catch (_) { actionStatus.textContent = '无法重置视图，请重试。'; }
      });
      stage.addEventListener('pointerdown', cancelViewReset);
      stage.addEventListener('wheel', cancelViewReset, { passive:true });
      stage.addEventListener('keydown', cancelViewReset);
      window.addEventListener('blur', cancelViewReset);
      window.addEventListener('pagehide', cancelViewReset);
      fullscreenButton.disabled = typeof root.requestFullscreen !== 'function';
      if (fullscreenButton.disabled) label(fullscreenButton, '当前浏览器不支持全屏');
      fullscreenButton.addEventListener('click', function () {
        try {
          var operation = document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen();
          if (operation && operation.catch) operation.catch(function () { actionStatus.textContent = '无法进入全屏，请使用浏览器全屏功能。'; });
        } catch (_) { actionStatus.textContent = '无法切换全屏，请使用浏览器全屏功能。'; }
      });
      document.addEventListener('fullscreenchange', function () {
        if (document.fullscreenElement) root.setAttribute('data-fullscreen', ''); else root.removeAttribute('data-fullscreen');
        label(fullscreenButton, document.fullscreenElement ? '退出全屏' : '进入全屏'); scheduleResize();
      });
      document.addEventListener('pointerdown', function (event) { if (!info.contains(event.target)) info.open = false; });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          cancelViewReset();
          if (info.open) { info.open = false; info.querySelector('summary').focus(); }
        }
      });
      retry.addEventListener('click', function () { window.location.reload(); });
      if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleResize).observe(stage);
      else window.addEventListener('resize', scheduleResize);
      function failLoad() {
        if (api) return;
        message.textContent = '课件加载失败，请检查网络连接后重新加载。';
        progress.hidden = true; message.hidden = false; retry.hidden = false;
        stage.setAttribute('aria-busy', 'false');
      }
      var loadTimeout = setTimeout(failLoad, 30000);
      function initialize() {
        if (typeof GGBApplet !== 'function') { clearTimeout(loadTimeout); failLoad(); return; }
        var params = {
          appName:'classic', width:stage.clientWidth, height:stage.clientHeight,
          showToolBar:false, showAlgebraInput:false, showMenuBar:false, showResetIcon:false,
          enableLabelDrags:false, enableShiftDragZoom:true, enableRightClick:false,
          borderColor:'#FFFFFF', disableAutoScale:true, useBrowserForScale:false,
          randomize:false, ggbBase64:original,
          appletOnLoad:function (loadedApi) {
            api = loadedApi; window.ggbApplet = loadedApi; clearTimeout(loadTimeout);
            resize(); restoreSavedView();
            stage.setAttribute('aria-busy', 'false');
            message.hidden = true; retry.hidden = true;
            status.setAttribute('data-complete', '');
            status.setAttribute('aria-hidden', 'true');
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) status.hidden = true;
            else setTimeout(function () { status.hidden = true; }, 180);
            syncGraphics();
            if (typeof api.registerClientListener === 'function') api.registerClientListener(function (event) {
              var type = typeof event === 'string' ? event : Array.isArray(event) ? event[0] : event && event.type;
              if (['viewPropertiesChanged','perspectiveChange','clear','undo','redo'].indexOf(type) !== -1) syncGraphics();
            });
          }
        };
        try { new GGBApplet(params, true).inject('ggb-element'); }
        catch (_) { clearTimeout(loadTimeout); failLoad(); }
      }
      var loader = document.createElement('script');
      loader.src = 'https://www.geogebra.org/apps/deployggb.js';
      loader.onload = initialize;
      loader.onerror = function () { clearTimeout(loadTimeout); failLoad(); };
      document.body.appendChild(loader);
    })();
  </script>
</body>
</html>`;
}
