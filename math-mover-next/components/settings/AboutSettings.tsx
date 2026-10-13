/**
 * 「关于」设置面 —— 产品身份、数据与密钥的保管边界。
 */

export default function AboutSettings() {
  return (
    <div>
      <p className="mt-1 max-w-[68ch] text-sm leading-6 text-stone-600">
        MathMover 是基于 AI 的数学课件生成工作台：把题目变成可交互的 GeoGebra 动态图形。
      </p>
      <dl className="mt-5 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-sm font-medium text-stone-900">版本</dt>
          <dd className="text-sm leading-6 text-stone-600">开发版</dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-sm font-medium text-stone-900">数据与密钥</dt>
          <dd className="max-w-[52ch] text-sm leading-6 text-stone-600">
            课件与配置全部存本机应用数据目录，不经第三方服务器。API 密钥只显示尾 4 位，
            保存后不可回读原文，且不会进入课件备份。
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-6">
          <dt className="w-40 shrink-0 text-sm font-medium text-stone-900">Agent 驱动</dt>
          <dd className="max-w-[52ch] text-sm leading-6 text-stone-600">
            本机安装的第三方 Agent（Claude Code / Codex / DeepSeek Harness）由各自官方
            提供；MathMover 只驱动其命令行程序，不改其安装与配置。
          </dd>
        </div>
      </dl>
    </div>
  );
}
