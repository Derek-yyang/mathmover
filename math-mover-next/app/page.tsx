import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Download, MoveUpRight } from 'lucide-react';
import { HeroDemo, ExampleGallery } from '@/components/landing/LandingExperience';
import { LandingHeader } from '@/components/landing/LandingHeader';
import { ThemeMenu } from '@/components/landing/ThemeMenu';
import { FaqItem } from '@/components/landing/FaqItem';
import { BrandIcon } from '@/components/settings/BrandIcon';
import styles from './landing.module.css';

// Each desktop release publishes this fixed-name copy alongside versioned assets.
const desktopDownloadUrl = 'https://github.com/Derek-yyang/mathmover/releases/latest/download/MathMover-Setup.exe';

export const metadata: Metadata = {
  title: 'MathMover · 让数学问题，成为可探索的图形',
  description: 'MathMover 桌面端，让你通过数学题或题图，与 Agent 一起构建和调整 GeoGebra 动态课件，探索函数、几何与空间中的关系。',
};

const questions = [
  { question: '需要下载安装吗？', answer: 'MathMover 是桌面应用，下载安装后即可在电脑上使用。官网提供产品介绍和交互演示。' },
  { question: '需要会使用 GeoGebra 吗？', answer: '可以从自然语言开始。描述要画的图形，或上传题目截图，再通过对话补充条件、调整图形。生成后也可以直接在 GeoGebra 画板中继续操作。数学条件和生成结果仍需要你核对。' },
  { question: '开始使用前，需要配置什么？', answer: '下载安装桌面端后，在设置中连接自己的模型 API，或者选择电脑上已经安装并登录的 Agent。不同模型的图片理解和工具调用能力有所不同，上传题图前请确认所选模型支持图片。' },
  { question: '使用模型会产生费用吗？', answer: 'MathMover 不设置生成积分或订阅门槛。模型 API 或 Agent 的使用费用由你选择的服务商收取，具体取决于服务商的计费规则和你的账户方案。' },
  { question: '课件和对话保存在哪里？', answer: '课件、对话和画板快照保存在你使用 MathMover 的电脑上。生成时，题目和相关上下文会发送给你选择的模型服务商或 Agent。' },
];

const supportedAgents = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'dsh', name: 'DeepSeek Harness' },
];

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <a href="#main" className={styles.skipLink}>跳转到主要内容</a>
      <LandingHeader>
          <Link href="/" className={styles.brand} aria-label="MathMover 首页"><span className={styles.brandMark} aria-hidden="true">M</span><span>MathMover</span></Link>
          <nav className={styles.navLinks} aria-label="首页导航"><a href="#demo">交互演示</a><a href="#examples">探索案例</a><a href="#questions">常见问题</a></nav>
          <div className={styles.navActions}><ThemeMenu /><a href={desktopDownloadUrl} className={styles.navAction} aria-label="下载 Windows x64 版 MathMover">下载桌面端 <Download size={15} aria-hidden="true" /></a></div>
      </LandingHeader>
      <main id="main">
        <section className={`${styles.container} ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.heroIntro}>
            <h1 id="hero-title">让数学问题，<span>成为可探索的图形。</span></h1>
            <div className={styles.heroAside}>
              <p>在桌面端输入题目或上传截图，<br className={styles.mobileBreak} />与 Agent 一起构建、调整。<br />让抽象关系在画板上清晰可见。</p>
              <div className={styles.heroActions}><a href={desktopDownloadUrl} className={styles.primaryButton}>下载 Windows 版 <Download size={17} aria-hidden="true" /></a></div>
            </div>
          </div>
          <div id="demo" className={styles.demoAnchor}><HeroDemo /></div>
          <div className={styles.capabilities} aria-label="主要能力"><span><Check size={15} aria-hidden="true" />文字与题图输入</span><span><Check size={15} aria-hidden="true" />GeoGebra 2D / 3D</span><span><Check size={15} aria-hidden="true" />自选模型与 Agent</span></div>
        </section>
        <section id="examples" className={`${styles.container} ${styles.examples}`} aria-labelledby="examples-title">
          <ExampleGallery />
        </section>
        <section className={styles.workflowSection} aria-labelledby="workflow-title">
          <div className={styles.container}>
            <div className={styles.workflowIntro}><h2 id="workflow-title">从一个想法，<br />到一堂生动的课。</h2><p>把精力留给问题本身。<br />在同一个工作台里，完成构建、探索与整理。</p></div>
            <ol className={styles.workflow}>
              <li><span className={styles.stepNumber}>01</span><h3>提出问题</h3><p>输入条件，或上传题目截图。<br />从熟悉的表达方式开始。</p></li>
              <li><span className={styles.stepNumber}>02</span><h3>一起构建</h3><p>让 Agent 操作画板。<br />通过对话补充条件、核对并调整。</p></li>
              <li><span className={styles.stepNumber}>03</span><h3>继续探索</h3><p>拖动图形，观察变化。<br />保存课件，或从画板导出成果。</p></li>
            </ol>
            <a href={desktopDownloadUrl} className={styles.workflowLink} aria-label="下载 Windows x64 版 MathMover">下载桌面端 <MoveUpRight size={18} aria-hidden="true" /></a>
          </div>
        </section>
        <section className={`${styles.container} ${styles.connectionSection}`} aria-labelledby="connection-title">
          <div><h2 id="connection-title">用你选择的模型，<br />探索你关心的问题。</h2><p>连接模型 API，或使用本机 Agent。<br />在设置中选择适合自己的方式，随时调整。</p></div>
          <div className={styles.connectionOptions}>
            <div><span className={styles.optionIndex}>API</span><div><h3>连接模型 API</h3><p>填写接口地址、密钥和模型。支持 OpenAI、Anthropic 与 Gemini 等接口格式。</p></div></div>
            <div><span className={styles.optionIndex}>CLI</span><div><h3>使用本机 Agent</h3><p>接入电脑上已经安装并登录的 Agent，沿用自己的账户与模型配置。</p><ul className={styles.supportedAgents} aria-label="已支持的本机 Agent">{supportedAgents.map(agent => <li key={agent.id}><BrandIcon id={agent.id} className={styles.agentLogo} /><span>{agent.name}</span></li>)}</ul></div></div>
            <p className={styles.costNote}>模型或 Agent 的使用费用，由对应服务商收取。</p>
          </div>
        </section>
        <section id="questions" className={`${styles.container} ${styles.faqSection}`} aria-labelledby="questions-title">
          <h2 id="questions-title">开始之前，<br />你可能想知道。</h2>
          <div className={styles.faqList}>{questions.map(({question, answer}) => <FaqItem key={question} question={question} answer={answer} />)}</div>
        </section>
        <section id="download" className={`${styles.container} ${styles.closing}`} aria-labelledby="closing-title">
          <span className={styles.closingSymbol} aria-hidden="true">↗</span>
          <h2 id="closing-title">下一个发现，<br />从你的问题开始。</h2>
          <a href={desktopDownloadUrl} className={styles.primaryButton}>下载 Windows 版 <Download size={17} aria-hidden="true" /></a>
          <p>适用于 Windows x64，连接自己的模型 API 或本机 Agent。</p>
        </section>
      </main>
      <footer className={styles.footer}><div className={styles.container}><Link href="/" className={styles.brand}><span className={styles.brandMark} aria-hidden="true">M</span><span>MathMover</span></Link><p>让数学关系，看得见，也动得起来。</p><span>© {new Date().getFullYear()} MathMover</span></div></footer>
    </div>
  );
}
