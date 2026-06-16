import 'server-only';

import { env } from '@/env';
import { log } from '@/lib/log';

/**
 * CMS content-change ingestion.
 *
 * AMBOSS articles/sections (in Cortex) move under the eids the mappings
 * reference: they get renamed, merged, archived. Nothing in the planner
 * notices today, so a consolidation can keep pointing an editor at an
 * article that no longer exists under that title/id.
 *
 * This adapter pulls a **cursor-based** change feed. Cursor (not
 * "changes since yesterday") so a missed sync window loses nothing —
 * the next sync resumes from the last persisted cursor. Events are
 * stored verbatim and joined against stored eids at read time
 * (`computeDriftImpacts`); we never auto-edit or auto-delete downstream
 * work. Auto-remap is explicitly deferred — see the plan.
 *
 * Feature-flagged like `cortex.ts`: when `CONTENT_CHANGE_FEED_URL` is
 * unset the feed returns an empty page and logs a warning, so the drift
 * review UX ships before the real feed endpoint exists. A
 * Cortex-MCP-backed implementation can slot in behind the same
 * interface later without touching callers.
 */

export type ContentChangeType = 'renamed' | 'moved' | 'archived' | 'merged' | 'deleted';

export type ContentChangeEvent = {
  /** Idempotency key — the feed's own event id, or a hash of
   *  (eid + type + occurredAt). Drives the upsert so re-syncing a window
   *  never duplicates rows. */
  eventKey: string;
  /** CMS article eid this event concerns. */
  articleEid: string;
  /** CMS section id, when the event is section-scoped. */
  sectionId?: string;
  changeType: ContentChangeType;
  /** New title for `renamed`/`moved`. */
  newTitle?: string;
  /** Destination eid for `merged`. */
  mergedIntoEid?: string;
  /** ms since epoch — when the change happened in the CMS. */
  occurredAt: number;
};

export type ContentChangePage = {
  events: ContentChangeEvent[];
  /** Opaque cursor to pass to the next `fetchChanges`. Null when the feed
   *  has no further pages (caller persists whatever it last received). */
  nextCursor: string | null;
};

export interface ContentChangeFeed {
  /** Fetch one page of changes after `sinceCursor` (null = from the
   *  beginning / the feed's default start). */
  fetchChanges(sinceCursor: string | null): Promise<ContentChangePage>;
}

const VALID_CHANGE_TYPES: ReadonlySet<string> = new Set<ContentChangeType>([
  'renamed',
  'moved',
  'archived',
  'merged',
  'deleted',
]);

/**
 * Normalize one raw feed entry into a `ContentChangeEvent`, or null if it
 * lacks the fields we can act on. Defensive because the feed contract
 * isn't final — a malformed entry shouldn't abort the whole sync.
 */
export function normalizeChangeEvent(raw: unknown): ContentChangeEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const articleEid =
    typeof r.articleEid === 'string'
      ? r.articleEid
      : typeof r.eid === 'string'
        ? r.eid
        : '';
  if (!articleEid) return null;
  const changeType = typeof r.changeType === 'string' ? r.changeType : '';
  if (!VALID_CHANGE_TYPES.has(changeType)) return null;
  const occurredAt =
    typeof r.occurredAt === 'number'
      ? r.occurredAt
      : typeof r.occurredAt === 'string'
        ? Date.parse(r.occurredAt) || 0
        : 0;
  const eventKey =
    typeof r.eventKey === 'string' && r.eventKey
      ? r.eventKey
      : typeof r.id === 'string' && r.id
        ? r.id
        : `${articleEid}::${changeType}::${occurredAt}`;
  const sectionId = typeof r.sectionId === 'string' ? r.sectionId : undefined;
  const newTitle = typeof r.newTitle === 'string' ? r.newTitle : undefined;
  const mergedIntoEid = typeof r.mergedIntoEid === 'string' ? r.mergedIntoEid : undefined;
  return {
    eventKey,
    articleEid,
    sectionId,
    changeType: changeType as ContentChangeType,
    newTitle,
    mergedIntoEid,
    occurredAt,
  };
}

/** HTTP feed: GET `${url}?cursor=<c>` → `{ events: [...], nextCursor }`. */
class HttpContentChangeFeed implements ContentChangeFeed {
  constructor(
    private readonly url: string,
    private readonly apiKey?: string,
  ) {}

  async fetchChanges(sinceCursor: string | null): Promise<ContentChangePage> {
    const endpoint = new URL(this.url);
    if (sinceCursor) endpoint.searchParams.set('cursor', sinceCursor);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(endpoint.toString(), { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Content change feed failed: ${res.status} ${res.statusText} — ${text}`,
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      events?: unknown[];
      nextCursor?: unknown;
    };
    const events = Array.isArray(body.events)
      ? body.events
          .map(normalizeChangeEvent)
          .filter((e): e is ContentChangeEvent => e !== null)
      : [];
    const nextCursor = typeof body.nextCursor === 'string' ? body.nextCursor : null;
    return { events, nextCursor };
  }
}

/** Stub feed: returns nothing, advancing no cursor. */
class StubContentChangeFeed implements ContentChangeFeed {
  async fetchChanges(sinceCursor: string | null): Promise<ContentChangePage> {
    log('content-drift').warn(
      '[FEED STUB] fetchChanges — CONTENT_CHANGE_FEED_URL unset, returning no events',
    );
    return { events: [], nextCursor: sinceCursor };
  }
}

/** True when no real feed endpoint is configured. */
export function isStubContentChangeFeed(): boolean {
  return !env.CONTENT_CHANGE_FEED_URL;
}

/** Resolve the active feed implementation from env. */
export function getContentChangeFeed(): ContentChangeFeed {
  if (!env.CONTENT_CHANGE_FEED_URL) return new StubContentChangeFeed();
  return new HttpContentChangeFeed(
    env.CONTENT_CHANGE_FEED_URL,
    env.CONTENT_CHANGE_FEED_API_KEY,
  );
}
