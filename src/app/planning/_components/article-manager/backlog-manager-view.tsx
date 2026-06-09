'use client';

// New-article backlog surface (type='new', stage='backlog') plus its private
// helpers: ArticleBar, DraftRunBadge, SourcesSection, ClickableStatusBadge,
// ReSearchSourcesButton. Extracted verbatim from article-manager-modal-v2.tsx.

import {
  Badge,
  Button,
  Inline,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type {
  ArticleBacklogStatus,
  ArticleDraftRunRecord,
  ArticleLitSearchRunRecord,
  ArticleSourceRecord,
} from '@/lib/pb/types';
import { resetArticle } from '../../[specialty]/actions';
import { AddSourceModal } from '../add-source-modal';
import { AnimatedDotsBadge } from '../animated-dots-badge';
import {
  type ArticleManagerPhase,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_OPTIONS,
  statusOptionValue,
} from '../backlog-constants';
import { CodeChipList } from '../code-chip';
import { CommentsSection } from '../comments-section';
import { DraftArticleButton, DraftLinksMenu } from '../draft-article-button';
import { LitSearchPhase1Panel } from '../lit-search-phase1-panel';
import { LitSearchProgressBadge } from '../lit-search-progress-badge';
import {
  canDraft,
  canRunLitSearch,
  canStartDraft,
  missingCortexIdCount,
  phaseFromStatus,
} from '../pipeline-stage-gates';
import { deriveLitSearchSnapshot } from '../use-running-lit-search-articles';
import { DecisionNoteField, footerStyle, SharedHeader } from './shared';
import { SourcesTable } from './sources-table';
import type { BacklogOpener } from './types';

export function BacklogManagerView({
  opener,
  onClose,
}: {
  opener: BacklogOpener;
  onClose: () => void;
}) {
  const {
    slug,
    article,
    currentStatus: openerCurrentStatus,
    currentBacklogRow,
    sources: openerSources,
    litSearchRuns: openerLitSearchRuns,
    draftRun,
    initialComments,
    initialNotes,
    categoryLookup,
    viewerEmail,
    onStatusChange,
    onPipelineActionTriggered,
    onPrev,
    onNext,
    position,
  } = opener;
  const router = useRouter();
  const [notes, setNotes] = useState<string>(initialNotes);
  const [pendingNotes, setPendingNotes] = useState<string>(initialNotes);
  const [savingNotes, setSavingNotes] = useState(false);
  const [resetting, setResetting] = useState(false);
  const notesDirty = pendingNotes !== notes;

  // The DS Modal doesn't lock body scroll, so wheel events that don't get
  // absorbed by the modal's own scroll container chain up to the page.
  // Lock body overflow while the modal is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Read modal state directly from the opener props. The parent already
  // runs PB subscriptions (via `useApprovalState`) AND polls
  // `router.refresh()` on pipeline actions, so the props it passes are
  // always fresh — and the snapshotToken-based reseed inside our own
  // `useLiveCollection` calls used to silently fail when PB's `updated`
  // string didn't visibly change between refreshes, freezing the badge.
  // Reading the props directly eliminates that failure mode entirely.
  const currentStatus = currentBacklogRow?.status ?? openerCurrentStatus;
  const sources = openerSources;
  const litSearchSnapshot = useMemo(
    () => deriveLitSearchSnapshot(openerLitSearchRuns ?? []),
    [openerLitSearchRuns],
  );
  const isLitSearchRunning = litSearchSnapshot.inFlight.has(article.articleKey);
  const isDraftRunning = draftRun?.status === 'running';

  async function pickStatus(next: ArticleBacklogStatus) {
    // Persist any dirty notes with the same status write so the user
    // doesn't have to click two buttons.
    await onStatusChange(next, notesDirty ? pendingNotes : undefined);
    if (notesDirty) setNotes(pendingNotes);
  }

  async function saveNotesOnly() {
    if (!notesDirty || savingNotes) return;
    setSavingNotes(true);
    try {
      await onStatusChange(currentStatus, pendingNotes);
      setNotes(pendingNotes);
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <Modal
      header={article.articleTitle ?? 'Manage article'}
      isFullScreen
      isDismissible
      onAction={() => onClose()}
      privateProps={{ height: '90vh' }}
      closeButtonAriaLabel="Close manager"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            paddingBottom: 12,
          }}
        >
          <SharedHeader
            title={article.articleTitle ?? '(untitled)'}
            decisionBadge={null}
            decisionBadgeNode={
              isLitSearchRunning ? (
                <LitSearchProgressBadge />
              ) : isDraftRunning ? (
                <AnimatedDotsBadge label="Drafting" color="blue" />
              ) : (
                <ClickableStatusBadge
                  status={currentStatus}
                  onStatusChange={pickStatus}
                />
              )
            }
            metaInline={
              <Inline space="s">
                {article.articleType && (
                  <Text size="xs" color="secondary">
                    Type: {article.articleType}
                  </Text>
                )}
                <Text size="xs" color="secondary">
                  # Codes: {article.codes.length}
                </Text>
                <Text size="xs" color="secondary">
                  # Sources: {article.sourcesCount}
                </Text>
              </Inline>
            }
          />

          {article.codes.length > 0 && (
            <Stack space="xs">
              <Text size="s" weight="bold">
                Codes ({article.codes.length})
              </Text>
              <CodeChipList codes={article.codes} categoryLookup={categoryLookup} />
            </Stack>
          )}

          {sources.length > 0 || canDraft(currentStatus) || draftRun ? (
            <ArticleBar
              slug={slug}
              articleKey={article.articleKey}
              articleRecordId={article.id}
              articleTitle={article.articleTitle ?? ''}
              sources={sources}
              viewerEmail={viewerEmail}
              draftRun={draftRun ?? null}
              status={currentStatus}
            />
          ) : null}
          <SourcesSection
            slug={slug}
            articleKey={article.articleKey}
            articleRecordId={article.id}
            sources={sources}
            status={currentStatus}
            litSearchRuns={openerLitSearchRuns ?? []}
            viewerEmail={viewerEmail}
            isLitSearchRunning={isLitSearchRunning}
            onPipelineActionTriggered={onPipelineActionTriggered}
          />

          <DecisionNoteField
            value={pendingNotes}
            onChange={setPendingNotes}
            placeholder="Status note (optional — saved with the next status change, or via Save note)"
          />
          {notesDirty && (
            <Inline space="s">
              <Button
                variant="secondary"
                size="s"
                onClick={saveNotesOnly}
                disabled={savingNotes}
              >
                {savingNotes ? 'Saving…' : 'Save note'}
              </Button>
              <Button
                variant="tertiary"
                size="s"
                onClick={() => setPendingNotes(notes)}
                disabled={savingNotes}
              >
                Revert
              </Button>
            </Inline>
          )}

          <CommentsSection
            slug={slug}
            recordKind="article"
            recordKey={article.articleKey}
            recordId={article.id}
            initialComments={initialComments}
            viewerEmail={viewerEmail}
          />

          <div
            style={{
              marginTop: 8,
              paddingTop: 16,
              borderTop: '1px solid rgba(0, 0, 0, 0.08)',
            }}
          >
            <Stack space="xs">
              <Text size="xs" color="secondary" weight="bold">
                Danger zone
              </Text>
              <Inline space="s" vAlignItems="center">
                <button
                  type="button"
                  disabled={resetting}
                  onClick={async () => {
                    if (resetting) return;
                    const ok = window.confirm(
                      `Reset "${article.articleTitle ?? '(untitled)'}" to a blank slate?\n\n` +
                        `This deletes ALL sources, comments, draft runs, ` +
                        `and draft outputs for this article. The article ` +
                        `stays approved and remains in your backlog at ` +
                        `the "Search sources" phase.\n\n` +
                        `This cannot be undone.`,
                    );
                    if (!ok) return;
                    setResetting(true);
                    try {
                      await resetArticle(slug, article.articleKey, article.id);
                      // Pulse the parent's polling window. A single
                      // `router.refresh()` here used to race the
                      // `revalidatePath` cache commit and sometimes pulled
                      // the pre-reset snapshot; the parent pulse fires an
                      // immediate refresh AND polls for 30s, so the modal
                      // header badge + the backlog table row both catch
                      // up without a manual reload. Keep the modal open
                      // so the user sees the article is still here, just
                      // back at phase 1.
                      if (onPipelineActionTriggered) {
                        onPipelineActionTriggered();
                      } else {
                        router.refresh();
                      }
                      setResetting(false);
                    } catch (e) {
                      log('reset-article').error('failed', e);
                      setResetting(false);
                      window.alert(`Reset failed: ${errorMessage(e)}`);
                    }
                  }}
                  style={{
                    background: 'white',
                    color: 'rgb(180, 30, 30)',
                    border: '1px solid rgb(220, 160, 160)',
                    padding: '6px 12px',
                    borderRadius: 4,
                    fontSize: 13,
                    cursor: resetting ? 'wait' : 'pointer',
                    opacity: resetting ? 0.6 : 1,
                  }}
                >
                  {resetting ? 'Resetting…' : 'Reset article'}
                </button>
                <Text size="xs" color="secondary">
                  Wipes sources, comments, and drafts. Keeps the article approved and in
                  your backlog.
                </Text>
              </Inline>
            </Stack>
          </div>
        </div>
        {(onPrev || onNext) && (
          <div style={footerStyle}>
            <Button variant="tertiary" onClick={onPrev} disabled={!onPrev}>
              ← Prev
            </Button>
            <Button variant="tertiary" onClick={onNext} disabled={!onNext}>
              Next →
            </Button>
            {position && (
              <Text size="xs" color="secondary">
                {position.index + 1} / {position.total}
              </Text>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Stacked layout: a slim Article bar on top (draft controls + on-demand
// preview) and the Sources work area below (Approve/Prioritize toggle + the
// sources table). Replaces the old two-tab presentation — the status engine
// (phaseFromStatus / pickStatus / the clickable header badge) is unchanged.
// ---------------------------------------------------------------------------

// The draft-run status badge (animated while running) — rendered next to the
// "Article status" header so the action buttons can sit on the line below.
function DraftRunBadge({ run }: { run: ArticleDraftRunRecord | null }) {
  if (!run) return null;
  if (run.status === 'running') {
    return <AnimatedDotsBadge label="Drafting" color="blue" />;
  }
  if (run.status === 'completed') return <Badge text="Drafted" color="green" />;
  if (run.status === 'failed') return <Badge text="Failed" color="gray" />;
  return <Badge text="Cancelled" color="gray" />;
}

// Article-status section — the badge sits on the header line; the
// DraftArticleButton (draft / re-draft / cancel + Drafts links) and "Mark
// published" sit on the line below. Rendered only once the article can be
// drafted or already has a run.
function ArticleBar({
  slug,
  articleKey,
  articleRecordId,
  articleTitle,
  sources,
  viewerEmail,
  draftRun,
  status,
}: {
  slug: string;
  articleKey: string;
  articleRecordId: string;
  articleTitle: string;
  sources: ArticleSourceRecord[];
  viewerEmail?: string;
  draftRun: ArticleDraftRunRecord | null;
  status: ArticleBacklogStatus;
}) {
  const completed = draftRun?.status === 'completed';
  const draftLinks =
    completed && Array.isArray(draftRun?.outputLinks) ? draftRun.outputLinks : [];
  const runFolderUrl = completed ? (draftRun?.outputUrl ?? null) : null;
  // Drafting unlocks only once every approved source carries a Source ID.
  const draftReady = canStartDraft(sources);
  const hasApproved = sources.some((s) => s.reviewStatus === 'approved');
  const draftDisabledHint = draftReady
    ? undefined
    : hasApproved
      ? `Add a Source ID to every approved source (${missingCortexIdCount(sources)} missing).`
      : 'Approve at least one source to draft.';
  return (
    <Stack space="xs">
      <Inline space="s" vAlignItems="center">
        <Text size="s" weight="bold">
          Article status
        </Text>
        <DraftRunBadge run={draftRun} />
        <DraftLinksMenu links={draftLinks} folderUrl={runFolderUrl} />
      </Inline>
      <Inline space="s" vAlignItems="center">
        <DraftArticleButton
          slug={slug}
          articleRecordId={articleRecordId}
          articleKey={articleKey}
          articleTitle={articleTitle}
          sources={sources}
          hasSources={sources.length > 0}
          viewerEmail={viewerEmail}
          initialRun={draftRun}
          hideBadge
          hideDrafts
          draftReady={draftReady}
          draftDisabledHint={draftDisabledHint}
        />
        {status === 'published' ? (
          <Text size="xs" color="secondary">
            Published
          </Text>
        ) : null}
      </Inline>
    </Stack>
  );
}

// Sources work area — the main body of the modal. Before any sources land it's
// the literature-search entry point; afterwards it's an Approve/Prioritize
// toggle over the sources table, plus Re-search.
function SourcesSection({
  slug,
  articleKey,
  articleRecordId,
  sources,
  status,
  litSearchRuns,
  viewerEmail,
  isLitSearchRunning,
  onPipelineActionTriggered,
}: {
  slug: string;
  articleKey: string;
  articleRecordId: string;
  sources: ArticleSourceRecord[];
  status: ArticleBacklogStatus;
  litSearchRuns: ArticleLitSearchRunRecord[];
  viewerEmail?: string;
  isLitSearchRunning: boolean;
  onPipelineActionTriggered?: () => void;
}) {
  const [view, setView] = useState<'approve' | 'prioritize'>(
    phaseFromStatus(status) >= 3 ? 'prioritize' : 'approve',
  );
  const [addSourceOpen, setAddSourceOpen] = useState(false);

  // No sources yet → the search entry point. Results fill the table below.
  if (canRunLitSearch(status, sources.length)) {
    return (
      <LitSearchPhase1Panel
        slug={slug}
        articleKey={articleKey}
        articleRecordId={articleRecordId}
        copy={PHASE_COPY[1]}
        initialRuns={litSearchRuns}
        onTriggered={onPipelineActionTriggered}
      />
    );
  }

  const approvedSorted = sources
    .filter((s) => s.reviewStatus === 'approved')
    .slice()
    .sort(
      (a, b) =>
        (a.priority ?? Number.POSITIVE_INFINITY) -
        (b.priority ?? Number.POSITIVE_INFINITY),
    );
  const draftReady = canStartDraft(sources);
  const missingIds = missingCortexIdCount(sources);

  return (
    <Stack space="xs">
      <Text size="s" weight="bold">
        Sources
      </Text>
      <Inline space="s" vAlignItems="center">
        <SegmentedControl
          label="Sources view"
          isLabelHidden
          value={view}
          onChange={(v) => setView(v === 'prioritize' ? 'prioritize' : 'approve')}
          size="s"
          options={[
            { name: 'sources-view', value: 'approve', label: 'Approve' },
            { name: 'sources-view', value: 'prioritize', label: 'Prioritize' },
          ]}
        />
        <ReSearchSourcesButton
          slug={slug}
          articleRecordId={articleRecordId}
          running={isLitSearchRunning}
          onTriggered={onPipelineActionTriggered}
        />
      </Inline>
      {view === 'approve' ? (
        <>
          <Text size="xs" color="secondary">
            {PHASE_COPY[2]}
          </Text>
          <SourcesTable
            sources={sources}
            slug={slug}
            viewerEmail={viewerEmail}
            mode="curation"
          />
        </>
      ) : (
        <>
          <Text size="xs" color="secondary">
            {PHASE_COPY[3]}
          </Text>
          <SourcesTable
            sources={approvedSorted}
            slug={slug}
            viewerEmail={viewerEmail}
            mode="priority"
          />
          <Inline space="s" vAlignItems="center">
            <Button
              variant="secondary"
              size="s"
              leftIcon="plus"
              onClick={() => setAddSourceOpen(true)}
            >
              Add source
            </Button>
            {!draftReady ? (
              <Text size="xs" color="secondary">
                {missingIds > 0
                  ? `Paste Source IDs for ${missingIds} more source${missingIds === 1 ? '' : 's'} — drafting unlocks once every approved source has one.`
                  : 'Approve at least one source to draft.'}
              </Text>
            ) : null}
          </Inline>
          <AddSourceModal
            open={addSourceOpen}
            slug={slug}
            articleKey={articleKey}
            articleRecordId={articleRecordId}
            onClose={() => setAddSourceOpen(false)}
          />
        </>
      )}
    </Stack>
  );
}

// Transparent native <select> overlaid on the status Badge in the modal
// header — click the badge to pick any status directly (same pattern as the
// backlog table's status column). This is the single status control: there's
// no separate "set status" dropdown or "back one stage" button.
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

function ClickableStatusBadge({
  status,
  onStatusChange,
}: {
  status: ArticleBacklogStatus;
  onStatusChange: (next: ArticleBacklogStatus) => void | Promise<void>;
}) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
      <Badge text={STATUS_LABEL[status]} color={STATUS_COLOR[status]} />
      <select
        aria-label="Status"
        style={statusOverlayStyle}
        value={statusOptionValue(status)}
        onChange={(e) => void onStatusChange(e.target.value as ArticleBacklogStatus)}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

// Re-search trigger for the Sources tab — re-runs the literature search even
// after sources exist (force flag), replacing the current candidate set.
// Shown once sources are present; the initial search is the Approve step's
// empty-state panel.
function ReSearchSourcesButton({
  slug,
  articleRecordId,
  running,
  onTriggered,
}: {
  slug: string;
  articleRecordId: string;
  /** A literature search is already in flight for this article. */
  running: boolean;
  onTriggered?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async () => {
    if (busy || running) return;
    const ok = window.confirm(
      'Re-searching replaces the current sources (and their approve / Source-ID ' +
        'decisions) with a fresh candidate set, and returns the article to the ' +
        'Approve step. Continue?',
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    onTriggered?.();
    try {
      const res = await fetch('/api/workflows/literature-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug: slug,
          articleRecordIds: [articleRecordId],
          force: true,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        skipped?: boolean;
        reason?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      if (body.skipped) {
        setError(
          body.reason === 'already_running'
            ? 'Search already in progress'
            : 'Not eligible for re-search',
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Inline space="xs" vAlignItems="center">
      <Button
        variant="secondary"
        size="s"
        disabled={busy || running}
        onClick={() => void onClick()}
      >
        {busy || running ? 'Searching…' : 'Re-search sources'}
      </Button>
      {error ? (
        <Text size="xs" color="error">
          {error}
        </Text>
      ) : null}
    </Inline>
  );
}

const PHASE_COPY: Record<ArticleManagerPhase, string> = {
  1: 'No sources fetched yet. Run a literature search to gather and rank candidates from Gemini web search, PubMed, and Google Scholar for this article.',
  2: 'The LLM ranked these sources. Approve the ones to keep and reject the rest — approved sources show up in the Prioritize step.',
  3: 'Drag to reorder by priority. Paste the Cortex Source ID for every approved source — the draft step needs all of them.',
  4: 'Article draft is being generated. The dispatcher runs up to 3 articles concurrently.',
  5: 'Preview the latest draft. Continue editing in Cortex; set the status from the header badge when the article moves forward.',
  6: 'Final QC check before publishing. Mark as published when the article is live.',
  7: 'Article is published.',
};
