export interface WorkItem {
  id: string;
  title: string;
  commands: string[];
  updatedAt: number;
  thumbnail?: string;
}

export type ModelProtocol =
  | 'openai-responses'
  | 'openai-completions'
  | 'anthropic'
  | 'google';

export interface SettingsValue {
  protocol: ModelProtocol;
  baseURL: string;
  model: string;
  apiKey: string;
}

const DEFAULT_PROTOCOL: ModelProtocol = 'openai-completions';
export const STORAGE_PROTOCOL = 'mathmover:protocol';
export const STORAGE_BASE = 'mathmover:baseURL';
export const STORAGE_MODEL = 'mathmover:model';
const LAST_KEY = 'mathmover:last';

export function readProtocol(): ModelProtocol {
  const raw = localStorage.getItem(STORAGE_PROTOCOL);
  return raw === 'openai-responses' ||
    raw === 'openai-completions' ||
    raw === 'anthropic' ||
    raw === 'google'
    ? raw
    : DEFAULT_PROTOCOL;
}

const WORKS_KEY = 'mathmover:works';
const MAX_WORKS = 30;

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** 读取作品库；首次升级时把旧的单条“上次图形”迁移进来。 */
export function readWorks(): WorkItem[] {
  try {
    const raw = localStorage.getItem(WORKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkItem[] | null;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(item => item && typeof item.id === 'string' && Array.isArray(item.commands));
    }

    const legacy = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as {
      commands?: string[];
      updatedAt?: number;
    } | null;
    if (!legacy?.commands?.length) return [];

    const migrated: WorkItem = {
      id: newId(),
      title: '上次的图形',
      commands: legacy.commands,
      updatedAt: legacy.updatedAt ?? Date.now(),
    };
    localStorage.setItem(WORKS_KEY, JSON.stringify([migrated]));
    localStorage.removeItem(LAST_KEY);
    return [migrated];
  } catch {
    return [];
  }
}

function writeWorks(works: WorkItem[]): WorkItem[] {
  try {
    localStorage.setItem(WORKS_KEY, JSON.stringify(works));
  } catch (error) {
    console.warn('[works] save failed', error);
  }
  return works;
}

export function upsertWork(work: WorkItem): WorkItem[] {
  const next = [work, ...readWorks().filter(item => item.id !== work.id)].slice(0, MAX_WORKS);
  return writeWorks(next);
}

export function updateWorkTitle(id: string, title: string): WorkItem[] {
  return writeWorks(
    readWorks().map(item => (item.id === id ? { ...item, title } : item)),
  );
}

export function deleteWork(id: string): WorkItem[] {
  return writeWorks(readWorks().filter(item => item.id !== id));
}

export function timeAgo(timestamp: number) {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}
