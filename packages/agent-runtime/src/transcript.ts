/**
 * 无原生会话的运行时（dsh headless）的多轮方案：把历史对话打包进 prompt。
 *
 * 形制参考 OpenDesign 的 buildDaemonTranscript（apps/web/src/providers/daemon.ts）
 * 的三条实战规则：
 * 1. 角色边界用 `## user` / `## assistant` 标记行；正文里的仿冒行必须转义
 *    （加反斜杠），否则伪造的边界会劫持解析
 * 2. 逐条截断 + 总预算从最旧开始丢，超限处明确告知被省略了多少
 * 3. 调用方的系统说明里钉死「不许输出角色标记行」的禁令（见 route.ts 的
 *    SYSTEM_BRIEF），因为宿主/模型都可能在下游把这些行当真边界
 *
 * 只应喂给声明了 recomposesHistory 的运行时；带原生会话的（claude/codex）
 * 喂了会造成双重上下文（OpenDesign 的 agy -c 教训：模型会复读历史里的
 * 标记并陷入循环）。
 */

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 单条消息进转写的字符上限（超出截断并标注）。 */
export const MAX_TRANSCRIPT_MESSAGE_CHARS = 2000;
/** 整份转写的字符总预算（超出从最旧的条目开始丢）。 */
export const MAX_TRANSCRIPT_TOTAL_CHARS = 8000;

/** 正文里形如角色边界行的行首加 `\`，防止伪造边界。 */
export function escapeRoleMarkers(content: string): string {
  return content.replace(/^(## (?:user|assistant|system)[ \t]*)(\r?)$/gm, '\\$1$2');
}

function truncateMessage(content: string): string {
  if (content.length <= MAX_TRANSCRIPT_MESSAGE_CHARS) return content;
  const omitted = content.length - MAX_TRANSCRIPT_MESSAGE_CHARS;
  return `${content.slice(0, MAX_TRANSCRIPT_MESSAGE_CHARS)}\n\n[（历史消息已截断 ${omitted} 字符）]`;
}

/**
 * 把历史轮次打包成注入 prompt 的转写文本。
 * @param turns 按时间顺序、**不含本轮用户输入**的历史
 */
export function buildTranscript(turns: TranscriptTurn[]): string {
  if (turns.length === 0) return '';

  // 总预算从最旧开始丢；末尾至少保留最近一轮
  const renderedTurns: string[] = [];
  let dropped = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const rendered = `## ${t.role}\n${escapeRoleMarkers(truncateMessage(t.content.trim()))}`;
    const projected = renderedTurns.join('\n\n').length + rendered.length;
    if (renderedTurns.length > 0 && projected > MAX_TRANSCRIPT_TOTAL_CHARS) {
      dropped = i + 1;
      break;
    }
    renderedTurns.unshift(rendered);
  }

  const body = renderedTurns.join('\n\n');
  const header = dropped > 0 ? `## context warning\n（更早的 ${dropped} 轮对话已省略）\n\n` : '';
  return header + body;
}
