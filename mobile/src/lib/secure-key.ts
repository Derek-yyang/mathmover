import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const KEY = 'apiKey';

/**
 * 原生端用系统安全存储（Android Keystore）；Web 开发时只放 sessionStorage，
 * 避免把 Key 明文写进 localStorage。
 */
export async function loadApiKey(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return sessionStorage.getItem(KEY) ?? '';
  try {
    const { value } = await SecureStoragePlugin.get({ key: KEY });
    return value ?? '';
  } catch {
    return '';
  }
}

export async function saveApiKey(value: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
    return;
  }
  if (!value) {
    try {
      await SecureStoragePlugin.remove({ key: KEY });
    } catch {
      // 没有旧 Key 时忽略。
    }
    return;
  }
  await SecureStoragePlugin.set({ key: KEY, value });
}
