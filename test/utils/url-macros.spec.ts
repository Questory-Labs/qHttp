import { describe, expect, it } from 'vitest';
import { findUnresolvedMacros } from '../../src/utils/url-macros.js';

describe('url macros helpers', () => {
  it('finds unresolved macros', () => {
    expect(findUnresolvedMacros('/users/{{id}}/posts/{{postId}}')).toEqual(['id', 'postId']);
  });
});
