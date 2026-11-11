'use client';

import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AssistantRuntimeProvider, SimpleImageAttachmentAdapter, ThreadPrimitive, useAuiState, useExternalStoreRuntime, type CompleteAttachment, type ExternalStoreThreadListAdapter, type ThreadMessageLike } from '@assistant-ui/react';
import { ArrowDown, HandGrab, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings2, RotateCcw } from 'lucide-react';
import AssistantChatComposer from '@/components/dashboard/AssistantChatComposer';
import { AssistantMessage, UserMessage } from '@/components/assistant-ui/elements/thread.aui';
import { ThreadListSidebar } from '@/components/assistant-ui/elements/threadlist-sidebar.aui';
import { ThreadList } from '@/components/assistant-ui/elements/thread-list.aui';
import { ImagePreviewProvider } from '@/components/dashboard/ImagePreview';
import AgentExecutionProgress from '@/components/dashboard/AgentExecutionProgress';
import ControlDeck from '@/components/dashboard/ControlDeck';
import SidebarRailButton from '@/components/dashboard/SidebarRailButton';
import { SidebarStateProvider, useSidebarState } from '@/components/dashboard/SidebarState';
import { signalBoardResizePreview } from '@/lib/board-resize-preview';
import { toAssistantMessage } from '@/lib/assistant-chat-adapter';
import type { AgentChatMessage, GeoGebraApi } from '@/components/dashboard/types';
import { useGgbGraphics } from '@/hooks/useGgbGraphics';
import type { AgentExecution } from '@/lib/agent-progress';
import { phaseMarks, phaseNames, scrollFromTimeline, timelineFromScroll, timing } from './workflow-demo-timeline';
import WorkflowConstruction, { type PointProjection } from './WorkflowConstruction';
import { fitWorkflowBoard, workflowCases, type DemoCaseId, type WorkflowApi } from './workflow-demo-cases';

// Lay out the real components at desktop size before scaling the whole camera.
const W=1920,H=1080;
const prompts:Record<DemoCaseId,string>={
  conic:'帮我构建这个椭圆题，我想直观看到三角形面积的变化。',
  function:'帮我构建这道函数题，我想直观看到线段长度和三角形的变化。',
  solid:'帮我构建这个正方体，我想直观看到三角形面积的变化。',
};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const part=(p:number,a:number,b:number)=>clamp((p-a)/(b-a));
const smooth=(v:number)=>v*v*(3-2*v);
const smoother=(v:number)=>v*v*v*(v*(v*6-15)+10);
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const bezier=(a:number,b:number,c:number,d:number,t:number)=>Math.pow(1-t,3)*a+3*Math.pow(1-t,2)*t*b+3*(1-t)*t*t*c+t*t*t*d;
const toolWindows=[[timing.toolsStart,.47],[.47,.57],[.57,.67],[.67,.78],[.78,timing.streaming]];
const toolNames=['ggb_get_state','ggb_apply','ggb_apply','ggb_apply','ggb_apply'];
const baseTime=Date.now();
const executionDuration=12000;
const executionTimeAt=(p:number)=>baseTime+Math.round(part(p,timing.send,timing.responseComplete)*executionDuration);
const PreviewClock=createContext<number|undefined>(undefined);
const reasoningOptions=[{id:'high',label:'high'},{id:'xhigh',label:'xhigh'}];
const models=[{id:'default',label:'默认',reasoningOptions}];
const imageAdapter=new SimpleImageAttachmentAdapter();
const choiceAngles:Record<DemoCaseId,number>={conic:-3,function:2,solid:-1.5};
const imageGrab={x:.28,y:.55};
const mockAction=()=>{};

// This is the actual message composition used by AssistantChatMessage.tsx.
function MessageBody(){
  const message=useAuiState(s=>s.message.metadata.custom.mathmover as AgentChatMessage);
  const clockNow=useContext(PreviewClock);
  return message.role==='user'?<UserMessage/>:<AssistantMessage before={message.meta?.execution&&<AgentExecutionProgress execution={message.meta.execution} clockNow={clockNow}/>}/>;
}
const messageComponents={Message:MessageBody};

type LibraryProps={title:string;onReplay:()=>void;style:CSSProperties};
const Library=memo(function Library(props:LibraryProps){
  return <SidebarStateProvider><LibrarySidebar {...props}/></SidebarStateProvider>;
});

function LibrarySidebar({title,onReplay,style}:LibraryProps){
  const sidebar=useSidebarState()!;
  const resizePreviewTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const toggleSidebar=()=>{
    signalBoardResizePreview('sidebar',true);
    if(resizePreviewTimer.current)clearTimeout(resizePreviewTimer.current);
    sidebar.toggleSidebar();
    resizePreviewTimer.current=setTimeout(()=>{
      resizePreviewTimer.current=null;
      signalBoardResizePreview('sidebar',false);
    },300);
  };
  useEffect(()=>()=>{
    if(resizePreviewTimer.current)clearTimeout(resizePreviewTimer.current);
    signalBoardResizePreview('sidebar',false);
  },[]);
  const adapter=useMemo<ExternalStoreThreadListAdapter>(()=>({
    threadId:'preview',isLoading:false,threads:[{id:'preview',remoteId:'preview',status:'regular',title,lastMessageAt:new Date(baseTime)}],
    onSwitchToThread:()=>{},onSwitchToNewThread:onReplay,onRename:async()=>{},onDelete:async()=>{},
  }),[title,onReplay]);
  const runtime=useExternalStoreRuntime<ThreadMessageLike>({messages:[],convertMessage:message=>message,isRunning:false,onNew:async()=>{},adapters:{threadList:adapter}});
  const iconButton='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-200)]/60 hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]';
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="workflow-sidebar dashboard-sidebar relative z-30 h-full shrink-0 bg-[var(--mm-canvas-shell)]" data-collapsed={sidebar.collapsed} style={style}>
      <aside aria-label="快捷侧栏" aria-hidden={!sidebar.collapsed} inert={!sidebar.collapsed} className="sidebar-rail absolute inset-y-0 left-0 flex w-14 flex-col items-center bg-[var(--mm-canvas-shell)]">
        <div className="flex h-14 shrink-0 items-center"><SidebarRailButton id={sidebar.openButtonId} label="展开侧栏" controls={sidebar.sidebarId} expanded={false} onClick={toggleSidebar}>
          <span className="rail-brand-mark flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--mm-bg-emerald-700)] text-sm font-bold text-white group-hover:hidden group-focus-visible:hidden">M</span>
          <PanelLeftOpen className="rail-expand-icon hidden h-5 w-5 group-hover:block group-focus-visible:block"/>
        </SidebarRailButton></div>
        <div className="flex flex-col gap-1">
          <SidebarRailButton label="新建课件" onClick={onReplay}><Plus className="h-5 w-5"/></SidebarRailButton>
          <SidebarRailButton label="搜索课件" onClick={mockAction}><Search className="h-5 w-5"/></SidebarRailButton>
        </div>
        <div className="mt-auto py-2"><SidebarRailButton label="设置" onClick={mockAction}><Settings2 className="h-5 w-5"/></SidebarRailButton></div>
      </aside>
      <div className="sidebar-expanded-clip absolute inset-0 overflow-hidden" inert={sidebar.collapsed} aria-hidden={sidebar.collapsed}>
      <ThreadListSidebar id={sidebar.sidebarId} className="sidebar-expanded w-64" aria-label="课件侧栏"
    header={<><a href="#" onClick={e=>e.preventDefault()} className="mr-auto flex min-w-0 items-center gap-2 rounded-lg" aria-label="MathMover 首页"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--mm-bg-emerald-600)] text-sm font-bold text-white">M</span><span className="text-sm font-semibold text-[var(--mm-text-stone-900)]">MathMover</span></a><button type="button" className={iconButton} aria-label="搜索课件"><Search className="h-4 w-4"/></button><button id={sidebar.closeButtonId} type="button" className={iconButton} aria-label="收起侧栏" title="收起侧栏" aria-controls={sidebar.sidebarId} aria-expanded={true} onClick={toggleSidebar}><PanelLeftClose className="h-4 w-4"/></button></>}
    footer={<button type="button" className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-200)]/50"><Settings2 className="h-4 w-4 shrink-0 text-[var(--mm-text-stone-500)]"/><span>设置</span></button>}>
    <ThreadList mockActions onNew={onReplay} showSearch={false} organization={{projects:[],onCreate:()=>{},onProject:()=>{},onMove:()=>{},onPin:()=>{}}} selection={{enabled:false,ids:new Set(),onToggleMode:()=>{},onToggle:()=>{},onSelectAll:()=>{}}}/>
      </ThreadListSidebar></div>
    </div>
  </AssistantRuntimeProvider>;
}

function scrollGeometry(node:HTMLElement){
  const sticky=node.querySelector<HTMLElement>('.workflow-sticky');
  const inset=sticky?Number.parseFloat(getComputedStyle(sticky).top)||0:0;
  return {top:window.scrollY+node.getBoundingClientRect().top-inset,span:Math.max(1,node.offsetHeight-(sticky?.offsetHeight??innerHeight))};
}

export default function WorkflowDemo({embedded=false}:{embedded?:boolean}){
  const [selectedId,setSelectedId]=useState<DemoCaseId>('conic');
  const example=workflowCases.find(value=>value.id===selectedId)!;
  const prompt=prompts[selectedId];
  const response=example.response,problemUrl=example.image;
  const photo=useMemo<CompleteAttachment>(()=>({id:`demo-${example.id}`,type:'image',name:example.fileName,contentType:'image/png',status:{type:'complete'},content:[{type:'image',image:example.image}]}),[example]);
  const [progress,setProgress]=useState(0);
  const [reduced,setReduced]=useState(false);
  const [engineMounted,setEngineMounted]=useState(false);
  const [boardReady,setBoardReady]=useState(false);
  const [boardApi,setBoardApi]=useState<GeoGebraApi|null>(null);
  const graphics=useGgbGraphics(boardApi);
  const [composerHeight,setComposerHeight]=useState(96);
  const [emptyComposerHeight,setEmptyComposerHeight]=useState(110);
  const [view,setView]=useState({width:1000,height:650});
  const [native,setNative]=useState(false);
  const [pointProjection,setPointProjection]=useState<PointProjection|null>(null);
  const [choiceOrigin,setChoiceOrigin]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  const displayedProgress=useRef(0);
  const story=useRef<HTMLElement>(null),viewport=useRef<HTMLDivElement>(null),composer=useRef<HTMLDivElement>(null),messagesViewport=useRef<HTMLDivElement>(null);
  const choiceRefs=useRef<Record<DemoCaseId,HTMLButtonElement|null>>({conic:null,function:null,solid:null});
  // Warm the real board while the prompt is still being typed. Mounting only at
  // zoomEnd exposes the dynamic loading placeholder during the camera reveal.
  const setP=useCallback((p:number)=>{displayedProgress.current=p;setProgress(p);if(p>=timing.typingStart)setEngineMounted(true);},[]);
  const jump=useCallback((p:number)=>{
    if(reduced){setP(p);return;}
    const node=story.current;if(!node)return;
    const {top,span}=scrollGeometry(node);
    window.scrollTo({top:top+scrollFromTimeline(p)*span,behavior:'instant'});setP(p);
  },[reduced,setP]);
  const replay=useCallback(()=>jump(0),[jump]);
  const selectExample=(id:DemoCaseId)=>{if(id===selectedId)return;setSelectedId(id);setPointProjection(null);setBoardReady(false);};
  useLayoutEffect(()=>{
    const query=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>{setReduced(query.matches);if(query.matches)setP(timing.complete);};update();query.addEventListener('change',update);
    let frame=0,target=displayedProgress.current,lastTime=0;
    const tick=(time:number)=>{
      frame=0;
      if(query.matches)return;
      const current=displayedProgress.current;
      // Soften wheel steps while either dragged object is moving. Explicit
      // step jumps and the construction timeline retain their exact marks.
      const soften=(current<timing.handoffEnd&&target<.26)||(current>=timing.pointApproach&&target>=timing.pointApproach&&current<timing.cursorExit&&target<timing.cursorExit);
      const next=soften?mix(current,target,1-Math.exp(-(lastTime?time-lastTime:16.67)/72)):target;
      lastTime=time;
      if(Math.abs(next-target)<.00005){setP(target);lastTime=0;return;}
      setP(next);frame=requestAnimationFrame(tick);
    };
    const scroll=()=>{if(query.matches)return;const n=story.current;if(!n)return;const {top,span}=scrollGeometry(n);target=timelineFromScroll((window.scrollY-top)/span);if(!frame)frame=requestAnimationFrame(tick);};
    window.addEventListener('scroll',scroll,{passive:true});
    const measure=()=>{if(viewport.current)setView({width:viewport.current.clientWidth,height:viewport.current.clientHeight});scroll();};
    const observer=new ResizeObserver(measure);
    measure();
    if(viewport.current)observer.observe(viewport.current);
    return()=>{query.removeEventListener('change',update);window.removeEventListener('scroll',scroll);cancelAnimationFrame(frame);observer.disconnect();};
  },[setP]);
  useLayoutEffect(()=>{const measure=()=>{const node=composer.current;if(!node)return;setComposerHeight(node.offsetHeight);if(!node.querySelector('[aria-label="待发送图片"]'))setEmptyComposerHeight(node.offsetHeight);};const observer=new ResizeObserver(measure);measure();if(composer.current)observer.observe(composer.current);return()=>observer.disconnect();},[]);
  useLayoutEffect(()=>{
    const root=composer.current;if(!root)return;
    const lockControls=()=>{
      root.querySelectorAll<HTMLElement>('button,input,textarea,[role="button"],[role="combobox"]').forEach(control=>{
        control.tabIndex=-1;
        if(control instanceof HTMLTextAreaElement)control.readOnly=true;
      });
    };
    lockControls();
    const observer=new MutationObserver(lockControls);
    observer.observe(root,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);
  const selecting=progress<timing.dragStart&&!reduced;
  useLayoutEffect(()=>{
    if(!selecting)return;
    const measure=()=>{
      const origin=viewport.current?.getBoundingClientRect(),node=choiceRefs.current[selectedId];
      if(!origin||!node){setChoiceOrigin(null);return;}
      const card=node.getBoundingClientRect(),style=getComputedStyle(node);
      // The rotated bounding box locates the center, but its dimensions are
      // larger than the paper. Keep the original layout size for the handoff.
      setChoiceOrigin({x:card.left-origin.left+card.width/2,y:card.top-origin.top+card.height/2,width:parseFloat(style.width),height:parseFloat(style.height)});
    };
    measure();
    const observer=window.ResizeObserver?new ResizeObserver(measure):null;
    if(viewport.current)observer?.observe(viewport.current);
    if(choiceRefs.current[selectedId])observer?.observe(choiceRefs.current[selectedId]!);
    window.addEventListener('resize',measure);
    return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
  },[selecting,selectedId,view.width]);

  const p=progress;
  const sent=p>=timing.send;
  const streaming=p>=timing.streaming&&p<timing.responseComplete;
  const running=sent&&p<timing.responseComplete;
  const movement=reduced?0:smoother(part(p,timing.pointDrag,timing.pointDrop));
  const typing=!reduced&&p>=timing.typingStart&&p<timing.zoomStart;
  const constructionStage=p>=timing.join?4:p>=timing.intersections?3:p>=timing.movingPoint?2:p>=timing.ellipse?1:0;
  const toolSignature=toolWindows.map(([start,end])=>p<start?0:p<end?1:2).join('');
  const textCount=Math.floor(part(p,timing.responseStart,timing.responseComplete)*response.length);
  // A stable value per displayed second updates duration labels without
  // rebuilding messages or starting wall-clock timers during playback.
  const clockNow=baseTime+Math.floor(part(p,timing.send,timing.responseComplete)*executionDuration/1000)*1000;
  const messages=useMemo<AgentChatMessage[]>(()=>{
    if(!sent)return [];
    const result:AgentChatMessage[]=[{id:'question',role:'user',content:prompt,createdAt:baseTime,attachments:[{id:'question-photo',name:example.fileName,url:problemUrl,contentType:'image/png'}]}];
    if(p>=timing.toolsStart){
      const steps=toolWindows.flatMap(([start,end],i)=>p>=start?[{id:`tool-${i}`,name:toolNames[i],status:(p>=end?'returned':'running') as 'returned'|'running',startedAt:executionTimeAt(start),endedAt:p>=end?executionTimeAt(end):undefined}]:[]);
      const execution:AgentExecution={status:p>=timing.responseComplete?'completed':'running',startedAt:baseTime,endedAt:p>=timing.responseComplete?baseTime+executionDuration:undefined,steps};
      result.push({id:'answer',role:'assistant',content:response.slice(0,textCount),createdAt:baseTime+1,meta:{status:p>=timing.responseComplete?'completed':'generating',execution}});
    }
    return result;
    // Only semantic changes update the real chat runtime, not every scroll pixel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sent,p>=timing.toolsStart,p>=timing.responseComplete,toolSignature,textCount,example]);
  const runtime=useExternalStoreRuntime({messages,convertMessage:toAssistantMessage,isRunning:running,onNew:async()=>jump(timing.send),adapters:{attachments:imageAdapter}});
  // Keep the completed question in the composer throughout the pullback.
  const draft=!sent?prompt.slice(0,Math.floor(part(p,timing.typingStart,timing.typingEnd)*prompt.length)):'';
  // Mount the real attachment before it becomes visible, so the floating
  // image can hand off to an already loaded, correctly positioned thumbnail.
  const attached=p>=timing.attachmentMount&&!sent;
  const attachmentSpace=reduced?1:smoother(part(p,timing.expandStart,timing.expandEnd));
  // Reveal underneath the fully aligned floating image, then fade only that
  // image out; fading both layers would briefly wash out the thumbnail.
  const attachmentOpacity=reduced||p>=timing.drop?1:0;
  useLayoutEffect(()=>{runtime.thread.composer.setText(draft);},[runtime,draft]);
  useLayoutEffect(()=>{
    if(!typing)return;
    const input=composer.current?.querySelector('textarea');if(!input)return;
    const inputMode=input.getAttribute('inputmode');
    // Use the real textarea caret without opening a mobile keyboard or
    // scrolling the page away from the scroll-driven camera.
    input.setAttribute('inputmode','none');input.focus({preventScroll:true});
    return()=>{if(inputMode===null)input.removeAttribute('inputmode');else input.setAttribute('inputmode',inputMode);if(document.activeElement===input)input.blur();};
  },[typing]);
  useLayoutEffect(()=>{
    if(!typing)return;
    const frame=requestAnimationFrame(()=>{const input=composer.current?.querySelector('textarea');if(input)input.setSelectionRange(input.value.length,input.value.length);});
    return()=>cancelAnimationFrame(frame);
  },[draft,typing]);
  useLayoutEffect(()=>{
    let cancelled=false;
    void (async()=>{
      const state=runtime.thread.composer.getState();
      if(attached&&state.attachments[0]?.id===photo.id)return;
      if(state.attachments.length)await runtime.thread.composer.clearAttachments();
      if(attached&&!cancelled)await runtime.thread.composer.addAttachment(photo);
    })();
    return()=>{cancelled=true;};
  },[runtime,attached,photo]);
  useLayoutEffect(()=>{if(messagesViewport.current)messagesViewport.current.scrollTop=messagesViewport.current.scrollHeight;},[messages]);

  // One camera transforms the entire unchanged workbench. The composer is never
  // recreated at a different location; it is already docked in the real chat.
  // During attachment expansion, derive camera height from the same 64 + 12px
  // row geometry as CSS; ResizeObserver would otherwise trail it by one frame.
  const cameraComposerHeight=p<.15?emptyComposerHeight+76*attachmentSpace:composerHeight;
  const zoom=reduced?Number(p>=timing.zoomStart):smooth(part(p,timing.zoomStart,timing.zoomEnd));
  const scaleFit=Math.min(view.width/W,view.height/H,1);
  const initialScale=Math.min(1.5,(view.width-32)/360);
  const scale=initialScale+(scaleFit-initialScale)*zoom;
  const composerCenter={x:W-192,y:H-cameraComposerHeight/2};
  // Bias the opening composer to the right so the question collage has a
  // generous working area without changing its final place in the workbench.
  const openingOffset=view.width<760?0:Math.min(210,Math.max(72,view.width*.14));
  const startX=view.width/2-composerCenter.x*initialScale+openingOffset;
  const startY=view.height/2-composerCenter.y*initialScale;
  const finalX=(view.width-W*scaleFit)/2,finalY=(view.height-H*scaleFit)/2;
  const cameraX=startX+(finalX-startX)*zoom,cameraY=startY+(finalY-startY)*zoom;
  // Only the pullback needs a persistent compositor layer. At either resting
  // scale, let text rasterize afresh and avoid fractional translation blur.
  // Keep GeoGebra's transform coordinates intact for native pointer hit testing.
  const settled=p>=timing.zoomEnd&&!native;
  const cameraMoving=p>timing.zoomStart&&p<timing.zoomEnd&&!native;
  const renderedCameraX=cameraMoving?cameraX:Math.round(cameraX),renderedCameraY=cameraMoving?cameraY:Math.round(cameraY);
  const cameraStyle:CSSProperties & {'--workflow-scale':number}={width:W,height:H,'--workflow-scale':native?1:scale,
    transform:cameraMoving
      ? `translate3d(${renderedCameraX}px,${renderedCameraY}px,0) scale(${scale})`
      : `translate(${renderedCameraX}px,${renderedCameraY}px) scale(${scale})`,
    backfaceVisibility:cameraMoving?'hidden':undefined,
    willChange:cameraMoving?'transform':'auto'};
  const reveal=part(p,timing.zoomStart+.01,timing.zoomEnd);
  const imageTravel=smoother(part(p,timing.dragStart,timing.drop));
  const imageMorph=smoother(part(p,.075,timing.drop));
  // Native composer padding is 12 + 1 + 12px horizontally and 8 + 1 +
  // 12px vertically; its actual attachment is 64px square.
  const targetImageX=renderedCameraX+(W-384+25+32)*scale;
  const targetImageY=renderedCameraY+(H-cameraComposerHeight+21+32)*scale;
  const imageFromX=choiceOrigin?.x??Math.max(110,view.width*.16);
  const imageFromY=choiceOrigin?.y??view.height*.25;
  const arc=Math.min(54,view.height*.07);
  const flyCenterX=bezier(imageFromX,mix(imageFromX,targetImageX,.38),targetImageX-arc,targetImageX,imageTravel);
  const flyCenterY=bezier(imageFromY,imageFromY-arc,targetImageY-arc*.8,targetImageY,imageTravel);
  const flyWidth=mix(choiceOrigin?.width??Math.min(220,view.width*.46),64*scale,imageMorph);
  const flyHeight=mix(choiceOrigin?.height??Math.min(220,view.width*.46)/2.45,64*scale,imageMorph);
  const flyX=flyCenterX-flyWidth/2,flyY=flyCenterY-flyHeight/2;
  const flyRotation=choiceAngles[selectedId]*(1-imageTravel);
  const flyOpacity=p<timing.dragStart?0:1-smooth(part(p,timing.drop,timing.handoffEnd));
  const previewCrop=smooth(part(p,.10,timing.drop));
  const sendX=renderedCameraX+(W-40)*scale,sendY=renderedCameraY+(H-40)*scale;
  const cursorToSend=smooth(part(p,timing.cursorStart,timing.cursorEnd));
  const pointDemo=p>=timing.pointApproach&&pointProjection!==null&&!reduced;
  const grabbingPoint=pointDemo&&p>=timing.pointDrag&&p<timing.pointDrop;
  const selectingChoice=p<timing.dragStart&&!reduced;
  const draggingChoice=p>=timing.dragStart&&p<timing.drop&&!reduced;
  const cursorHand=selectingChoice||(p>=timing.cursorEnd&&p<timing.send+.015)||(pointDemo&&p>=timing.pointHover);
  const hoveringSend=p>=timing.cursorEnd&&!sent;
  const cursorOpacity=selectingChoice?1:pointDemo?smooth(part(p,timing.pointApproach,timing.pointApproach+.01))*(1-smooth(part(p,timing.pointRelease,timing.cursorExit))):(p<.15?1-smooth(part(p,timing.drop,.15)):part(p,timing.zoomEnd,timing.cursorStart))*(1-part(p,timing.send,timing.send+.015));
  const cursorScale=pointDemo?1-.08*smooth(part(p,timing.pointHover,timing.pointDrag))*(1-smooth(part(p,timing.pointDrop,timing.pointRelease))):1-.12*part(p,timing.cursorEnd,timing.send)*(1-part(p,timing.send,timing.send+.01));
  const grabX=flyWidth*(imageGrab.x-.5),grabY=flyHeight*(imageGrab.y-.5),angle=flyRotation*Math.PI/180;
  const release=smooth(part(p,timing.drop,.15))*12;
  const dragCursorX=flyCenterX+grabX*Math.cos(angle)-grabY*Math.sin(angle)+release;
  const dragCursorY=flyCenterY+grabX*Math.sin(angle)+grabY*Math.cos(angle)+release;
  const approachPoint=smoother(part(p,timing.pointApproach,timing.pointHover));
  const leavePoint=smooth(part(p,timing.pointRelease,timing.cursorExit));
  const pointFrom=pointProjection?.from??{x:sendX,y:sendY},pointTo=pointProjection?.to??{x:sendX,y:sendY};
  const pointCursorX=pointProjection?.current.x??mix(pointFrom.x,pointTo.x,movement),pointCursorY=pointProjection?.current.y??mix(pointFrom.y,pointTo.y,movement);
  const cursorX=pointDemo?mix(sendX,pointCursorX,approachPoint)+18*leavePoint:mix(dragCursorX,sendX,cursorToSend);
  const cursorY=pointDemo?mix(sendY,pointCursorY,approachPoint)+12*leavePoint:mix(dragCursorY,sendY,cursorToSend);
  // Anchor both glyphs by their fingertip/arrow tip so changing to a hand
  // and pressing do not move the point that is over the button.
  const cursorHotspotX=(grabbingPoint||draggingChoice?14.4:cursorHand?9.6:3)*25/32;
  const cursorHotspotY=(grabbingPoint||draggingChoice?14.4:cursorHand?2.4:2)*30/38;
  const phase=p>=timing.complete?8:p>=timing.pointApproach?7:p>=timing.streaming?6:p>=timing.toolsStart?5:sent?4:p>=timing.zoomStart?3:p>=timing.typingStart?2:p>=timing.dragStart?1:0;
  const title=p>=timing.ellipse?example.title:'未命名课件';
  const surfaceStyle=useMemo<CSSProperties>(()=>({opacity:reveal,pointerEvents:reveal<1?'none':'auto'}),[reveal]);

  return <div className={native?'workflow-native':undefined}><section className="workflow-story" ref={story} aria-label="MathMover 从题图到互动图形的演示"><div className="workflow-sticky" data-progress={p.toFixed(3)}>
    {!embedded&&<p className="workflow-caption" style={{opacity:reveal}}>MathMover <span style={{marginLeft:10}}>工作流程预览</span></p>}
    {embedded&&<a className="workflow-skip" href="#connection" onClick={event=>{
      if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const target=document.getElementById('connection');if(!target)return;
      event.preventDefault();target.scrollIntoView({behavior:'instant',block:'start'});target.focus({preventScroll:true});
      if(location.hash!=='#connection')history.pushState(history.state,'','#connection');
    }}>跳过演示，查看模型接入 <ArrowDown aria-hidden="true"/></a>}
    <div className="workflow-elevation" aria-hidden="true"><div className="workflow-workbench-shadow" style={{...cameraStyle,opacity:cameraMoving?0:smooth(reveal)}}/></div>
    <div className="workflow-viewport" ref={viewport}>
      <div className="workflow-camera" data-product-workbench data-settled={settled} style={cameraStyle}>
        <div className="workflow-frame" style={{backgroundColor:`color-mix(in srgb, var(--background) ${reveal*100}%, transparent)`}}>
          <Library title={title} onReplay={embedded?mockAction:replay} style={surfaceStyle}/>
          <div className="workflow-board-shell" style={surfaceStyle}>
            <ControlDeck title={title} saveStatusText={p>=timing.responseComplete?'已保存':undefined} connectionStatus="connected" boardDisabled={!boardReady} showAxes={graphics.axes==='all'} axesMixed={graphics.axes==='mixed'} showGrid={graphics.showGrid} isFullscreen={false} onToggleAxes={graphics.toggleAxes} onToggleGrid={graphics.toggleGrid} onToggleSettings={()=>{}} onResetView={()=>{if(boardApi)fitWorkflowBoard(boardApi as unknown as WorkflowApi,example.id);}} onToggleFullscreen={()=>{if(!embedded)setNative(v=>!v);}} onExport={()=>{}}/>
            <div data-slot="board-surface" className="relative mx-2 mb-2 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-[var(--mm-border-stone-300)]">
              {engineMounted&&<div className="workflow-board-live absolute inset-0 flex" data-ready={boardReady} data-visible={boardReady&&p>=timing.zoomEnd}>
                <WorkflowConstruction key={`${view.width}:${view.height}:${example.id}`} example={example} stage={constructionStage} movement={movement} projectionVersion={native} onProjection={setPointProjection} onReady={setBoardReady} onApi={setBoardApi}/>
              </div>}
              {(!boardReady||p<timing.zoomEnd)&&<div className="workflow-board-placeholder absolute inset-0" aria-hidden="true"/>}
            </div>
          </div>
          <PreviewClock value={clockNow}><AssistantRuntimeProvider runtime={runtime}><ImagePreviewProvider><ThreadPrimitive.Root className="workflow-chat aui-root" style={{'--composer-radius':'1rem','--composer-padding':'8px',backgroundColor:`color-mix(in srgb, var(--background) ${reveal*100}%, transparent)`} as CSSProperties}>
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4" style={surfaceStyle}><span className="shrink-0 text-sm font-semibold text-[var(--mm-text-stone-800)]">对话</span><span className="min-w-0 max-w-40 truncate text-xs text-[var(--mm-text-stone-500)]">Claude Code</span></div>
            <div className="workflow-messages chat-scroll-viewport pl-4 pr-4 pt-5 pb-3 select-text" ref={messagesViewport} style={{...surfaceStyle,bottom:composerHeight}}>
              <div className="space-y-6">{messages.map(message=><ThreadPrimitive.Unstable_MessageById key={message.id} messageId={message.id} components={messageComponents}/>)}</div>
            </div>
            <div ref={composer} className="workflow-composer" data-running={running} data-typing={typing} data-send-hover={hoveringSend} aria-label="演示题目输入区，不接受编辑" onPointerDownCapture={event=>event.preventDefault()} onClickCapture={event=>{event.preventDefault();event.stopPropagation();}} onKeyDownCapture={event=>event.preventDefault()} onPasteCapture={event=>event.preventDefault()} onDropCapture={event=>event.preventDefault()} style={{'--attachment-space':attachmentSpace,'--attachment-opacity':attachmentOpacity} as CSSProperties}><AssistantChatComposer canAttachImages isLoading={running} onStopRun={()=>jump(timing.complete)} models={models} selectedModel="default" onSelectModel={()=>{}} reasoningOptions={reasoningOptions} selectedEffort="xhigh" onSelectEffort={()=>{}}/></div>
          </ThreadPrimitive.Root></ImagePreviewProvider></AssistantRuntimeProvider></PreviewClock>
        </div>
      </div>
      {!reduced&&p<timing.zoomStart&&<div className="workflow-choices" aria-label="选择题图演示" style={{opacity:1-smooth(part(p,timing.handoffEnd,timing.zoomStart))}}>
        {workflowCases.map(option=><button key={option.id} type="button" ref={node=>{choiceRefs.current[option.id]=node;}} className="workflow-choice" data-case={option.id} aria-label={`选择${option.label}题图：${option.title}`} aria-pressed={option.id===selectedId} disabled={!selectingChoice} onClick={()=>selectExample(option.id)} style={{opacity:option.id===selectedId&&p>=timing.dragStart?0:undefined}}>
          <img src={option.image} alt={`${option.label}示例题图`}/>
          <span className="workflow-choice-tag">{option.label}</span>
        </button>)}
      </div>}
      <div className="workflow-drag-image" aria-hidden style={{width:flyWidth,height:flyHeight,opacity:reduced?0:flyOpacity,borderWidth:scale*imageMorph,borderRadius:mix(4,8*scale,imageMorph),transform:`translate(${flyX}px,${flyY}px) rotate(${flyRotation}deg)`,boxShadow:`0 ${mix(7,0,imageMorph)}px ${mix(12,0,imageMorph)}px rgb(41 37 36 / ${.13*(1-imageMorph)})`}}><img className="workflow-drag-full" src={problemUrl} alt="" style={{opacity:1-previewCrop}}/><img className="workflow-drag-crop" src={problemUrl} alt="" style={{opacity:previewCrop}}/></div>
      <svg className="workflow-cursor" data-kind={grabbingPoint||draggingChoice?'grabbing':cursorHand?'pointer':'arrow'} viewBox="0 0 32 38" style={{opacity:cursorOpacity,transformOrigin:'0 0',transform:`translate(${cursorX}px,${cursorY}px) scale(${cursorScale}) translate(${-cursorHotspotX}px,${-cursorHotspotY}px)`,transition:selectingChoice?'transform .24s cubic-bezier(.22,1,.36,1)':'none'}} aria-hidden>
        {grabbingPoint||draggingChoice?<HandGrab width="28.8" height="28.8" stroke="#292524" strokeWidth="1.4" fill="white"/>:cursorHand?<g transform="scale(1.2)" stroke="#292524" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14V4a2 2 0 0 1 4 0v5a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15Z" fill="white"/><path d="M10 9v5m4-4v4m4-3v3" fill="none"/></g>:<><path d="m3 2 23 19-12 1-6 10Z" fill="#292524" stroke="white" strokeWidth="2"/><path d="m14 22 6 12" stroke="#292524" strokeWidth="4"/></>}
      </svg>
    </div>
    {!embedded&&<div className="workflow-footer"><span className="workflow-scroll-hint"><ArrowDown/>{reduced?'点击步骤查看':p>=timing.complete?'完成 · 可以拖动画板上的 P':p>=timing.pointDrag&&p<timing.pointDrop?'拖动 P · 观察图形联动':p>=timing.responseComplete&&p<timing.pointApproach?'图形已就绪 · 向下滚动继续':'向下滚动'}</span><nav className="workflow-nav" aria-label="演示步骤" style={{opacity:p>.02?1:0}}>{phaseNames.map((name,i)=><button key={name} type="button" onClick={()=>jump(phaseMarks[i])} aria-current={phase===i?'step':undefined}>{name}</button>)}<button type="button" className="workflow-replay" onClick={replay}><RotateCcw/>重播</button></nav><span className="workflow-reduced-note">已减少动态效果</span></div>}
    <span hidden data-board-ready={boardReady} data-streaming={streaming}/>
  </div></section>{!embedded&&<footer className="workflow-tail">滚动预览 · 工具过程与回复为演示数据</footer>}</div>;
}
