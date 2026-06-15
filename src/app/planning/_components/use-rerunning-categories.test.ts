import { describe, expect, it } from 'vitest';
import type { PipelineRunRecord } from '@/lib/pb/types';
import { applyPipelineRunRealtimeEvent } from './use-rerunning-categories';

const now = 1_800_000_000_000;

function run(
  overrides: Partial<PipelineRunRecord> & Pick<PipelineRunRecord, 'id'>,
): PipelineRunRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    collectionId: 'pipelineRuns',
    collectionName: 'pipelineRuns',
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
    specialtySlug: 'anesthesia',
    status: 'running',
    startedAt: now,
    updatedAt: now,
    mappingCheckIds: false,
    ...rest,
  };
}

describe('applyPipelineRunRealtimeEvent', () => {
  it('adds a running targeted run category', () => {
    const result = applyPipelineRunRealtimeEvent(
      [],
      {
        action: 'create',
        record: run({ id: 'run-1', targetCategories: ['Airway'] }),
      },
      'anesthesia',
      now,
    );

    expect(result.runs.map((r) => r.id)).toEqual(['run-1']);
    expect(result.settlements).toEqual([]);
  });

  it('removes a running-to-completed category and signals settlement metadata', () => {
    const previous = run({ id: 'run-1', targetCategories: ['Airway'] });

    const result = applyPipelineRunRealtimeEvent(
      [previous],
      {
        action: 'update',
        record: { ...previous, status: 'completed' },
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([
      { categories: ['Airway'], status: 'completed', runId: 'run-1', error: undefined },
    ]);
  });

  it('removes a running-to-failed category and signals error settlement metadata', () => {
    const previous = run({ id: 'run-1', targetCategories: ['Airway'] });

    const result = applyPipelineRunRealtimeEvent(
      [previous],
      {
        action: 'update',
        record: { ...previous, status: 'failed', error: 'Model failed' },
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([
      {
        categories: ['Airway'],
        status: 'failed',
        runId: 'run-1',
        error: 'Model failed',
      },
    ]);
  });

  it('signals missed-create terminal failed targeted updates', () => {
    const result = applyPipelineRunRealtimeEvent(
      [],
      {
        action: 'update',
        record: run({
          id: 'run-1',
          status: 'failed',
          targetCategories: ['Airway'],
          error: 'Run failed',
        }),
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([
      { categories: ['Airway'], status: 'failed', runId: 'run-1', error: 'Run failed' },
    ]);
  });

  it('signals cancelled settlement metadata', () => {
    const previous = run({ id: 'run-1', targetCategories: ['Airway'] });

    const result = applyPipelineRunRealtimeEvent(
      [previous],
      {
        action: 'update',
        record: { ...previous, status: 'cancelled', error: 'Cancelled by user' },
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([
      {
        categories: ['Airway'],
        status: 'cancelled',
        runId: 'run-1',
        error: 'Cancelled by user',
      },
    ]);
  });

  it('removes a deleted running category and signals settlement', () => {
    const previous = run({ id: 'run-1', targetCategories: ['Airway'] });

    const result = applyPipelineRunRealtimeEvent(
      [previous],
      {
        action: 'delete',
        record: previous,
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([
      { categories: ['Airway'], status: 'cancelled', runId: 'run-1', error: undefined },
    ]);
  });

  it('ignores stale running rows', () => {
    const result = applyPipelineRunRealtimeEvent(
      [],
      {
        action: 'create',
        record: run({
          id: 'run-1',
          // Older than the shared FRESH_RUNNING_MS window (15 min).
          startedAt: now - 16 * 60 * 1000,
          targetCategories: ['Airway'],
        }),
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([]);
  });

  it('ignores non-targeted full-specialty rows', () => {
    const result = applyPipelineRunRealtimeEvent(
      [],
      {
        action: 'create',
        record: run({ id: 'run-1' }),
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([]);
  });

  it('ignores non-targeted missed-create terminal rows', () => {
    const result = applyPipelineRunRealtimeEvent(
      [],
      {
        action: 'update',
        record: run({ id: 'run-1', status: 'failed', error: 'Full run failed' }),
      },
      'anesthesia',
      now,
    );

    expect(result.runs).toEqual([]);
    expect(result.settlements).toEqual([]);
  });
});
