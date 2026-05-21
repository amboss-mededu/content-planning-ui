import { act, renderHook, waitFor } from '@testing-library/react';
import type { RecordModel, RecordSubscription } from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFilteredEvent,
  snapshotToken,
  useLiveCollection,
} from './use-live-collection';

type TestRecord = RecordModel & {
  id: string;
  specialtySlug?: string;
  articleKey?: string;
  status?: string;
  updated?: string;
};

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
}));

vi.mock('./browser', () => ({
  getBrowserClient: () => ({
    collection: () => ({
      subscribe: mocks.subscribe,
    }),
  }),
}));

function record(input: {
  id: string;
  specialtySlug?: string;
  articleKey?: string;
  status?: string;
  updated?: string;
}): TestRecord {
  return { collectionId: 'test', collectionName: 'test', ...input };
}

function event(
  action: RecordSubscription<TestRecord>['action'],
  record: TestRecord,
): RecordSubscription<TestRecord> {
  return { action, record };
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.subscribe.mockReset();
});

describe('useLiveCollection', () => {
  it('preserves locally-applied realtime rows when the same initial reference is passed again', async () => {
    let onEvent: ((e: RecordSubscription<TestRecord>) => void) | undefined;
    mocks.subscribe.mockImplementation(
      (_topic: string, cb: (e: RecordSubscription<TestRecord>) => void) => {
        onEvent = cb;
        return Promise.resolve(() => {});
      },
    );

    // Pass the SAME `initial` array reference across rerenders so the
    // reseed branch is gated only on the snapshot token. Realtime-added
    // rows should survive identical-reference rerenders — that's the
    // "no in-place mutation" case where the snapshot-token fallback
    // protects the hook from wiping live state on every parent render.
    const stableInitial: TestRecord[] = [];

    const { result, rerender } = renderHook(
      ({ initial }) => useLiveCollection<TestRecord>('articleReviews', initial),
      { initialProps: { initial: stableInitial } },
    );

    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());

    act(() => {
      onEvent?.(event('create', record({ id: 'review-1', updated: '1' })));
    });
    expect(result.current.map((r) => r.id)).toEqual(['review-1']);

    rerender({ initial: stableInitial });

    expect(result.current.map((r) => r.id)).toEqual(['review-1']);
  });

  it('reseeds from initial when the parent passes a new array reference (RSC refresh)', async () => {
    let onEvent: ((e: RecordSubscription<TestRecord>) => void) | undefined;
    mocks.subscribe.mockImplementation(
      (_topic: string, cb: (e: RecordSubscription<TestRecord>) => void) => {
        onEvent = cb;
        return Promise.resolve(() => {});
      },
    );

    const { result, rerender } = renderHook(
      ({ initial }) => useLiveCollection<TestRecord>('articleReviews', initial),
      { initialProps: { initial: [] as TestRecord[] } },
    );

    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());

    act(() => {
      onEvent?.(event('create', record({ id: 'tmp-1', updated: '1' })));
    });
    expect(result.current.map((r) => r.id)).toEqual(['tmp-1']);

    // A new array reference (different identity) means the parent
    // re-fetched server state. Reseed from the new initial; realtime
    // rows that arrived between renders are intentionally wiped — the
    // server is authoritative, and PB realtime is dead for anonymous
    // browser clients across this app anyway.
    rerender({ initial: [] });

    expect(result.current.map((r) => r.id)).toEqual([]);
  });

  it('replaces stale local rows when the refreshed server snapshot changes', async () => {
    mocks.subscribe.mockResolvedValue(() => {});
    const initial = [record({ id: 'review-1', status: 'approved', updated: '1' })];
    const refreshed = [record({ id: 'review-1', status: 'rejected', updated: '2' })];

    const { result, rerender } = renderHook(
      ({ initial }) => useLiveCollection<TestRecord>('articleReviews', initial),
      { initialProps: { initial } },
    );

    expect(result.current[0]?.status).toBe('approved');

    rerender({ initial: refreshed });

    await waitFor(() => expect(result.current[0]?.status).toBe('rejected'));
  });

  it('logs subscribe failures instead of hiding auth-gated realtime issues', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('forbidden');
    mocks.subscribe.mockRejectedValue(error);

    renderHook(() =>
      useLiveCollection<TestRecord>('articleReviews', [], {
        filter: 'specialtySlug = "cardiology"',
      }),
    );

    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith('PocketBase realtime subscribe failed', {
      collection: 'articleReviews',
      filter: 'specialtySlug = "cardiology"',
      error,
    });
  });
});

describe('snapshotToken', () => {
  it('uses ordered row id and updated values as the stable server snapshot token', () => {
    expect(
      snapshotToken([
        record({ id: 'a', updated: '1' }),
        record({ id: 'b', updated: '2' }),
      ]),
    ).toBe('a:1|b:2');
  });
});

describe('applyFilteredEvent', () => {
  it('removes an existing row on sparse delete events even when filter fields are missing', () => {
    const current: TestRecord[] = [
      record({
        id: 'review-1',
        specialtySlug: 'cardiology',
        articleKey: 'new::cardiology::heart-failure',
        status: 'approved',
      }),
    ];

    const next = applyFilteredEvent(
      current,
      event('delete', record({ id: 'review-1' })),
      'specialtySlug = "cardiology"',
    );

    expect(next).toEqual([]);
  });

  it('ignores non-matching creates that were not already present locally', () => {
    const next = applyFilteredEvent(
      [],
      event(
        'create',
        record({
          id: 'review-2',
          specialtySlug: 'neurology',
          articleKey: 'new::neurology::seizure',
        }),
      ),
      'specialtySlug = "cardiology"',
    );

    expect(next).toEqual([]);
  });

  it('removes an existing row when an update moves it out of the active filter', () => {
    const current: TestRecord[] = [
      record({
        id: 'review-1',
        specialtySlug: 'cardiology',
        articleKey: 'new::cardiology::heart-failure',
      }),
    ];

    const next = applyFilteredEvent(
      current,
      event(
        'update',
        record({
          id: 'review-1',
          specialtySlug: 'neurology',
          articleKey: 'new::neurology::seizure',
        }),
      ),
      'specialtySlug = "cardiology"',
    );

    expect(next).toEqual([]);
  });
});
