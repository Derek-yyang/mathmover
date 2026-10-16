/**
 * 标题标记提取 —— 单元 + **真实夹具集成**。
 *
 * 夹具 `fixtures/claude-stream-sample.jsonl` 是 2026-10-09 抓的真 CLI 输出，而且正好含
 * **两条通道吐同样内容**：39-45 行是 `text_delta` 增量，46 行是 `assistant` 整段文本。
 * 所以它天生就是「两条通道交错」的样本，不用自己编。
 *
 * 锁住的语义：
 * - 分块切碎（`<mm-ti` + `tle>…`）不漏半截标签、不丢字、不重复
 * - **剥离恒开**：同一轮里第二个标记照样剥掉（OpenDesign 的 `scanning = false` 是漏洞）
 * - **采用只一次**：第一条带 meta.title 的消息赢，跨轮不许改名由前端管
 * - 两条通道同时出现**不重复生成标题**
 * - 畸形开标签当普通文本吐出，之后仍继续剥
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claudeCode, type AgentEvent } from '../src/defs.ts';
import { createTitleExtractor, normalizeTitle, TITLE_MAX_CHARS } from '../src/title-marker.ts';

const SAMPLE = fileURLToPath(new URL('./fixtures/claude-stream-sample.jsonl', import.meta.url));

function run(events: AgentEvent[]): AgentEvent[] {
  const extractor = createTitleExtractor();
  const out: AgentEvent[] = [];
  for (const event of events) out.push(...extractor.push(event));
  out.push(...extractor.flush());
  return out;
}
const textOf = (out: AgentEvent[], kind: 'text' | 'text-delta'): string =>
  out.filter((e) => e.kind === kind).map((e) => (e as { text: string }).text).join('');
const allText = (out: AgentEvent[]): string => textOf(out, 'text') + textOf(out, 'text-delta');
const titlesOf = (out: AgentEvent[]): string[] =>
  out.filter((e) => e.kind === 'title').map((e) => (e as { title: string }).title);
const delta = (text: string): AgentEvent => ({ kind: 'text-delta', text });

describe('分块切碎也不漏', () => {
  it('用户给的那四块：标题完整、正文无半截标签、不丢字不重复', () => {
    const chunks = ['<mm-ti', 'tle>圆的动态', '演示</mm-title>好的，', '我来画一个圆。'];
    const out = run(chunks.map(delta));
    expect(titlesOf(out)).toEqual(['圆的动态演示']);
    expect(allText(out)).toBe('好的，我来画一个圆。');
  });

  it('标记出现在正文中间', () => {
    const out = run([delta('先看画布。'), delta('<mm-title>圆的动态</mm-title>'), delta('好的，开始。')]);
    expect(titlesOf(out)).toEqual(['圆的动态']);
    expect(allText(out)).toBe('先看画布。好的，开始。');
  });

  it('正文里出现孤立的 `<`（半截标签前缀）不吞字', () => {
    const out = run([delta('a < b'), delta(' 且 c > d')]);
    expect(allText(out)).toBe('a < b 且 c > d');
    expect(titlesOf(out)).toEqual([]);
  });
});

describe('剥离恒开、采用只一次', () => {
  it('同一轮两个标记：两个都剥掉，只采用第一个', () => {
    // OpenDesign 的 strip() 采到第一个后 scanning = false，第二个会原样漏进正文——这是漏洞
    const out = run([delta('<mm-title>圆的动态演示</mm-title>好的，我来画一个圆。'),
      delta('<mm-title>几何演示</mm-title>')]);
    expect(titlesOf(out)).toEqual(['圆的动态演示']);
    expect(allText(out)).toBe('好的，我来画一个圆。');
  });

  it('第一个标记是空的（归一化后为空）时，第二个仍可被采用', () => {
    const out = run([delta('<mm-title>   </mm-title>'), delta('<mm-title>真正的名字</mm-title>')]);
    expect(titlesOf(out)).toEqual(['真正的名字']);
    expect(allText(out)).toBe('');
  });

  it('畸形开标签当普通文本吐出，且之后仍继续剥', () => {
    const junk = '<mm-title>' + 'x'.repeat(600);   // 600 字符内没有闭标签
    const out = run([delta(junk), delta('尾巴'), delta('<mm-title>后面的真标记</mm-title>')]);
    expect(titlesOf(out)).toEqual(['后面的真标记']);
    // 畸形的那个原样出现（不吞后面的正文），尾巴与标记都不丢
    expect(allText(out)).toContain('尾巴');
    expect(allText(out)).toContain('<mm-title>');
    expect(allText(out)).not.toContain('后面的真标记');
  });
});

describe('两条通道交错', () => {
  it('text-delta 与 text 吐同样内容：各剥各的，标题只出一次', () => {
    const body = '好的，我来画一个圆。';
    const out = run([
      delta('<mm-ti'), delta('tle>圆的动态</mm-title>好'), delta('的，我来画一个圆。'),
      { kind: 'text', text: `<mm-title>圆的动态</mm-title>${body}` },
    ]);
    expect(titlesOf(out)).toEqual(['圆的动态']);          // ← 不重复
    expect(textOf(out, 'text-delta')).toBe(body);          // ← 增量通道逐字等于原文
    expect(textOf(out, 'text')).toBe(body);                // ← 整段通道也逐字等于原文
  });

  it('两条通道各带一个**不同**的标记时，也只采用先到的那个', () => {
    const out = run([
      delta('<mm-title>先到的</mm-title>正文'),
      { kind: 'text', text: '<mm-title>后到的</mm-title>正文' },
    ]);
    expect(titlesOf(out)).toEqual(['先到的']);
    expect(allText(out)).toBe('正文正文');
  });
});

describe('归一化', () => {
  it('剥首尾引号/反引号、压平空白、去结尾标点', () => {
    expect(normalizeTitle('  "圆的动态演示"  ')).toBe('圆的动态演示');
    expect(normalizeTitle('“圆的动态演示。”')).toBe('圆的动态演示');
    expect(normalizeTitle('`抛物线与焦点`')).toBe('抛物线与焦点');
    expect(normalizeTitle('圆  的\n动态')).toBe('圆 的 动态');
    expect(normalizeTitle('圆和切线。')).toBe('圆和切线');
  });

  it('空 / 非字符串判失败', () => {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle('   ')).toBe('');
    expect(normalizeTitle('""')).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle(42)).toBe('');
  });

  it('超长按**字符**截断（不是字节，也不切碎代理对）', () => {
    expect([...normalizeTitle('圆'.repeat(100))].length).toBe(TITLE_MAX_CHARS);
    expect([...normalizeTitle('🎯'.repeat(100))].length).toBe(TITLE_MAX_CHARS);
    // 代理对没被切成两半
    expect(normalizeTitle('🎯'.repeat(100))).not.toContain('�');
  });
});

describe('真实夹具重放（两条通道都吐同样内容）', () => {
  const lines = fs.readFileSync(SAMPLE, 'utf-8').split('\n').filter((l) => l.trim());
  const events = lines.flatMap((line) => {
    const parsed = claudeCode.parseLine(line);
    return parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
  });
  const BODY = '画布是空的：2D 模式下没有任何对象、滑块或构造指令，就是一张白板。';

  it('夹具里没有标记：正文逐字不变、不产生标题', () => {
    const out = run(events);
    expect(titlesOf(out)).toEqual([]);
    expect(textOf(out, 'text-delta')).toBe(BODY);
    expect(textOf(out, 'text')).toBe(BODY);
  });

  it('往两条通道都注入同一个标记：正文逐字不变、标题只出一次', () => {
    let injectedDelta = false;
    const marked = lines.map((line) => {
      const j = JSON.parse(line);
      if (j.type === 'stream_event' && j.event?.delta?.type === 'text_delta' && !injectedDelta) {
        injectedDelta = true;
        j.event.delta.text = `<mm-title>白板状态</mm-title>${j.event.delta.text}`;
        return JSON.stringify(j);
      }
      if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        for (const block of j.message.content) {
          if (block.type === 'text') block.text = `<mm-title>白板状态</mm-title>${block.text}`;
        }
        return JSON.stringify(j);
      }
      return line;
    });
    const markedEvents = marked.flatMap((line) => {
      const parsed = claudeCode.parseLine(line);
      return parsed ? (Array.isArray(parsed) ? parsed : [parsed]) : [];
    });
    const out = run(markedEvents);
    expect(titlesOf(out)).toEqual(['白板状态']);
    expect(textOf(out, 'text-delta')).toBe(BODY);
    expect(textOf(out, 'text')).toBe(BODY);
  });
});
