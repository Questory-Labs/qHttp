import { QHttpError } from '../errors/qhttp-error.js';

const MACRO_PATTERN = /\{\{\s*([\w.$-]+)\s*\}\}/g;

export function resolveMacros(
  template: string,
  macros: Record<string, string | number>,
  options: { strict?: boolean } = {},
): string {
  const unresolved = new Set<string>();

  const resolved = template.replace(MACRO_PATTERN, (_match, key: string) => {
    if (!(key in macros)) {
      unresolved.add(key);
      return `{{${key}}}`;
    }
    return encodeURIComponent(String(macros[key]));
  });

  if (options.strict && unresolved.size > 0) {
    throw new QHttpError(`Unresolved URL macro(s): ${[...unresolved].join(', ')}`, {
      code: 'MISSING_URL_MACRO',
    });
  }

  return resolved;
}

export function findUnresolvedMacros(value: string): string[] {
  const unresolved: string[] = [];
  const pattern = new RegExp(MACRO_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    unresolved.push(match[1]!);
  }
  return unresolved;
}

export function hasUnresolvedMacros(value: string): boolean {
  return findUnresolvedMacros(value).length > 0;
}
