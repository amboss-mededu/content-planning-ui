import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runLiteratureSearch } from './run';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/data/article-backlog', () => ({
  setArticleBacklogStatusAsAdmin: vi.fn(),
}));
vi.mock('@/lib/data/article-lit-search-runs', () => ({
  finishArticleLitSearchRunAsAdmin: vi.fn(),
}));
vi.mock('@/lib/data/article-sources', () => ({
  bulkInsertArticleSourcesAsAdmin: vi.fn(),
}));
vi.mock('../lib/db-writes', () => ({
  markStageCompleted: vi.fn(),
  markStageFailed: vi.fn(),
  markStageRunning: vi.fn(),
  updatePipelineRunStatus: vi.fn(),
}));
vi.mock('../lib/events', () => ({
  aggregateStageMetrics: vi.fn(async () => ({})),
  logEvent: vi.fn(),
}));
vi.mock('./llm-calls', () => ({
  generateSearchQueries: vi.fn(),
  rankCandidates: vi.fn(),
}));
vi.mock('./pubmed', () => ({
  fetchPubmedCandidates: vi.fn(),
}));

import { setArticleBacklogStatusAsAdmin } from '@/lib/data/article-backlog';
import { finishArticleLitSearchRunAsAdmin } from '@/lib/data/article-lit-search-runs';
import { bulkInsertArticleSourcesAsAdmin } from '@/lib/data/article-sources';
import { updatePipelineRunStatus } from '../lib/db-writes';
import { generateSearchQueries, rankCandidates } from './llm-calls';
import { fetchPubmedCandidates } from './pubmed';

const article = {
  id: 'article-1',
  articleKey: 'new::cardiology::hf',
  articleTitle: 'Heart failure',
  litSearchRunId: 'lit-run-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runLiteratureSearch', () => {
  it('fails the article and keeps backlog unchanged when ranking returns no sources', async () => {
    vi.mocked(generateSearchQueries).mockResolvedValue(['heart failure review']);
    vi.mocked(fetchPubmedCandidates).mockResolvedValue([
      {
        pmid: '1',
        title: 'Candidate',
        authors: [],
        journal: 'Journal',
        url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
      },
    ]);
    vi.mocked(rankCandidates).mockResolvedValue([]);

    await runLiteratureSearch({
      runId: 'run-1',
      specialtySlug: 'cardiology',
      articles: [article],
      apiKeys: { google: 'key' },
    });

    expect(setArticleBacklogStatusAsAdmin).not.toHaveBeenCalled();
    expect(finishArticleLitSearchRunAsAdmin).toHaveBeenCalledWith('lit-run-1', {
      status: 'failed',
      errorMessage: 'ranking returned 0 sources',
      queryCount: 1,
      candidateCount: 1,
      sourcesCount: 0,
    });
    expect(updatePipelineRunStatus).toHaveBeenLastCalledWith(
      'run-1',
      'failed',
      'Literature search failed for all 1 article(s).',
    );
  });

  it('completes the article and advances backlog when sources are inserted', async () => {
    vi.mocked(generateSearchQueries).mockResolvedValue(['heart failure review']);
    vi.mocked(fetchPubmedCandidates).mockResolvedValue([
      {
        pmid: '1',
        title: 'Candidate',
        authors: [],
        journal: 'Journal',
        url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
      },
    ]);
    vi.mocked(rankCandidates).mockResolvedValue([
      {
        title: 'Ranked source',
        rank: 1,
      },
    ]);
    vi.mocked(bulkInsertArticleSourcesAsAdmin).mockResolvedValue(1);

    await runLiteratureSearch({
      runId: 'run-1',
      specialtySlug: 'cardiology',
      articles: [article],
      apiKeys: { google: 'key' },
    });

    expect(setArticleBacklogStatusAsAdmin).toHaveBeenCalledWith(
      'cardiology',
      'new::cardiology::hf',
      'article-1',
      'sources-searched',
      null,
    );
    expect(finishArticleLitSearchRunAsAdmin).toHaveBeenCalledWith('lit-run-1', {
      status: 'completed',
      queryCount: 1,
      candidateCount: 1,
      sourcesCount: 1,
    });
    expect(updatePipelineRunStatus).toHaveBeenLastCalledWith('run-1', 'completed');
  });
});
