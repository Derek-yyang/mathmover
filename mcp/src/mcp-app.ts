import { createHash } from 'node:crypto';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const MCP_APP_TITLE = 'MathMover 动态画板';

export const MCP_APP_RESOURCE_META = {
  ui: {
    csp: {
      frameDomains: ['http://127.0.0.1:*'],
      connectDomains: [],
      resourceDomains: [],
    },
  },
  workbuddy: {
    ui: {
      launchSurface: 'panel',
    },
  },
};

export const MCP_APP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${MCP_APP_TITLE}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { background: #fdfcf8; color: #292524; }
    #root { position: relative; }
    #canvas { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
    #state {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      padding: 28px;
      background: #fdfcf8;
      color: #78716c;
      text-align: center;
    }
    #state[hidden] { display: none; }
    .mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 40px;
      border-radius: 9px;
      background: #047857;
      color: #fff;
      font-size: 25px;
      font-weight: 700;
    }
    #state p { max-width: 440px; margin: 0; line-height: 1.7; font-size: 13px; }
    #state.error { color: #991b1b; }
  </style>
</head>
<body>
  <main id="root">
    <div id="state" role="status">
      <span class="mark">M</span>
      <p id="message">正在打开 MathMover 画板…</p>
    </div>
    <iframe
      id="canvas"
      title="MathMover 动态画板"
      allow="clipboard-read; clipboard-write; fullscreen"
    ></iframe>
  </main>
  <script>
    (() => {
      const APP_INFO = { name: "MathMover", version: "0.1.0" };
      const PROTOCOL_VERSION = "2026-01-26";
      const frame = document.getElementById("canvas");
      const state = document.getElementById("state");
      const message = document.getElementById("message");
      const pending = new Map();
      let sequence = 0;
      let initialized = false;
      let latestResult = null;
      let hostCapabilities = {};
      let activeCanvas = null;

      const updateContext = () => {
        if (!initialized || !activeCanvas || !hostCapabilities.updateModelContext) return;
        request("ui/update-model-context", {
          content: [{ type: "text", text: "用户在 MathMover 课件管理中选择了当前课件：" + JSON.stringify(activeCanvas) + "。后续构图请使用这个 session_id 和 workfile，不要继续操作先前的课件。" }],
        }).catch(() => {});
      };

      const post = payload => window.parent.postMessage(payload, "*");
      const request = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => {
        const id = "mathmover-" + (++sequence);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(method + " 请求超时"));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        post({ jsonrpc: "2.0", id, method, params });
      });

      const showError = text => {
        state.classList.add("error");
        state.hidden = false;
        message.textContent = text;
      };

      const readCanvasInfo = result => {
        if (result && result.structuredContent && typeof result.structuredContent.url === "string") {
          return result.structuredContent;
        }
        if (result && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (!item || item.type !== "text" || typeof item.text !== "string") continue;
            try {
              const value = JSON.parse(item.text);
              if (value && typeof value.url === "string") return value;
            } catch {}
          }
        }
        return null;
      };

      const applyToolResult = result => {
        latestResult = result;
        if (!initialized) return;
        if (result && result.isError) {
          const detail = Array.isArray(result.content) && result.content[0] && result.content[0].text;
          showError(detail || "画板创建失败，请回到 Agent 查看详情。");
          return;
        }
        const info = readCanvasInfo(result);
        if (!info) return;
        if (info.title) {
          document.title = info.title + " · MathMover";
          frame.title = info.title;
        }
        if (frame.src !== info.url) {
          state.classList.remove("error");
          state.hidden = false;
          message.textContent = "正在打开 MathMover 画板…";
          frame.src = info.url;
        }
      };

      window.addEventListener("message", event => {
        const payload = event.data;
        if (event.source === frame.contentWindow) {
          if (payload && payload.type === "mathmover:export-support" && typeof payload.requestId === "string") {
            if (event.origin !== new URL(frame.src).origin) return;
            event.source.postMessage({
              type: "mathmover:export-support-result", requestId: payload.requestId, version: 1,
              ...(!initialized || !hostCapabilities.downloadFile ? { error: "当前宿主不支持文件下载，请在浏览器中打开画板后导出。" } : {}),
            }, event.origin);
            return;
          }
          if (payload && payload.type === "mathmover:export" && typeof payload.requestId === "string") {
            const reply = value => event.source.postMessage({ type: "mathmover:export-result", requestId: payload.requestId, ...value }, event.origin);
            if (event.origin !== new URL(frame.src).origin) return;
            if (!initialized || !hostCapabilities.downloadFile) {
              reply({ error: "当前宿主不支持文件下载，请在浏览器中打开画板后导出。" });
              return;
            }
            const resource = payload.resource;
            if (!resource || typeof resource.blob !== "string" || typeof resource.uri !== "string" || !resource.uri.startsWith("file:///") || !["application/vnd.geogebra.file", "text/html", "image/png"].includes(resource.mimeType)) {
              reply({ error: "导出文件无效，请重试。" });
              return;
            }
            request("ui/download-file", { contents: [{ type: "resource", resource: { uri: resource.uri, mimeType: resource.mimeType, blob: resource.blob } }] }, 180000).then(result => {
              if (result && result.isError) reply({ error: /cancel/i.test(result.error || "") ? "已取消导出。" : String(result.error || "宿主未能保存文件，请重试。") });
              else reply({});
            }).catch(error => reply({ error: error.message || "导出失败，请重试。" }));
            return;
          }
          if (payload && payload.type === "mathmover:active-canvas" && typeof payload.session_id === "string" && typeof payload.workfile === "string") {
            // Child navigation stays inside this App while the host conversation
            // learns the newly selected file/session without sending a chat message.
            activeCanvas = { session_id: payload.session_id, title: payload.title, workfile: payload.workfile };
            frame.title = String(payload.title || "MathMover 动态画板");
            updateContext();
          }
          return;
        }
        if (event.source !== window.parent) return;
        if (!payload || payload.jsonrpc !== "2.0") return;
        if (payload.id != null && pending.has(String(payload.id))) {
          const waiter = pending.get(String(payload.id));
          pending.delete(String(payload.id));
          clearTimeout(waiter.timer);
          if (payload.error) waiter.reject(new Error(payload.error.message || "MCP Apps 请求失败"));
          else waiter.resolve(payload.result);
          return;
        }
        if (payload.method === "ui/notifications/tool-result") applyToolResult(payload.params);
      });

      frame.addEventListener("load", () => {
        if (frame.src && frame.src !== "about:blank") state.hidden = true;
      });
      frame.addEventListener("error", () => showError("画板页面加载失败，请回到 Agent 重新打开。"));

      const sendSize = () => {
        post({
          jsonrpc: "2.0",
          method: "ui/notifications/size-changed",
          params: { width: window.innerWidth, height: window.innerHeight },
        });
      };
      new ResizeObserver(sendSize).observe(document.documentElement);

      request("ui/initialize", {
        protocolVersion: PROTOCOL_VERSION,
        appInfo: APP_INFO,
        appCapabilities: {},
      }).then(result => {
        initialized = true;
        hostCapabilities = result.hostCapabilities || {};
        post({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
        if (latestResult) applyToolResult(latestResult);
        updateContext();
        sendSize();
      }).catch(error => showError(String(error && error.message ? error.message : error)));
    })();
  </script>
</body>
</html>`;

// Hosts cache UI resources by URI. A changed wrapper must not reuse old HTML
// while its independently served canvas.js already contains the new protocol.
export const MCP_APP_URI = `ui://mathmover/canvas-${createHash('sha256').update(MCP_APP_HTML).digest('hex').slice(0, 12)}.html`;
