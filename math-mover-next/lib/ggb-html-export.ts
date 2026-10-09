function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** Embed the current .ggb snapshot, rather than replaying construction commands. */
export function createCoursewareHTML(base64: string, title = 'MathMover 交互课件'): string {
  if (!base64.trim()) throw new Error('无法获取画板数据，请等待画板加载完成后重试。');
  const safeTitle = escapeHtml(title || 'MathMover 交互课件');
  const snapshot = JSON.stringify(base64).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} · MathMover</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; padding: 24px; background: #FDFCF8; color: #292524;
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: center; }
    header, main, footer { width: 100%; max-width: 1000px; }
    header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .logo { width: 36px; height: 36px; flex-shrink: 0; background: #10B981; border-radius: 10px;
      color: white; font-size: 20px; font-weight: 800; display: grid; place-items: center; }
    h1 { margin: 0; font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
    main { position: relative; aspect-ratio: 16 / 10; background: white; overflow: hidden;
      border: 1px solid #E7E5E4; border-radius: 12px; }
    #ggb-element { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }
    #load-status { position: absolute; inset: 0; margin: 0; padding: 24px; background: white;
      display: grid; place-items: center; color: #57534E; font-size: 14px; text-align: center; }
    #load-status[hidden] { display: none; }
    footer { margin-top: 12px; color: #57534E; font-size: 12px; line-height: 1.6; }
    footer a { color: #047857; }
    @media (max-width: 600px) { body { padding: 12px; } h1 { font-size: 16px; } }
  </style>
</head>
<body>
  <header><div class="logo" aria-hidden="true">M</div><h1>${safeTitle}</h1></header>
  <main aria-label="数学交互课件"><div id="ggb-element"></div>
    <p id="load-status" role="status">正在加载 GeoGebra 交互课件…</p>
  </main>
  <footer>课件数据已包含在此文件中；打开时需联网加载 GeoGebra。可拖动对象、调整参数和缩放视图。
    <a href="https://mathmover.top" target="_blank" rel="noopener noreferrer">MathMover</a>
  </footer>
  <script src="https://www.geogebra.org/apps/deployggb.js"></script>
  <script>
    (function () {
      var stage = document.querySelector('main');
      var status = document.getElementById('load-status');
      if (typeof GGBApplet !== 'function') {
        status.textContent = 'GeoGebra 加载失败，请检查网络连接后刷新页面。';
        return;
      }
      var api = null;
      var frame = 0;
      var lastWidth = 0;
      var lastHeight = 0;
      function resize() {
        if (!api) return;
        var width = stage.clientWidth;
        var height = stage.clientHeight;
        if (width > 0 && height > 0 && (width !== lastWidth || height !== lastHeight)) {
          api.setSize(width, height);
          lastWidth = width;
          lastHeight = height;
        }
      }
      function scheduleResize() {
        if (!frame) frame = requestAnimationFrame(function () { frame = 0; resize(); });
      }
      var params = {
        appName: 'classic', width: stage.clientWidth, height: stage.clientHeight,
        showToolBar: false, showAlgebraInput: false, showMenuBar: false, showResetIcon: true,
        enableLabelDrags: false, enableShiftDragZoom: true, enableRightClick: false,
        borderColor: '#D3D3D3', disableAutoScale: true, useBrowserForScale: false,
        randomize: false, ggbBase64: ${snapshot},
        appletOnLoad: function (loadedApi) {
          api = loadedApi;
          window.ggbApplet = loadedApi;
          resize();
          status.hidden = true;
        }
      };
      try {
        new GGBApplet(params, true).inject('ggb-element');
        if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleResize).observe(stage);
        else window.addEventListener('resize', scheduleResize);
      } catch (error) {
        status.textContent = '课件加载失败，请检查网络连接后刷新页面。';
        console.error(error);
      }
    })();
  </script>
</body>
</html>`;
}
