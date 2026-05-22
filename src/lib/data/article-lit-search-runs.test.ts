import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimArticleLitSearchRunWithClient } from './article-lit-search-runs-claim';

const create = vi.fn();
const getFirstListItem = vi.fn();

const pb = {
  collection: () => ({
    create,
    getFirstListItem,
  }),
};

function uniqueError() {
  const err = new Error('unique constraint failed') as Error & {
    status: number;
    response: unknown;
  };
  Object.setPrototypeOf(err, Error.prototype);
  err.status = 400;
  err.response = { message: 'unique constraint failed' };
  return err;
}

beforeEach(() => {
  create.mockReset();
  getFirstListItem.mockReset();
});

describe('claimArticleLitSearchRunWithClient', () => {
  it('creates a running claim when no run is active', async () => {
    create.mockResolvedValue({ id: 'claim-1', status: 'running' });
    const result = await claimArticleLitSearchRunWithClient(pb as never, {
      specialtySlug: 'cardiology',
      articleKey: 'new::cardiology::hf',
      articleRecordId: 'article-1',
    });

    expect(result).toMatchObject({ claimed: true, record: { id: 'claim-1' } });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        specialtySlug: 'cardiology',
        articleKey: 'new::cardiology::hf',
        articleRecordId: 'article-1',
        status: 'running',
      }),
    );
  });

  it('skips a duplicate claim while the article is running', async () => {
    create.mockRejectedValue(uniqueError());
    getFirstListItem.mockResolvedValue({ id: 'claim-1', status: 'running' });
    const result = await claimArticleLitSearchRunWithClient(pb as never, {
      specialtySlug: 'cardiology',
      articleKey: 'new::cardiology::hf',
      articleRecordId: 'article-1',
    });

    expect(result).toEqual({
      claimed: false,
      reason: 'already_running',
      record: { id: 'claim-1', status: 'running' },
    });
  });
});
