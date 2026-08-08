export function joinUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  if (!path) return base;
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function appendQueryString(url: string, queryString: string): string {
  if (!queryString) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${queryString}`;
}
