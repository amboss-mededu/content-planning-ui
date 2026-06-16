import type { ContentChangeEventType } from '@/lib/pb/types';

/**
 * Pure drift-impact join. Given open CMS change events and a flat list of
 * "content references" extracted from the mappings + consolidation output,
 * compute which planner artifacts each event touches.
 *
 * No PB / IO here so the join is unit-testable in isolation; the server
 * layer (`src/lib/data/content-drift.ts`) fetches the records, projects
 * them into the input shapes below, and calls these functions.
 *
 * The model is flag-only: we report impacts, never mutate downstream work.
 * `hasDownstreamWork` marks refs an editor has already committed to
 * (approved review / triaged backlog) so the UI can emphasize those.
 */

export type DriftRefKind = 'code' | 'article' | 'section' | 'backlog';

/** One planner artifact that points at a CMS article (and maybe section). */
export type DriftContentRef = {
  kind: DriftRefKind;
  /** CMS article eid this ref points at. */
  articleEid: string;
  /** CMS section id — only set for `section` refs. */
  sectionId?: string;
  /** Human label for the queue (code+desc, article title, section name). */
  label: string;
  /** Stable key for deep-linking (article/section/backlog refs). */
  articleKey?: string;
  /** Mapping code, for `code` refs. */
  code?: string;
  /** True when an editor has committed downstream work on this ref
   *  (approved review / triaged backlog row). Drives warning emphasis. */
  hasDownstreamWork?: boolean;
};

export type DriftEventInput = {
  eventKey: string;
  articleEid: string;
  sectionId?: string;
  changeType: ContentChangeEventType;
  newTitle?: string;
  mergedIntoEid?: string;
  occurredAt?: number;
};

export type DriftImpact = {
  event: DriftEventInput;
  refs: DriftContentRef[];
  /** Any matched ref carries committed downstream work. */
  touchesDownstreamWork: boolean;
};

/**
 * Does a content ref fall under an event?
 * - Always requires the same `articleEid`.
 * - A section-scoped event (has `sectionId`) only matches `section` refs
 *   whose `sectionId` agrees; code/article/backlog refs for the same
 *   article still match (the parent article is genuinely involved).
 * - An article-scoped event (no `sectionId`) matches every ref for the
 *   article, including all its sections.
 */
export function refMatchesEvent(ref: DriftContentRef, event: DriftEventInput): boolean {
  if (ref.articleEid !== event.articleEid) return false;
  if (event.sectionId && ref.kind === 'section') {
    return ref.sectionId === event.sectionId;
  }
  return true;
}

/**
 * Join open events against refs. Every event yields exactly one impact —
 * an event with no matching refs is still surfaced (an editor can resolve
 * it as "doesn't affect us").
 */
export function computeDriftImpacts(
  events: DriftEventInput[],
  refs: DriftContentRef[],
): DriftImpact[] {
  return events.map((event) => {
    const matched = refs.filter((ref) => refMatchesEvent(ref, event));
    return {
      event,
      refs: matched,
      touchesDownstreamWork: matched.some((r) => r.hasDownstreamWork === true),
    };
  });
}

// --- Ref extraction (pure) -------------------------------------------------

export type DriftCodeInput = {
  code: string;
  description?: string;
  /** Distinct CMS article eids this code's coverage/update arrays cite. */
  articleEids: string[];
};

export type DriftArticleInput = {
  articleKey: string;
  articleId?: string;
  articleTitle?: string;
  approved: boolean;
};

export type DriftSectionInput = {
  sectionKey: string;
  articleId?: string;
  sectionId?: string;
  articleTitle?: string;
  sectionName?: string;
  approved: boolean;
};

export type DriftBacklogInput = {
  /** `upd::<eid>` for update-article backlog rows. */
  articleKey: string;
  articleTitle?: string;
};

/** Prefix used by update-article backlog/review keys: `upd::<articleEid>`. */
const UPDATE_KEY_PREFIX = 'upd::';

export function buildDriftRefs(inputs: {
  codes: DriftCodeInput[];
  articles: DriftArticleInput[];
  sections: DriftSectionInput[];
  backlog: DriftBacklogInput[];
}): DriftContentRef[] {
  const refs: DriftContentRef[] = [];

  for (const c of inputs.codes) {
    for (const eid of c.articleEids) {
      if (!eid) continue;
      refs.push({
        kind: 'code',
        articleEid: eid,
        code: c.code,
        label: c.description ? `${c.code} — ${c.description}` : c.code,
      });
    }
  }

  for (const a of inputs.articles) {
    if (!a.articleId) continue; // new articles have no CMS eid → can't drift
    refs.push({
      kind: 'article',
      articleEid: a.articleId,
      articleKey: a.articleKey,
      label: a.articleTitle || a.articleId,
      hasDownstreamWork: a.approved,
    });
  }

  for (const s of inputs.sections) {
    if (!s.articleId) continue;
    const label = s.sectionName
      ? `${s.articleTitle || s.articleId} › ${s.sectionName}`
      : s.articleTitle || s.articleId || '';
    refs.push({
      kind: 'section',
      articleEid: s.articleId,
      sectionId: s.sectionId,
      articleKey: s.sectionKey,
      label,
      hasDownstreamWork: s.approved,
    });
  }

  for (const b of inputs.backlog) {
    if (!b.articleKey.startsWith(UPDATE_KEY_PREFIX)) continue;
    const eid = b.articleKey.slice(UPDATE_KEY_PREFIX.length);
    if (!eid) continue;
    refs.push({
      kind: 'backlog',
      articleEid: eid,
      articleKey: b.articleKey,
      label: b.articleTitle || eid,
      hasDownstreamWork: true, // a backlog row is itself committed work
    });
  }

  return refs;
}
