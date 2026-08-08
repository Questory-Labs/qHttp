import { QHttpError } from '../errors/qhttp-error.js';
import type { QueryParams, QueryValue } from '../core/types.js';

export interface SerializeParamsOptions {
  sort?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, QueryValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function serializeValue(key: string, value: QueryValue, parts: string[]): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      serializeValue(key, item, parts);
    }
    return;
  }

  if (value instanceof Date) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.toISOString())}`);
    return;
  }

  if (isPlainObject(value)) {
    throw new QHttpError(`Cannot serialize nested object for query param "${key}"`, {
      code: 'UNSERIALIZABLE_PARAM',
    });
  }

  parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

export function serializeParams(
  params: QueryParams | undefined,
  options: SerializeParamsOptions = {},
): string {
  if (!params || Object.keys(params).length === 0) return '';

  const keys = options.sort ? Object.keys(params).sort() : Object.keys(params);
  const parts: string[] = [];

  for (const key of keys) {
    serializeValue(key, params[key], parts);
  }

  return parts.join('&');
}

export function mergeQueryParams(
  existing: QueryParams | undefined,
  incoming: QueryParams | undefined,
): QueryParams {
  return { ...existing, ...incoming };
}
