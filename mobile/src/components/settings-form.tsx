import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { fetchModels, type ModelOption } from '../lib/models';
import type { ModelProtocol, SettingsValue } from '../lib/store';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';

const PROTOCOLS: Array<{ id: ModelProtocol; label: string; hint: string }> = [
  { id: 'openai-completions', label: 'OpenAI Completions', hint: 'Chat Completions 兼容' },
  { id: 'openai-responses', label: 'OpenAI Responses', hint: 'Responses API' },
  { id: 'anthropic', label: 'Anthropic Messages', hint: 'Claude 原生接口' },
  { id: 'google', label: 'Google Gemini', hint: 'Gemini 原生接口' },
];

const PRESETS: Array<{
  label: string;
  protocol: ModelProtocol;
  baseURL: string;
  model: string;
}> = [
  {
    label: 'DeepSeek',
    protocol: 'openai-completions',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
  },
];

const BASE_PLACEHOLDER: Record<ModelProtocol, string> = {
  'openai-completions': 'https://api.deepseek.com/v1',
  'openai-responses': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

const KEY_PLACEHOLDER: Record<ModelProtocol, string> = {
  'openai-completions': 'sk-...',
  'openai-responses': 'sk-...',
  anthropic: 'sk-ant-...',
  google: 'AIza...',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold">{label}</span>
      {children}
    </label>
  );
}

interface SettingsFormProps {
  initial: SettingsValue;
  onSave: (next: SettingsValue) => void;
  onTest: (next: SettingsValue) => Promise<void>;
  /** 保存成功后的回调：抽屉用来关闭，页面不需要。 */
  onSaved?: () => void;
}

export function SettingsForm({ initial, onSave, onTest, onSaved }: SettingsFormProps) {
  const [protocol, setProtocol] = useState<ModelProtocol>(initial.protocol);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [baseURL, setBaseURL] = useState(initial.baseURL);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const protocolRef = useRef<HTMLDivElement>(null);
  const presetRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProtocol(initial.protocol);
    setBaseURL(initial.baseURL);
    setModel(initial.model);
  }, [initial.protocol, initial.baseURL, initial.model]);

  useEffect(() => {
    setApiKey('');
  }, [initial.apiKey]);

  useEffect(() => {
    setTestResult(null);
  }, [protocol, baseURL, model, apiKey]);

  useEffect(() => {
    if (!protocolOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!protocolRef.current?.contains(event.target as Node)) setProtocolOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [protocolOpen]);

  useEffect(() => {
    if (!presetOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!presetRef.current?.contains(event.target as Node)) setPresetOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [presetOpen]);

  useEffect(() => {
    if (!modelsOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!modelRef.current?.contains(event.target as Node)) setModelsOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [modelsOpen]);

  useEffect(() => {
    setModelsOpen(false);
    setModelOptions([]);
  }, [protocol, baseURL]);

  function normalizedValue(): SettingsValue {
    let nextBase = baseURL.trim().replace(/\/+$/, '');
    if (nextBase && !/^https?:\/\//.test(nextBase)) nextBase = `https://${nextBase}`;
    return {
      protocol,
      baseURL: nextBase,
      model: model.trim(),
      apiKey: apiKey.trim() || initial.apiKey,
    };
  }

  function submit() {
    const next = normalizedValue();
    if (!next.baseURL) {
      toast.error('请填写 Base URL');
      return;
    }
    if (next.baseURL.startsWith('http://') && !next.baseURL.includes('127.0.0.1')) {
      toast.error('远程 provider 请使用 https:// 地址');
      return;
    }
    if (!next.model) {
      toast.error('请填写模型 ID');
      return;
    }
    if (!next.apiKey && !next.baseURL.includes('127.0.0.1')) {
      toast.error('请填写 API Key');
      return;
    }

    onSave(next);
    setApiKey('');
    onSaved?.();
    toast.success('设置已保存');
  }

  async function test() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      await onTest(normalizedValue());
      setTestResult({ ok: true, text: '连接成功' });
    } catch (error) {
      setTestResult({
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  }

  async function loadModels() {
    if (loadingModels) return;
    let nextBase = baseURL.trim().replace(/\/+$/, '');
    if (nextBase && !/^https?:\/\//.test(nextBase)) nextBase = `https://${nextBase}`;
    if (!nextBase) {
      toast.error('请先填写 Base URL');
      return;
    }
    const key = apiKey.trim() || initial.apiKey;
    if (!key) {
      toast.error('请先填写 API Key');
      return;
    }

    setLoadingModels(true);
    try {
      const list = await fetchModels(protocol, nextBase, key);
      if (list.length === 0) {
        toast.error('没有获取到可用模型');
        return;
      }
      setModelOptions(list);
      setModelsOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  }

  const activeProtocol = PROTOCOLS.find(item => item.id === protocol) ?? PROTOCOLS[0];
  const activePreset = PRESETS.find(
    preset =>
      preset.protocol === protocol &&
      preset.baseURL === baseURL &&
      preset.model === model,
  )?.label;

  return (
    <div className="space-y-4">
      <Field label="模型协议">
        <div className="relative" ref={protocolRef}>
          <button
            type="button"
            onClick={() => setProtocolOpen(value => !value)}
            aria-label="选择模型协议"
            aria-expanded={protocolOpen}
            className="flex h-12 w-full items-center justify-between rounded-xl border border-border bg-card px-3.5 text-left text-[13px] font-normal transition active:bg-muted/60"
          >
            <span className="min-w-0 flex-1 truncate">{activeProtocol.label}</span>
            <ChevronDown
              className={cn(
                'ml-2 size-4 shrink-0 text-muted-foreground transition',
                protocolOpen && 'rotate-180',
              )}
            />
          </button>

          {protocolOpen && (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card shadow-float">
              {PROTOCOLS.map(item => {
                const selected = protocol === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setProtocol(item.id);
                      setProtocolOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition active:bg-muted',
                      selected ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{item.label}</span>
                      <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                        {item.hint}
                      </span>
                    </span>
                    {selected && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Field>

      <Field label="Provider Base URL">
        <div className="relative" ref={presetRef}>
          <Input
            type="url"
            inputMode="url"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="pr-12 text-[13px]"
            placeholder={BASE_PLACEHOLDER[protocol]}
            value={baseURL}
            onChange={event => setBaseURL(event.target.value)}
          />
          <button
            type="button"
            onClick={() => setPresetOpen(value => !value)}
            aria-label="选择预设"
            aria-expanded={presetOpen}
            className="absolute right-0 top-0 grid h-12 w-11 place-items-center rounded-r-xl bg-transparent text-muted-foreground transition active:bg-muted/60"
          >
            <ChevronDown
              className={cn('size-4 transition', presetOpen && 'rotate-180')}
            />
          </button>

          {presetOpen && (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] z-20 divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card shadow-float">
              {PRESETS.map(preset => {
                const selected = activePreset === preset.label;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setProtocol(preset.protocol);
                      setBaseURL(preset.baseURL);
                      setModel(preset.model);
                      setPresetOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition active:bg-muted',
                      selected ? 'text-primary' : 'text-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">{preset.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                        {preset.baseURL}
                      </span>
                    </span>
                    {selected && <Check className="size-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Field>
      <Field label="API Key">
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            className="pr-12"
            placeholder={initial.apiKey ? '已配置（留空保持不变）' : KEY_PLACEHOLDER[protocol]}
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowKey(value => !value)}
            aria-label={showKey ? '隐藏 Key' : '显示 Key'}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition active:bg-muted"
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">模型 ID</span>
          <button
            type="button"
            onClick={() => void loadModels()}
            disabled={loadingModels}
            className="flex items-center gap-1 text-[12px] font-medium text-primary transition active:opacity-60 disabled:opacity-60"
          >
            {loadingModels ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {loadingModels ? '获取中…' : '获取模型列表'}
          </button>
        </div>
        <div className="relative" ref={modelRef}>
          <Input
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="deepseek-flash"
            value={model}
            onChange={event => setModel(event.target.value)}
          />
          {modelsOpen && (
            <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-60 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border bg-card shadow-float">
              {modelOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setModel(option.id);
                    setModelsOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left transition active:bg-muted',
                    option.id === model ? 'text-primary' : 'text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{option.id}</span>
                    {option.label && option.label !== option.id && (
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-muted-foreground">
                        {option.label}
                      </span>
                    )}
                  </span>
                  {option.id === model && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">Key 保存在本机安全存储。</p>

      <div className="flex gap-2 pt-1">
        <Button
          variant="secondary"
          className="h-12 flex-1"
          onClick={() => void test()}
          disabled={testing}
        >
          {testing && <Loader2 className="size-4 animate-spin" />}
          {testing ? '测试中…' : '测试连接'}
        </Button>
        <Button className="h-12 flex-1" onClick={submit}>
          保存
        </Button>
      </div>

      {testResult && (
        <p
          className={cn(
            'break-words text-xs leading-relaxed',
            testResult.ok ? 'text-primary' : 'text-destructive',
          )}
        >
          {testResult.text}
        </p>
      )}
    </div>
  );
}
