import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/assistant-chat-adapter.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { toAssistantMessage, fromAssistantInput } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
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
  assert.equal(toAssistantMessage(message({}, 'user')).status, undefined);
  assert.deepEqual(toAssistantMessage({...message(),content:''}).content, []);
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
