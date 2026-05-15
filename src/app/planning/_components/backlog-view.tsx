'use client';

import { Badge, Button, Inline, Select, Stack, Text } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearBacklogRow,
  setBacklogAssignee,
  setBacklogStatus,
} from '@/app/planning/[specialty]/actions';
import type {
  ArticleBacklogRecord,
  ArticleBacklogStatus,
  ArticleSourceRecord,
  ArticleWritingRunRecord,
  ReviewCommentRecord,
} from '@/lib/pb/types';
import { ArticleManagerModalV2 } from './article-manager-modal-v2';
import { ArticleSourcesDrawer } from './article-sources-drawer';
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
import type { SectionRow } from './sections-view';
import { StartWritingButton } from './start-writing-button';

export type BacklogRow = {
  /** For type='new': PB id of the underlying newArticleSuggestions row.
   *  For type='update': the parent article's CMS articleId. */
  id: string;
  /** Discriminator. type='update' rows are built by aggregating approved
   *  section reviews; type='new' rows mirror approved newArticleSuggestions. */
  type: 'new' | 'update';
  articleTitle?: string;
  articleType?: string;
  codes: EmbeddedCode[];
  /** Sources attached to this article (type='new' only — empty for updates). */
  sourcesCount: number;
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
  initialSourcesByArticle,
  initialCommentsByArticle,
  initialWritingRuns,
  viewerEmail,
}: {
  slug: string;
  rows: BacklogRow[];
  categoryLookup: CategoryLookup;
  assignableUsers: AssignableUser[];
  initialBacklog: Record<string, ArticleBacklogRecord>;
  initialSourcesByArticle: Record<string, ArticleSourceRecord[]>;
  initialCommentsByArticle: Record<string, ReviewCommentRecord[]>;
  initialWritingRuns?: Record<string, ArticleWritingRunRecord>;
  viewerEmail?: string;
}) {
  const params = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(
    () => params.get('status') ?? '',
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>(
    () => params.get('assignee') ?? '',
  );
  const [backlog, setBacklog] =
    useState<Record<string, ArticleBacklogRecord>>(initialBacklog);
  const [drawerArticleId, setDrawerArticleId] = useState<string | null>(null);
  const [managerArticleId, setManagerArticleId] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (assigneeFilter) p.set('assignee', assigneeFilter);
    const qs = p.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', next);
  }, [statusFilter, assigneeFilter]);

  const statusOf = useCallback(
    (id: string): ArticleBacklogStatus => backlog[id]?.status ?? 'waiting-for-sources',
    [backlog],
  );
  const assigneeOf = useCallback(
    (id: string): string => backlog[id]?.assigneeEmail ?? '',
    [backlog],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter) {
      out = out.filter((r) => statusOf(r.id) === statusFilter);
    }
    if (assigneeFilter) {
      if (assigneeFilter === '__unassigned__') {
        out = out.filter((r) => !assigneeOf(r.id));
      } else {
        out = out.filter((r) => assigneeOf(r.id) === assigneeFilter);
      }
    }
    return out;
  }, [rows, statusFilter, assigneeFilter, statusOf, assigneeOf]);

  const counts = useMemo(() => {
    let published = 0;
    let inProgress = 0;
    let waiting = 0;
    for (const r of rows) {
      const s = statusOf(r.id);
      if (s === 'published') published++;
      else if (WAITING_STATUSES.includes(s)) waiting++;
      else if (IN_PROGRESS_STATUSES.includes(s)) inProgress++;
    }
    return { published, inProgress, waiting };
  }, [rows, statusOf]);

  // Picking a status in the inline cell. Selecting 'unassigned' is the
  // reset path — delete the PB row entirely so the article returns to
  // its default state. Any other value is an upsert.
  async function handleStatusChange(
    rowId: string,
    next: ArticleBacklogStatus,
    notes?: string,
  ): Promise<void> {
    const prev = backlog[rowId];
    if (next === 'unassigned') {
      setBacklog((curr) => {
        const copy = { ...curr };
        delete copy[rowId];
        return copy;
      });
      try {
        await clearBacklogRow(slug, rowId);
      } catch (e) {
        setBacklog((curr) => (prev ? { ...curr, [rowId]: prev } : curr));
        console.error('clearBacklogRow failed', e);
      }
      return;
    }
    setBacklog((curr) => ({
      ...curr,
      [rowId]: {
        ...(curr[rowId] ?? ({} as ArticleBacklogRecord)),
        articleRecordId: rowId,
        specialtySlug: slug,
        status: next,
        assigneeEmail: curr[rowId]?.assigneeEmail ?? '',
        lastChangedByEmail: viewerEmail ?? '',
        lastChangedAt: Date.now(),
        ...(notes !== undefined ? { notes } : {}),
      } as ArticleBacklogRecord,
    }));
    try {
      await setBacklogStatus(slug, rowId, next, notes);
    } catch (e) {
      setBacklog((curr) => {
        const copy = { ...curr };
        if (prev) copy[rowId] = prev;
        else delete copy[rowId];
        return copy;
      });
      console.error('setBacklogStatus failed', e);
    }
  }

  async function handleAssigneeChange(rowId: string, nextEmail: string): Promise<void> {
    const prev = backlog[rowId];
    const emailOrNull = nextEmail.length > 0 ? nextEmail : null;

    setBacklog((curr) => ({
      ...curr,
      [rowId]: {
        ...(curr[rowId] ?? ({} as ArticleBacklogRecord)),
        articleRecordId: rowId,
        specialtySlug: slug,
        status: curr[rowId]?.status ?? 'waiting-for-sources',
        assigneeEmail: emailOrNull ?? '',
        lastChangedByEmail: viewerEmail ?? '',
        lastChangedAt: Date.now(),
      } as ArticleBacklogRecord,
    }));
    try {
      await setBacklogAssignee(slug, rowId, emailOrNull);
    } catch (e) {
      setBacklog((curr) => {
        const copy = { ...curr };
        if (prev) copy[rowId] = prev;
        else delete copy[rowId];
        return copy;
      });
      console.error('setBacklogAssignee failed', e);
    }
  }

  const columns: Column<BacklogRow>[] = [
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
        'For new articles: the approved 2nd-pass suggestion title. For updates: the parent article being updated.',
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
      description: 'Codes assigned to the article in the 2nd-pass consolidation.',
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
      accessor: (r) => STATUS_LABEL[statusOf(r.id)],
      type: 'string',
      filterable: true,
      filterOptions: STATUS_OPTIONS.map((o) => ({ value: o.label, label: o.label })),
      filterValue: (r) => STATUS_LABEL[statusOf(r.id)],
      render: (r) => {
        const s = statusOf(r.id);
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
                handleStatusChange(r.id, e.target.value as ArticleBacklogStatus);
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
      accessor: (r) => NEXT_ACTION[statusOf(r.id)],
      type: 'string',
      filterable: true,
      filterOptions: Array.from(
        new Set(Object.values(NEXT_ACTION).filter((v) => v !== '—')),
      ).map((v) => ({ value: v, label: v })),
      filterValue: (r) => NEXT_ACTION[statusOf(r.id)],
      render: (r) => <Text>{NEXT_ACTION[statusOf(r.id)]}</Text>,
    },
    {
      key: 'assignee',
      label: 'Assignee',
      description: 'Editor assigned to take this article through the workflow.',
      width: 200,
      verticalAlign: 'middle',
      align: 'left',
      accessor: (r) => assigneeOf(r.id) || null,
      type: 'string',
      filterable: true,
      filterOptions: [
        { value: '__unassigned__', label: 'Unassigned' },
        ...assignableUsers.map((u) => ({
          value: u.email,
          label: u.name ?? u.email,
        })),
      ],
      filterValue: (r) => assigneeOf(r.id) || '__unassigned__',
      render: (r) => (
        <select
          aria-label="Assignee"
          style={inlineSelectStyle}
          value={assigneeOf(r.id)}
          onChange={(e) => handleAssigneeChange(r.id, e.target.value)}
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
      render: (r) =>
        r.type === 'update' ? (
          <Text size="xs" color="secondary">
            —
          </Text>
        ) : (
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
        ),
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
          <StartWritingButton
            slug={slug}
            articleRecordId={r.id}
            hasSources={r.sourcesCount > 0}
            initialRun={initialWritingRuns?.[r.id] ?? null}
          />
        ),
    },
  ];

  const drawerRow = drawerArticleId ? rows.find((r) => r.id === drawerArticleId) : null;
  const drawerSources = drawerArticleId
    ? (initialSourcesByArticle[drawerArticleId] ?? [])
    : [];
  const managerRow = managerArticleId
    ? (rows.find((r) => r.id === managerArticleId) ?? null)
    : null;

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
      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(r) => r.id}
        onRowClick={(r) => setManagerArticleId(r.id)}
        countAddendum={() => 'articles'}
        leadingNote={`${rows.length} approved · ${counts.published} published · ${counts.inProgress} in progress · ${counts.waiting} waiting for sources`}
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
            currentStatus: statusOf(managerArticleId),
            sources: initialSourcesByArticle[managerArticleId] ?? [],
            initialComments: initialCommentsByArticle[managerArticleId] ?? [],
            initialNotes: backlog[managerArticleId]?.notes ?? '',
            categoryLookup,
            viewerEmail,
            onStatusChange: (next, notes) =>
              handleStatusChange(managerArticleId, next, notes),
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
            currentStatus: statusOf(managerArticleId),
            initialComments: initialCommentsByArticle[managerArticleId] ?? [],
            initialNotes: backlog[managerArticleId]?.notes ?? '',
            categoryLookup,
            viewerEmail,
            onStatusChange: (next, notes) =>
              handleStatusChange(managerArticleId, next, notes),
          }}
          onClose={() => setManagerArticleId(null)}
        />
      )}
    </Stack>
  );
}
