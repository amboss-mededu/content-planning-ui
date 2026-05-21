'use client';

import { Badge, Button, Inline, Select, Stack, Text } from '@amboss/design-system';
import { useRouter, useSearchParams } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { setBacklogStatus } from '@/app/planning/[specialty]/actions';
import type {
  ArticleBacklogRecord,
  ArticleBacklogStatus,
  ArticleReviewRecord,
  ArticleSourceRecord,
  ArticleWritingRunRecord,
  ReviewCommentRecord,
  SectionReviewRecord,
} from '@/lib/pb/types';
import { useApprovalState } from '@/lib/pb/use-approval-state';
import { ArticleManagerModalV2 } from './article-manager-modal-v2';
import { ArticleSourcesDrawer } from './article-sources-drawer';
import { BacklogBulkToolbar } from './backlog-bulk-toolbar';
import {
  IN_PROGRESS_STATUSES,
  NEXT_ACTION,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_OPTIONS,
  WAITING_STATUSES,
} from './backlog-constants';
import { CodeChipList } from './code-chip';
import type { CategoryLookup, EmbeddedCode } from './code-utils';
import { type Column, DataTable } from './data-table';
import { canRunLitSearch } from './pipeline-stage-gates';
import { RegisterCortexButton } from './register-cortex-button';
import { RunLitSearchRowButton } from './run-lit-search-row-button';
import type { SectionRow } from './sections-view';
import { StartWritingButton } from './start-writing-button';

export type BacklogRow = {
  /** For type='new': PB id of the underlying newArticleSuggestions row.
   *  For type='update': the parent article's CMS articleId. Use this
   *  for click-target routing only — cross-collection joins go through
   *  `articleKey`. */
  id: string;
  /** Stable, content-derived identifier — see
   *  `src/lib/data/article-keys.ts`. Computed by the loader page from
   *  the row's current title (or CMS articleId for updates); never
   *  synthesized client-side. */
  articleKey: string;
  /** Discriminator. type='update' rows are built by aggregating approved
   *  section reviews; type='new' rows mirror approved newArticleSuggestions. */
  type: 'new' | 'update';
  articleTitle?: string;
  articleType?: string;
  codes: EmbeddedCode[];
  /** Sources attached to this article (type='new' only — empty for updates). */
  sourcesCount: number;
  /** Of `sourcesCount`, how many have a non-empty `cortexSourceId` —
   *  i.e. have been registered in Cortex CMS. Drives the "Register in
   *  Cortex" per-row affordance + the status gate before drafting. */
  registeredSourcesCount: number;
  /** Approved section changes for type='update' rows; undefined otherwise. */
  sections?: SectionRow[];
};

export type AssignableUser = { email: string; name?: string };

// Native-select-like styling for the assignee column. Compact and
// doesn't inherit DS form-row spacing.
const inlineSelectStyle: CSSProperties = {
  border: '1px solid rgb(210, 210, 215)',
  borderRadius: 4,
  padding: '2px 6px',
  background: 'white',
  font: 'inherit',
  fontSize: '0.9em',
  maxWidth: '100%',
};

// Transparent <select> overlaid on the status Badge — click anywhere on
// the badge opens the native dropdown, keeping the Badge as the visual
// while keyboard + click work the same as a plain select.
const statusOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
  // Some browsers add a default appearance with min sizing; flatten so
  // the overlay matches the Badge bounding box.
  border: 0,
  padding: 0,
  margin: 0,
  background: 'transparent',
};

export function BacklogView({
  slug,
  rows,
  categoryLookup,
  assignableUsers,
  initialBacklog,
  initialArticleReviewRows,
  initialSectionReviewRows,
  initialSourcesByArticleKey,
  initialCommentsByArticle,
  initialWritingRuns,
  viewerEmail,
}: {
  slug: string;
  rows: BacklogRow[];
  categoryLookup: CategoryLookup;
  assignableUsers: AssignableUser[];
  initialBacklog: Record<string, ArticleBacklogRecord>;
  initialArticleReviewRows: ArticleReviewRecord[];
  initialSectionReviewRows: SectionReviewRecord[];
  initialSourcesByArticleKey: Record<string, ArticleSourceRecord[]>;
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  initialWritingRuns?: Record<string, ArticleWritingRunRecord>;
  viewerEmail?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(
    () => params.get('status') ?? '',
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>(
    () => params.get('assignee') ?? '',
  );
  // Same shared decision hook used by Consolidation Review / Articles /
  // Sections. Seeded with the SSR snapshots so the first paint matches
  // the server, then live PB subscriptions + optimistic patches keep
  // every row in sync. "Remove approval" patches a tombstone on the
  // backlog row (and review row for new-article keys) so the table
  // updates instantly instead of waiting for realtime.
  const initialBacklogArray = useMemo(
    () => Object.values(initialBacklog),
    [initialBacklog],
  );
  const approval = useApprovalState(slug, {
    articleReviews: initialArticleReviewRows,
    sectionReviews: initialSectionReviewRows,
    backlog: initialBacklogArray,
  });
  const backlog = approval.backlogByKey;
  const articleReviews = approval.articleReviewByKey;
  const sectionReviews = approval.sectionReviewByKey;
  const [drawerArticleId, setDrawerArticleId] = useState<string | null>(null);
  const [managerArticleId, setManagerArticleId] = useState<string | null>(null);
  // Inline banner for Remove-approval / status-change failures. Without
  // this, the hook silently rolls back its optimistic patch and the
  // user sees a row reappear with no explanation.
  const [actionError, setActionError] = useState<string | null>(null);
  // Multi-select for the bulk-action toolbar. Keyed by row.id (the
  // newArticleSuggestions PB id for type='new', the parent CMS articleId
  // for type='update'). Updates clear automatically when the row leaves
  // the table (e.g. status filter excludes it).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (assigneeFilter) p.set('assignee', assigneeFilter);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [statusFilter, assigneeFilter]);

  // State + actions are keyed by articleKey (stable across re-runs).
  // `articleRecordId` is still threaded through for the PB row's
  // breadcrumb column, but it is never used as a lookup key.

  const statusOf = useCallback(
    (key: string): ArticleBacklogStatus => backlog[key]?.status ?? 'waiting-for-sources',
    [backlog],
  );
  const assigneeOf = useCallback(
    (key: string): string => backlog[key]?.assigneeEmail ?? '',
    [backlog],
  );

  const memberRows = useMemo(() => {
    const out: BacklogRow[] = [];
    for (const row of rows) {
      const membership = backlog[row.articleKey];
      if (!membership) continue;
      if (row.type === 'new') {
        if ((membership.type ?? 'new') !== 'new') continue;
        if (articleReviews[row.articleKey]?.status !== 'approved') continue;
        out.push(row);
        continue;
      }
      if (membership.type !== 'update') continue;
      const approvedSections = (row.sections ?? []).filter(
        (section) =>
          section.sectionKey && sectionReviews[section.sectionKey]?.status === 'approved',
      );
      if (approvedSections.length === 0) continue;
      out.push({ ...row, sections: approvedSections });
    }
    return out;
  }, [rows, backlog, articleReviews, sectionReviews]);

  const filtered = useMemo(() => {
    let out = memberRows;
    if (statusFilter) {
      out = out.filter((r) => statusOf(r.articleKey) === statusFilter);
    }
    if (assigneeFilter) {
      if (assigneeFilter === '__unassigned__') {
        out = out.filter((r) => !assigneeOf(r.articleKey));
      } else {
        out = out.filter((r) => assigneeOf(r.articleKey) === assigneeFilter);
      }
    }
    return out;
  }, [memberRows, statusFilter, assigneeFilter, statusOf, assigneeOf]);

  const counts = useMemo(() => {
    let published = 0;
    let inProgress = 0;
    let waiting = 0;
    for (const r of memberRows) {
      const s = statusOf(r.articleKey);
      if (s === 'published') published++;
      else if (WAITING_STATUSES.includes(s)) waiting++;
      else if (IN_PROGRESS_STATUSES.includes(s)) inProgress++;
    }
    return { published, inProgress, waiting };
  }, [memberRows, statusOf]);

  // Optimistic state was removed when this view moved to PB realtime.
  // The handlers below are thin: write, log on failure, let realtime
  // catch the rest.
  async function handleStatusChange(
    articleKey: string,
    articleRecordId: string,
    next: ArticleBacklogStatus,
    notes?: string,
  ): Promise<void> {
    // Picking "unassigned" from the status dropdown is the same
    // operation as clicking the Remove approval button — drop the row
    // through the shared hook so the optimistic tombstone fires.
    if (next === 'unassigned') {
      try {
        await approval.clearBacklog(articleKey);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Remove approval failed');
      }
      return;
    }
    try {
      await setBacklogStatus(slug, articleKey, articleRecordId, next, notes);
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Status change failed');
    }
  }

  async function handleRemoveApproval(articleKey: string): Promise<void> {
    // The shared hook tombstones the backlog row (and matching review
    // row(s)) immediately, then awaits the server action. If the modal
    // happens to be open on the removed article, close it.
    setManagerArticleId((current) => {
      const row = current ? memberRows.find((r) => r.id === current) : null;
      return row?.articleKey === articleKey ? null : current;
    });
    try {
      await approval.clearBacklog(articleKey);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Remove approval failed');
    }
  }

  async function handleAssigneeChange(
    articleKey: string,
    articleRecordId: string,
    nextEmail: string,
  ): Promise<void> {
    const emailOrNull = nextEmail.length > 0 ? nextEmail : null;
    try {
      await approval.setAssignee(articleKey, articleRecordId, emailOrNull);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Assignee change failed');
    }
  }

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const columns: Column<BacklogRow>[] = [
    {
      key: 'select',
      label: '',
      description: 'Select rows to enable bulk-action toolbar.',
      width: 36,
      verticalAlign: 'middle',
      align: 'center',
      render: (r) =>
        r.type === 'update' ? null : (
          <input
            type="checkbox"
            aria-label="Select row"
            checked={selectedIds.has(r.id)}
            onChange={() => toggleRow(r.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
    },
    {
      key: 'kind',
      label: 'Kind',
      description:
        'Whether this row tracks a brand-new article or an update to an existing article (built from approved section changes).',
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
        'For new articles: the approved suggestion title. For updates: the parent article being updated.',
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
      description: 'Editorial workflow state. Click the badge to pick a new value.',
      width: 220,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => STATUS_LABEL[statusOf(r.articleKey)],
      type: 'string',
      filterable: true,
      filterOptions: STATUS_OPTIONS.map((o) => ({ value: o.label, label: o.label })),
      filterValue: (r) => STATUS_LABEL[statusOf(r.articleKey)],
      render: (r) => {
        const s = statusOf(r.articleKey);
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
                handleStatusChange(
                  r.articleKey,
                  r.id,
                  e.target.value as ArticleBacklogStatus,
                );
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
      key: 'approval',
      label: 'Approval',
      description: 'Remove the approval decision and drop this row from the backlog.',
      width: 150,
      verticalAlign: 'middle',
      align: 'center',
      render: (r) => (
        <Button
          variant="tertiary"
          size="s"
          destructive
          onClick={(e) => {
            (e as React.MouseEvent).stopPropagation();
            handleRemoveApproval(r.articleKey);
          }}
        >
          Remove approval
        </Button>
      ),
    },
    {
      key: 'nextAction',
      label: 'Next action',
      description:
        'What needs to happen next for this article, derived from its current status.',
      width: 180,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => NEXT_ACTION[statusOf(r.articleKey)],
      type: 'string',
      filterable: true,
      filterOptions: Array.from(
        new Set(Object.values(NEXT_ACTION).filter((v) => v !== '—')),
      ).map((v) => ({ value: v, label: v })),
      filterValue: (r) => NEXT_ACTION[statusOf(r.articleKey)],
      render: (r) => <Text>{NEXT_ACTION[statusOf(r.articleKey)]}</Text>,
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
          onChange={(e) => handleAssigneeChange(r.articleKey, r.id, e.target.value)}
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
      description:
        'Per-row literature search (when waiting) or open the sources drawer (after sources land). New articles only.',
      width: 200,
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
        if (canRunLitSearch(statusOf(r.articleKey), r.sourcesCount)) {
          return <RunLitSearchRowButton slug={slug} articleRecordId={r.id} />;
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
    {
      key: 'draft',
      label: 'Draft',
      description:
        'Kick off the 6-pass LLM article draft. New articles only — updates use a different editorial path.',
      width: 220,
      verticalAlign: 'middle',
      align: 'left',
      render: (r) =>
        r.type === 'update' ? (
          <Text size="xs" color="secondary">
            —
          </Text>
        ) : (
          <Inline space="xs" vAlignItems="center">
            <RegisterCortexButton
              slug={slug}
              articleRecordId={r.id}
              sourcesCount={r.sourcesCount}
              registeredSourcesCount={r.registeredSourcesCount}
            />
            <StartWritingButton
              slug={slug}
              articleRecordId={r.id}
              hasSources={r.sourcesCount > 0}
              initialRun={initialWritingRuns?.[r.id] ?? null}
            />
          </Inline>
        ),
    },
  ];

  // Mapping selected row id → effective backlog status, so the bulk
  // toolbar can show per-stage eligibility counts. Rows that no longer
  // appear in `rows` (e.g. filtered out) get pruned silently.
  const statusByRowId = useMemo(() => {
    const out: Record<string, ArticleBacklogStatus | undefined> = {};
    for (const r of memberRows) out[r.id] = statusOf(r.articleKey);
    return out;
  }, [memberRows, statusOf]);

  const selectedIdsArr = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const drawerRow = drawerArticleId
    ? memberRows.find((r) => r.id === drawerArticleId)
    : null;
  const drawerSources = drawerRow?.articleKey
    ? (initialSourcesByArticleKey[drawerRow.articleKey] ?? [])
    : [];
  const managerRow = managerArticleId
    ? (memberRows.find((r) => r.id === managerArticleId) ?? null)
    : null;

  return (
    <Stack space="m">
      {actionError ? (
        <button
          type="button"
          onClick={() => setActionError(null)}
          style={{
            textAlign: 'left',
            padding: '6px 8px',
            border: '1px solid rgb(220, 38, 38)',
            borderRadius: 4,
            background: 'rgb(254, 226, 226)',
            cursor: 'pointer',
            font: 'inherit',
            color: 'rgb(127, 29, 29)',
            fontSize: 12,
          }}
          title="Dismiss"
        >
          {actionError}
        </button>
      ) : null}
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
            name="assignee"
            label="Assignee"
            value={assigneeFilter}
            options={[
              { value: '', label: 'All assignees' },
              { value: '__unassigned__', label: 'Unassigned' },
              ...assignableUsers.map((u) => ({
                value: u.email,
                label: u.name ?? u.email,
              })),
            ]}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          />
        </div>
      </Inline>
      {selectedIds.size > 0 && (
        <BacklogBulkToolbar
          slug={slug}
          selectedIds={selectedIdsArr}
          statusById={statusByRowId}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(r) => r.id}
        onRowClick={(r) => setManagerArticleId(r.id)}
        countAddendum={() => 'articles'}
        leadingNote={`${memberRows.length} approved · ${counts.published} published · ${counts.inProgress} in progress · ${counts.waiting} waiting for sources`}
        storageKey={`backlog-table:${slug}`}
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
            slug,
            article: managerRow,
            currentStatus: statusOf(managerRow.articleKey),
            currentBacklogRow: backlog[managerRow.articleKey],
            sources: initialSourcesByArticleKey[managerRow.articleKey] ?? [],
            initialComments: initialCommentsByArticle[managerRow.articleKey] ?? [],
            initialNotes: backlog[managerRow.articleKey]?.notes ?? '',
            categoryLookup,
            viewerEmail,
            onStatusChange: (next, notes) =>
              handleStatusChange(managerRow.articleKey, managerArticleId, next, notes),
          }}
          onClose={() => setManagerArticleId(null)}
        />
      )}
      {managerArticleId && managerRow && managerRow.type === 'update' && (
        <ArticleManagerModalV2
          opener={{
            type: 'update',
            stage: 'backlog',
            slug,
            article: managerRow,
            sections: managerRow.sections ?? [],
            currentStatus: statusOf(managerRow.articleKey),
            currentBacklogRow: backlog[managerRow.articleKey],
            initialComments: initialCommentsByArticle[managerRow.articleKey] ?? [],
            initialNotes: backlog[managerRow.articleKey]?.notes ?? '',
            categoryLookup,
            viewerEmail,
            onStatusChange: (next, notes) =>
              handleStatusChange(managerRow.articleKey, managerArticleId, next, notes),
          }}
          onClose={() => setManagerArticleId(null)}
        />
      )}
    </Stack>
  );
}
