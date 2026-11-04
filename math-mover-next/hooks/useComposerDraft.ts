'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ThreadComposerRuntime } from '@assistant-ui/react';
import { ComposerDrafts, type ComposerDraft } from '@/lib/composer-drafts';

export function useComposerDraft(composer: ThreadComposerRuntime, drafts: ComposerDrafts, id: string) {
  const restoredComposer = useRef<ThreadComposerRuntime | null>(null);
  const recovering = useRef({ pending: new Map<string, ComposerDraft['attachments'][number]>(), inserted: new Set<string>() });
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    let cancelled = false;
    const needsRestore = restoredComposer.current !== composer;
    if (needsRestore) recovering.current = { pending: new Map(), inserted: new Set() };
    // Keep recovery bookkeeping through StrictMode's effect replay as well.
    const { pending, inserted } = recovering.current;
    const save = () => {
      const state = composer.getState();
      // A restored File is added asynchronously. A runtime replacement or a
      // quick second navigation must not replace its saved draft with the
      // partially restored composer in that gap.
      const missing = [...pending.values()].filter(attachment => {
        if (state.attachments.some(current => current.id === attachment.id || !!attachment.file && current.file === attachment.file)) inserted.add(attachment.id);
        // Once inserted, a later absence means the user removed it.
        return !inserted.has(attachment.id);
      });
      drafts.save(id, missing.length ? { text: state.text, attachments: [...state.attachments, ...missing] } : state);
    };
    if (needsRestore) {
      restoredComposer.current = composer;
      const draft = drafts.get(id);
      composer.setText(draft?.text ?? '');
      for (const attachment of draft?.attachments ?? []) pending.set(attachment.id, attachment);
      for (const attachment of draft?.attachments ?? []) {
        // Ready previews use the official descriptor API without rereading files.
        // An image still being read can resume from its original File.
        const source = attachment.content?.length ? {
          id: attachment.id, type: attachment.type, name: attachment.name,
          contentType: attachment.contentType, content: attachment.content,
        } : attachment.file;
        if (source) void composer.addAttachment(source).catch(cause => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : '草稿图片恢复失败，请重新添加。');
        }).finally(() => {
          pending.delete(attachment.id);
          if (!cancelled) save();
        });
        else pending.delete(attachment.id);
      }
    }
    save();
    const unsubscribe = composer.subscribe(save);
    return () => {
      cancelled = true;
      unsubscribe();
      save();
      // Fresh unsaved editors have no list entry to return to. A first save
      // adopts the database id while keeping the same live composer.
      if (id.startsWith('new:')) drafts.forget(id);
    };
  }, [composer, drafts, id]);

  return error;
}
