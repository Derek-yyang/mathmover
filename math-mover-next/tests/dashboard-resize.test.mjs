import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

async function load(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ES2020,target:ts.ScriptTarget.ES2020}}).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { chatWidthLimits, clampChatWidth, chatWidthForKey } = await load('../lib/chat-panel-width.ts');
const { resizedViewBounds, resizeAppletPreservingView } = await load('../lib/ggb-view-resize.ts');

test('normal and small windows retain useful canvas space and bound chat width', () => {
  assert.deepEqual(chatWidthLimits(1664), {min:320,max:720});
  assert.deepEqual(chatWidthLimits(1000), {min:320,max:520});
  assert.deepEqual(chatWidthLimits(600), {min:300,max:300});
  assert.deepEqual(chatWidthLimits(0), {min:0,max:0});
  assert.deepEqual(chatWidthLimits(NaN), {min:0,max:0});
  assert.equal(clampChatWidth(999, chatWidthLimits(1000)),520);
  assert.equal(clampChatWidth(-99, chatWidthLimits(1000)),320);
});

test('keyboard follows the left divider direction, with endpoints and larger steps', () => {
  const limits=chatWidthLimits(1664);
  assert.equal(chatWidthForKey(384,'ArrowLeft',false,limits),400);
  assert.equal(chatWidthForKey(384,'ArrowRight',true,limits),336);
  assert.equal(chatWidthForKey(384,'Home',false,limits),320);
  assert.equal(chatWidthForKey(384,'End',false,limits),720);
  assert.equal(chatWidthForKey(720,'ArrowLeft',false,limits),720);
  assert.equal(chatWidthForKey(384,'Enter',false,limits),null);
});

const before={xMin:-7,yMin:-5,width:1000,height:600,invXscale:0.02,invYscale:0.02};
test('shrinking preserves an off-origin center and units per pixel', () => {
  const bounds=resizedViewBounds(JSON.stringify(before), {...before,width:800});
  assert.deepEqual(bounds,{xMin:-5,xMax:11,yMin:-5,yMax:7});
  assert.equal((bounds.xMax-bounds.xMin)/800,0.02);
  assert.equal((bounds.xMax+bounds.xMin)/2,3);
});

test('growing and height changes preserve nonuniform scales instead of stretching', () => {
  assert.deepEqual(resizedViewBounds({...before,invYscale:0.01}, {...before,width:1200,height:800}),
    {xMin:-9,xMax:15,yMin:-6,yMax:2});
});

test('invalid and hidden view metrics do not generate bad coordinates', () => {
  for(const value of [null,'bad',{...before,width:0},{...before,invXscale:-1},{...before,yMin:Infinity}]) {
    assert.equal(resizedViewBounds(value,before),null);
  }
});

test('resize reads actual graphics dimensions after setSize, not the outer frame', () => {
  let view=before;
  const calls=[];
  const api={getViewProperties:()=>view,setSize(w,h){calls.push(['size',w,h]);view={...before,width:w-2,height:h-2};},
    setCoordSystem(...bounds){calls.push(['coords',...bounds]);}};
  resizeAppletPreservingView(api,802,602);
  assert.deepEqual(calls,[['size',802,602],['coords',-5,11,-5,7]]);
});

test('old or unsupported applets still resize without resetting constructions', () => {
  const calls=[];
  resizeAppletPreservingView({setSize:(...size)=>calls.push(size),getViewProperties:()=>{throw Error('unsupported');}},800,600);
  assert.deepEqual(calls,[[800,600]]);
});
