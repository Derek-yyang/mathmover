import { effectiveReasoningLevels, reasoningDialect } from '../../../packages/agent-runtime/src/opencode-config.ts';
import { isByokRunnable, maskByokConfig, type ByokConfig } from '../byok-store.ts';
import type { DetectedRuntime } from './detection-cache.ts';

/** Model discovery belongs to explicit detection; saving configuration only rebuilds metadata. */
export function buildByokRuntime(config: ByokConfig | null, binaryAvailable: boolean, discovered?: DetectedRuntime['models']): DetectedRuntime {
  const view = maskByokConfig(config);
  const ready = binaryAvailable && isByokRunnable(config);
  const options = (reasoningDialect(config?.apiFormat) ? effectiveReasoningLevels(config?.reasoningLevels ?? '') : [])
    .map(id => ({ id, label: id }));
  // Strip old reasoning options, including when the new format has no effort dialect.
  const list = ready && discovered?.list.length
    ? discovered.list.map(({ id, label }) => ({ id, label }))
    : [{ id: 'default', label: '默认（用设置里配置的模型）' }];
  if (ready && config && !list.some(item => item.id === config.model)) {
    list.unshift({ id: config.model, label: `${config.model}（设置里配置的）` });
  }
  return {
    id: 'byok', name: '内置Agent',
    version: binaryAvailable ? '自带 runtime · 无需安装' : '自带 runtime 缺失',
    usable: binaryAvailable,
    authStatus: ready ? 'ok' : 'missing',
    authMessage: !binaryAvailable
      ? '内置 runtime 缺失：重装应用即可恢复（或设 OPENCODE_BIN 指向一个 opencode 可执行文件）。'
      : ready
        ? (view.apiKeyConfigured ? `已配置（•••• ${view.apiKeyTail}）` : '已配置（本地端点，无密钥）')
        : '未配置端点与模型，请在设置里填写',
    canAttachImages: true,
    models: {
      list: list.map(item => options.length ? { ...item, reasoningOptions: options } : item),
      source: ready && discovered?.list.length ? discovered.source : 'fallback',
    },
  };
}

/** Credentials and protocol define a model catalog. Changing the default model/effort does not. */
export function sameByokConnection(a: ByokConfig | null, b: ByokConfig | null): boolean {
  return !!a && !!b && a.apiFormat === b.apiFormat && a.baseUrl === b.baseUrl && a.apiKey === b.apiKey;
}
