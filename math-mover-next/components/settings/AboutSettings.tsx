import { ExternalLink, Github, Globe, MessageSquare } from 'lucide-react';

const links = [
  { label: '官网', href: 'https://mathmover.top', icon: Globe },
  { label: 'GitHub', href: 'https://github.com/Derek-yyang/mathmover', icon: Github },
  { label: '反馈问题', href: 'https://github.com/Derek-yyang/mathmover/issues', icon: MessageSquare },
];

/** 产品身份与项目入口；版本由设置侧栏显示。 */
export default function AboutSettings() {
  return <section aria-labelledby="about-mathmover-title" className="flex min-h-full flex-col py-3">
    <div className="flex items-center gap-4">
      <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[var(--mm-bg-emerald-700)] text-3xl font-bold leading-none text-white">M</span>
      <div>
        <h3 id="about-mathmover-title" className="text-[22px] font-semibold leading-7 text-[var(--mm-text-stone-900)]"><span className="sr-only">关于 </span>MathMover</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">让数学问题成为可探索的图形。</p>
      </div>
    </div>
    <p className="mt-6 max-w-[42ch] text-sm leading-7 text-[var(--mm-text-stone-600)]">
      输入题目文字或截图，和 Agent 一起构建、调整 GeoGebra 动态图形。
    </p>
    <div className="mt-6 flex flex-wrap gap-2">
      {links.map(({ label, href, icon: Icon }) => <a key={label} href={href} target="_blank" rel="noopener noreferrer"
        className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[var(--mm-text-stone-700)] transition-colors hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] motion-reduce:transition-none">
        <Icon size={15} aria-hidden="true" />{label}<ExternalLink size={12} aria-hidden="true" />
      </a>)}
    </div>
    <footer className="mt-auto pt-10">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-[var(--mm-border-divider)] pt-4 text-xs leading-5 text-[var(--mm-text-stone-600)]">
        <p>由 Derek Yang 开发</p>
        <a href="https://github.com/Derek-yyang/mathmover/blob/master/LICENSE" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-sm underline decoration-[var(--mm-border-stone-300)] underline-offset-4 hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]">MIT License<ExternalLink size={12} aria-hidden="true" /></a>
      </div>
    </footer>
  </section>;
}
