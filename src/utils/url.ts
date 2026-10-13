const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isAbsoluteUrl(value: string): boolean {
  return ABSOLUTE_URL.test(value) || value.startsWith('//');
}

/**
 * Join a base URL and a path. An absolute `path` wins over `base`, matching
 * axios and ky, so `client.get('https://other.example/x')` works on a client
 * that has a baseUrl.
 */
export function joinUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  if (!path) return base;
  if (isAbsoluteUrl(path)) return path;
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function appendQueryString(url: string, queryString: string): string {
  if (!queryString) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryString}`;
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
