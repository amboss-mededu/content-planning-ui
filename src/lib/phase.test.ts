import { describe, expect, it } from 'vitest';
import { derivePhase } from './phase';

describe('derivePhase', () => {
  it('returns not_started when the specialty has no runs', () => {
    expect(derivePhase(null)).toBe('not_started');
    expect(derivePhase(undefined)).toBe('not_started');
  });

  it('maps run statuses onto phases', () => {
    expect(derivePhase({ status: 'running' })).toBe('preprocessing');
    expect(derivePhase({ status: 'awaiting_preprocessing_approval' })).toBe(
      'preprocessing',
    );
    expect(derivePhase({ status: 'mapping' })).toBe('mapping');
    expect(derivePhase({ status: 'consolidating' })).toBe('consolidating');
    expect(derivePhase({ status: 'completed' })).toBe('completed');
    expect(derivePhase({ status: 'failed' })).toBe('failed');
    expect(derivePhase({ status: 'cancelled' })).toBe('failed');
  });

  it('treats unknown statuses as not_started', () => {
    expect(derivePhase({ status: 'definitely-not-a-status' })).toBe('not_started');
  });
});
