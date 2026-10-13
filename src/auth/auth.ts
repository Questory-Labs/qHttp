import type { AuthConfig, RequestContext } from '../core/types.js';
import { setHeader } from '../utils/headers.js';

export function toBase64(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  const B = (globalThis as { Buffer?: { from(v: string, e: string): { toString(e: string): string } } })
    .Buffer;
  if (B) {
    return B.from(value, 'utf-8').toString('base64');
  }
  throw new Error('No base64 encoder available');
}

/** Resolve a token source (static or provider). */
export async function resolveToken(
  token: string | (() => string | Promise<string>),
): Promise<string> {
  return typeof token === 'function' ? await token() : token;
}

export async function applyAuth(ctx: RequestContext, auth?: AuthConfig): Promise<RequestContext> {
  if (!auth) return ctx;

  if (auth.type === 'bearer') {
    const token = await resolveToken(auth.token);
    if (token) setHeader(ctx.headers, 'authorization', `Bearer ${token}`);
  } else if (auth.type === 'basic') {
    const encoded = toBase64(`${auth.username}:${auth.password}`);
    setHeader(ctx.headers, 'authorization', `Basic ${encoded}`);
  } else if (auth.type === 'custom') {
    await auth.apply(ctx);
  }

  return ctx;
}

export function createAuthPreRequestHook(auth?: AuthConfig) {
  return (ctx: RequestContext) => applyAuth(ctx, auth).then(() => undefined);
}
