import type { ThreadComposerState } from '@assistant-ui/react';

export type ComposerDraft = Pick<ThreadComposerState, 'text' | 'attachments'>;

/** Page-lifetime drafts, separate from saved messages and browser storage. */
export class ComposerDrafts {
  private entries = new Map<string, ComposerDraft>();
  private deleted = new Set<string>();

  get(id: string) { return this.entries.get(id); }

  save(id: string, draft: ComposerDraft) {
    if (this.deleted.has(id)) return;
    if (!draft.text && !draft.attachments.length) { this.entries.delete(id); return; }
    const previous = this.entries.get(id);
    if (previous?.text === draft.text && previous.attachments === draft.attachments) return;
    // Keep immutable attachment references: never copy/encode images per keystroke.
    this.entries.set(id, { text: draft.text, attachments: draft.attachments });
  }

  forget(id: string) { this.entries.delete(id); }

  delete(ids: string[]) {
    for (const id of ids) {
      this.deleted.add(id);
      this.entries.delete(id);
    }
  }
}
