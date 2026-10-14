export const OPEN_SETTINGS_EVENT = 'mathmover_open_settings';

export function openSettings() {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
}
