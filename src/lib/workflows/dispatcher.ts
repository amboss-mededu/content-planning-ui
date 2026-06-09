import 'server-only';

/**
 * Article-writing dispatcher.
 *
 * Singleton in-process loop that drains the `articleWritingRuns`
 * queue under bounded concurrency. Started by `instrumentation.ts`
 * once per Node process (and again after dev HMR — the guard below
 * makes that idempotent).
 *
 * Why this exists: bulk-launching N writing runs via the route would
 * fan out N parallel `writeArticleWorkflow` promises — each one
 * hammers the LLM provider's per-minute rate limits and inflates the
 * cost line. The dispatcher takes the same fire-and-forget pattern
 * but throttles it to `MAX_CONCURRENT` actually-running runs at any
 * given moment.
 *
 * Pickup mechanism: every `POLL_MS` the loop lists queued runs and
 * tries to claim the oldest ones up to the available slot count.
 * Claim is optimistic — `claimQueuedWritingRunAsAdmin` rejects rows
 * whose status changed since we read them, so two processes racing
 * for the same run won't both run it.
 *
 * On startup: any rows the previous process left as `running` are
 * reaped to `failed` with `errorMessage='process_restart'`. The
 * editor retries via the row's "Re-run" button — there is no
 * mid-pass resume.
 */

import { env } from '@/env';
import { listArticleSourcesForArticleAsAdmin } from '@/lib/data/article-sources';
import {
  claimQueuedWritingRunAsAdmin,
  listQueuedWritingRunsAsAdmin,
  reapStuckWritingRunsAsAdmin,
  updateWritingRunAsAdmin,
} from '@/lib/data/article-writing';
import { getNewArticleSuggestionByIdAsAdmin } from '@/lib/data/articles';
import { getKeyForUserAsAdmin } from '@/lib/data/user-api-keys';
import { log } from '@/lib/log';
import type { ArticleWritingRunRecord } from '@/lib/pb/types';
import type { ModelSpec, ProviderApiKeys, ProviderId, ReasoningLevel } from './lib/llm';
import { writeArticleWorkflow } from './writing/write-article';

export const MAX_CONCURRENT = 3;
const POLL_MS = 5000;

type DispatcherState = {
  started: boolean;
  inFlight: Set<string>;
  pollTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
};

// Module-level singleton. Re-import after HMR re-uses the same object,
// so we don't spawn a second loop in dev.
const G = globalThis as unknown as { __writingDispatcher?: DispatcherState };
function getState(): DispatcherState {
  if (!G.__writingDispatcher) {
    G.__writingDispatcher = {
      started: false,
      inFlight: new Set<string>(),
      pollTimer: null,
      stopped: false,
    };
  }
  return G.__writingDispatcher;
}

const ENV_BY_PROVIDER: Record<ProviderId, string | undefined> = {
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
};

async function resolveKeysForRun(
  run: ArticleWritingRunRecord,
  providers: readonly ProviderId[],
): Promise<ProviderApiKeys> {
  const out: ProviderApiKeys = {};
  for (const p of providers) {
    let key: string | null = null;
    if (run.requestedByUserId) {
      key = await getKeyForUserAsAdmin({ userId: run.requestedByUserId, provider: p });
    }
    const resolved = key ?? ENV_BY_PROVIDER[p];
    if (resolved) out[p] = resolved;
  }
  return out;
}

function reconstructModelSpec(run: ArticleWritingRunRecord): ModelSpec | null {
  if (
    run.modelProvider !== 'google' &&
    run.modelProvider !== 'anthropic' &&
    run.modelProvider !== 'openai'
  ) {
    return null;
  }
  if (!run.modelId) return null;
  const reasoning = (run.modelReasoning ?? 'auto') as ReasoningLevel;
  return {
    provider: run.modelProvider,
    model: run.modelId,
    reasoning,
  };
}

async function dispatchOne(run: ArticleWritingRunRecord): Promise<void> {
  const state = getState();
  state.inFlight.add(run.id);
  try {
    const claimed = await claimQueuedWritingRunAsAdmin(run.id);
    if (!claimed) return;

    const model = reconstructModelSpec(claimed);
    if (!model) {
      await updateWritingRunAsAdmin(claimed.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: `bad model spec on run: ${claimed.modelProvider}/${claimed.modelId}`,
      });
      return;
    }

    const apiKeys = await resolveKeysForRun(claimed, [model.provider, 'google']);
    if (!apiKeys[model.provider]) {
      await updateWritingRunAsAdmin(claimed.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: `MISSING_API_KEY: ${model.provider}`,
      });
      return;
    }

    const article = await getNewArticleSuggestionByIdAsAdmin(claimed.articleRecordId);
    const articleTitle = article?.articleTitle?.trim();
    if (!article || !articleTitle || article.specialtySlug !== claimed.specialtySlug) {
      await updateWritingRunAsAdmin(claimed.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: 'article missing or specialty mismatch at dispatch time',
      });
      return;
    }

    const sources = await listArticleSourcesForArticleAsAdmin(
      claimed.specialtySlug,
      claimed.articleRecordId,
    );

    await writeArticleWorkflow({
      runId: claimed.id,
      specialtySlug: claimed.specialtySlug,
      articleRecordId: claimed.articleRecordId,
      articleTitle,
      language: claimed.language ?? 'en',
      articleLength: claimed.articleLength ?? 'medium',
      useTextBubbles: claimed.useTextBubbles ?? true,
      sources,
      model,
      apiKeys,
      requestedByEmail: claimed.requestedByEmail ?? null,
    });
  } catch (e) {
    log('dispatcher').error('dispatch failed', run.id, e);
    await updateWritingRunAsAdmin(run.id, {
      status: 'failed',
      finishedAt: Date.now(),
      errorMessage: e instanceof Error ? e.message : String(e),
    }).catch(() => {});
  } finally {
    state.inFlight.delete(run.id);
  }
}

async function tick(): Promise<void> {
  const state = getState();
  if (state.stopped) return;
  try {
    const available = MAX_CONCURRENT - state.inFlight.size;
    if (available > 0) {
      const queued = await listQueuedWritingRunsAsAdmin(available + state.inFlight.size);
      let started = 0;
      for (const r of queued) {
        if (state.inFlight.has(r.id)) continue;
        if (started >= available) break;
        started++;
        void dispatchOne(r);
      }
    }
  } catch (e) {
    log('dispatcher').error('tick failed', e);
  } finally {
    if (!state.stopped) {
      state.pollTimer = setTimeout(tick, POLL_MS);
    }
  }
}

export async function startWritingDispatcher(): Promise<void> {
  const state = getState();
  if (state.started) return;
  state.started = true;
  state.stopped = false;
  try {
    const reaped = await reapStuckWritingRunsAsAdmin();
    if (reaped > 0) {
      log('dispatcher').info(`reaped ${reaped} stuck run(s) from previous process`);
    }
  } catch (e) {
    log('dispatcher').error('reap stuck failed', e);
  }
  log('dispatcher').info(`starting · max=${MAX_CONCURRENT} · poll=${POLL_MS}ms`);
  void tick();
}

export function stopWritingDispatcher(): void {
  const state = getState();
  state.stopped = true;
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  state.started = false;
}
