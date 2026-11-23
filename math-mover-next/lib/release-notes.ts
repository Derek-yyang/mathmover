import { desktopBridge } from './desktop-bridge';

export const RELEASE_NOTES_SEEN_EVENT = 'mathmover_release_notes_seen';

export function acknowledgeReleaseNotes(version: string) {
  window.dispatchEvent(new CustomEvent(RELEASE_NOTES_SEEN_EVENT, { detail: version }));
  void desktopBridge()?.acknowledgeReleaseNotes?.(version).catch(() => {});
}
