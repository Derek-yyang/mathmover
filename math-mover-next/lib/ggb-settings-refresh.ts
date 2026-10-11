interface SettingsApi {
  getPerspectiveXML?: () => string;
  setPerspective: (perspective: string) => void;
}

const panels = new WeakMap<object, { readWidth: () => number; width: number }>();
// The pinned bundle subtracts its dock splitter from the stored Properties size.
const SPLITTER_WIDTH = 8;

export function registerGgbSettingsPanel(api: object, readWidth: () => number) {
  const panel = { readWidth, width: 0 };
  panels.set(api, panel);
  return () => { if (panels.get(api) === panel) panels.delete(api); };
}

/** Update only the hidden panel's saved size. Replaying an open overlay's XML
 * can collapse its contents; the actual opening must go through native +P. */
export function perspectiveForSettingsReopen(xml: string, width: number): string | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  let updated = false;
  const result = xml.replace(/<view\b[^>]*>/g, tag => {
    if (!/\bid="4097"/.test(tag) || !/\bvisible="false"/.test(tag) || !/\bsize="[^"]+"/.test(tag)) return tag;
    updated = true;
    return tag.replace(/\bsize="[^"]+"/, `size="${Math.round(width) + SPLITTER_WIDTH}"`);
  });
  return updated ? result : null;
}

export function refreshGgbSettings(api: SettingsApi, open: boolean) {
  const panel = panels.get(api);
  if (!open || !panel || !api.getPerspectiveXML) return;
  const width = panel.readWidth();
  if (Number.isFinite(width) && width > 0) panel.width = width;
  // Rapid clicks can arrive before the native panel is reattached to the DOM.
  if (!panel.width) return;
  api.setPerspective('-P');
  try {
    const perspective = perspectiveForSettingsReopen(api.getPerspectiveXML(), panel.width);
    if (perspective) api.setPerspective(perspective);
  } finally {
    api.setPerspective('+P');
  }
}
