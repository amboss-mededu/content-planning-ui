'use client';

import { Badge, Button, Inline, Select, Stack, Text } from '@amboss/design-system';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArticleManagerModalV2 } from '@/app/planning/_components/article-manager-modal-v2';
import { ArticleSourcesDrawer } from '@/app/planning/_components/article-sources-drawer';
import {
  IN_PROGRESS_STATUSES,
  NEXT_ACTION,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_OPTIONS,
  WAITING_STATUSES,
} from '@/app/planning/_components/backlog-constants';
import { CodeChipList } from '@/app/planning/_components/code-chip';
import type { CategoryLookup, EmbeddedCode } from '@/app/planning/_components/code-utils';
import { type Column, DataTable } from '@/app/planning/_components/data-table';
import { LitSearchProgressBadge } from '@/app/planning/_components/lit-search-progress-badge';
import { canRunLitSearch } from '@/app/planning/_components/pipeline-stage-gates';
import { RunLitSearchRowButton } from '@/app/planning/_components/run-lit-search-row-button';
import type { SectionRow } from '@/app/planning/_components/sections-view';
import { useLitSearchState } from '@/app/planning/_components/use-running-lit-search-articles';
import {
  clearBacklogRow,
  setBacklogAssignee,
  setBacklogStatus,
} from '@/app/planning/[specialty]/actions';
import type {
  ArticleBacklogRecord,
  ArticleBacklogStatus,
  ArticleLitSearchRunRecord,
  ArticleSourceRecord,
  ReviewCommentRecord,
} from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';

export type MyBacklogRow = {
  /** For type='new': PB id of the current underlying newArticleSuggestions
   *  row. For type='update': the parent article's CMS articleId. Use for
   *  click-target routing only — cross-collection joins go through
   *  `articleKey`. */
  id: string;
  /** Stable, content-derived identifier — see
   *  `src/lib/data/article-keys.ts`. */
  articleKey: string;
  type: 'new' | 'update';
  specialtySlug: string;
  specialtyName: string;
  articleTitle?: string;
  articleType?: string;
  codes: EmbeddedCode[];
  /** Sources attached (type='new' only — 0 for updates). */
  sourcesCount: number;
  /** Of those, how many have been registered in Cortex CMS. The
   *  my-backlog view doesn't expose the register button itself; the
   *  field exists only to satisfy `BacklogRow` when the row is handed
   *  off to the ArticleManagerModalV2 opener. */
  registeredSourcesCount: number;
  /** Approved section changes for type='update' rows. */
  sections?: SectionRow[];
};

export type AssignableUser = { email: string; name?: string };

const inlineSelectStyle: CSSProperties = {
  border: '1px solid rgb(210, 210, 215)',
  borderRadius: 4,
  padding: '2px 6px',
  background: 'white',
  font: 'inherit',
  fontSize: '0.9em',
  maxWidth: '100%',
};

const statusOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
  border: 0,
  padding: 0,
  margin: 0,
  background: 'transparent',
};

export function MyBacklogView({
  rows,
  categoryLookup,
  assignableUsers,
  initialBacklog,
  initialSourcesByArticleKey,
  initialLitSearchRuns,
  initialCommentsByArticle,
  viewerEmail,
}: {
  rows: MyBacklogRow[];
  categoryLookup: CategoryLookup;
  assignableUsers: AssignableUser[];
  initialBacklog: Record<string, ArticleBacklogRecord>;
  initialSourcesByArticleKey: Record<string, ArticleSourceRecord[]>;
  initialLitSearchRuns: ArticleLitSearchRunRecord[];
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  viewerEmail: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(
    () => params.get('status') ?? '',
  );
  const [specialtyFilter, setSpecialtyFilter] = useState<string>(
    () => params.get('specialty') ?? '',
  );
  // Live PB sub on `articleBacklog`. Filter on the current user's email
  // so the cross-specialty view only resubscribes when the assignee
  // changes (i.e. never within a session). Same key-indexed projection
  // as the specialty backlog view — see `backlog-view.tsx` for the
  // mirror.
  const liveBacklogRows = useLiveCollection<ArticleBacklogRecord>(
    'articleBacklog',
    useMemo(() => Object.values(initialBacklog), [initialBacklog]),
    { filter: `assigneeEmail = "${viewerEmail}"` },
  );
  const backlog = useMemo(() => {
    const m: Record<string, ArticleBacklogRecord> = {};
    for (const r of liveBacklogRows) {
      if (r.articleKey) m[r.articleKey] = r;
    }
    return m;
  }, [liveBacklogRows]);
  const [drawerArticleId, setDrawerArticleId] = useState<string | null>(null);
  const [managerArticleId, setManagerArticleId] = useState<string | null>(null);
  const initialSources = useMemo(
    () => Object.values(initialSourcesByArticleKey).flat(),
    [initialSourcesByArticleKey],
  );
  const liveSources = useLiveCollection<ArticleSourceRecord>(
    'articleSources',
    initialSources,
  );
  const sourcesByArticleKey = useMemo(() => {
    const rowKeys = new Set(rows.map((row) => row.articleKey));
    const out: Record<string, ArticleSourceRecord[]> = {};
    for (const source of liveSources) {
      const key = source.articleKey;
      if (!key || !rowKeys.has(key)) continue;
      if (!out[key]) out[key] = [];
      out[key].push(source);
    }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => {
        const ar = a.rank ?? Number.POSITIVE_INFINITY;
        const br = b.rank ?? Number.POSITIVE_INFINITY;
        if (ar !== br) return ar - br;
        return a.title.localeCompare(b.title);
      });
    }
    return out;
  }, [liveSources, rows]);
  const litSearchState = useLitSearchState(initialLitSearchRuns);

  // Browser PB realtime drops events for auth-gated collections (httpOnly
  // pb_auth cookie isn't readable from JS). Mirror the polling fallback in
  // `codes-view-client.tsx` so badge swaps land for the cross-specialty
  // backlog too.
  const lastLitSearchClickAt = useRef<number>(0);
  const onLitSearchTriggered = useCallback(() => {
    lastLitSearchClickAt.current = Date.now();
  }, []);

  useEffect(() => {
    const hasRunningRow = initialLitSearchRuns.some((r) => r.status === 'running');
    const isInClickWindow = () => Date.now() - lastLitSearchClickAt.current < 30_000;
    if (!hasRunningRow && !isInClickWindow()) return;
    const tick = () => {
      router.refresh();
      const stillRunning = initialLitSearchRuns.some((r) => r.status === 'running');
      if (!stillRunning && !isInClickWindow()) {
        window.clearInterval(id);
      }
    };
    const id = window.setInterval(tick, 2500);
    const onFocus = () => router.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [initialLitSearchRuns, router]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (specialtyFilter) p.set('specialty', specialtyFilter);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [statusFilter, specialtyFilter]);

  // State + actions are keyed by articleKey. `id` is kept for routing
  // (drawer, modal) but never used for cross-collection joins.

  const statusOf = useCallback(
    (key: string): ArticleBacklogStatus => backlog[key]?.status ?? 'waiting-for-sources',
    [backlog],
  );
  const assigneeOf = useCallback(
    (key: string): string => backlog[key]?.assigneeEmail ?? '',
    [backlog],
  );
  const isLitSearchRunning = useCallback(
    (articleKey: string): boolean => litSearchState.inFlight.has(articleKey),
    [litSearchState.inFlight],
  );

  const specialtyOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.specialtySlug)) seen.set(r.specialtySlug, r.specialtyName);
    }
    return Array.from(seen.entries())
      .map(([slug, name]) => ({ value: slug, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows.map((row) => {
      const sources = sourcesByArticleKey[row.articleKey] ?? [];
      return row.type === 'new'
        ? {
            ...row,
            sourcesCount: sources.length,
            registeredSourcesCount: sources.filter((s) => !!s.cortexSourceId).length,
          }
        : row;
    });
    if (statusFilter) {
      out = out.filter((r) => statusOf(r.articleKey) === statusFilter);
    }
    if (specialtyFilter) {
      out = out.filter((r) => r.specialtySlug === specialtyFilter);
    }
    return out;
  }, [rows, sourcesByArticleKey, statusFilter, specialtyFilter, statusOf]);

  const liveRows = useMemo(
    () =>
      rows.map((row) => {
        const sources = sourcesByArticleKey[row.articleKey] ?? [];
        return row.type === 'new'
          ? {
              ...row,
              sourcesCount: sources.length,
              registeredSourcesCount: sources.filter((s) => !!s.cortexSourceId).length,
            }
          : row;
      }),
    [rows, sourcesByArticleKey],
  );

  const counts = useMemo(() => {
    let published = 0;
    let inProgress = 0;
    let waiting = 0;
    for (const r of liveRows) {
      if (isLitSearchRunning(r.articleKey)) {
        inProgress++;
        continue;
      }
      const s = statusOf(r.articleKey);
      if (s === 'published') published++;
      else if (WAITING_STATUSES.includes(s)) waiting++;
      else if (IN_PROGRESS_STATUSES.includes(s)) inProgress++;
    }
    return { published, inProgress, waiting };
  }, [liveRows, statusOf, isLitSearchRunning]);

  // Optimistic state was removed when this view moved to PB realtime —
  // see the matching comment in `backlog-view.tsx`. Server writes, the
  // live sub catches the change, the table re-renders.
  async function handleStatusChange(
    row: MyBacklogRow,
    next: ArticleBacklogStatus,
    notes?: string,
  ): Promise<void> {
    if (next === 'unassigned') {
      try {
        await clearBacklogRow(row.specialtySlug, row.articleKey);
        router.refresh();
      } catch (e) {
        console.error('clearBacklogRow failed', e);
      }
      return;
    }
    try {
      await setBacklogStatus(row.specialtySlug, row.articleKey, row.id, next, notes);
      router.refresh();
    } catch (e) {
      console.error('setBacklogStatus failed', e);
    }
  }

  async function handleAssigneeChange(
    row: MyBacklogRow,
    nextEmail: string,
  ): Promise<void> {
    const emailOrNull = nextEmail.length > 0 ? nextEmail : null;
    try {
      await setBacklogAssignee(row.specialtySlug, row.articleKey, row.id, emailOrNull);
      router.refresh();
    } catch (e) {
      console.error('setBacklogAssignee failed', e);
    }
  }

  const columns: Column<MyBacklogRow>[] = [
    {
      key: 'specialty',
      label: 'Specialty',
      description: 'Specialty this article belongs to.',
      render: (r) => r.specialtyName,
      width: 180,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => r.specialtyName,
      type: 'string',
      filterable: true,
      filterOptions: specialtyOptions,
      filterValue: (r) => r.specialtySlug,
    },
    {
      key: 'kind',
      label: 'Kind',
      description: 'New article vs. update to an existing article.',
      render: (r) =>
        r.type === 'update' ? (
          <Badge text="Update" color="purple" />
        ) : (
          <Badge text="New" color="blue" />
        ),
      width: 90,
      verticalAlign: 'middle',
      align: 'center',
      accessor: (r) => (r.type === 'update' ? 'Update' : 'New'),
      type: 'string',
      filterable: true,
      filterOptions: [
        { value: 'New', label: 'New' },
        { value: 'Update', label: 'Update' },
      ],
      filterValue: (r) => (r.type === 'update' ? 'Update' : 'New'),
    },
    {
      key: 'articleTitle',
      label: 'Article Title',
      description:
        'For new articles: the approved suggestion. For updates: the parent article being updated.',
      render: (r) => r.articleTitle ?? '—',
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => r.articleTitle ?? null,
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'articleType',
      label: 'Type',
      description: 'Article type from the suggestion (new articles only).',
      render: (r) => r.articleType ?? '—',
      width: 130,
      verticalAlign: 'middle',
      align: 'center',
      accessor: (r) => r.articleType ?? null,
      type: 'string',
      filterable: true,
    },
    {
      key: 'codes',
      label: 'Codes',
      description: 'Codes assigned to the article in consolidation.',
      render: (r) => <CodeChipList codes={r.codes} categoryLookup={categoryLookup} />,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => r.codes.map((c) => c.description ?? c.code).join(' '),
      type: 'string',
      filterable: true,
      filterMode: 'contains',
    },
    {
      key: 'status',
      label: 'Status',
      description:
        'Editorial workflow state. Click the badge to pick a new value; selecting Unassigned resets the row.',
      width: 220,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) =>
        isLitSearchRunning(r.articleKey)
          ? 'Search in progress...'
          : STATUS_LABEL[statusOf(r.articleKey)],
      type: 'string',
      filterable: true,
      filterOptions: STATUS_OPTIONS.map((o) => ({ value: o.label, label: o.label })),
      filterValue: (r) =>
        isLitSearchRunning(r.articleKey)
          ? 'Search in progress...'
          : STATUS_LABEL[statusOf(r.articleKey)],
      render: (r) => {
        const s = statusOf(r.articleKey);
        if (isLitSearchRunning(r.articleKey)) {
          return <LitSearchProgressBadge />;
        }
        return (
          <span
            style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
          >
            <Badge text={STATUS_LABEL[s]} color={STATUS_COLOR[s]} />
            <select
              aria-label="Status"
              style={statusOverlayStyle}
              value={s}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                handleStatusChange(r, e.target.value as ArticleBacklogStatus);
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        );
      },
    },
    {
      key: 'nextAction',
      label: 'Next action',
      description:
        'What needs to happen next for this article, derived from its current status.',
      width: 180,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) =>
        isLitSearchRunning(r.articleKey)
          ? 'Search in progress...'
          : NEXT_ACTION[statusOf(r.articleKey)],
      type: 'string',
      filterable: true,
      filterOptions: Array.from(
        new Set(Object.values(NEXT_ACTION).filter((v) => v !== '—')),
      ).map((v) => ({ value: v, label: v })),
      filterValue: (r) =>
        isLitSearchRunning(r.articleKey)
          ? 'Search in progress...'
          : NEXT_ACTION[statusOf(r.articleKey)],
      render: (r) => (
        <Text>
          {isLitSearchRunning(r.articleKey)
            ? 'Search in progress...'
            : NEXT_ACTION[statusOf(r.articleKey)]}
        </Text>
      ),
    },
    {
      key: 'assignee',
      label: 'Assignee',
      description: 'Editor assigned to take this article through the workflow.',
      width: 200,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => assigneeOf(r.articleKey) || null,
      type: 'string',
      filterable: true,
      filterOptions: [
        { value: '__unassigned__', label: 'Unassigned' },
        ...assignableUsers.map((u) => ({
          value: u.email,
          label: u.name ?? u.email,
        })),
      ],
      filterValue: (r) => assigneeOf(r.articleKey) || '__unassigned__',
      render: (r) => (
        <select
          aria-label="Assignee"
          style={inlineSelectStyle}
          value={assigneeOf(r.articleKey)}
          onChange={(e) => handleAssigneeChange(r, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <option value="">— Unassigned —</option>
          {assignableUsers.map((u) => (
            <option key={u.email} value={u.email}>
              {u.name ? `${u.name} (${u.email})` : u.email}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'count',
      label: '# Items',
      description:
        'For new articles: count of attached sources. For updates: count of approved section changes.',
      render: (r) => (r.type === 'update' ? (r.sections?.length ?? 0) : r.sourcesCount),
      width: 100,
      verticalAlign: 'middle',
      align: 'center',
      accessor: (r) => (r.type === 'update' ? (r.sections?.length ?? 0) : r.sourcesCount),
      type: 'number',
      filterable: true,
    },
    {
      key: 'sourcesAction',
      label: 'Sources',
      description: 'Open the per-article sources drawer (new articles only).',
      width: 120,
      verticalAlign: 'middle',
      align: 'center',
      render: (r) => {
        if (r.type === 'update') {
          return (
            <Text size="xs" color="secondary">
              —
            </Text>
          );
        }
        if (isLitSearchRunning(r.articleKey)) {
          return <LitSearchProgressBadge />;
        }
        if (canRunLitSearch(statusOf(r.articleKey), r.sourcesCount)) {
          return <RunLitSearchRowButton slug={r.specialtySlug} articleRecordId={r.id} />;
        }
        return (
          <Button
            variant="tertiary"
            size="s"
            onClick={(e) => {
              (e as React.MouseEvent).stopPropagation();
              setDrawerArticleId(r.id);
            }}
          >
            View
          </Button>
        );
      },
    },
  ];

  const drawerRow = drawerArticleId
    ? liveRows.find((r) => r.id === drawerArticleId)
    : null;
  const drawerSources = drawerRow?.articleKey
    ? (sourcesByArticleKey[drawerRow.articleKey] ?? [])
    : [];
  const managerRow = managerArticleId
    ? (liveRows.find((r) => r.id === managerArticleId) ?? null)
    : null;
  const managerLatestLitSearchRun = managerRow?.articleKey
    ? litSearchState.latestByArticleKey.get(managerRow.articleKey)
    : undefined;
  const managerLitSearchRuns = managerLatestLitSearchRun
    ? [managerLatestLitSearchRun]
    : initialLitSearchRuns.filter((run) => run.articleKey === managerRow?.articleKey);

  return (
    <Stack space="m">
      <Inline space="s" vAlignItems="bottom">
        <div className="filter-cell">
          <Select
            name="status"
            label="Status"
            value={statusFilter}
            options={[
              { value: '', label: 'All statuses' },
              ...STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            ]}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
        <div className="filter-cell">
          <Select
            name="specialty"
            label="Specialty"
            value={specialtyFilter}
            options={[{ value: '', label: 'All specialties' }, ...specialtyOptions]}
            onChange={(e) => setSpecialtyFilter(e.target.value)}
          />
        </div>
      </Inline>
      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(r) => r.id}
        onRowClick={(r) => setManagerArticleId(r.id)}
        countAddendum={() => 'articles'}
        leadingNote={`${liveRows.length} assigned · ${counts.published} published · ${counts.inProgress} in progress · ${counts.waiting} waiting for sources`}
        storageKey="my-backlog-table"
      />
      {drawerArticleId && (
        <ArticleSourcesDrawer
          articleTitle={drawerRow?.articleTitle ?? null}
          sources={drawerSources}
          onClose={() => setDrawerArticleId(null)}
        />
      )}
      {managerArticleId && managerRow && managerRow.type === 'new' && (
        <ArticleManagerModalV2
          opener={{
            type: 'new',
            stage: 'backlog',
            slug: managerRow.specialtySlug,
            article: managerRow,
            currentStatus: statusOf(managerRow.articleKey),
            currentBacklogRow: backlog[managerRow.articleKey],
            sources: sourcesByArticleKey[managerRow.articleKey] ?? [],
            litSearchRuns: managerLitSearchRuns,
            initialComments: initialCommentsByArticle[managerRow.articleKey] ?? [],
            initialNotes: backlog[managerRow.articleKey]?.notes ?? '',
            categoryLookup,
            viewerEmail,
            onStatusChange: (next, notes) => handleStatusChange(managerRow, next, notes),
            onLitSearchTriggered,
          }}
          onClose={() => setManagerArticleId(null)}
        />
      )}
      {managerArticleId && managerRow && managerRow.type === 'update' && (
        <ArticleManagerModalV2
          opener={{
            type: 'update',
            stage: 'backlog',
            slug: managerRow.specialtySlug,
            article: managerRow,
            sections: managerRow.sections ?? [],
            currentStatus: statusOf(managerRow.articleKey),
            currentBacklogRow: backlog[managerRow.articleKey],
            initialComments: initialCommentsByArticle[managerRow.articleKey] ?? [],
            initialNotes: backlog[managerRow.articleKey]?.notes ?? '',
            categoryLookup,
            viewerEmail,
            onStatusChange: (next, notes) => handleStatusChange(managerRow, next, notes),
          }}
          onClose={() => setManagerArticleId(null)}
        />
      )}
    </Stack>
  );
}
