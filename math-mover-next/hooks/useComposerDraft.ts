'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { ThreadComposerRuntime } from '@assistant-ui/react';
import { ComposerDrafts } from '@/lib/composer-drafts';

export function useComposerDraft(composer: ThreadComposerRuntime, drafts: ComposerDrafts, id: string) {
  const restoredComposer = useRef<ThreadComposerRuntime | null>(null);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    let cancelled = false;
    if (restoredComposer.current !== composer) {
      restoredComposer.current = composer;
      const draft = drafts.get(id);
      composer.setText(draft?.text ?? '');
      for (const attachment of draft?.attachments ?? []) {
        // Ready previews use the official descriptor API without rereading files.
        // An image still being read can resume from its original File.
        const source = attachment.content?.length ? {
          id: attachment.id, type: attachment.type, name: attachment.name,
          contentType: attachment.contentType, content: attachment.content,
        } : attachment.file;
        if (source) void composer.addAttachment(source).catch(cause => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : '草稿图片恢复失败，请重新添加。');
        });
      }
    }
    const save = () => drafts.save(id, composer.getState());
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
