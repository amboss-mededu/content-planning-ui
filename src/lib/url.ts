const SAFE_PROTOCOL = /^https?:\/\//i;

export function isSafeUrl(url: string): boolean {
  return SAFE_PROTOCOL.test(url.trim());
}
