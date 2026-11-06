export const timing={dragStart:.015,attachmentMount:.045,expandStart:.055,expandEnd:.12,drop:.13,handoffEnd:.145,typingStart:.15,typingEnd:.29,zoomStart:.315,zoomEnd:.39,cursorStart:.395,cursorEnd:.415,send:.42,toolsStart:.43,ellipse:.52,movingPoint:.62,intersections:.72,join:.825,streaming:.86,responseStart:.865,responseComplete:.995,pointApproach:1,pointHover:1.055,pointDrag:1.075,pointDrop:1.195,pointRelease:1.21,cursorExit:1.24,complete:1.30};
export const phaseMarks=[0,.035,.24,.35,.425,.58,.915,timing.pointApproach,timing.complete];
export const phaseNames=['选择题图','拖入题图','输入描述','拉远视角','点击发送','逐步构图','流式回复','拖动观察','完成'];

// Extra scroll distance preserves the approved pauses and closing interaction.
const playbackSections=[
  // The opening choice stays still until the pointer starts the drag.
  [0,0,.035],
  [0,timing.zoomEnd,timing.zoomEnd],
  [timing.zoomEnd,timing.zoomEnd,.055],
  [timing.zoomEnd,timing.cursorStart,timing.cursorStart-timing.zoomEnd],
  [timing.cursorStart,timing.cursorEnd,.04],
  [timing.cursorEnd,timing.cursorEnd,.025],
  [timing.cursorEnd,timing.send,.01],
  [timing.send,timing.responseComplete,timing.responseComplete-timing.send],
  [timing.responseComplete,timing.responseComplete,.075],
  [timing.responseComplete,timing.complete,timing.complete-timing.responseComplete],
] as const;
const playbackLength=playbackSections.reduce((sum,[,,length])=>sum+length,0);
export const workflowScrollSpan=580*playbackLength;
const clamp=(value:number)=>Math.max(0,Math.min(1,value));

export function timelineFromScroll(progress:number){
  let remaining=clamp(progress)*playbackLength;
  for(const [from,to,length] of playbackSections){if(remaining<=length)return from+(to-from)*remaining/length;remaining-=length;}
  return timing.complete;
}
export function scrollFromTimeline(progress:number){
  const value=Math.max(0,Math.min(timing.complete,progress));let distance=0;
  for(const [from,to,length] of playbackSections){if(to>from&&value<=to)return (distance+(value-from)/(to-from)*length)/playbackLength;distance+=length;}
  return 1;
}
