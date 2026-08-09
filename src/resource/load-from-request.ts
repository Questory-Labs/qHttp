import type { QHttp } from '../core/QHttp.js';
import { isQHttpError } from '../errors/qhttp-error.js';

/** Build a resource load function from a configured QHttp client (typically GET). */
export function loadFromRequest<T>(client: QHttp): () => Promise<T> {
  return async () => {
    try {
      const result = await client.get<T>();
      return result.data;
    } catch (err) {
      if (isQHttpError(err)) {
        const mapped = new Error(err.message) as Error & { status?: number };
        if (typeof err.httpStatus === 'number') mapped.status = err.httpStatus;
        throw mapped;
      }
      throw err;
    }
  };
}
