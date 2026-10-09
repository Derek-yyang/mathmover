"use client";

/**
 * 本地历史存储（去 SaaS 化）：
 * 以 localStorage 替代原 Supabase generations 表 + Storage。
 * 历史条目结构与原表对齐，另加 thumbnail（小尺寸 dataURL）用于侧栏缩略图。
 * localStorage 配额约 5MB，缩略图务必压缩；完整题图不落盘。
 */

export interface GenerationRecord {
  id: string;
  title: string;
  problem_type: string | null;
  category: string | null;
  commands: string[];
  created_at: string;
  thumbnail?: string; // 小尺寸 dataURL，可为空
  router_meta?: Record<string, unknown> | null; // 路由后端元数据
  messages?: any[]; // 完整多轮对话记录
}

const KEY = "mathmover_generations_v1";
const MAX_RECORDS = 50;

function readAll(): GenerationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GenerationRecord[]) : [];
  } catch (e) {
    console.error("读取本地历史失败:", e);
    return [];
  }
}

// 清洗消息中的附件，防止超大 raw base64 撑爆 localStorage 配额
function sanitizeRecordForStorage(record: GenerationRecord): GenerationRecord {
  if (!record.messages || !Array.isArray(record.messages)) return record;

  const sanitizedMessages = record.messages.map((msg) => {
    if (!msg.attachments || !Array.isArray(msg.attachments)) return msg;
    const sanitizedAttachments = msg.attachments.map((att: any) => {
      // 避免存入巨型 blob: 或超大 base64 字符串（超过 100KB）
      const isTooLarge = typeof att.url === 'string' && att.url.length > 100 * 1024;
      return {
        id: att.id,
        name: att.name,
        contentType: att.contentType,
        url: isTooLarge ? (record.thumbnail || '') : att.url,
      };
    });
    return { ...msg, attachments: sanitizedAttachments };
  });

  return { ...record, messages: sanitizedMessages };
}

function writeAll(records: GenerationRecord[]): void {
  if (typeof window === "undefined") return;
  const sanitized = records.slice(0, MAX_RECORDS).map(sanitizeRecordForStorage);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sanitized));
    window.dispatchEvent(new CustomEvent("mathmover_generations_changed"));
  } catch (e) {
    // 配额溢出：丢弃最旧的一半再试一次
    try {
      const trimmed = sanitized.slice(0, Math.floor(MAX_RECORDS / 2));
      window.localStorage.setItem(KEY, JSON.stringify(trimmed));
      window.dispatchEvent(new CustomEvent("mathmover_generations_changed"));
    } catch {
      console.error("本地历史保存失败（配额不足）:", e);
    }
  }
}

export function listGenerations(): GenerationRecord[] {
  return readAll().sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getGeneration(id: string): GenerationRecord | undefined {
  return readAll().find((r) => r.id === id);
}

export function saveGeneration(
  record: Omit<GenerationRecord, "id" | "created_at"> & { id?: string }
): GenerationRecord {
  const now = new Date().toISOString();
  const full: GenerationRecord = {
    ...record,
    id: record.id || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: now,
  };
  const rest = readAll().filter((r) => r.id !== full.id);
  writeAll([full, ...rest]);
  return full;
}

export function updateGenerationTitle(id: string, title: string): void {
  writeAll(readAll().map((r) => (r.id === id ? { ...r, title } : r)));
}

export function deleteGenerations(ids: string[]): void {
  const set = new Set(ids);
  writeAll(readAll().filter((r) => !set.has(r.id)));
}

/** 订阅历史变化（跨组件同步用） */
export function onGenerationsChanged(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("mathmover_generations_changed", cb);
  return () => window.removeEventListener("mathmover_generations_changed", cb);
}

/** 把上传图压缩为小尺寸缩略图 dataURL（侧栏展示用，避免 localStorage 爆炸）。 */
export async function makeThumbnail(file: File, maxEdge = 96): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.65);
  } catch (e) {
    console.error("生成缩略图失败:", e);
    return undefined;
  }
}
