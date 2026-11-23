'use client';

import { useEffect, useState } from 'react';
import { desktopBridge } from '@/lib/desktop-bridge';
import { useAgentRuntimeState } from './AgentRuntimeState';
import { hasReleaseNotes, ReleaseNotesDialog } from './ReleaseNotesDialog';
import { RELEASE_NOTES_SEEN_EVENT } from '@/lib/release-notes';

/** Mounted once for the dashboard, outside retained courseware workspaces. */
export function ReleaseNotesHost() {
  const [version, setVersion] = useState('');
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const { busy } = useAgentRuntimeState();
  useEffect(() => {
    const acknowledge = (event: Event) => {
      if ((event as CustomEvent<string>).detail === version) setPending(false);
    };
    window.addEventListener(RELEASE_NOTES_SEEN_EVENT, acknowledge);
    return () => window.removeEventListener(RELEASE_NOTES_SEEN_EVENT, acknowledge);
  }, [version]);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.getReleaseNotesState) return;
    let active = true;
    void bridge.getReleaseNotesState().then(state => {
      if (!active) return;
      if (state.onboarding) {
        // Setup takes priority on a new installation, including after refresh.
        void bridge.acknowledgeReleaseNotes?.(state.version).catch(() => {});
        return;
      }
      if (state.shouldShow && hasReleaseNotes(state.version)) {
        setVersion(state.version);
        setPending(true);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!pending || busy) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.querySelector('[data-mm-modal-overlay]')) {
        clearTimeout(timer);
        timer = undefined;
        return;
      }
      if (timer !== undefined) return;
      timer = setTimeout(() => { setPending(false); setOpen(true); }, 800);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true });
    schedule();
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [pending, busy]);
  return <ReleaseNotesDialog open={open} version={version} onOpenChange={setOpen} />;
}
