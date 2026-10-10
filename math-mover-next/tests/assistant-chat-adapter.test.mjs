import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/assistant-chat-adapter.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { toAssistantMessage, fromAssistantInput, assistantMessagePhase, canCopyAgentMessage } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const message = (meta = {}, role = 'assistant') => ({id:'stable-id',role,content:'$x^2$',createdAt:1000,meta});

test('projection preserves identity and host metadata without mutating saved messages', () => {
  const original = Object.freeze(message(Object.freeze({commands:['A=(1,2)']})));
  const output = toAssistantMessage(original);
  assert.equal(output.id, original.id);
  assert.equal(output.createdAt.getTime(), 1000);
  assert.deepEqual(output.content, [{type:'text',text:'$x^2$'}]);
  assert.equal(output.metadata.custom.mathmover, original);
  assert.deepEqual(output.status, {type:'complete',reason:'stop'});
});

test('error, streaming and finished states are explicit; user messages are not running', () => {
  assert.deepEqual(toAssistantMessage(message({status:'error'})).status, {type:'incomplete',reason:'error'});
  assert.deepEqual(toAssistantMessage(message({status:'generating'})).status, {type:'running'});
  assert.deepEqual(toAssistantMessage(message({execution:{status:'running'}})).status, {type:'running'});
  assert.deepEqual(toAssistantMessage(message({execution:{status:'error'}})).status, {type:'incomplete',reason:'error'});
  assert.deepEqual(toAssistantMessage(message({execution:{status:'unconfirmed'}})).status, {type:'incomplete',reason:'error'});
  assert.equal(toAssistantMessage(message({}, 'user')).status, undefined);
  assert.deepEqual(toAssistantMessage({...message(),content:''}).content, []);
});

test('copy action stays unavailable while a message is running', () => {
  assert.equal(assistantMessagePhase(message({status:'generating'})), 'running');
  assert.equal(assistantMessagePhase(message({execution:{status:'running'}})), 'running');
  assert.equal(assistantMessagePhase(message({status:'completed'})), 'complete');
  assert.equal(assistantMessagePhase(message()), 'complete');
  assert.equal(assistantMessagePhase(message({status:'error'})), 'error');

  assert.equal(canCopyAgentMessage(message({status:'generating'})), false);
  assert.equal(canCopyAgentMessage(message({execution:{status:'running'}})), false);
  assert.equal(canCopyAgentMessage(message({status:'completed'})), true);
  assert.equal(canCopyAgentMessage(message({status:'error'})), true);
  assert.equal(canCopyAgentMessage({...message(), content:'   '}), false);
});

test('UI projection never registers executable tool parts', () => {
  const projected = toAssistantMessage(message({execution:{status:'completed',steps:[{name:'ggb_apply',status:'returned'}]}}));
  assert.equal(projected.content.some(p => p.type === 'tool-call'), false);
});

test('outgoing input preserves image-only questions and existing local image format', () => {
  const file = {name:'question.png'};
  const result = fromAssistantInput({content:[],attachments:[{id:'image-id',name:'question.png',file,contentType:'image/png',content:[{type:'image',image:'data:image/png;base64,eA=='}]}]});
  assert.equal(result.text, '');
  assert.deepEqual(result.attachments, [{id:'image-id',name:'question.png',contentType:'image/png',file,url:'data:image/png;base64,eA=='}]);
});

test('text input joins only text parts and supports no attachments', () => {
  assert.deepEqual(fromAssistantInput({content:[{type:'text',text:' 第一行'},{type:'image',image:'unused'},{type:'text',text:'第二行 '}]}), {text:['第一行','第二行'].join(String.fromCharCode(10)),attachments:[]});
});

test('user-stopped runs are distinct from errors and completions', () => {
  // 停止不是失败：内容残缺但可复制，投影用 cancelled 语义
  const stopped = message({ status: 'stopped' });
  assert.equal(assistantMessagePhase(stopped), 'stopped');
  assert.deepEqual(toAssistantMessage(stopped).status, { type: 'incomplete', reason: 'cancelled' });
  assert.equal(canCopyAgentMessage(stopped), true);

  // 执行层的 stopped 同样认
  const byExecution = message({ execution: { status: 'stopped', startedAt: 1, steps: [] } });
  assert.equal(assistantMessagePhase(byExecution), 'stopped');
  assert.equal(canCopyAgentMessage(byExecution), true);

  // 不要把 stopped 误判成 error 或 complete
  assert.notEqual(assistantMessagePhase(stopped), 'error');
  assert.notEqual(assistantMessagePhase(stopped), 'complete');
});
