'use client';

// Sources table (curation + priority modes), resizable headers, and the
// per-cell inline editors. Extracted verbatim from article-manager-modal-v2.tsx.

import {
  Badge,
  Button,
  Inline,
  PictogramButton,
  Stack,
  Text,
} from '@amboss/design-system';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type { ArticleSourceRecord, SourceReviewStatus } from '@/lib/pb/types';
import { isSafeUrl } from '@/lib/url';
import {
  fetchSourceMetadataForSource,
  registerSourceInCortex,
  submitSourceCortexId,
  submitSourceDoi,
  submitSourceNotes,
  submitSourceReview,
  submitSourcesOrder,
  submitSourceUrl,
} from '../../[specialty]/actions';
import { decideButton } from './shared';

const SOURCE_TYPE_LABEL: Record<string, string> = {
  guideline: 'Guideline',
  systematic_review: 'Systematic review',
  clinical_review: 'Clinical review',
  meta_analysis: 'Meta-analysis',
  case_report: 'Case report',
  vet_content: 'Vet content',
  non_english: 'Non-English',
  other: 'Other',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9em',
  tableLayout: 'fixed',
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid rgb(220, 220, 225)',
  borderRight: '1px solid var(--ads-c-divider, rgba(0, 0, 0, 0.08))',
  padding: '8px 6px',
  fontWeight: 600,
  color: 'rgb(70, 70, 80)',
  background: 'rgb(248, 248, 250)',
  position: 'sticky',
  top: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};
const tdStyle: CSSProperties = {
  borderBottom: '1px solid rgb(238, 238, 242)',
  borderRight: '1px solid var(--ads-c-divider, rgba(0, 0, 0, 0.08))',
  padding: '8px 6px',
  verticalAlign: 'top',
  overflow: 'hidden',
  wordBreak: 'break-word',
};

type SourceColumn = {
  key: string;
  label: string;
  initialWidth: number;
  /** Defaults to true. The trailing decision column and the leading drag
   *  handle don't get a resize grip. */
  resizable?: boolean;
};

const MIN_COL_WIDTH = 32;

function ResizableHeader({
  column,
  onResize,
}: {
  column: SourceColumn;
  onResize: (width: number) => void;
}) {
  const thRef = useRef<HTMLTableCellElement | null>(null);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = thRef.current?.getBoundingClientRect().width ?? MIN_COL_WIDTH;
      const move = (ev: MouseEvent) => {
        onResize(startWidth + (ev.clientX - startX));
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [onResize],
  );
  const resizable = column.resizable !== false;
  return (
    <th ref={thRef} style={{ ...thStyle, position: 'sticky', top: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {column.label}
        </span>
        {resizable ? (
          <span
            onMouseDown={onMouseDown}
            style={{
              width: 6,
              flex: 'none',
              cursor: 'col-resize',
              alignSelf: 'stretch',
              marginRight: -6,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </th>
  );
}

export function SourcesTable({
  sources,
  slug,
  viewerEmail,
  mode,
}: {
  sources: ArticleSourceRecord[];
  slug: string;
  viewerEmail?: string;
  mode: 'curation' | 'priority';
}) {
  // Local order is the source of truth for the priority view so DnD
  // feels immediate; reconciled with props when the modal's live
  // subscription emits a fresh row set.
  const [order, setOrder] = useState<string[]>(() => sources.map((s) => s.id));
  useEffect(() => {
    setOrder(sources.map((s) => s.id));
  }, [sources]);

  const byId = useMemo(() => {
    const m: Record<string, ArticleSourceRecord> = {};
    for (const s of sources) m[s.id] = s;
    return m;
  }, [sources]);

  const ordered =
    mode === 'priority' ? order.map((id) => byId[id]).filter(Boolean) : sources;

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  // Column widths are persisted per mode (curation vs priority) so the
  // two views remember their own layouts independently.
  const widthsStorageKey = `sources-table:widths:${mode}`;
  const [widths, setWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(widthsStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const cleaned: Record<string, number> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_COL_WIDTH) {
            cleaned[k] = v;
          }
        }
        setWidths(cleaned);
      }
    } catch {
      /* corrupt blob — ignore */
    }
  }, [widthsStorageKey]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Object.keys(widths).length === 0) return;
    try {
      window.localStorage.setItem(widthsStorageKey, JSON.stringify(widths));
    } catch {
      /* quota or disabled — silent */
    }
  }, [widths, widthsStorageKey]);

  const onDrop = useCallback(async () => {
    if (!dragId || !dropId || dragId === dropId) {
      setDragId(null);
      setDropId(null);
      return;
    }
    const from = order.indexOf(dragId);
    const to = order.indexOf(dropId);
    if (from === -1 || to === -1) return;
    const next = order.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setOrder(next);
    setDragId(null);
    setDropId(null);
    try {
      await submitSourcesOrder(slug, next);
    } catch (e) {
      log('sources-order').error('submit failed', e);
    }
  }, [dragId, dropId, order, slug]);

  if (sources.length === 0) {
    return (
      <Stack space="s">
        <Text>
          {mode === 'priority'
            ? 'No approved sources yet — approve sources in the previous step.'
            : 'No sources attached yet.'}
        </Text>
        {mode === 'curation' ? (
          <Text size="s" color="secondary">
            Run the Literature search card on the Pipeline tab to fetch PubMed candidates
            for every article still waiting for sources.
          </Text>
        ) : null}
      </Stack>
    );
  }

  const columnList: SourceColumn[] =
    mode === 'priority'
      ? [
          { key: 'drag', label: '', initialWidth: 28, resizable: false },
          { key: 'sourceId', label: 'Source ID', initialWidth: 160 },
          { key: 'title', label: 'Title', initialWidth: 320 },
          { key: 'type', label: 'Type', initialWidth: 140 },
          { key: 'journal', label: 'Journal', initialWidth: 220 },
          { key: 'url', label: 'URL', initialWidth: 160 },
          { key: 'doi', label: 'DOI', initialWidth: 180 },
          { key: 'notes', label: 'Notes', initialWidth: 220 },
          { key: 'decision', label: 'Decision', initialWidth: 110, resizable: false },
        ]
      : [
          { key: 'title', label: 'Title', initialWidth: 360 },
          { key: 'type', label: 'Type', initialWidth: 140 },
          { key: 'journal', label: 'Journal', initialWidth: 240 },
          { key: 'url', label: 'URL', initialWidth: 160 },
          { key: 'doi', label: 'DOI', initialWidth: 200 },
          { key: 'notes', label: 'Notes', initialWidth: 220 },
          { key: 'decision', label: 'Decision', initialWidth: 110, resizable: false },
        ];

  return (
    <div
      style={{
        maxHeight: '40vh',
        overflow: 'auto',
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      <table style={tableStyle}>
        <colgroup>
          {columnList.map((c) => (
            <col key={c.key} style={{ width: widths[c.key] ?? c.initialWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columnList.map((c) => (
              <ResizableHeader
                key={c.key}
                column={c}
                onResize={(next) =>
                  setWidths((w) => ({ ...w, [c.key]: Math.max(MIN_COL_WIDTH, next) }))
                }
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => {
            const isDragging = dragId === s.id;
            const isDropTarget = dropId === s.id && dragId !== s.id;
            return (
              <tr
                key={s.id}
                onDragOver={(e) => {
                  if (mode !== 'priority' || !dragId) return;
                  e.preventDefault();
                  if (dropId !== s.id) setDropId(s.id);
                }}
                onDrop={(e) => {
                  if (mode !== 'priority') return;
                  e.preventDefault();
                  void onDrop();
                }}
                style={{
                  opacity: isDragging ? 0.4 : 1,
                  boxShadow: isDropTarget ? 'inset 0 2px 0 rgb(59, 130, 246)' : undefined,
                }}
              >
                {mode === 'priority' ? (
                  <>
                    <td
                      style={{ ...tdStyle, textAlign: 'center', cursor: 'grab' }}
                      draggable
                      onDragStart={() => setDragId(s.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropId(null);
                      }}
                      title="Drag to reorder"
                      aria-label="Drag to reorder"
                    >
                      ≡
                    </td>
                    <td style={tdStyle}>
                      <SourceIdCell source={s} slug={slug} />
                    </td>
                  </>
                ) : null}
                <td style={tdStyle}>
                  <Text weight="bold">{s.title}</Text>
                  {s.llmSummary ? (
                    <Text size="xs" color="secondary">
                      {s.llmSummary}
                    </Text>
                  ) : null}
                </td>
                <td style={tdStyle}>
                  {s.sourceType ? (
                    <Badge
                      text={SOURCE_TYPE_LABEL[s.sourceType] ?? s.sourceType}
                      color="blue"
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td style={tdStyle}>
                  {s.journal ?? '—'}
                  {s.journalNlm ? (
                    <Text size="xs" color="secondary">
                      {s.journalNlm}
                    </Text>
                  ) : null}
                </td>
                <td style={tdStyle}>
                  <SourceUrlCell source={s} slug={slug} />
                </td>
                <td style={tdStyle}>
                  <SourceDoiCell source={s} slug={slug} />
                </td>
                <td style={tdStyle}>
                  <SourceNotesCell source={s} slug={slug} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <SourceDecisionCell source={s} slug={slug} viewerEmail={viewerEmail} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceIdCell({ source, slug }: { source: ArticleSourceRecord; slug: string }) {
  const [value, setValue] = useState<string>(source.cortexSourceId ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.cortexSourceId ?? '');
  }, [source.cortexSourceId]);

  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.cortexSourceId ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceCortexId(slug, source.id, trimmed);
    } catch (e) {
      log('source-id').error('submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.cortexSourceId, slug]);

  // Create this one source in Cortex (enriching from its DOI first) and fill in
  // the Source ID. The new cortexSourceId flows back via the live row.
  const register = useCallback(async () => {
    if (registering) return;
    setRegistering(true);
    setError(null);
    try {
      const res = await registerSourceInCortex(slug, source.id);
      if (!res.ok) setError(res.error ?? 'Registration failed');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRegistering(false);
    }
  }, [registering, slug, source.id]);

  const registered = Boolean(source.cortexSourceId);

  return (
    <Stack space="xxs">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={submitting || registering}
        placeholder="Paste source ID"
        style={{
          width: '100%',
          padding: '4px 6px',
          fontSize: 12,
          border: '1px solid rgba(0, 0, 0, 0.15)',
          borderRadius: 4,
          background: '#fff',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      />
      {!registered && (
        <Inline space="xxs" vAlignItems="center">
          <Button
            size="s"
            variant="secondary"
            leftIcon="plus"
            loading={registering}
            onClick={() => void register()}
          >
            Register
          </Button>
          {error && (
            <Text size="xs" color="error">
              {error}
            </Text>
          )}
        </Inline>
      )}
    </Stack>
  );
}

// Borderless input that looks like plain text in the cell. The browser's
// native focus ring marks the active field; cursor switches to text on
// hover so the affordance is discoverable.
const editableInputStyle: CSSProperties = {
  width: '100%',
  padding: '2px 4px',
  fontSize: 'inherit',
  fontFamily: 'inherit',
  color: 'inherit',
  border: '1px solid transparent',
  borderRadius: 3,
  background: 'transparent',
};

const openLinkStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 3,
  textDecoration: 'none',
  fontSize: 12,
  lineHeight: 1,
  color: 'inherit',
  opacity: 0.6,
};

function SourceUrlCell({ source, slug }: { source: ArticleSourceRecord; slug: string }) {
  const [value, setValue] = useState<string>(source.url ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.url ?? '');
  }, [source.url]);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.url ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceUrl(slug, source.id, trimmed);
    } catch (e) {
      log('source-url').error('submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.url, slug]);

  const trimmed = value.trim();
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={submitting}
        placeholder="Paste URL"
        style={editableInputStyle}
      />
      {trimmed && isSafeUrl(trimmed) && (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          title="Open URL"
          style={openLinkStyle}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function SourceDoiCell({ source, slug }: { source: ArticleSourceRecord; slug: string }) {
  const [value, setValue] = useState<string>(source.doi ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.doi ?? '');
  }, [source.doi]);

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.doi ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceDoi(slug, source.id, trimmed);
    } catch (e) {
      log('source-doi').error('submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.doi, slug]);

  // Pull title + journal from the DOI. Only offered before the source is
  // registered, so it can't clobber a source already written to Cortex.
  const fetchMeta = useCallback(async () => {
    if (fetching) return;
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetchSourceMetadataForSource(slug, source.id);
      if (!res.ok) setFetchError(res.error ?? 'Fetch failed');
    } catch (e) {
      setFetchError(errorMessage(e));
    } finally {
      setFetching(false);
    }
  }, [fetching, slug, source.id]);

  const trimmed = value.trim();
  const canFetch = trimmed.length > 0 && !source.cortexSourceId;
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={submitting || fetching}
        placeholder="Paste DOI"
        style={editableInputStyle}
      />
      {canFetch && (
        <PictogramButton
          icon="rotate-cw"
          size="xs"
          variant="tertiary"
          label={
            fetching
              ? 'Fetching…'
              : fetchError
                ? `Fetch failed: ${fetchError}`
                : 'Fetch title + journal from DOI'
          }
          disabled={fetching}
          onClick={() => void fetchMeta()}
        />
      )}
      {trimmed && (
        <a
          href={`https://doi.org/${trimmed}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open DOI"
          style={openLinkStyle}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function SourceNotesCell({
  source,
  slug,
}: {
  source: ArticleSourceRecord;
  slug: string;
}) {
  const [value, setValue] = useState<string>(source.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setValue(source.notes ?? '');
  }, [source.notes]);

  const persist = useCallback(async () => {
    const trimmed = value.trim();
    const current = source.notes ?? '';
    if (trimmed === current) return;
    setSubmitting(true);
    try {
      await submitSourceNotes(slug, source.id, trimmed);
    } catch (e) {
      log('source-notes').error('submit failed', e);
      setValue(current);
    } finally {
      setSubmitting(false);
    }
  }, [value, source.id, source.notes, slug]);

  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void persist()}
      onKeyDown={(e) => {
        // Enter saves and blurs; Shift+Enter inserts a newline so editors
        // can write multi-line notes.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      disabled={submitting}
      placeholder="Add note…"
      rows={2}
      style={{
        ...editableInputStyle,
        resize: 'vertical',
        minHeight: 36,
        lineHeight: 1.4,
      }}
    />
  );
}

function SourceDecisionCell({
  source,
  slug,
  viewerEmail,
}: {
  source: ArticleSourceRecord;
  slug: string;
  viewerEmail?: string;
}) {
  const [status, setStatus] = useState<SourceReviewStatus | null>(
    source.reviewStatus ?? null,
  );
  const [submitting, setSubmitting] = useState(false);

  // Reconcile with the parent's live source row — the modal subscribes
  // to `articleSources` via useLiveCollection, so an update from another
  // tab or a server-side flip propagates through props.
  useEffect(() => {
    setStatus(source.reviewStatus ?? null);
  }, [source.reviewStatus]);

  const toggle = useCallback(
    async (target: SourceReviewStatus) => {
      if (submitting) return;
      const next = status === target ? null : target;
      setSubmitting(true);
      setStatus(next);
      try {
        await submitSourceReview(slug, source.id, next);
      } catch (e) {
        setStatus(source.reviewStatus ?? null);
        log('source-review').error('submit failed', e);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, status, slug, source.id, source.reviewStatus],
  );

  const reviewerHandle = source.reviewerEmail ? source.reviewerEmail.split('@')[0] : '';
  const stamp = source.reviewedAt ? new Date(source.reviewedAt).toLocaleString() : '';
  const approveTitle =
    status === 'approved' && reviewerHandle
      ? `Approved by ${reviewerHandle}${stamp ? ` · ${stamp}` : ''}`
      : 'Approve source';
  const rejectTitle =
    status === 'rejected' && reviewerHandle
      ? `Rejected by ${reviewerHandle}${stamp ? ` · ${stamp}` : ''}`
      : 'Reject source';

  return (
    <Inline space="xxs" vAlignItems="center">
      <button
        type="button"
        style={decideButton(status === 'approved', 'approve')}
        title={approveTitle}
        disabled={submitting}
        onClick={() => toggle('approved')}
        aria-label={approveTitle}
      >
        ✓
      </button>
      <button
        type="button"
        style={decideButton(status === 'rejected', 'reject')}
        title={rejectTitle}
        disabled={submitting}
        onClick={() => toggle('rejected')}
        aria-label={rejectTitle}
      >
        ✗
      </button>
      {viewerEmail ? null : null}
    </Inline>
  );
}
