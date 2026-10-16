/**
 * 标题标记的**提取与剥离** —— 吃 `AgentEvent`、吐 `AgentEvent`。
 *
 * agent 在回复正文里吐一个标记：`<mm-title>圆的动态演示</mm-title>`。宿主把它从流里剥掉
 * （用户看不见），剥出来的内容当课件名。对齐 OpenDesign 的 `<od-title>`，但修了他们的一处漏洞。
 *
 * 三条纪律：
 *
 * 1. **剥离恒开、贯穿整轮。** 每遇到一个成对标签就吃掉，**不因为「已经采用过」就停止扫描**——
 *    否则同一轮里第二个标记会原样显示在聊天里。OpenDesign 的 `strip()` 正是采到第一个后
 *    `scanning = false`，那是个漏洞，别照抄。
 * 2. **采用只一次。** 第一个标签赢；后面的照样剥、只是不采用。跨轮的「不许改名」由前端
 *    （第一条带 meta.title 的消息赢）管，这里只管本轮。
 * 3. **两条通道各一份缓冲。** `text-delta` 与 `text` 是两条会吐同样内容的流（claude 解析器
 *    两条都给，前端靠 `streamedText` 去重）。剥离器带「半截标签」缓冲，两条流交错喂进同一个
 *    缓冲会互相串位——拼出两边都没写过的东西。所以各配一个实例，只共用「已采用」标志。
 *    （OpenDesign 为 thinking 流单独配第二个实例，是同一条教训。）
 *
 * 标记是**协议噪音**：模型是按提示词吐它的，它并不知道这一轮我们要不要标题。所以剥离无条件，
 * 「要不要拿它命名」另设闸门——OpenDesign 原来让两者共用一个开关，于是不请求标题的轮次里
 * 标记原样漏进正文（线上量到 `<od-title>编辑级羊皮纸单页</od-title>` 出现在第一行）。
 */

import type { AgentEvent } from './defs.ts';

const OPEN = '<mm-title>';
const CLOSE = '</mm-title>';

/** 开标签出现后最多再等这么多字符等闭标签；超了就当它是普通文本。 */
const DEFAULT_SCAN_LIMIT = 512;

/** 标题长度上限（按**字符**数，不是字节——CJK 一个字三字节）。 */
export const TITLE_MAX_CHARS = 36;

/**
 * 归一化（纪律抄 Codex 的 `parse_thread_title`）：剥首尾引号/反引号 → 压平空白 →
 * 去结尾标点 → 空则判失败 → 按字符截断。
 */
export function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/^[\s"'`“”‘’]+/, '')
    .replace(/[\s"'`“”‘’]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.?!。？！]+$/, '')
    .trim();
  if (!cleaned) return '';
  // 按**码点**截断，别把代理对（emoji / 生僻字）切成两半
  return [...cleaned].slice(0, TITLE_MAX_CHARS).join('');
}

interface Stripper {
  strip(delta: string): string;
  flush(): string;
}

function createStripper(onTitle: (raw: string) => void, maxScanLength = DEFAULT_SCAN_LIMIT): Stripper {
  let buffer = '';

  /** 缓冲末尾「最长的、是开标签前缀的后缀」——`<mm-ti` 得留着，不然会漏出半截标签。 */
  const partialOpenLength = (text: string): number => {
    const max = Math.min(text.length, OPEN.length - 1);
    for (let len = max; len > 0; len -= 1) {
      if (OPEN.startsWith(text.slice(-len))) return len;
    }
    return 0;
  };

  const strip = (delta: string): string => {
    buffer += delta;
    let visible = '';
    // 每轮至少吃掉一个字符或吐出至少一个字符，必然终止
    for (;;) {
      const open = buffer.indexOf(OPEN);
      if (open === -1) {
        const keep = partialOpenLength(buffer);
        visible += keep ? buffer.slice(0, buffer.length - keep) : buffer;
        buffer = keep ? buffer.slice(-keep) : '';
        break;
      }
      if (open > 0) {
        visible += buffer.slice(0, open);
        buffer = buffer.slice(open);
        continue;
      }
      const close = buffer.indexOf(CLOSE, OPEN.length);
      if (close === -1) {
        if (buffer.length > maxScanLength) {
          // 畸形（开标签迟迟不闭合）：把它当普通文本吐出去，从它之后继续扫。
          // 既不吞掉后面的正文，也不关掉剥离——这个标记不是标记，后面的可能才是。
          visible += OPEN;
          buffer = buffer.slice(OPEN.length);
          continue;
        }
        break;
      }
      onTitle(buffer.slice(OPEN.length, close));
      buffer = buffer.slice(close + CLOSE.length);
      // 继续循环：同一轮里的第二个标记照样要剥（停止采用 ≠ 停止剥离）
    }
    return visible;
  };

  const flush = (): string => {
    if (!buffer) return '';
    const rest = strip('');
    if (rest) return rest;
    if (!buffer) return '';
    // 剩下的只是半截开标签前缀（如正文结尾就写了个 `<`）——原样交还，别吞字
    const tail = buffer;
    buffer = '';
    return tail;
  };

  return { strip, flush };
}

export interface TitleExtractor {
  /** 过一遍事件：返回该发出去的事件（0 条 / 1 条 / 文本 + title 两条）。 */
  push(event: AgentEvent): AgentEvent[];
  /** 流结束时调用：把缓冲里的残留当可见文本吐出，别丢字。 */
  flush(): AgentEvent[];
}

export function createTitleExtractor(): TitleExtractor {
  let adopted: string | null = null;
  let pending: string | null = null;

  const onTitle = (raw: string): void => {
    if (adopted) return;               // 只采用第一个
    const title = normalizeTitle(raw);
    if (!title) return;
    adopted = title;
    pending = title;
  };

  const takePending = (): AgentEvent[] => {
    if (pending === null) return [];
    const event: AgentEvent = { kind: 'title', title: pending };
    pending = null;
    return [event];
  };

  const pass = (
    event: { kind: 'text-delta' | 'text'; text: string },
    stripper: Stripper,
  ): AgentEvent[] => {
    const visible = stripper.strip(event.text);
    const out: AgentEvent[] = [...takePending()];
    if (visible) out.push({ ...event, text: visible } as AgentEvent);
    return out;
  };

  const deltaStripper = createStripper(onTitle);
  const textStripper = createStripper(onTitle);

  return {
    push(event) {
      if (event.kind === 'text-delta') return pass(event, deltaStripper);
      if (event.kind === 'text') return pass(event, textStripper);
      return [event];
    },
    flush() {
      const out: AgentEvent[] = [];
      for (const [stripper, kind] of [[deltaStripper, 'text-delta'], [textStripper, 'text']] as const) {
        const rest = stripper.flush();
        out.push(...takePending());
        if (rest) out.push({ kind, text: rest } as AgentEvent);
      }
      return out;
    },
  };
}
