import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/sidebar-history.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020}}).outputText;
const { groupSidebarHistory } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const now = new Date(2026, 9, 9, 12);
const item = (title, date) => ({title, created_at:date.toISOString()});

test('groups by local calendar day, not a rolling 24 hour window', () => {
  const records=[item('旧课件',new Date(2026,9,7,23,59)),item('昨日',new Date(2026,9,8,23,59)),item('今日',new Date(2026,9,9,0,1))];
  assert.deepEqual(groupSidebarHistory(records,'',now).map(g=>[g.label,g.items[0].title]), [['今天','今日'],['昨天','昨日'],['更早','旧课件']]);
});
test('month and year boundaries still classify yesterday correctly', () => {
  const records=[item('跨年',new Date(2025,11,31,23))];
  assert.equal(groupSidebarHistory(records,'',new Date(2026,0,1,1))[0].label,'昨天');
});
test('search trims, ignores case and normalizes full-width titles', () => {
  const records=[item('函数 ＡＢＣ',now),item('几何',now)];
  assert.equal(groupSidebarHistory(records,' abc ',now)[0].items.length,1);
  assert.deepEqual(groupSidebarHistory(records,'未找到',now),[]);
  assert.deepEqual(groupSidebarHistory([], '',now),[]);
});
test('sorts newest first without changing the source array', () => {
  const records=[item('上午',new Date(2026,9,9,8)),item('下午',new Date(2026,9,9,14))];
  assert.deepEqual(groupSidebarHistory(records,'',now)[0].items.map(i=>i.title),['下午','上午']);
  assert.equal(records[0].title,'上午');
});
test('malformed dates are retained in earlier history and empty groups are omitted', () => {
  const records=[{title:'旧记录',created_at:'unknown'},item('有效日期',new Date(2026,9,1))];
  const result=groupSidebarHistory(records,'',now);
  assert.equal(result.length,1);
  assert.equal(result[0].label,'更早');
  assert.deepEqual(result[0].items.map(i=>i.title),['有效日期','旧记录']);
});
