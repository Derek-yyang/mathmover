import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, PanelLeft, Pencil, Plus, Search, Trash2 } from 'lucide-react';

type Courseware = { id: string; title: string; createdAt: string };
type Editor = { kind: 'create' } | { kind: 'rename' | 'delete'; item: Courseware };

export function CoursewareLibrary({ open, onClose, currentId, managementToken, beforeLeave, onRename }: {
  open: boolean;
  onClose: () => void;
  currentId: string;
  managementToken: string;
  beforeLeave: () => Promise<boolean>;
  onRename: (title: string) => void;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Courseware[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editError, setEditError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState('');

  async function request<T>(suffix = '', init: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/canvases${suffix}`, {
      ...init,
      headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '课件操作失败，请重试。');
    return body as T;
  }

  useEffect(() => {
    if (open) panel.current?.showModal();
    else panel.current?.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void request<Courseware[]>('', { signal: controller.signal }).then(setItems).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, managementToken]);

  useEffect(() => {
    if (editing) {
      editor.current?.showModal();
      input.current?.select();
    } else editor.current?.close();
  }, [editing]);

  function begin(value: Editor) {
    setName(value.kind === 'rename' ? value.item.title : '');
    setEditError('');
    setEditing(value);
  }

  function navigate(url: string) {
    const target = new URL(url, location.origin);
    if (target.origin !== location.origin || !/^\/canvas\/[a-f0-9-]{36}$/.test(target.pathname)) throw new Error('课件地址无效');
    location.assign(target.href);
  }

  async function select(item: Courseware) {
    if (busy) return;
    if (item.id === currentId) { onClose(); return; }
    setBusy(true);
    setOpeningId(item.id);
    setError('');
    try {
      if (!await beforeLeave()) throw new Error('当前课件尚未保存成功，请重试后再切换。');
      const result = await request<{ url: string }>(`/${item.id}`, { method: 'POST', body: '{}' });
      navigate(result.url);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); setOpeningId(''); }
  }

  async function submit() {
    if (!editing || busy) return;
    setBusy(true);
    setEditError('');
    try {
      if (editing.kind === 'rename') {
        const result = await request<Courseware>(`/${editing.item.id}`, { method: 'PATCH', body: JSON.stringify({ title: name }) });
        setItems(items => items.map(item => item.id === result.id ? result : item));
        if (result.id === currentId) onRename(result.title);
        setEditing(null);
      } else if (editing.kind === 'create') {
        if (!await beforeLeave()) throw new Error('当前课件尚未保存成功，请重试后再新建。');
        const result = await request<{ url: string }>('', { method: 'POST', body: JSON.stringify({ title: name }) });
        navigate(result.url);
      } else {
        let nextUrl: string | undefined;
        if (editing.item.id === currentId) {
          if (!await beforeLeave()) throw new Error('当前课件尚未保存成功，请重试后再删除。');
          const next = items.find(item => item.id !== currentId);
          const result = await request<{ url: string }>(next ? `/${next.id}` : '', { method: 'POST', body: '{}' });
          nextUrl = result.url;
        }
        await request(`/${editing.item.id}`, { method: 'DELETE' });
        setItems(items => items.filter(item => item.id !== editing.item.id));
        setEditing(null);
        if (nextUrl) navigate(nextUrl);
      }
    } catch (error) { setEditError((error as Error).message); }
    finally { setBusy(false); }
  }

  const filtered = items.filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <dialog ref={panel} id="courseware-library" className="library-panel" aria-labelledby="library-heading" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }} onClick={event => {
      if (event.target !== panel.current || busy) return;
      const rect = panel.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
      <div className="library-heading"><h2 id="library-heading">课件</h2><button aria-label="收起课件栏" title="收起课件栏" aria-controls="courseware-library" aria-expanded={open} disabled={busy} onClick={onClose}><PanelLeft size={18} aria-hidden="true" /></button></div>
      <button className="library-new" disabled={busy} onClick={() => begin({ kind: 'create' })}><Plus size={17} />新建课件</button>
      <label className="library-search"><Search size={15} /><input aria-label="搜索课件" placeholder="搜索课件" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="library-caption"><span>本地课件</span><span>{items.length} 份</span></div>
      {error && <p className="library-error" role="alert">{error}</p>}
      <nav className="library-list" aria-label="已保存课件" aria-busy={loading}>
        {loading ? <p className="library-empty" role="status">正在读取课件…</p> : filtered.map(item => <div key={item.id} className={`library-row ${item.id === currentId ? 'current' : ''}`}>
          <button className="library-select" disabled={busy} aria-current={item.id === currentId ? 'page' : undefined} onClick={() => void select(item)} title={item.title}>
            <span className="library-item-title">{item.title}</span><span className="library-item-date">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
            {openingId === item.id ? <LoaderCircle className="spinner library-current-icon" size={14} /> : item.id === currentId && <Check className="library-current-icon" size={14} />}
          </button>
          <div className="library-row-actions"><button disabled={busy} aria-label={`重命名 ${item.title}`} title="重命名" onClick={() => begin({ kind: 'rename', item })}><Pencil size={14} /></button><button disabled={busy} aria-label={`删除 ${item.title}`} title="删除" onClick={() => begin({ kind: 'delete', item })}><Trash2 size={14} /></button></div>
        </div>)}
        {!loading && !filtered.length && <p className="library-empty">{query ? '没有找到匹配的课件，试试其他名称。' : '新建一份课件，再让 Agent 帮你构图。'}</p>}
      </nav>
    </dialog>
    <dialog ref={editor} className="library-editor" aria-labelledby="library-editor-heading" aria-describedby={editing?.kind === 'delete' ? 'library-delete-description' : undefined} onCancel={event => { if (busy) event.preventDefault(); else setEditing(null); }}>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <h2 id="library-editor-heading">{editing?.kind === 'delete' ? '删除课件？' : editing?.kind === 'rename' ? '重命名课件' : '新建课件'}</h2>
        {editing?.kind === 'delete' ? <p id="library-delete-description">“{editing.item.title}”将从列表中移除，原文件会保留在本机的 MathMover MCP 回收目录。</p> : <label className="library-name-label">课件名称<input ref={input} aria-label="课件名称" autoFocus required maxLength={100} placeholder="例如：椭圆与动点" value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>}
        {editError && <p className="library-error" role="alert">{editError}</p>}
        <div className="library-editor-actions"><button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button type="submit" className={editing?.kind === 'delete' ? 'danger' : 'primary'} disabled={busy || (editing?.kind !== 'delete' && !name.trim())}>{busy && <LoaderCircle size={14} className="spinner" />}{editing?.kind === 'delete' ? '删除课件' : editing?.kind === 'rename' ? '保存名称' : '创建课件'}</button></div>
      </form>
    </dialog>
  </>;
}
