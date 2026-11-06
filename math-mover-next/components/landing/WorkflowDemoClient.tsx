'use client';

import dynamic from 'next/dynamic';
import type { CSSProperties } from 'react';
import { workflowScrollSpan } from './workflow-demo-timeline';
import './workflow-demo.css';

// Keep the measured composer and GeoGebra in a separate client bundle.
// The fallback reserves the same scroll space, so cases stay at a stable offset.
const WorkflowDemo=dynamic(()=>import('./WorkflowDemo'),{ssr:false,loading:()=>
  <section className="workflow-story" aria-label="数学工作流演示">
    <div className="workflow-sticky workflow-loading" role="status">
      <img src="/workflow-preview/problem.png" width="2048" height="645" alt="椭圆与动点的数学题图"/>
      <p>从一张题图，构建可探索的图形。</p>
      <a href="#connection">查看模型接入</a>
    </div>
  </section>
});

export default function WorkflowDemoClient({embedded=false}:{embedded?:boolean}){
  return <div className={`workflow-host${embedded?' workflow-embedded':''}`} style={{'--workflow-scroll-span':`${workflowScrollSpan}vh`} as CSSProperties}>
    <WorkflowDemo embedded={embedded}/>
  </div>;
}
