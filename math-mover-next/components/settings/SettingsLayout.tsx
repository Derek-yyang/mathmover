'use client';

import { useId, type ReactNode } from 'react';
import { Archive, Cpu, Database, Info, Keyboard, SunMoon } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../assistant-ui/ui/tabs';

export type SettingsSection = 'agents' | 'appearance' | 'archives' | 'storage' | 'help' | 'about';
export type SettingsProviderTab = 'cli' | 'providers';

const sections = [
  { id: 'agents', label: '模型与提供商', icon: Cpu },
  { id: 'appearance', label: '外观', icon: SunMoon },
  { id: 'archives', label: '归档课件', icon: Archive },
  { id: 'storage', label: '数据与存储', icon: Database },
  { id: 'help', label: '帮助与快捷键', icon: Keyboard },
  { id: 'about', label: '关于', icon: Info },
] satisfies Array<{ id: SettingsSection; label: string; icon: typeof Cpu }>;

// Shared presentation only. Each host owns its data, side effects and dialog.
export function SettingsSections({ section, onSectionChange, children }: {
  section: SettingsSection; onSectionChange: (section: SettingsSection) => void; children: ReactNode;
}) {
  return <div data-settings-layout className="flex min-h-0 flex-1">
    <nav data-settings-nav aria-label="设置分区" className="w-48 shrink-0 border-r border-[var(--mm-border-stone-200)] px-3 py-4">
      <ul className="space-y-1">
        {sections.map(({ id, label, icon: Icon }) => <li key={id}>
          <button type="button" aria-current={section === id ? 'page' : undefined} onClick={() => onSectionChange(id)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] ${section === id ? 'bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-900)]' : 'text-[var(--mm-text-stone-700)] hover:bg-[var(--mm-bg-stone-100)]'}`}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}
          </button>
        </li>)}
      </ul>
    </nav>
    <div data-settings-scroll className="settings-scroll-viewport min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
  </div>;
}

export function SettingsProviderTabs({ tab, onTabChange, cliCount, api, agents }: {
  tab: SettingsProviderTab; onTabChange: (tab: SettingsProviderTab) => void; cliCount: number; api: ReactNode; agents: ReactNode;
}) {
  const id = useId();
  const tabClass = 'h-10 flex-none rounded-none px-4 after:bg-primary data-[state=active]:text-primary dark:data-[state=active]:text-primary group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]';
  return <Tabs value={tab} onValueChange={value => { if (value === 'cli' || value === 'providers') onTabChange(value); }} className="gap-0">
    <TabsList variant="line" aria-label="模型与提供商" className="mb-4 h-10 w-full justify-start border-b border-[var(--mm-border-stone-200)] p-0 group-data-[orientation=horizontal]/tabs:h-10">
      <TabsTrigger value="providers" id={`${id}-api-tab`} aria-controls={`${id}-api-panel`} className={tabClass}>模型 API</TabsTrigger>
      <TabsTrigger value="cli" id={`${id}-cli-tab`} aria-controls={`${id}-cli-panel`} className={tabClass}>本机 Agent{cliCount > 0 ? `（${cliCount}）` : ''}</TabsTrigger>
    </TabsList>
    <TabsContent forceMount value="providers" id={`${id}-api-panel`} aria-labelledby={`${id}-api-tab`} hidden={tab !== 'providers'}>{api}</TabsContent>
    <TabsContent forceMount value="cli" id={`${id}-cli-panel`} aria-labelledby={`${id}-cli-tab`} hidden={tab !== 'cli'}>{agents}</TabsContent>
  </Tabs>;
}
