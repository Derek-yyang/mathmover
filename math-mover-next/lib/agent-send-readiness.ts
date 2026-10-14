import type { GgbConnectionStatus } from './ggb-connection';

export interface SendBlock {
  message: string;
  action?: 'reconnect' | 'settings' | 'rescan';
}

/** Only known prerequisites block a new turn; unknown auth remains server-validated. */
export function agentSendBlock({ connection, detecting, detectionFailed, active }: {
  connection: GgbConnectionStatus;
  detecting: boolean;
  detectionFailed: boolean;
  active?: { usable: boolean; authStatus?: 'ok' | 'missing' | 'unknown' };
}): SendBlock | undefined {
  if (connection === 'loading') return { message: '画板加载中，完成后即可发送。' };
  if (connection === 'connecting') return { message: '正在连接画板，连接后即可发送。' };
  if (connection === 'disconnected') return { message: '画板未连接，连接后即可发送。', action: 'reconnect' };
  if (detecting) return { message: '正在检测 Agent，请稍候。' };
  if (detectionFailed) return { message: 'Agent 检测失败，请重新检测。', action: 'rescan' };
  if (!active) return { message: '未选择可用 Agent，请在设置中选择。', action: 'settings' };
  if (!active.usable) return { message: '当前 Agent 不可用，请检查设置。', action: 'settings' };
  if (active.authStatus === 'missing') return { message: '当前 Agent 尚未登录，请查看配置指引。', action: 'settings' };
  return undefined;
}
