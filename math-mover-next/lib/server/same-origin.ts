/**
 * 本机工作台的同源判据。
 *
 * 不能直接比 `origin !== url.origin`：Next standalone 会把内部请求 URL 的主机名
 * 归一成 `localhost`，而浏览器/Electron 可能从 `127.0.0.1`（或 `[::1]`）加载页面——
 * 两者都是同一台机器、同一个端口，却是不同的字符串。实测 Electron 里所有
 * /api/coursewares 请求因此 403。
 *
 * 判据收紧到「回环主机 + 同协议 + 同端口」：别的本机端口仍然是跨源，照旧拒绝。
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isSameLocalOrigin(requestUrl: string, origin: string | null): boolean {
  if (!origin) return true;
  try {
    const url = new URL(requestUrl);
    const source = new URL(origin);
    return source.protocol === url.protocol
      && source.port === url.port
      && LOOPBACK_HOSTS.has(source.hostname)
      && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
