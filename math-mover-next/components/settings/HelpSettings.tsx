/**
 * 「帮助与快捷键」设置面 —— 产品既有交互的事实清单（不是营销文案）。
 *
 * 这些行为在界面里都能用，但此前没有任何地方告诉用户——尤其题目图片的
 * 粘贴/数量/体积规则，老师第一次用几乎发现不了。
 */

const rows: Array<{ term: string; detail: string }> = [
  { term: '发送', detail: 'Enter 发送，Shift + Enter 换行。' },
  { term: '题目图片', detail: '粘贴、拖入或点图片按钮上传，一次最多 4 张，单张不超过 6 MB，支持 PNG / JPEG / WebP / GIF。**只发图、不打字也可以**——agent 直接看图理解题意作图。' },
  { term: '模型与推理档位', detail: '聊天区工具栏与本设置页都能改，两处是同一份状态，改哪边都同步。' },
  { term: '切换 Agent', detail: '不自动切换、不会静默降级；换 Agent 时会话不跨 Agent 延续。' },
  { term: '没装 Agent', detail: '在「API 提供商」里配置内置构造 Agent（BYOK），填一个 OpenAI 兼容端点即可生成课件。' },
  { term: '画板保护', detail: '画板未连接时不会启动 Agent——发题会被拦下并提示，不会空跑。' },
  { term: '模型、账号、密钥', detail: '由各自 Agent 管理；MathMover 只读取配置并驱动本机命令行程序。' },
];

export default function HelpSettings() {
  return (
    <div>
      <p className="mt-1 max-w-[68ch] text-sm leading-6 text-[var(--mm-text-stone-600)]">工作台的实际交互行为速查。</p>
      <dl className="mt-5 space-y-4">
        {rows.map(row => (
          <div key={row.term} className="flex flex-col gap-1 sm:flex-row sm:gap-6">
            <dt className="w-40 shrink-0 text-sm font-medium text-[var(--mm-text-stone-900)]">{row.term}</dt>
            <dd className="max-w-[52ch] text-sm leading-6 text-[var(--mm-text-stone-600)]">{row.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
