import type { QHttp } from '../core/QHttp.js';

/**
 * Build a resource load function from a configured QHttp client (GET).
 * Errors propagate unchanged: a `QHttpError` keeps its `code`, `httpStatus`
 * (also readable as `status`) and parsed body.
 */
export function loadFromRequest<T>(client: QHttp): () => Promise<T> {
  return async () => {
    const result = await client.get<T>();
    return result.data;
  };
}
