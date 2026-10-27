'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { ATTACHMENT_LIMIT, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES } from '@/lib/attachment-policy';

const formats = ATTACHMENT_TYPES.map(type => type === 'image/webp' ? 'WebP' : type.slice('image/'.length).toUpperCase()).join(' / ');
const maxImageMB = ATTACHMENT_MAX_BYTES / (1024 * 1024);
const shortcuts = [
  { action: '发送题目', keys: ['Enter'] },
  { action: '换行', keys: ['Shift', 'Enter'] },
];
const questions: Array<{ id: string; question: string; answer: ReactNode }> = [
  {
    id: 'images', question: '如何上传题目图片？可以只发图片吗？',
    answer: <>
      <p>把图片粘贴或拖入题目输入框，也可以点击输入框下方的图片按钮上传。<strong className="font-medium text-[var(--mm-text-stone-800)]">只发图片也可以，无需补充文字。</strong></p>
      <p>一次最多 {ATTACHMENT_LIMIT} 张，单张不超过 {maxImageMB} MB，支持 {formats}。当前 Agent 和模型需要支持图片输入。</p>
    </>,
  },
  {
    id: 'setup', question: '如何配置内置 Agent？',
    answer: <p>打开「模型与提供商 → 模型 API」，选择接口格式，填写 API 端点、密钥和模型后保存。点击「测试」可检查连接，无需另行安装本机 Agent。</p>,
  },
  {
    id: 'model', question: '在哪里切换模型和思考档位？',
    answer: <>
      <p>有多个可选项时，点击对话输入框下方的模型名称，选择模型和思考档位。</p>
      <p>内置 Agent 的当前档位也可以在「模型与提供商 → 模型 API」中调整，两处选择会同步。可选档位取决于当前模型与接口格式。</p>
    </>,
  },
  {
    id: 'agents', question: '内置 Agent 和本机 Agent 有什么区别？',
    answer: <>
      <p>内置 Agent 使用你在「模型 API」中保存的配置。本机 Agent（Claude Code、Codex、DeepSeek Harness）使用各自程序的登录状态、账号和模型配置。</p>
      <p>在「模型与提供商」中选择要使用的 Agent。MathMover 不会自动替你切换，切换后也不会延续另一个 Agent 的会话。</p>
    </>,
  },
  {
    id: 'sending', question: '为什么暂时不能发送题目？',
    answer: <>
      <p>先查看输入框附近的提示：画板加载或 Agent 检测期间需要稍候；连接断开时点击「重新连接」；配置未完成时，按提示打开设置。</p>
      <p>图片尚未读取完成时，请等待处理结束。如果提示当前 Agent 不支持图片，请移除图片，或切换到支持图片的 Agent 和模型。</p>
    </>,
  },
];

export default function HelpSettings() {
  const idPrefix = useId();
  const [expandedQuestions, setExpandedQuestions] = useState(() => new Set<string>());

  function toggleQuestion(id: string) {
    setExpandedQuestions(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return <section aria-labelledby="help-settings-title">
    <h3 id="help-settings-title" className="text-base font-semibold text-[var(--mm-text-stone-800)]">帮助与快捷键</h3>
    <section aria-labelledby="help-shortcuts-title" className="mt-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 id="help-shortcuts-title" className="text-sm font-medium text-[var(--mm-text-stone-800)]">快捷键</h4>
        <p className="text-xs leading-5 text-[var(--mm-text-stone-600)]">在题目输入框中使用</p>
      </div>
      <table className="mt-2 w-full text-sm">
        <caption className="sr-only">题目输入快捷键</caption>
        <thead className="sr-only"><tr><th scope="col">操作</th><th scope="col">快捷键</th></tr></thead>
        <tbody>
          {shortcuts.map(({ action, keys }) => <tr key={action} className="border-b border-[var(--mm-border-stone-200)]">
            <th scope="row" className="py-2.5 text-left font-normal text-[var(--mm-text-stone-700)]">{action}</th>
            <td className="py-2.5 pl-3">
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                {keys.map((key, index) => <span key={key} className="inline-flex items-center gap-1.5">
                  {index > 0 && <span aria-hidden className="text-xs text-[var(--mm-text-stone-600)]">+</span>}
                  <kbd className="inline-flex min-h-6 min-w-8 items-center justify-center rounded border border-[var(--mm-border-stone-300)] bg-[var(--mm-bg-stone-100)] px-1.5 font-mono text-xs leading-5 text-[var(--mm-text-stone-800)]">{key}</kbd>
                </span>)}
              </span>
            </td>
          </tr>)}
        </tbody>
      </table>
    </section>
    <section aria-labelledby="help-questions-title" className="mt-6">
      <h4 id="help-questions-title" className="text-sm font-medium text-[var(--mm-text-stone-800)]">使用帮助</h4>
      <div className="mt-2">
        {questions.map(({ id, question, answer }) => {
          const expanded = expandedQuestions.has(id);
          const answerId = `${idPrefix}-${id}`;
          return <div key={id} className="border-b border-[var(--mm-border-stone-200)] last:border-b-0">
            <h5>
              <button type="button" aria-expanded={expanded} aria-controls={answerId} onClick={() => toggleQuestion(id)}
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md py-3 text-left text-sm font-medium text-[var(--mm-text-stone-800)] hover:text-[var(--mm-text-emerald-800)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]">
                <span>{question}</span>
                <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-[var(--mm-text-stone-600)] transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
              </button>
            </h5>
            <div id={answerId} inert={!expanded} aria-hidden={!expanded}
              className={`grid overflow-hidden transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100 duration-250' : 'grid-rows-[0fr] opacity-0 duration-200'}`}>
              <div className="min-h-0 overflow-hidden">
                <div className="space-y-2 pb-4 pr-6 text-sm leading-6 text-[var(--mm-text-stone-600)]">{answer}</div>
              </div>
            </div>
          </div>;
        })}
      </div>
    </section>
  </section>;
}
