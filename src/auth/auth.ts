import type { AuthConfig, RequestContext } from '../core/types.js';
import { setHeader } from '../utils/headers.js';

export function toBase64(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf-8').toString('base64');
  }
  throw new Error('No base64 encoder available');
}

export function applyAuth(ctx: RequestContext, auth?: AuthConfig): RequestContext {
  if (!auth) return ctx;

  if (auth.type === 'bearer') {
    setHeader(ctx.headers, 'authorization', `Bearer ${auth.token}`);
  }

  if (auth.type === 'basic') {
    const encoded = toBase64(`${auth.username}:${auth.password}`);
    setHeader(ctx.headers, 'authorization', `Basic ${encoded}`);
  }

  return ctx;
}

export function createAuthPreRequestHook(auth?: AuthConfig) {
  return (ctx: RequestContext) => applyAuth(ctx, auth);
}
