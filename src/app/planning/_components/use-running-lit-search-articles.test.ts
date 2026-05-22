import { describe, expect, it } from 'vitest';
import type { ArticleLitSearchRunRecord } from '@/lib/pb/types';
import {
  deriveLitSearchSnapshot,
  latestLitSearchRunByArticleKey,
} from './use-running-lit-search-articles';

function run(input: {
  id: string;
  articleKey: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  errorMessage?: string;
}): ArticleLitSearchRunRecord {
  return {
    id: input.id,
    collectionId: 'articleLitSearchRuns',
    collectionName: 'articleLitSearchRuns',
    specialtySlug: 'cardiology',
    articleKey: input.articleKey,
    articleRecordId: 'article-1',
    status: input.status,
    startedAt: input.startedAt,
    errorMessage: input.errorMessage,
    created: '',
    updated: '',
  };
}

describe('lit-search run derivation', () => {
  it('uses the latest run per article key', () => {
    const latest = latestLitSearchRunByArticleKey([
      run({
        id: 'old',
        articleKey: 'new::cardiology::hf',
        status: 'failed',
        startedAt: 1,
      }),
      run({
        id: 'new',
        articleKey: 'new::cardiology::hf',
        status: 'running',
        startedAt: 2,
      }),
    ]);

    expect(latest.get('new::cardiology::hf')?.id).toBe('new');
  });

  it('running overrides backlog status through the in-flight set', () => {
    const snapshot = deriveLitSearchSnapshot([
      run({
        id: 'run-1',
        articleKey: 'new::cardiology::hf',
        status: 'running',
        startedAt: 1,
      }),
    ]);

    expect(snapshot.inFlight).toEqual(new Set(['new::cardiology::hf']));
    expect(snapshot.errors.size).toBe(0);
  });

  it('failed shows retry error when it is the latest run', () => {
    const snapshot = deriveLitSearchSnapshot([
      run({
        id: 'run-1',
        articleKey: 'new::cardiology::hf',
        status: 'failed',
        startedAt: 1,
        errorMessage: 'ranking returned 0 sources',
      }),
    ]);

    expect(snapshot.inFlight.size).toBe(0);
    expect(snapshot.errors.get('new::cardiology::hf')).toBe('ranking returned 0 sources');
  });

  it('completed clears in-progress and stale failure state', () => {
    const snapshot = deriveLitSearchSnapshot([
      run({
        id: 'run-1',
        articleKey: 'new::cardiology::hf',
        status: 'failed',
        startedAt: 1,
        errorMessage: 'ranking returned 0 sources',
      }),
      run({
        id: 'run-2',
        articleKey: 'new::cardiology::hf',
        status: 'completed',
        startedAt: 2,
      }),
    ]);

    expect(snapshot.inFlight.size).toBe(0);
    expect(snapshot.errors.size).toBe(0);
  });
});
