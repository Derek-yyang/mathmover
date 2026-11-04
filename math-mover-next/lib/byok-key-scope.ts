/** Saved credentials belong to one HTTP(S) origin, including scheme and port. */
export function sameByokKeyOrigin(previousUrl: string, nextUrl: string): boolean {
  try {
    const previous = new URL(previousUrl.trim());
    const next = new URL(nextUrl.trim());
    return [previous, next].every(url => ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      && previous.origin === next.origin;
  } catch {
    return false;
  }
}

export class ByokKeyScopeError extends Error {
  constructor() {
    super('API 端点已更换，请填写新地址对应的 API 密钥。');
    this.name = 'ByokKeyScopeError';
  }
}

/** null explicitly opts out of authentication; a blank field can only reuse a same-origin key. */
export function resolveByokKey(baseUrl: string, input: string | null | undefined, saved: { baseUrl: string; apiKey: string } | null): string {
  if (input === null) return '';
  if (input?.trim()) return input.trim();
  if (!saved?.apiKey) return '';
  if (!sameByokKeyOrigin(saved.baseUrl, baseUrl)) throw new ByokKeyScopeError();
  return saved.apiKey;
}
