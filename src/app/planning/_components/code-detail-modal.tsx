'use client';

import {
  Badge,
  Button,
  Checkbox,
  Inline,
  Modal,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import type { CodeRunMetadata } from '@/lib/data/code-run-metadata';
import type { CodeTableRow, PatchCodeFields } from '@/lib/data/codes';
import { errorMessage } from '@/lib/error-message';
import { log } from '@/lib/log';
import type {
  CodeLitSourceRecord,
  CoveredSection as CoveredSectionRow,
  NewArticle as NewArticleRow,
  SectionUpdate as SectionUpdateRow,
} from '@/lib/pb/types';
import type { Code, CurriculumMeta, MappingSource, PipelineMode } from '@/lib/types';
import {
  formatDurationOrCadence,
  formatTimeframe,
} from '@/lib/workflows/lib/curriculum-meta';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { submitCodeLitSourceReview } from '../[specialty]/actions';
import { missingApiKeyProvider } from '../[specialty]/pipeline/_components/missing-api-key';
import { MissingKeyModal } from '../[specialty]/pipeline/_components/missing-key-modal';
import {
  backupModelKey,
  DEFAULT_BACKUP_MODEL,
  readSpec,
  readSpecForStage,
} from '../[specialty]/pipeline/_components/model-selection-storage';
import { AddCodeLitSourceModal } from './add-code-lit-source-modal';
import { CancelMappingButton } from './cancel-mapping-button';
import {
  ArticleUpdatesEditor,
  CoverageArticlesEditor,
  NewArticlesEditor,
  TextFieldsEditor,
} from './code-detail-edit-panels';
import { CoverageBadge, DepthBadge } from './suggestion-badge';

// The on-disk shape of these JSON columns is richer than the Zod type
// suggests (passthrough preserves the full object). We cast through these
// runtime types when rendering.
type CoveredSection = {
  articleTitle?: string;
  articleId?: string;
  sections?:
    | Record<string, string>
    | Array<{ sectionTitle?: string; sectionId?: string }>;
};

type SectionUpdate = {
  articleTitle?: string;
  articleId?: string;
  sections?: Array<{
    sectionTitle?: string;
    sectionId?: string;
    exists?: boolean;
    changes?: string;
    importance?: number;
  }>;
};

type NewArticleSuggestion = {
  articleTitle?: string;
  importance?: number;
};

type CoveredQuestion = {
  questionId?: string;
  questionStem?: string;
  studyObjectives?: string[];
  learningObjective?: string;
  competency?: string;
  system?: string;
  difficulty?: string;
};

type GuidelineCoverageItem = {
  guidelineTitle?: string;
  guidelineId?: string;
  organization?: string;
  year?: number;
  recommendations?:
    | Record<string, string>
    | Array<{ recommendationTitle?: string; recommendationId?: string }>;
};

function flattenRecommendations(
  block: GuidelineCoverageItem['recommendations'],
): Array<{ title: string; id: string }> {
  if (!block) return [];
  if (Array.isArray(block)) {
    return block
      .map((r) => ({
        title: r.recommendationTitle ?? '(unnamed)',
        id: r.recommendationId ?? '',
      }))
      .filter((r) => r.title || r.id);
  }
  return Object.entries(block).map(([title, id]) => ({ title, id }));
}

function flattenSections(
  block: CoveredSection['sections'],
): Array<{ title: string; id: string }> {
  if (!block) return [];
  if (Array.isArray(block)) {
    return block
      .map((s) => ({ title: s.sectionTitle ?? '(unnamed)', id: s.sectionId ?? '' }))
      .filter((s) => s.title || s.id);
  }
  return Object.entries(block).map(([title, id]) => ({ title, id }));
}

/**
 * Which tab the modal should open on. Lets callers (the table cells) deep-link
 * into the relevant section without the user having to click around.
 * `coverage-articles` is the default.
 */
export type DetailTarget =
  | 'coverage-articles'
  | 'coverage-notes'
  | 'suggestion-improvements'
  | 'suggestion-updates'
  | 'suggestion-new-articles'
  | 'guideline-coverage'
  | 'questions'
  | 'literature'
  | 'curriculum'
  | 'metadata';

type TabDef = { target: DetailTarget; label: string };

/**
 * The tabs shown depend on the specialty's `mappingSource` + `pipelineMode`,
 * mirroring the column gating in {@link codes-view}. We build the visible list
 * up front and switch panels on the active *target* (not a magic index) so the
 * set can vary without index drift.
 * - AMBOSS coverage / suggestions are only meaningful when the source includes
 *   AMBOSS (suggestions additionally require the full pipeline — they're an
 *   AMBOSS-only concept never produced on guideline-only / non-full runs).
 * - Guideline-only specialties surface guideline coverage *in* the Coverage tab
 *   (no separate Guidelines tab); `both` keeps Coverage = articles + a dedicated
 *   Guidelines tab.
 * - Literature is the rag-corpus reference corpus.
 */
function buildVisibleTabs(opts: {
  showAmboss: boolean;
  showGuidelines: boolean;
  showSuggestions: boolean;
  showQuestions: boolean;
  showLiterature: boolean;
  showCurriculum: boolean;
}): TabDef[] {
  const tabs: TabDef[] = [
    { target: 'coverage-articles', label: 'Coverage' },
    { target: 'coverage-notes', label: 'Coverage Notes & Gaps' },
  ];
  if (opts.showSuggestions) {
    tabs.push(
      { target: 'suggestion-improvements', label: 'Improvements' },
      { target: 'suggestion-updates', label: 'Article Updates' },
      { target: 'suggestion-new-articles', label: 'New Articles' },
    );
  }
  if (opts.showGuidelines && opts.showAmboss) {
    tabs.push({ target: 'guideline-coverage', label: 'Guidelines' });
  }
  if (opts.showQuestions) {
    tabs.push({ target: 'questions', label: 'Questions' });
  }
  if (opts.showLiterature) {
    tabs.push({ target: 'literature', label: 'Literature' });
  }
  if (opts.showCurriculum) {
    tabs.push({ target: 'curriculum', label: 'Curriculum' });
  }
  tabs.push({ target: 'metadata', label: 'Metadata' });
  return tabs;
}

function targetToIndex(tabs: TabDef[], target: DetailTarget | undefined): number {
  if (!target) return 0;
  const i = tabs.findIndex((t) => t.target === target);
  return i === -1 ? 0 : i;
}

// Which targets carry an inline editor (full-array / notes replacement).
const EDITABLE_TARGETS = new Set<DetailTarget>([
  'coverage-articles',
  'coverage-notes',
  'suggestion-improvements',
  'suggestion-updates',
  'suggestion-new-articles',
]);

// Curriculum approval footer buttons. Fixed appearance regardless of the
// current decision — Approve is always green-filled, Reject is always an
// unfilled (outlined) button. The header badge conveys which one is selected.
const labeledDecisionBase: CSSProperties = {
  borderRadius: 4,
  padding: '8px 12px',
  fontSize: 14,
  fontWeight: 700,
  fontFamily: 'inherit',
  lineHeight: 1.1428571429,
};
function approveButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...labeledDecisionBase,
    // The AMBOSS Learning/Library primary-navigation green (dark green).
    background: '#0a5c45',
    border: '1px solid #0a5c45',
    color: '#fff',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
function rejectButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...labeledDecisionBase,
    background: '#fff',
    border: '1px solid rgba(0, 0, 0, 0.2)',
    color: 'inherit',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

export function CodeDetailModal({
  row,
  target,
  specialtySlug,
  mappingSource,
  pipelineMode,
  canEdit,
  lockStatus,
  supportReady = true,
  inFlight,
  onPatchRow,
  onClose,
  navList,
  navIndex,
  onNavigate,
  onDecideCurriculum,
}: {
  row: Code | null;
  target?: DetailTarget;
  specialtySlug: string;
  mappingSource: MappingSource;
  pipelineMode: PipelineMode;
  canEdit: boolean;
  lockStatus: string | null;
  supportReady?: boolean;
  inFlight: boolean;
  /** When present (and `canEdit`), the array/notes tabs gain an Edit toggle.
   *  Saving PATCHes a full-array replacement and refreshes the detail. */
  onPatchRow?: (code: string, fields: PatchCodeFields) => Promise<CodeTableRow>;
  onClose: () => void;
  // --- Curriculum approval review (curriculum-mapping only) ----------------
  /** The sorted+filtered rows, for step-through navigation. */
  navList?: Code[];
  /** Index of the current row within `navList` (-1 when filtered out). */
  navIndex?: number;
  /** Navigate the modal to another row (prev/next, keyboard). */
  onNavigate?: (row: Code) => void;
  /** Approve/reject the current curriculum item ('' clears the decision). */
  onDecideCurriculum?: (
    code: string,
    status: '' | 'approved' | 'rejected',
  ) => Promise<CodeTableRow> | undefined;
}) {
  const router = useRouter();

  // Source/mode-derived visibility — mirrors the table's column gating so the
  // modal never shows AMBOSS surfaces for a guidelines-only specialty (or vice
  // versa) or empty suggestion tabs for non-full / guideline-only runs.
  const showAmboss = mappingSource !== 'guidelines';
  const showGuidelines = mappingSource !== 'amboss';
  const guidelineOnly = mappingSource === 'guidelines';
  const showSuggestions = pipelineMode === 'full' && showAmboss;
  const showLiterature = pipelineMode === 'rag-corpus';
  const showCurriculum = pipelineMode === 'curriculum-mapping';
  // Questions are mapped only for curriculum-mapping specialties (a separate
  // search_questions agent runs alongside article mapping there).
  const showQuestions = pipelineMode === 'curriculum-mapping';
  const visibleTabs = useMemo(
    () =>
      buildVisibleTabs({
        showAmboss,
        showGuidelines,
        showSuggestions,
        showQuestions,
        showLiterature,
        showCurriculum,
      }),
    [
      showAmboss,
      showGuidelines,
      showSuggestions,
      showQuestions,
      showLiterature,
      showCurriculum,
    ],
  );

  const [activeTab, setActiveTab] = useState(targetToIndex(visibleTabs, target));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);
  const [metadata, setMetadata] = useState<CodeRunMetadata | null>(null);
  const [metadataState, setMetadataState] = useState<
    'idle' | 'loading' | 'loaded' | 'missing' | 'error'
  >('idle');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [fullRow, setFullRow] = useState<Code | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    'idle',
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  // Which tab (if any) is in edit mode, and a counter bumped after a save to
  // re-run the detail fetch so the panel reflects the persisted arrays.
  const [editingTab, setEditingTab] = useState<number | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  // The modal stays mounted across opens (row toggles between null and a
  // value), so re-align the tab whenever the caller's target/row changes.
  // Manual user clicks aren't overridden until the next open. Errors and
  // submit state also reset so a previous row's failure doesn't leak.
  const rowKey = row?.code;
  useEffect(() => {
    // rowKey is read here so a row change with an unchanged target still fires
    void rowKey;
    setActiveTab(targetToIndex(visibleTabs, target));
    setError(null);
    setSubmitting(false);
    setMetadata(null);
    setMetadataState('idle');
    setMetadataError(null);
    setFullRow(null);
    setDetailState(rowKey ? 'loading' : 'idle');
    setDetailError(null);
    setEditingTab(null);
  }, [target, rowKey, visibleTabs]);

  useEffect(() => {
    if (!rowKey) return;
    // `reloadSeq` is a trigger-only dep — bumped after a save to re-fetch the
    // freshly-persisted detail. Read it so the exhaustive-deps lint is happy.
    void reloadSeq;
    let cancelled = false;
    setDetailState('loading');
    setDetailError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/codes/${encodeURIComponent(specialtySlug)}/${encodeURIComponent(rowKey)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setDetailError(body?.error ?? `HTTP ${res.status}`);
          setDetailState('error');
          return;
        }
        const json = (await res.json()) as Code;
        if (cancelled) return;
        setFullRow(json);
        setDetailState('loaded');
      } catch (e) {
        if (cancelled) return;
        setDetailError(errorMessage(e));
        setDetailState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rowKey, specialtySlug, reloadSeq]);

  // Lazy-load metadata only when the user opens that tab. We deliberately
  // exclude `metadataState` from the deps: setting it to 'loading' inside the
  // effect would otherwise re-trigger the effect, and the previous run's
  // cleanup would flip `cancelled = true` on the in-flight fetch — leaving
  // state stuck at 'loading'. Re-runs on row/tab change cancel cleanly.
  const activeTarget = visibleTabs[activeTab]?.target ?? 'coverage-articles';

  useEffect(() => {
    if (activeTarget !== 'metadata' || !rowKey) return;
    let cancelled = false;
    setMetadataState('loading');
    setMetadataError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/codes/${encodeURIComponent(specialtySlug)}/${encodeURIComponent(rowKey)}/run-metadata`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          setMetadataState('missing');
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setMetadataError(body?.error ?? `HTTP ${res.status}`);
          setMetadataState('error');
          return;
        }
        const json = (await res.json()) as CodeRunMetadata;
        if (cancelled) return;
        setMetadata(json);
        setMetadataState('loaded');
      } catch (e) {
        if (cancelled) return;
        setMetadataError(errorMessage(e));
        setMetadataState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTarget, rowKey, specialtySlug]);

  // --- Curriculum approval review: navigation + decision --------------------
  // Step to another item in the table's sorted+filtered order, wrapping around.
  const navTo = useCallback(
    (delta: number) => {
      if (!navList || navList.length <= 1 || navIndex == null || navIndex < 0) return;
      const next = navList[(navIndex + delta + navList.length) % navList.length];
      if (next) onNavigate?.(next);
    },
    [navList, navIndex, onNavigate],
  );

  // Approve/reject the current item (toggle off when re-pressing the active
  // decision), then re-fetch so the modal's status badge reflects the stamp.
  const decideCurrent = useCallback(
    (status: 'approved' | 'rejected') => {
      if (!onDecideCurriculum || !row) return;
      const current = (fullRow ?? row).curriculumReviewStatus;
      const next = current === status ? '' : status;
      const p = onDecideCurriculum(row.code, next);
      if (p) void p.then(() => setReloadSeq((s) => s + 1));
    },
    [onDecideCurriculum, row, fullRow],
  );

  // Keyboard review: ←/→ navigate, A approve, R reject. Ignored while typing in
  // an editor field or when an inline edit panel is open. Capture phase so the
  // DS Modal's focus trap doesn't swallow the keys.
  useEffect(() => {
    if (!row || !showCurriculum) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      if (editingTab !== null) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navTo(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navTo(1);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        decideCurrent('approved');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        decideCurrent('rejected');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [row, showCurriculum, editingTab, navTo, decideCurrent]);

  if (!row) return null;

  // Map/Remap action wired into the modal footer. Mirrors the old in-table
  // RowActions: unmapped rows can always be mapped; remap of an already-
  // mapped row requires the consolidation gate to be open. While the row is
  // currently in flight from an active map_codes run, the action is locked.
  const detailRow = fullRow ?? row;
  const detailLoading = detailState === 'loading';
  const detailFailed = detailState === 'error';

  const isUnmapped = !((detailRow.mappedAt ?? 0) > 0);
  const actionEnabled =
    supportReady && !inFlight && !submitting && (isUnmapped || canEdit);
  const actionLabel = inFlight
    ? 'Mapping…'
    : !supportReady
      ? 'Loading…'
      : submitting
        ? isUnmapped
          ? 'Mapping…'
          : 'Remapping…'
        : isUnmapped
          ? 'Map'
          : 'Remap';
  const lockReason =
    supportReady && !canEdit && !isUnmapped
      ? `Consolidation is active${lockStatus ? ` (${lockStatus})` : ''} — reset to re-enable`
      : null;

  const runMap = async () => {
    if (!actionEnabled) return;
    if (!isUnmapped) {
      const ok = window.confirm(
        `Clear the current mapping for "${detailRow.code}" and re-run? The existing coverage, suggestions, and metadata will be overwritten.`,
      );
      if (!ok) return;
    }
    const primaryModel = readSpecForStage(specialtySlug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured for Map codes. Open the gear icon on the Map codes card to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(specialtySlug)) ?? DEFAULT_BACKUP_MODEL;
    setSubmitting(true);
    setError(null);
    try {
      const url = isUnmapped ? '/api/workflows/map-codes' : '/api/workflows/remap-code';
      const body = isUnmapped
        ? {
            specialtySlug,
            codes: [detailRow.code],
            checkAgainstLibrary: true,
            primaryModel,
            backupModel,
          }
        : {
            specialtySlug,
            code: detailRow.code,
            checkAgainstLibrary: true,
            primaryModel,
            backupModel,
          };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        const missing = missingApiKeyProvider(res.status, resBody);
        if (missing) {
          setMissingKey(missing);
          return;
        }
        setError(resBody?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const covered = (detailRow.articlesWhereCoverageIs ??
    []) as unknown as CoveredSection[];
  const updates = (detailRow.existingArticleUpdates ?? []) as unknown as SectionUpdate[];
  const newArticles = (detailRow.newArticlesNeeded ??
    []) as unknown as NewArticleSuggestion[];
  const coveredGuidelines = (detailRow.guidelinesWhereCoverageIs ??
    []) as unknown as GuidelineCoverageItem[];
  const coveredQuestions = (detailRow.questionsWhereCoverageIs ??
    []) as unknown as CoveredQuestion[];
  const inAmboss = detailRow.isInAMBOSS;
  const specialty = detailRow.specialty ?? '';
  const category = detailRow.category ?? '';

  // PATCH a full-array (or notes) replacement, then re-fetch the detail so the
  // panel shows the persisted values. `onPatchRow` also merges the lean row
  // into the table behind the modal (count columns / mappedAt update).
  const patchAndReload = async (fields: PatchCodeFields) => {
    if (!onPatchRow || !rowKey) return;
    await onPatchRow(rowKey, fields);
    setReloadSeq((s) => s + 1);
  };

  // Edit affordances are offered on the array/notes tabs once the lock is open,
  // the parent supplied a PATCH handler, and the detail has loaded. For a
  // guideline-only specialty the Coverage tab shows (read-only) guideline
  // coverage and the Notes tab shows guideline notes/gaps — neither has an
  // editor (matching today's read-only Guidelines tab), so they're excluded.
  const targetEditable =
    EDITABLE_TARGETS.has(activeTarget) &&
    (activeTarget !== 'coverage-articles' || showAmboss) &&
    (activeTarget !== 'coverage-notes' || !guidelineOnly);
  const canEditPanel =
    canEdit && !!onPatchRow && detailState === 'loaded' && targetEditable;
  const isEditingPanel = editingTab === activeTab;

  // Curriculum: the Map/Remap action moves up beside the AMBOSS badge (the
  // modal's footer is reserved for the approval review controls).
  const RemapInlineButton = () => (
    <Button
      variant="secondary"
      size="s"
      disabled={!actionEnabled}
      loading={submitting}
      onClick={() => runMap()}
    >
      {actionLabel}
    </Button>
  );

  return (
    <Modal
      header={detailRow.description ?? detailRow.code}
      subHeader={detailRow.description ? detailRow.code : undefined}
      size="l"
      isDismissible
      // Curriculum review has its own footer (prev/next + approve/reject) in the
      // body and moves Map/Remap up beside the AMBOSS badge, so the modal's
      // built-in footer buttons are dropped (the X still dismisses it).
      actionButton={
        showCurriculum
          ? undefined
          : { text: actionLabel, disabled: !actionEnabled, loading: submitting }
      }
      secondaryButton={showCurriculum ? undefined : { text: 'Close' }}
      onAction={(action) => {
        if (action === 'cancel') onClose();
        else if (action === 'action') runMap();
      }}
    >
      <Modal.Stack>
        {/* Curriculum approval status floats top-right, up by the close (X)
            button, rather than sitting below the header. Only a made decision
            shows a badge; pending stays unbadged. */}
        {showCurriculum &&
        (detailRow.curriculumReviewStatus === 'approved' ||
          detailRow.curriculumReviewStatus === 'rejected') ? (
          // Flex-center within the header band (top 0..height) so the badge lines
          // up vertically with the title + the close (X) button, regardless of
          // badge height. `height` ≈ the modal header band; nudge if needed.
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 56,
              height: 64,
              display: 'flex',
              alignItems: 'center',
              zIndex: 1,
            }}
          >
            {detailRow.curriculumReviewStatus === 'approved' ? (
              <Badge text="Approved" color="green" />
            ) : (
              <Badge text="Rejected" color="red" />
            )}
          </div>
        ) : null}
        <Stack space="m">
          <Inline space="s" vAlignItems="center">
            {specialty ? (
              <Text size="s" color="secondary">
                <Text as="span" size="s" weight="bold">
                  Specialty:
                </Text>{' '}
                {specialty}
              </Text>
            ) : null}
            {category ? (
              <Text size="s" color="secondary">
                <Text as="span" size="s" weight="bold">
                  Category:
                </Text>{' '}
                {category}
              </Text>
            ) : null}
          </Inline>

          {inFlight ? (
            <Inline space="s" vAlignItems="center">
              <Badge text="Mapping…" color="blue" icon="loader" />
              <Text size="s" color="secondary">
                This code is currently being mapped.
              </Text>
              <CancelMappingButton slug={specialtySlug} onCancelled={onClose} />
            </Inline>
          ) : null}

          {isUnmapped ? (
            <Inline space="s" vAlignItems="center">
              <Badge text="Unmapped" color="gray" />
              {showCurriculum ? <RemapInlineButton /> : null}
            </Inline>
          ) : (
            <>
              {showAmboss ? (
                <Inline space="s" vAlignItems="center">
                  {inAmboss === true ? (
                    <Badge text="In AMBOSS" color="green" />
                  ) : (
                    <Badge text="Not in AMBOSS" color="red" />
                  )}
                  {/* Curriculum mapping drops the coverage-level (year) and
                      depth (score) badges — scoring isn't used for curricula. */}
                  {!showCurriculum && detailRow.coverageLevel ? (
                    <CoverageBadge level={detailRow.coverageLevel} />
                  ) : null}
                  {!showCurriculum && typeof detailRow.depthOfCoverage === 'number' ? (
                    <DepthBadge
                      depth={detailRow.depthOfCoverage}
                      level={detailRow.coverageLevel}
                    />
                  ) : null}
                  {/* Curriculum: Map/Remap lives beside the AMBOSS badge. */}
                  {showCurriculum ? <RemapInlineButton /> : null}
                </Inline>
              ) : null}
              {showGuidelines ? (
                <Inline space="s" vAlignItems="center">
                  {detailRow.isInGuidelines === true ? (
                    <Badge text="In guidelines" color="green" />
                  ) : detailRow.isInGuidelines === false ? (
                    <Badge text="Not in guidelines" color="red" />
                  ) : null}
                  {detailRow.guidelineCoverageLevel ? (
                    <CoverageBadge level={detailRow.guidelineCoverageLevel} />
                  ) : null}
                  {typeof detailRow.guidelineDepthOfCoverage === 'number' ? (
                    <DepthBadge
                      depth={detailRow.guidelineDepthOfCoverage}
                      level={detailRow.guidelineCoverageLevel}
                    />
                  ) : null}
                </Inline>
              ) : null}
              {showAmboss && showGuidelines && detailRow.overallCoverageLevel ? (
                <Inline space="s" vAlignItems="center">
                  <Badge
                    text={`Overall: ${detailRow.overallCoverageLevel}`}
                    color="blue"
                  />
                </Inline>
              ) : null}
            </>
          )}

          {error ? (
            <Text size="s" color="error">
              {error}
            </Text>
          ) : null}
          {lockReason && !error ? (
            <Text size="s" color="secondary">
              {lockReason}
            </Text>
          ) : null}
          {detailFailed ? (
            <Text size="s" color="error">
              {detailError ?? 'Failed to load code details.'}
            </Text>
          ) : null}

          <Tabs
            aria-label="Code detail sections"
            tabPanelId="code-detail-panel"
            activeTab={activeTab}
            onTabSelect={(i) => {
              setActiveTab(i);
              setEditingTab(null);
            }}
            tabs={visibleTabs.map((t) => ({ label: t.label }))}
          >
            <div>
              {canEditPanel && !isEditingPanel && !showCurriculum ? (
                <Inline alignItems="right" fullWidth>
                  <Button
                    variant="secondary"
                    size="s"
                    onClick={() => setEditingTab(activeTab)}
                  >
                    Edit
                  </Button>
                </Inline>
              ) : null}
              {detailLoading && activeTarget !== 'metadata' ? (
                <Text size="s" color="tertiary">
                  Loading code details…
                </Text>
              ) : isEditingPanel && activeTarget === 'coverage-articles' ? (
                <CoverageArticlesEditor
                  initial={covered as unknown as CoveredSectionRow[]}
                  save={(next) => patchAndReload({ articlesWhereCoverageIs: next })}
                  onClose={() => setEditingTab(null)}
                />
              ) : isEditingPanel && activeTarget === 'coverage-notes' ? (
                <TextFieldsEditor
                  fields={[
                    { key: 'notes', label: 'Notes', value: detailRow.notes ?? '' },
                    { key: 'gaps', label: 'Gaps', value: detailRow.gaps ?? '' },
                  ]}
                  save={(next) => patchAndReload({ notes: next.notes, gaps: next.gaps })}
                  onClose={() => setEditingTab(null)}
                />
              ) : isEditingPanel && activeTarget === 'suggestion-improvements' ? (
                <TextFieldsEditor
                  fields={[
                    {
                      key: 'improvements',
                      label: 'Improvements',
                      value: detailRow.improvements ?? '',
                    },
                  ]}
                  save={(next) => patchAndReload({ improvements: next.improvements })}
                  onClose={() => setEditingTab(null)}
                />
              ) : isEditingPanel && activeTarget === 'suggestion-updates' ? (
                <ArticleUpdatesEditor
                  initial={updates as unknown as SectionUpdateRow[]}
                  save={(next) => patchAndReload({ existingArticleUpdates: next })}
                  onClose={() => setEditingTab(null)}
                />
              ) : isEditingPanel && activeTarget === 'suggestion-new-articles' ? (
                <NewArticlesEditor
                  initial={newArticles as unknown as NewArticleRow[]}
                  save={(next) => patchAndReload({ newArticlesNeeded: next })}
                  onClose={() => setEditingTab(null)}
                />
              ) : activeTarget === 'coverage-articles' ? (
                // Guideline-only specialties have no AMBOSS coverage — show the
                // guideline coverage here instead of the (empty) article list.
                guidelineOnly ? (
                  <GuidelineCoveragePanel
                    guidelines={coveredGuidelines}
                    notes={detailRow.guidelineNotes ?? null}
                    gaps={detailRow.guidelineGaps ?? null}
                  />
                ) : (
                  <CoverageArticlesPanel covered={covered} />
                )
              ) : activeTarget === 'coverage-notes' ? (
                <CoverageNotesPanel
                  notes={
                    (guidelineOnly ? detailRow.guidelineNotes : detailRow.notes) ?? null
                  }
                  gaps={
                    (guidelineOnly ? detailRow.guidelineGaps : detailRow.gaps) ?? null
                  }
                />
              ) : activeTarget === 'suggestion-improvements' ? (
                <SuggestionImprovementsPanel
                  improvements={detailRow.improvements ?? null}
                />
              ) : activeTarget === 'suggestion-updates' ? (
                <SuggestionUpdatesPanel updates={updates} />
              ) : activeTarget === 'suggestion-new-articles' ? (
                <SuggestionNewArticlesPanel newArticles={newArticles} />
              ) : activeTarget === 'guideline-coverage' ? (
                <GuidelineCoveragePanel
                  guidelines={coveredGuidelines}
                  notes={detailRow.guidelineNotes ?? null}
                  gaps={detailRow.guidelineGaps ?? null}
                />
              ) : activeTarget === 'questions' ? (
                <QuestionsPanel questions={coveredQuestions} />
              ) : activeTarget === 'literature' ? (
                <LiteratureCodePanel
                  specialtySlug={specialtySlug}
                  codeId={detailRow.id ?? null}
                  code={detailRow.code ?? ''}
                  active={activeTarget === 'literature'}
                />
              ) : activeTarget === 'curriculum' ? (
                <CurriculumPanel meta={detailRow.curriculumMeta ?? null} />
              ) : (
                <MetadataPanel
                  state={metadataState}
                  error={metadataError}
                  metadata={metadata}
                />
              )}
            </div>
          </Tabs>

          {/* Curriculum approval footer: prev/next on the left, approve/reject
              floated to the right. The selection is reflected by the header
              badge, so the buttons keep a fixed appearance. */}
          {showCurriculum ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                {navList && navList.length > 1 ? (
                  <>
                    <Button variant="tertiary" size="s" onClick={() => navTo(-1)}>
                      ‹ Prev
                    </Button>
                    <Text size="s" color="secondary">
                      {navIndex != null && navIndex >= 0
                        ? `${navIndex + 1} of ${navList.length}`
                        : `${navList.length}`}
                    </Text>
                    <Button variant="tertiary" size="s" onClick={() => navTo(1)}>
                      Next ›
                    </Button>
                  </>
                ) : null}
              </div>
              {onDecideCurriculum ? (
                <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={inFlight}
                    style={approveButtonStyle(inFlight)}
                    onClick={() => decideCurrent('approved')}
                  >
                    Approve (A)
                  </button>
                  <button
                    type="button"
                    disabled={inFlight}
                    style={rejectButtonStyle(inFlight)}
                    onClick={() => decideCurrent('rejected')}
                  >
                    Reject (R)
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </Stack>
      </Modal.Stack>
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </Modal>
  );
}

function CurriculumRow({ label, value }: { label: string; value: string }) {
  return (
    <Inline space="s" vAlignItems="center">
      <div style={{ minWidth: 150 }}>
        <Text weight="bold">{label}</Text>
      </div>
      <Text>{value}</Text>
    </Inline>
  );
}

/** Read-only view of a curriculum block's time dimension (curriculum-mapping). */
function CurriculumPanel({ meta }: { meta: CurriculumMeta | null }) {
  if (!meta || Object.keys(meta).length === 0) {
    return (
      <Text size="s" color="tertiary">
        No curriculum timing captured for this block.
      </Text>
    );
  }
  return (
    <Stack space="s">
      <CurriculumRow label="Year" value={meta.year != null ? `Year ${meta.year}` : '—'} />
      <CurriculumRow label="Phase" value={meta.phase ?? '—'} />
      <CurriculumRow label="Timeframe" value={formatTimeframe(meta)} />
      <CurriculumRow label="Duration / cadence" value={formatDurationOrCadence(meta)} />
      <Stack space="xxs">
        <Text weight="bold">Learning objective</Text>
        <Text>{meta.learningObjective ?? '—'}</Text>
      </Stack>
      <Stack space="xxs">
        <Text weight="bold">Subtopics</Text>
        {meta.subtopics && meta.subtopics.length > 0 ? (
          <Inline space="xxs" vAlignItems="center">
            {meta.subtopics.map((s) => (
              <Badge key={s} text={s} color="gray" />
            ))}
          </Inline>
        ) : (
          <Text>—</Text>
        )}
      </Stack>
    </Stack>
  );
}

function CoverageArticlesPanel({ covered }: { covered: CoveredSection[] }) {
  if (covered.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No covered articles.
      </Text>
    );
  }
  return (
    <Stack space="s">
      {covered.map((art) => {
        const sections = flattenSections(art.sections);
        return (
          <div
            key={art.articleId ?? art.articleTitle ?? 'art'}
            style={{
              borderLeft: '2px solid var(--ads-c-divider, rgba(0,0,0,0.15))',
              paddingLeft: 10,
            }}
          >
            <Inline space="xxs" vAlignItems="center">
              <Text weight="bold">{art.articleTitle ?? '(untitled)'}</Text>
              {art.articleId ? (
                <Text size="s" color="tertiary">
                  {art.articleId}
                </Text>
              ) : null}
            </Inline>
            {sections.length > 0 ? (
              <Stack space="xxs">
                {sections.map((s) => (
                  <Inline key={s.id || s.title} space="xs" vAlignItems="center">
                    <Text size="s">{s.title}</Text>
                    {s.id ? (
                      <Text size="xs" color="tertiary">
                        {s.id}
                      </Text>
                    ) : null}
                  </Inline>
                ))}
              </Stack>
            ) : null}
          </div>
        );
      })}
    </Stack>
  );
}

function GuidelineCoveragePanel({
  guidelines,
  notes,
  gaps,
}: {
  guidelines: GuidelineCoverageItem[];
  notes: string | null;
  gaps: string | null;
}) {
  if (guidelines.length === 0 && !notes && !gaps) {
    return (
      <Text size="s" color="tertiary">
        No guideline coverage.
      </Text>
    );
  }
  return (
    <Stack space="m">
      {guidelines.length > 0 ? (
        <Stack space="s">
          {guidelines.map((g) => {
            const recs = flattenRecommendations(g.recommendations);
            return (
              <div
                key={g.guidelineId ?? g.guidelineTitle ?? 'guideline'}
                style={{ borderLeft: '2px solid rgb(56, 132, 168)', paddingLeft: 10 }}
              >
                <Inline space="xxs" vAlignItems="center">
                  <Text weight="bold">{g.guidelineTitle ?? '(untitled)'}</Text>
                  {g.organization ? <Badge text={g.organization} color="blue" /> : null}
                  {typeof g.year === 'number' ? (
                    <Text size="s" color="tertiary">
                      {g.year}
                    </Text>
                  ) : null}
                  {g.guidelineId ? (
                    <Text size="xs" color="tertiary">
                      {g.guidelineId}
                    </Text>
                  ) : null}
                </Inline>
                {recs.length > 0 ? (
                  <Stack space="xxs">
                    {recs.map((r) => (
                      <Inline key={r.id || r.title} space="xs" vAlignItems="center">
                        <Text size="s">{r.title}</Text>
                        {r.id ? (
                          <Text size="xs" color="tertiary">
                            {r.id}
                          </Text>
                        ) : null}
                      </Inline>
                    ))}
                  </Stack>
                ) : null}
              </div>
            );
          })}
        </Stack>
      ) : null}
      {notes || gaps ? <CoverageNotesPanel notes={notes} gaps={gaps} /> : null}
    </Stack>
  );
}

/**
 * Read-only view of the AMBOSS Qbank questions matched to this code
 * (curriculum-mapping question track). The stem (fetched via `get_questions`)
 * is the title; below it the EID, the learning objective, and the
 * competency / system / difficulty / study-objective metadata.
 */
function QuestionsPanel({ questions }: { questions: CoveredQuestion[] }) {
  if (questions.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No matched questions.
      </Text>
    );
  }
  return (
    <Stack space="s">
      {questions.map((q) => (
        <div
          key={q.questionId ?? q.questionStem ?? q.learningObjective ?? 'question'}
          style={{ borderLeft: '2px solid rgb(13, 148, 136)', paddingLeft: 10 }}
        >
          <Text weight="bold">
            {q.questionStem ?? q.learningObjective ?? '(no stem)'}
          </Text>
          <Inline space="xs" vAlignItems="center">
            {q.questionId ? (
              <Text size="xs" color="tertiary">
                {q.questionId}
              </Text>
            ) : null}
            {q.competency ? <Badge text={q.competency} color="blue" /> : null}
            {q.system ? <Badge text={q.system} color="gray" /> : null}
            {q.difficulty ? (
              <Badge text={`Difficulty ${q.difficulty}/5`} color="yellow" />
            ) : null}
          </Inline>
          {q.learningObjective ? <Text size="s">{q.learningObjective}</Text> : null}
          {q.studyObjectives && q.studyObjectives.length > 0 ? (
            <Inline space="xxs" vAlignItems="center">
              {[...new Set(q.studyObjectives)].map((so) => (
                <Badge key={so} text={so} color="purple" />
              ))}
            </Inline>
          ) : null}
        </div>
      ))}
    </Stack>
  );
}

/**
 * RAG-corpus Literature tab — the reference corpus gathered for this code.
 * Sources aren't carried on the table row (potentially many per code), so they
 * are fetched on demand when the tab is shown.
 */
function LiteratureCodePanel({
  specialtySlug,
  codeId,
  code,
  active,
}: {
  specialtySlug: string;
  codeId: string | null;
  code: string;
  active: boolean;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [sources, setSources] = useState<CodeLitSourceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !codeId) return;
    let cancelled = false;
    setState('loading');
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/code-lit-sources?specialtySlug=${encodeURIComponent(specialtySlug)}&codeId=${encodeURIComponent(codeId)}`,
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error ?? `HTTP ${res.status}`);
          setState('error');
          return;
        }
        const json = (await res.json()) as { sources: CodeLitSourceRecord[] };
        if (cancelled) return;
        setSources(json.sources ?? []);
        setState('loaded');
      } catch (e) {
        if (cancelled) return;
        setError(errorMessage(e));
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, codeId, specialtySlug]);

  const [pane, setPane] = useState<'searched' | 'approved'>('searched');
  const [addOpen, setAddOpen] = useState(false);
  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Human-in-the-loop approval. Optimistically flip the source locally so it
  // moves panes at once, persist via the server action, and revert on failure
  // (mirrors SourceDecisionCell in article-manager/sources-table.tsx).
  const toggleApproval = useCallback(
    async (source: CodeLitSourceRecord, approve: boolean) => {
      if (submittingIds.has(source.id)) return;
      const next = approve ? 'approved' : null;
      const prev = source.reviewStatus ?? null;
      setSubmittingIds((s) => new Set(s).add(source.id));
      setSources((rows) =>
        rows.map((r) =>
          r.id === source.id ? { ...r, reviewStatus: next ?? undefined } : r,
        ),
      );
      try {
        await submitCodeLitSourceReview(specialtySlug, source.id, next);
      } catch (e) {
        setSources((rows) =>
          rows.map((r) =>
            r.id === source.id ? { ...r, reviewStatus: prev ?? undefined } : r,
          ),
        );
        log('code-lit-source-review').error('submit failed', e);
      } finally {
        setSubmittingIds((s) => {
          const copy = new Set(s);
          copy.delete(source.id);
          return copy;
        });
      }
    },
    [specialtySlug, submittingIds],
  );

  if (!codeId) {
    return (
      <Text size="s" color="tertiary">
        No literature gathered for this topic yet.
      </Text>
    );
  }
  if (state === 'loading' || state === 'idle') {
    return (
      <Text size="s" color="tertiary">
        Loading sources…
      </Text>
    );
  }
  if (state === 'error') {
    return (
      <Text size="s" color="error">
        {error ?? 'Failed to load sources.'}
      </Text>
    );
  }
  const approved = sources.filter((s) => s.reviewStatus === 'approved');
  // Searched is the full candidate list — approving a source keeps it here
  // (with its box checked) and also surfaces it in the Approved pane.
  const searched = sources;
  const list = pane === 'approved' ? approved : searched;

  const renderCard = (s: CodeLitSourceRecord) => {
    const href = s.url || (s.doi ? `https://doi.org/${s.doi}` : null);
    const isApproved = s.reviewStatus === 'approved';
    const reviewerHandle = s.reviewerEmail ? s.reviewerEmail.split('@')[0] : '';
    const stamp = s.reviewedAt ? new Date(s.reviewedAt).toLocaleString() : '';
    return (
      <div
        key={s.id}
        style={{ borderLeft: '2px solid rgb(124, 58, 237)', paddingLeft: 10 }}
      >
        <Inline space="xs" vAlignItems="center">
          <Checkbox
            label={isApproved ? 'Approved' : 'Approve'}
            size="s"
            checked={isApproved}
            disabled={submittingIds.has(s.id)}
            onChange={(e) => toggleApproval(s, e.target.checked)}
          />
          {isApproved && reviewerHandle ? (
            <Text size="xs" color="tertiary">
              by {reviewerHandle}
              {stamp ? ` · ${stamp}` : ''}
            </Text>
          ) : null}
        </Inline>
        <Inline space="xxs" vAlignItems="center">
          <Text weight="bold">{s.title}</Text>
          {typeof s.rank === 'number' ? (
            <Badge text={`#${s.rank}`} color="purple" />
          ) : null}
          {s.sourceType ? (
            <Badge text={s.sourceType.replace(/_/g, ' ')} color="gray" />
          ) : null}
        </Inline>
        <Inline space="xs" vAlignItems="center">
          {s.journal ? (
            <Text size="s" color="secondary">
              {s.journal}
            </Text>
          ) : null}
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
              {s.doi ? s.doi : 'Link'}
            </a>
          ) : null}
        </Inline>
        {s.llmSummary ? <Text size="s">{s.llmSummary}</Text> : null}
      </div>
    );
  };

  return (
    <Stack space="s">
      <Inline space="s" vAlignItems="center" alignItems="spaceBetween">
        <SegmentedControl
          label="Literature review"
          isLabelHidden
          value={pane}
          onChange={(v) => setPane(v === 'approved' ? 'approved' : 'searched')}
          options={[
            {
              name: 'lit-pane',
              value: 'searched',
              label: `Searched (${searched.length})`,
            },
            {
              name: 'lit-pane',
              value: 'approved',
              label: `Approved (${approved.length})`,
            },
          ]}
        />
        <Button
          variant="secondary"
          size="s"
          leftIcon="plus"
          onClick={() => setAddOpen(true)}
        >
          Add source
        </Button>
      </Inline>
      {list.length === 0 ? (
        <Text size="s" color="tertiary">
          {pane === 'approved'
            ? 'No approved literature yet — approve sources from the Searched tab, or add one manually.'
            : 'No literature gathered for this topic yet.'}
        </Text>
      ) : (
        list.map(renderCard)
      )}
      <AddCodeLitSourceModal
        open={addOpen}
        slug={specialtySlug}
        codeId={codeId}
        code={code}
        onClose={() => setAddOpen(false)}
        onAdded={(source) => setSources((rows) => [...rows, source])}
      />
    </Stack>
  );
}

function CoverageNotesPanel({
  notes,
  gaps,
}: {
  notes: string | null;
  gaps: string | null;
}) {
  if (!notes && !gaps) {
    return (
      <Text size="s" color="tertiary">
        No notes or gaps.
      </Text>
    );
  }
  return (
    <Stack space="m">
      {notes ? (
        <Stack space="xxs">
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            Notes
          </Text>
          <Text>{notes}</Text>
        </Stack>
      ) : null}
      {gaps ? (
        <Stack space="xxs">
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            Gaps
          </Text>
          <Text>{gaps}</Text>
        </Stack>
      ) : null}
    </Stack>
  );
}

function SuggestionUpdatesPanel({ updates }: { updates: SectionUpdate[] }) {
  if (updates.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No existing article updates.
      </Text>
    );
  }
  return (
    <Stack space="s">
      {updates.map((upd) => (
        <div
          key={upd.articleId ?? upd.articleTitle ?? 'upd'}
          style={{
            borderLeft: '2px solid rgb(217, 119, 6)',
            paddingLeft: 10,
          }}
        >
          <Inline space="xxs" vAlignItems="center">
            <Text weight="bold">{upd.articleTitle ?? '(untitled)'}</Text>
            {upd.articleId ? (
              <Text size="s" color="tertiary">
                {upd.articleId}
              </Text>
            ) : null}
          </Inline>
          <Stack space="xs">
            {(upd.sections ?? []).map((s) => (
              <Stack key={s.sectionId ?? s.sectionTitle ?? 'sec'} space="xxs">
                <Inline space="xxs" vAlignItems="center">
                  <Text size="s" weight="bold">
                    {s.sectionTitle ?? '(untitled section)'}
                  </Text>
                  {s.exists ? (
                    <Badge text="Section update" color="blue" />
                  ) : (
                    <Badge text="New section" color="green" />
                  )}
                  {typeof s.importance === 'number' ? (
                    <Badge text={`importance ${s.importance}/5`} color="yellow" />
                  ) : null}
                  {s.sectionId ? (
                    <Text size="xs" color="tertiary">
                      {s.sectionId}
                    </Text>
                  ) : null}
                </Inline>
                {s.changes ? <Text size="s">{s.changes}</Text> : null}
              </Stack>
            ))}
          </Stack>
        </div>
      ))}
    </Stack>
  );
}

function SuggestionNewArticlesPanel({
  newArticles,
}: {
  newArticles: NewArticleSuggestion[];
}) {
  if (newArticles.length === 0) {
    return (
      <Text size="s" color="tertiary">
        No new articles needed.
      </Text>
    );
  }
  return (
    <Stack space="xs">
      {newArticles.map((a) => (
        <Inline key={a.articleTitle ?? 'new'} space="xxs" vAlignItems="center">
          <Text weight="bold">{a.articleTitle ?? '(untitled)'}</Text>
          {typeof a.importance === 'number' ? (
            <Badge text={`importance ${a.importance}/5`} color="yellow" />
          ) : null}
        </Inline>
      ))}
    </Stack>
  );
}

function SuggestionImprovementsPanel({ improvements }: { improvements: string | null }) {
  if (!improvements) {
    return (
      <Text size="s" color="tertiary">
        No improvements suggested.
      </Text>
    );
  }
  return <Text>{improvements}</Text>;
}

function formatUsd(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatTokens(n: number): string {
  if (n === 0) return '—';
  return n.toLocaleString();
}

function MetadataPanel({
  state,
  error,
  metadata,
}: {
  state: 'idle' | 'loading' | 'loaded' | 'missing' | 'error';
  error: string | null;
  metadata: CodeRunMetadata | null;
}) {
  if (state === 'loading' || state === 'idle') {
    return (
      <Text size="s" color="tertiary">
        Loading run metadata…
      </Text>
    );
  }
  if (state === 'missing') {
    return (
      <Text size="s" color="tertiary">
        No mapping run has been recorded for this code yet.
      </Text>
    );
  }
  if (state === 'error' || !metadata) {
    return (
      <Text size="s" color="error">
        {error ?? 'Failed to load metadata.'}
      </Text>
    );
  }

  const { totals, attempts, toolBreakdown, finalModel, runStartedAt, stageStatus } =
    metadata;

  return (
    <Stack space="m">
      <Stack space="xxs">
        <Text size="xs" weight="bold" color="secondary" transform="uppercase">
          Run summary
        </Text>
        <Inline space="xs" vAlignItems="center">
          <Badge text={stageStatus ?? 'unknown'} color="gray" />
          {finalModel ? <Badge text={finalModel} color="blue" /> : null}
          <Text size="s" color="tertiary">
            Started {new Date(runStartedAt).toLocaleString()}
          </Text>
        </Inline>
      </Stack>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        <MetricCell label="Total cost" value={formatUsd(totals.costUsd)} />
        <MetricCell label="Wall time" value={formatDuration(totals.durationMs)} />
        <MetricCell label="MCP calls" value={String(totals.mcpToolCalls)} />
        <MetricCell label="Input tokens" value={formatTokens(totals.inputTokens)} />
        <MetricCell label="Output tokens" value={formatTokens(totals.outputTokens)} />
        <MetricCell
          label="Reasoning tokens"
          value={formatTokens(totals.reasoningTokens)}
        />
      </div>

      {toolBreakdown.length > 0 ? (
        <Stack space="xxs">
          <Text size="xs" weight="bold" color="secondary" transform="uppercase">
            MCP tool breakdown
          </Text>
          <Inline space="xs" vAlignItems="center">
            {toolBreakdown.map((t) => (
              <Badge key={t.name} text={`${t.name} ×${t.count}`} color="purple" />
            ))}
          </Inline>
        </Stack>
      ) : null}

      <Stack space="xxs">
        <Text size="xs" weight="bold" color="secondary" transform="uppercase">
          Attempts ({attempts.length})
        </Text>
        {attempts.length === 0 ? (
          <Text size="s" color="tertiary">
            No attempt events recorded.
          </Text>
        ) : (
          <Stack space="xs">
            {attempts.map((a, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: events have no stable id and createdAt may collide for fast attempts
                key={`${a.createdAt}-${i}`}
                style={{
                  borderLeft: `2px solid ${
                    a.level === 'error'
                      ? 'rgb(220, 38, 38)'
                      : a.level === 'warn'
                        ? 'rgb(217, 119, 6)'
                        : 'var(--ads-c-divider, rgba(0,0,0,0.15))'
                  }`,
                  paddingLeft: 10,
                }}
              >
                <Inline space="xs" vAlignItems="center">
                  <Text size="s" weight="bold">
                    {a.message}
                  </Text>
                  {a.model ? (
                    <Text size="xs" color="tertiary">
                      {a.model}
                    </Text>
                  ) : null}
                </Inline>
                <Inline space="s" vAlignItems="center">
                  {typeof a.costUsd === 'number' ? (
                    <Text size="xs" color="secondary">
                      {formatUsd(a.costUsd)}
                    </Text>
                  ) : null}
                  {a.durationMs ? (
                    <Text size="xs" color="secondary">
                      {formatDuration(a.durationMs)}
                    </Text>
                  ) : null}
                  {typeof a.mcpToolCalls === 'number' && a.mcpToolCalls > 0 ? (
                    <Text size="xs" color="secondary">
                      {a.mcpToolCalls} MCP calls
                    </Text>
                  ) : null}
                  {a.inputTokens || a.outputTokens ? (
                    <Text size="xs" color="tertiary">
                      {formatTokens(a.inputTokens ?? 0)} in /{' '}
                      {formatTokens(a.outputTokens ?? 0)} out
                    </Text>
                  ) : null}
                  {a.invalidIds && a.invalidIds.length > 0 ? (
                    <Badge text={`${a.invalidIds.length} invalid IDs`} color="yellow" />
                  ) : null}
                </Inline>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--ads-c-divider, rgba(0,0,0,0.1))',
        borderRadius: 6,
        padding: '8px 10px',
      }}
    >
      <Text size="xs" color="tertiary">
        {label}
      </Text>
      <Text size="m" weight="bold">
        {value}
      </Text>
    </div>
  );
}
