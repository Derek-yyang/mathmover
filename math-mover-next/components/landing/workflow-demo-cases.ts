export type DemoCaseId='conic'|'function'|'solid';
export type DemoPoint=readonly [number,number,number?];
export type WorkflowCase={
  id:DemoCaseId;
  label:string;
  title:string;
  image:string;
  fileName:string;
  response:string;
  pointStart:DemoPoint;
  pointEnd:DemoPoint;
};

export const workflowCases:readonly WorkflowCase[]=[
  {id:'conic',label:'解析几何',title:'椭圆与动点',image:'/workflow-preview/problem.png',fileName:'椭圆题.png',
    response:'图形已构建完成。\n\n你可以拖动直线 $x=6$ 上的点 $P$，观察 $C$、$D$ 沿椭圆移动，以及直线 $CD$ 的变化。',
    pointStart:[6,2],pointEnd:[6,.8]},
  {id:'function',label:'函数',title:'抛物线与动点',image:'/workflow-preview/function.png',fileName:'二次函数题.png',
    response:'图形已构建完成。\n\n你可以拖动线段 $AB$ 上的点 $P$，观察线段 $PC$ 的长度，以及三角形 $APC$ 的变化。',
    pointStart:[1.2,3.2],pointEnd:[3.1,5.1]},
  {id:'solid',label:'立体几何',title:'正方体中的动点',image:'/workflow-preview/solid.png',fileName:'正方体题.png',
    response:'图形已构建完成。\n\n你可以沿绿色线段拖动点 $P$，保持 $D_1O\\perp OP$，观察三角形 $D_1C_1P$ 的变化。',
    pointStart:[2,.5,.75],pointEnd:[2,1.6,.2]},
];

export interface WorkflowApi {
  evalCommand:(command:string)=>unknown;
  setPerspective:(perspective:string)=>void;
  setCoordSystem:(a:number,b:number,c:number,d:number)=>void;
  setAxesVisible:{(x:boolean,y:boolean):void;(view:number,x:boolean,y:boolean,z:boolean):void};
  setGridVisible:{(visible:boolean):void;(view:number,visible:boolean):void};
  setColor:(name:string,r:number,g:number,b:number)=>void;
  setLabelVisible:(name:string,value:boolean)=>void;
  setVisible:(name:string,value:boolean)=>void;
  setFixed:(name:string,fixed:boolean,selectionAllowed:boolean)=>void;
  setPointSize:(name:string,size:number)=>void;
  setLineThickness:(name:string,size:number)=>void;
  setFilling:(name:string,value:number)=>void;
  setCoords:(name:string,x:number,y:number,z?:number)=>void;
  getXcoord:(name:string)=>number;
  getYcoord:(name:string)=>number;
  getZcoord:(name:string)=>number;
  getViewProperties:(view:number)=>unknown;
  getPerspectiveXML:()=>string;
  getXML:()=>string;
  setXML:(xml:string)=>void;
  refreshViews:()=>void;
  deleteObject:(name:string)=>void;
  newConstruction:()=>void;
  getAllObjectNames:()=>string[];
  registerClientListener:(listener:(event:unknown)=>void)=>void;
  unregisterClientListener:(listener:(event:unknown)=>void)=>void;
}

export function fitWorkflowBoard(api:WorkflowApi,id:DemoCaseId){
  if(id==='solid'){
    // A deterministic orthographic camera also makes the animated pointer
    // project onto the real 3D point, independently of previous examples.
    const xml=api.getXML();
    const block=/<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(xml)?.[0];
    if(!block)return;
    let next=block.replace(/<coordSystem[^>]*\/>/,'<coordSystem xZero="-1" yZero="-1" zZero="-1" scale="195" xAngle="20" zAngle="-60"/>');
    next=/<projection\b/.test(next)?next.replace(/<projection[^>]*\/>/,'<projection type="0"/>'):next.replace('</euclidianView3D>','<projection type="0"/></euclidianView3D>');
    api.setXML(xml.replace(block,()=>next));api.refreshViews();
    api.setAxesVisible(3,false,false,false);api.setGridVisible(3,false);
    api.evalCommand('ShowPlane(false)');
    return;
  }
  const board=document.querySelector('.workflow-host [data-slot="board-surface"]');
  const ratio=board?board.clientHeight/board.clientWidth:1;
  const width=id==='function'?10.8:12.3,centerX=id==='function'?1.5:1.45,centerY=id==='function'?2:.5;
  api.setCoordSystem(centerX-width/2,centerX+width/2,centerY-width*ratio/2,centerY+width*ratio/2);
}

export function buildWorkflowStage(api:WorkflowApi,id:DemoCaseId,stage:number){
  const run=(commands:string[])=>commands.forEach(command=>{if(api.evalCommand(command)===false)throw new Error(`无法构建演示对象：${command}`);});
  const points=(names:string[],size=4)=>names.forEach(name=>{api.setLabelVisible(name,true);api.setPointSize(name,size);api.setColor(name,4,120,87);});
  const lines=(names:string[],color:readonly [number,number,number]=[111,158,137],width=2)=>names.forEach(name=>{api.setColor(name,...color);api.setLineThickness(name,width);api.setLabelVisible(name,false);});
  if(id==='conic'){
    if(stage===1){run(['E: x^2/9+y^2=1','A=(-3,0)','B=(3,0)','G=(0,1)']);lines(['E'],[4,120,87],4);points(['A','B','G']);}
    if(stage===2){run(['l: x=6','P=Point(l)']);lines(['l'],[150,160,155]);points(['P'],6);}
    if(stage===3){
      run(['g=Line(P,A)','h=Line(P,B)','C=Intersect(E,g,1)','D=Intersect(E,h,1)']);
      if(Math.abs(api.getXcoord('C')+3)<.001){api.deleteObject('C');run(['C=Intersect(E,g,2)']);}
      if(Math.abs(api.getXcoord('D')-3)<.001){api.deleteObject('D');run(['D=Intersect(E,h,2)']);}
      lines(['g','h']);points(['C','D']);
    }
    if(stage===4){run(['s=Line(C,D)']);lines(['s'],[186,113,69],4);}
  }else if(id==='function'){
    if(stage===1){run(['f(x)=2x^2-8x+6','g: y=x+2','A=(0.5,2.5)','B=(4,6)','E=(-2,0)']);lines(['f'],[4,120,87],4);lines(['g'],[150,160,155]);points(['A','B','E']);}
    if(stage===2){run(['ab=Segment(A,B)','P=Point(ab)']);api.setVisible('ab',false);points(['P'],6);}
    if(stage===3){run(['D=(x(P),0)','C=(x(P),f(x(P)))','pc=Segment(P,C)','pd=Segment(P,D)']);lines(['pd']);lines(['pc'],[186,113,69],4);points(['C','D']);}
    if(stage===4){run(['s=Polygon(A,P,C)']);lines(['s'],[4,120,87]);api.setFilling('s',.13);}
  }else{
    if(stage===1){
      run(['A=(0,0,0)','B=(2,0,0)','C=(2,2,0)','D=(0,2,0)','A_1=(0,0,2)','B_1=(2,0,2)','C_1=(2,2,2)','D_1=(0,2,2)']);
      const edges=[['A','B'],['B','C'],['C','D'],['D','A'],['A_1','B_1'],['B_1','C_1'],['C_1','D_1'],['D_1','A_1'],['A','A_1'],['B','B_1'],['C','C_1'],['D','D_1']];
      run(edges.map(([a,b],i)=>`e${i}=Segment(${a},${b})`));lines(edges.map((_,i)=>`e${i}`),[120,132,125],3);points(['A','B','C','D','A_1','B_1','C_1','D_1'],3);
    }
    if(stage===2){
      // With O=(1,1,0), D1O ⟂ OP on x=2 is exactly y+2z=2.
      // P remains a native path point, so a user can drag it after playback.
      run(['O=(1,1,0)','M=(2,0,1)','N=(2,2,0)','r=Segment(M,N)','P=Point(r)']);
      api.setVisible('M',false);api.setVisible('N',false);lines(['r'],[78,164,131],4);points(['O']);points(['P'],6);
    }
    if(stage===3){run(['u=Segment(D_1,O)','v=Segment(O,P)','angle=Angle(D_1,O,P)']);lines(['u','v']);api.setColor('angle',4,120,87);api.setLabelVisible('angle',false);}
    if(stage===4){run(['s=Polygon(D_1,C_1,P)']);lines(['s'],[186,113,69],4);api.setFilling('s',.22);}
  }
}
