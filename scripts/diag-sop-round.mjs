/** SOP 三工具单轮探针：走 /api/agent POST，倒出全部事件。临时诊断用。 */
import { POST } from '../math-mover-next/app/api/agent/route.ts';

const res = await POST(new Request('http://local/api/agent', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    text: '请走 SOP 流程建一个最简单的函数构造：ggb_route 判类别为 A，get_expert_prompt 取卡，' +
      '然后用 submit_construction 提交两行：MODE:2D 和 f = Function(x^2/4, -3, 3)。',
    runtimeId: 'claude-code',
  }),
}));

let buf = '';
const dec = new TextDecoder();
for await (const c of res.body) {
  buf += dec.decode(c, { stream: true });
  const ls = buf.split('\n');
  buf = ls.pop() ?? '';
  for (const l of ls) {
    if (!l.trim()) continue;
    const e = JSON.parse(l);
    if (e.kind === 'tool-call') console.log('CALL:', e.name, JSON.stringify(e.input ?? {}).slice(0, 100));
    else if (e.kind === 'tool-result') console.log('RESULT:', JSON.stringify(e.output ?? '').slice(0, 220), e.isError ? '(isError)' : '');
    else if (e.kind === 'error') console.log('ERROR:', e.message.slice(0, 250));
    else if (e.kind === 'text') console.log('TEXT:', e.text.slice(0, 120).replace(/\n/g, ' '));
    else if (e.kind !== 'thinking' && e.kind !== 'text-delta' && e.kind !== 'usage') console.log(e.kind.toUpperCase());
  }
}
