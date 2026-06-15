import 'server-only';

import { cookies } from 'next/headers';
import { connection } from 'next/server';
import type PocketBase from 'pocketbase';
import { computeArticleKey, computeSectionKey } from '@/lib/data/article-keys';
import { errorMessage } from '@/lib/error-message';
import {
  type ContentChangeEvent,
  getContentChangeFeed,
  isStubContentChangeFeed,
} from '@/lib/integrations/content-change-feed';
import { log } from '@/lib/log';
import { createAdminClient, createServerClient } from '@/lib/pb/server';
import type {
  ArticleBacklogRecord,
  ArticleReviewRecord,
  CodeRecord,
  ConsolidatedArticleRecord,
  ConsolidatedSectionRecord,
  ContentChangeEventRecord,
  IntegrationStateRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';
import {
  buildDriftRefs,
  computeDriftImpacts,
  type DriftEventInput,
  type DriftImpact,
} from '@/lib/workflows/drift/drift-impacts';

async function userClient(): Promise<PocketBase> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  return createServerClient(cookieHeader);
}

const CURSOR_KEY = 'contentChangeFeedCursor';
/** Safety bound so a misbehaving feed (cursor never advancing) can't loop
 *  forever within one sync. */
const MAX_SYNC_PAGES = 50;

// --- Cursor persistence (integrationState) ---------------------------------

async function readCursorAsAdmin(pb: PocketBase): Promise<string | null> {
  try {
    const row = await pb
      .collection<IntegrationStateRecord>('integrationState')
      .getFirstListItem(pb.filter('key = {:k}', { k: CURSOR_KEY }));
    const value = row.value as { cursor?: unknown } | null;
    return typeof value?.cursor === 'string' ? value.cursor : null;
  } catch {
    return null;
  }
}

async function writeCursorAsAdmin(pb: PocketBase, cursor: string | null): Promise<void> {
  const payload = { key: CURSOR_KEY, value: { cursor } };
  try {
    const row = await pb
      .collection<IntegrationStateRecord>('integrationState')
      .getFirstListItem(pb.filter('key = {:k}', { k: CURSOR_KEY }));
    await pb.collection('integrationState').update(row.id, payload);
  } catch {
    await pb.collection('integrationState').create(payload);
  }
}

// --- Ingestion -------------------------------------------------------------

export type DriftSyncResult = {
  ingested: number;
  pages: number;
  cursor: string | null;
  /** True when no real feed is configured (no-op sync). */
  stub: boolean;
};

/**
 * Pull pages from the content-change feed starting at the persisted
 * cursor, upsert each event by `eventKey`, and save the new cursor.
 * Idempotent: a re-synced window updates the feed-owned fields but never
 * clobbers an event's `open`/`resolved` resolution state.
 */
export async function ingestContentChangesAsAdmin(): Promise<DriftSyncResult> {
  const pb = await createAdminClient();
  const feed = getContentChangeFeed();
  let cursor = await readCursorAsAdmin(pb);
  let pages = 0;
  let ingested = 0;

  while (pages < MAX_SYNC_PAGES) {
    const page = await feed.fetchChanges(cursor);
    pages += 1;
    for (const ev of dedupeByEventKey(page.events)) {
      await upsertEventAsAdmin(pb, ev);
      ingested += 1;
    }
    const next = page.nextCursor;
    // Stop when the feed is exhausted, returns nothing, or fails to
    // advance the cursor (the stub does the latter).
    if (!next || next === cursor || page.events.length === 0) {
      cursor = next ?? cursor;
      break;
    }
    cursor = next;
  }

  await writeCursorAsAdmin(pb, cursor);
  log('content-drift').info('ingestContentChanges', { ingested, pages, cursor });
  return { ingested, pages, cursor, stub: isStubContentChangeFeed() };
}

function dedupeByEventKey(events: ContentChangeEvent[]): ContentChangeEvent[] {
  const seen = new Set<string>();
  const out: ContentChangeEvent[] = [];
  for (const e of events) {
    if (seen.has(e.eventKey)) continue;
    seen.add(e.eventKey);
    out.push(e);
  }
  return out;
}

async function upsertEventAsAdmin(pb: PocketBase, ev: ContentChangeEvent): Promise<void> {
  const feedFields = {
    articleEid: ev.articleEid,
    sectionId: ev.sectionId ?? '',
    changeType: ev.changeType,
    newTitle: ev.newTitle ?? '',
    mergedIntoEid: ev.mergedIntoEid ?? '',
    occurredAt: ev.occurredAt,
    ingestedAt: Date.now(),
  };
  try {
    const existing = await pb
      .collection<ContentChangeEventRecord>('contentChangeEvents')
      .getFirstListItem(pb.filter('eventKey = {:k}', { k: ev.eventKey }));
    // Refresh feed-owned fields; preserve status / resolution.
    await pb.collection('contentChangeEvents').update(existing.id, feedFields);
  } catch {
    await pb.collection('contentChangeEvents').create({
      eventKey: ev.eventKey,
      status: 'open',
      ...feedFields,
    });
  }
}

// --- Reads -----------------------------------------------------------------

/** All open (unresolved) drift events, newest CMS change first. */
export async function listOpenDriftEvents(): Promise<ContentChangeEventRecord[]> {
  await connection();
  const pb = await userClient();
  return pb
    .collection<ContentChangeEventRecord>('contentChangeEvents')
    .getFullList({ filter: 'status = "open"', sort: '-occurredAt' });
}

function toEventInput(r: ContentChangeEventRecord): DriftEventInput {
  return {
    eventKey: r.eventKey,
    articleEid: r.articleEid,
    sectionId: r.sectionId || undefined,
    changeType: r.changeType,
    newTitle: r.newTitle || undefined,
    mergedIntoEid: r.mergedIntoEid || undefined,
    occurredAt: r.occurredAt,
  };
}

/** Distinct CMS article eids a code's coverage/update arrays reference. */
function codeArticleEids(c: CodeRecord): string[] {
  const out = new Set<string>();
  for (const cov of c.articlesWhereCoverageIs ?? []) {
    if (cov.articleId) out.add(cov.articleId);
  }
  for (const upd of c.existingArticleUpdates ?? []) {
    if (upd.articleId) out.add(upd.articleId);
  }
  return Array.from(out);
}

/**
 * Join open drift events against everything in `slug` that references a
 * CMS eid — mapped codes, consolidated articles/sections, and update
 * backlog rows. Returns one impact per open event (events that touch
 * nothing are still surfaced). Pure join + extraction live in
 * `drift-impacts.ts`; this only fetches + projects.
 */
export async function getDriftImpacts(slug: string): Promise<DriftImpact[]> {
  await connection();
  const pb = await userClient();
  const [events, codes, articles, sections, articleReviews, sectionReviews, backlog] =
    await Promise.all([
      pb
        .collection<ContentChangeEventRecord>('contentChangeEvents')
        .getFullList({ filter: 'status = "open"', sort: '-occurredAt' }),
      pb
        .collection<CodeRecord>('codes')
        .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) }),
      pb
        .collection<ConsolidatedArticleRecord>('consolidatedArticles')
        .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) }),
      pb
        .collection<ConsolidatedSectionRecord>('consolidatedSections')
        .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) }),
      pb
        .collection<ArticleReviewRecord>('articleReviews')
        .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) }),
      pb
        .collection<SectionReviewRecord>('sectionReviews')
        .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) }),
      pb
        .collection<ArticleBacklogRecord>('articleBacklog')
        .getFullList({ filter: pb.filter('specialtySlug = {:slug}', { slug }) }),
    ]);

  const approvedArticleKeys = new Set(
    articleReviews.filter((r) => r.status === 'approved').map((r) => r.articleKey),
  );
  const approvedSectionKeys = new Set(
    sectionReviews.filter((r) => r.status === 'approved').map((r) => r.sectionKey),
  );

  const refs = buildDriftRefs({
    codes: codes.map((c) => ({
      code: c.code,
      description: c.description,
      articleEids: codeArticleEids(c),
    })),
    articles: articles.map((a) => {
      const articleKey =
        a.articleKey ||
        computeArticleKey({
          specialtySlug: slug,
          articleTitle: a.articleTitle,
          articleId: a.articleId,
          category: a.category,
        });
      return {
        articleKey,
        articleId: a.articleId,
        articleTitle: a.articleTitle,
        approved: approvedArticleKeys.has(articleKey),
      };
    }),
    sections: sections.map((s) => {
      const sectionKey =
        s.sectionKey ||
        computeSectionKey({
          specialtySlug: slug,
          articleTitle: s.articleTitle,
          articleId: s.articleId,
          sectionName: s.sectionName,
          sectionId: s.sectionId,
          category: s.category,
        });
      return {
        sectionKey,
        articleId: s.articleId,
        sectionId: s.sectionId,
        articleTitle: s.articleTitle,
        sectionName: s.sectionName,
        approved: approvedSectionKeys.has(sectionKey),
      };
    }),
    backlog: backlog.map((b) => ({
      articleKey: b.articleKey,
      // No title on update backlog rows; the parent eid is the label fallback.
    })),
  });

  return computeDriftImpacts(events.map(toEventInput), refs);
}

// --- Resolution ------------------------------------------------------------

/**
 * Mark a drift event resolved. Flag-only model: resolving records the
 * editor's acknowledgement and stops surfacing the event; it does not
 * verify the underlying eid was actually fixed (noted as a follow-up).
 */
export async function resolveDriftEventAsAdmin(
  eventId: string,
  resolverEmail: string,
  notes?: string,
): Promise<ContentChangeEventRecord | null> {
  const pb = await createAdminClient();
  try {
    return await pb
      .collection<ContentChangeEventRecord>('contentChangeEvents')
      .update(eventId, {
        status: 'resolved',
        resolvedBy: resolverEmail,
        resolvedAt: Date.now(),
        notes: notes ?? '',
      });
  } catch (e) {
    log('content-drift').error('resolveDriftEvent failed', {
      eventId,
      error: errorMessage(e),
    });
    return null;
  }
}
