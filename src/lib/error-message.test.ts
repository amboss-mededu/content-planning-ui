import { describe, expect, it } from 'vitest';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('returns the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('passes strings through', () => {
    expect(errorMessage('plain failure')).toBe('plain failure');
  });

  it('stringifies non-Error throwables', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage({ code: 'X' })).toBe('[object Object]');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
