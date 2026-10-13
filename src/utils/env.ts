/** Safe read of NODE_ENV in browsers, edge and Node. */
export function isProduction(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.NODE_ENV === 'production';
}

export function warnDev(message: string): void {
  if (isProduction()) return;
  if (typeof console !== 'undefined') {
    console.warn(`[qhttp] ${message}`);
  }
}
