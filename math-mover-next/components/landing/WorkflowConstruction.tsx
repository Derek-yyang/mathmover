'use client';

import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import CanvasStage from '@/components/dashboard/CanvasStage';
import type { GeoGebraApi } from '@/components/dashboard/types';
import { readViewBounds } from '@/lib/ggb-view-transition';
import { read3DCamera } from '@/lib/ggb-view-reset';
import { ggbClientEventType } from '@/lib/ggb-graphics-state';
import { buildWorkflowStage, fitWorkflowBoard, type DemoPoint, type WorkflowApi, type WorkflowCase } from './workflow-demo-cases';

type ScreenPoint={x:number;y:number};
export type PointProjection={from:ScreenPoint;to:ScreenPoint;current:ScreenPoint};

export default memo(function WorkflowConstruction({example,stage,movement,projectionVersion,onProjection,onReady,onApi}:{example:WorkflowCase;stage:number;movement:number;projectionVersion:boolean;onProjection:(value:PointProjection|null)=>void;onReady:(ready:boolean)=>void;onApi:(api:GeoGebraApi|null)=>void}){
  const [api,setApi]=useState<WorkflowApi|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState(false);
  const current=useRef(0);
  const root=useRef<HTMLDivElement>(null);
  const initialize=useCallback((value:GeoGebraApi)=>{setApi(value as unknown as WorkflowApi);onApi(value);},[onApi]);
  useLayoutEffect(()=>()=>onApi(null),[onApi]);
  useLayoutEffect(()=>{
    if(!api)return;
    onReady(false);setReady(false);setError(false);
    api.setPerspective(example.id==='solid'?'T':'G');
    let frame=0,cancelled=false;const started=performance.now();
    const wait=()=>{
      if(cancelled)return;
      const visible=example.id!=='solid'||/view id="512"[^>]*visible="true"/.test(api.getPerspectiveXML());
      if(!visible){if(performance.now()-started>8000){setError(true);return;}frame=requestAnimationFrame(wait);return;}
      fitWorkflowBoard(api,example.id);
      frame=requestAnimationFrame(()=>{if(!cancelled){setReady(true);onReady(true);}});
    };
    frame=requestAnimationFrame(wait);
    return()=>{cancelled=true;cancelAnimationFrame(frame);onProjection(null);onReady(false);};
  },[api,example.id,onReady,onProjection]);
  useLayoutEffect(()=>{
    if(!api||!ready)return;
    try{
      if(stage<current.current){
        // Keep the initialized 3D view and camera while rewinding objects.
        for(const name of api.getAllObjectNames().reverse())api.deleteObject(name);
        current.current=0;
      }
      while(current.current<stage){buildWorkflowStage(api,example.id,current.current+1);current.current++;}
      // Only the native path point P is interactive; dependent geometry still
      // recomputes normally, including during scripted movement and rewinding.
      for(const name of api.getAllObjectNames())api.setFixed(name,name!=='P',name==='P');
      (window as unknown as {previewBoard:WorkflowApi}).previewBoard=api;
    }catch{setError(true);onReady(false);}
  },[api,ready,stage,example.id,onReady]);
  useLayoutEffect(()=>{
    if(!api||!ready||stage<2)return;
    const from=example.pointStart,to=example.pointEnd;
    api.setCoords('P',from[0]+(to[0]-from[0])*movement,from[1]+(to[1]-from[1])*movement,from[2]===undefined?undefined:from[2]+((to[2]??0)-from[2])*movement);
  },[api,ready,stage,movement,example]);
  const updateProjection=useCallback(()=>{
    if(!api||!ready||stage<2){onProjection(null);return;}
    const viewport=root.current?.closest('.workflow-viewport');
    const panel=root.current?.querySelector('.EuclidianPanel');
    if(!viewport||!panel){onProjection(null);return;}
    const rect=panel.getBoundingClientRect(),origin=viewport.getBoundingClientRect();
    let project:(point:DemoPoint)=>ScreenPoint;
    if(example.id==='solid'){
      const camera=read3DCamera(api.getXML());if(!camera){onProjection(null);return;}
      // GeoGebra's orthographic model matrix: Rx(xAngle-90) *
      // Rz(-zAngle-90) * scale * translate(origin). See EuclidianView3D.
      const a=(-camera.zAngle-90)*Math.PI/180,b=(camera.xAngle-90)*Math.PI/180;
      const scale=rect.width/panel.clientWidth*camera.scale;
      project=([x,y,z=0]:DemoPoint)=>{
        const dx=x+camera.xZero,dy=y+camera.yZero,dz=z+camera.zZero;
        return {x:rect.left-origin.left+rect.width/2+scale*(Math.cos(a)*dx-Math.sin(a)*dy),y:rect.top-origin.top+rect.height/2-scale*(Math.cos(b)*(Math.sin(a)*dx+Math.cos(a)*dy)-Math.sin(b)*dz)};
      };
    }else{
      const bounds=readViewBounds(api.getViewProperties(1));if(!bounds){onProjection(null);return;}
      project=([x,y]:DemoPoint)=>({x:rect.left-origin.left+(x-bounds.xMin)/(bounds.xMax-bounds.xMin)*rect.width,y:rect.top-origin.top+(bounds.yMax-y)/(bounds.yMax-bounds.yMin)*rect.height});
    }
    onProjection({from:project(example.pointStart),to:project(example.pointEnd),current:project([api.getXcoord('P'),api.getYcoord('P'),example.id==='solid'?api.getZcoord('P'):undefined])});
  },[api,ready,stage,example,onProjection]);
  useLayoutEffect(()=>{
    // Read the point after setCoords, in the same layout pass, so the hand and
    // native geometry reach each displayed frame together (also when rewinding).
    updateProjection();
  },[movement,projectionVersion,updateProjection]);
  useLayoutEffect(()=>{
    if(!api||!ready||stage<2)return;
    let frame=0;
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;updateProjection();});};
    const onViewChanged=(event:unknown)=>{if(['viewChanged2D','viewPropertiesChanged','perspectiveChange'].includes(ggbClientEventType(event)??''))schedule();};
    const observer=new ResizeObserver(schedule);
    const panel=root.current?.querySelector('.EuclidianPanel');
    if(panel)observer.observe(panel);
    api.registerClientListener(onViewChanged);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();api.unregisterClientListener(onViewChanged);};
  },[api,ready,stage,updateProjection]);
  return <div ref={root} className="relative flex min-h-0 min-w-0 flex-1"><CanvasStage onAppletReady={initialize} active={false} fixedView/>{error&&<p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-[var(--mm-surface)] p-3 text-sm text-[var(--mm-text-stone-800)]">演示画板未能加载，请重播或刷新页面。</p>}</div>;
});
