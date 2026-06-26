'use client';

import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  CollapsibleHeader,
  Divider,
  Inline,
  Modal,
  Stack,
  Text,
  Tooltip,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import type { ProviderId } from '@/lib/workflows/lib/llm';
import { missingApiKeyProvider } from '../[specialty]/pipeline/_components/missing-api-key';
import { MissingKeyModal } from '../[specialty]/pipeline/_components/missing-key-modal';
import {
  backupModelKey,
  DEFAULT_BACKUP_MODEL,
  readSpec,
  readSpecForStage,
} from '../[specialty]/pipeline/_components/model-selection-storage';
import { CancelMappingButton } from './cancel-mapping-button';
import { ConfirmRemapModal } from './confirm-remap-modal';
import {
  approveCodes,
  type CategoryManagerCode,
  type CategoryManagerData,
  type CategoryManagerGroup,
  decideCode,
  loadCurriculumCategoryManager,
  type ReviewStatus,
} from './curriculum-category-actions';

/** Re-derive a group's counts after a local (optimistic) status change, so the
 *  badges and the "Map approved (N)" / "Remap" enablement stay in sync without
 *  a server round-trip. Mirrors `summarize` in `curriculum-category-actions`. */
function resummarize(
  group: CategoryManagerGroup,
  codes: CategoryManagerCode[],
): CategoryManagerGroup {
  let mapped = 0;
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let mappableNow = 0;
  for (const c of codes) {
    if (c.mapped) mapped += 1;
    if (c.reviewStatus === 'approved') {
      approved += 1;
      if (!c.mapped) mappableNow += 1;
    } else if (c.reviewStatus === 'rejected') {
      rejected += 1;
    } else {
      pending += 1;
    }
  }
  return { ...group, mapped, approved, pending, rejected, mappableNow, codes };
}

function mappingBadge(c: CategoryManagerCode) {
  if (c.mapped && c.isInAMBOSS === true) return <Badge text="Mapped" color="green" />;
  if (c.mapped && c.isInAMBOSS === false)
    return <Badge text="Not in AMBOSS" color="red" />;
  return <Badge text="Unmapped" color="gray" />;
}

function CategorySection({
  group,
  busy,
  approvingBusy,
  togglingCodes,
  defaultExpanded = false,
  onApproveAll,
  onRejectAll,
  onToggleCode,
  onMap,
  onRemap,
}: {
  group: CategoryManagerGroup;
  /** A map/remap run is being launched somewhere — lock all map/remap buttons. */
  busy: boolean;
  approvingBusy: boolean;
  togglingCodes: Set<string>;
  /** Start expanded — used when the modal is scoped to a single category. */
  defaultExpanded?: boolean;
  onApproveAll: () => void;
  onRejectAll: () => void;
  onToggleCode: (code: string, approved: boolean) => void;
  onMap: () => void;
  onRemap: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const allCodes = group.codes.map((c) => c.code);
  const mappedColor = group.total > 0 && group.mapped === group.total ? 'green' : 'gray';

  return (
    <Card outlined>
      <Box space="m" vSpace="s">
        <Inline alignItems="spaceBetween" vAlignItems="center">
          <Inline space="xs" vAlignItems="center">
            <Text weight="bold">{group.category}</Text>
            <Badge text={`${group.mapped}/${group.total} mapped`} color={mappedColor} />
            <Badge text={`${group.approved} approved`} color="gray" />
            {group.pending > 0 ? (
              <Badge text={`${group.pending} pending`} color="gray" />
            ) : null}
          </Inline>
          <Inline space="xs" vAlignItems="center">
            <Button
              variant="secondary"
              size="s"
              disabled={approvingBusy || allCodes.length === 0}
              onClick={onApproveAll}
            >
              Approve all
            </Button>
            <Button
              variant="secondary"
              size="s"
              disabled={approvingBusy || allCodes.length === 0}
              onClick={onRejectAll}
            >
              Reject all
            </Button>
            <Button
              variant="primary"
              size="s"
              disabled={busy || group.mappableNow === 0}
              onClick={onMap}
            >
              {`Map approved (${group.mappableNow})`}
            </Button>
            {group.mapped > 0 ? (
              <Button variant="secondary" size="s" disabled={busy} onClick={onRemap}>
                Remap
              </Button>
            ) : null}
          </Inline>
        </Inline>
        {group.mappableNow === 0 && group.mapped < group.total ? (
          <Text size="s" color="tertiary">
            Approve codes to enable mapping.
          </Text>
        ) : null}
      </Box>
      <Collapsible isExpanded={expanded}>
        <CollapsibleHeader
          space="m"
          vSpace="s"
          onClick={() => setExpanded((v) => !v)}
          expandedIconAriaLabel={`Hide codes in ${group.category}`}
          collapsedIconAriaLabel={`Show codes in ${group.category}`}
        >
          <Text size="s" color="secondary">
            {expanded ? 'Hide' : 'Show'} codes ({group.total})
          </Text>
        </CollapsibleHeader>
        <Box space="m" vSpace="s">
          <Stack space="xs">
            {group.codes.map((c, i) => (
              <Stack key={c.code} space="xs">
                {i > 0 ? <Divider /> : null}
                <Inline alignItems="spaceBetween" vAlignItems="center">
                  <Checkbox
                    label={c.description || c.code}
                    size="s"
                    checked={c.reviewStatus === 'approved'}
                    disabled={togglingCodes.has(c.code)}
                    onChange={(e) => onToggleCode(c.code, e.target.checked)}
                  />
                  <Inline space="xs" vAlignItems="center">
                    {c.reviewStatus === 'rejected' ? (
                      <Badge text="Rejected" color="red" />
                    ) : null}
                    {mappingBadge(c)}
                  </Inline>
                </Inline>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Collapsible>
    </Card>
  );
}

export function CurriculumCategoryManagerModal({
  slug,
  open,
  mappingActive = false,
  initialCategory = null,
  onClose,
}: {
  slug: string;
  open: boolean;
  mappingActive?: boolean;
  /** When set, the modal is scoped to this single category (used by the
   *  Source-categories row click); otherwise it lists every category. */
  initialCategory?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<CategoryManagerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);
  const [approvingCategory, setApprovingCategory] = useState<string | null>(null);
  const [togglingCodes, setTogglingCodes] = useState<Set<string>>(new Set());
  const [missingKey, setMissingKey] = useState<ProviderId | null>(null);
  const [confirm, setConfirm] = useState<{
    category: string;
    codes: string[];
    count: number;
  } | null>(null);
  // Which category is in focus in single-category (scoped) mode — seeded from
  // `initialCategory`, then moved by the prev/next arrows and ←/→ keys.
  const [currentCategory, setCurrentCategory] = useState<string | null>(null);

  // Load (and reload) the category data whenever the modal opens. Deps are
  // [open, slug] only — see the study-plan modal note: including the loading
  // flag would let setState re-run this effect and strand the request.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadCurriculumCategoryManager(slug)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load categories.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  // Seed / reset the focused category each time the modal opens (or is opened
  // on a different category).
  useEffect(() => {
    if (open && initialCategory != null) {
      setCurrentCategory(initialCategory.trim() || 'Uncategorized');
    }
  }, [open, initialCategory]);

  const updateGroup = (category: string, codes: CategoryManagerCode[]) => {
    setData((prev) =>
      prev
        ? {
            groups: prev.groups.map((g) =>
              g.category === category ? resummarize(g, codes) : g,
            ),
          }
        : prev,
    );
  };

  const onToggleCode = async (category: string, code: string, approved: boolean) => {
    const group = data?.groups.find((g) => g.category === category);
    if (!group) return;
    const status: ReviewStatus = approved ? 'approved' : '';
    const prevCodes = group.codes;
    // Optimistic.
    updateGroup(
      category,
      group.codes.map((c) => (c.code === code ? { ...c, reviewStatus: status } : c)),
    );
    setTogglingCodes((s) => new Set(s).add(code));
    const res = await decideCode(slug, code, status);
    setTogglingCodes((s) => {
      const next = new Set(s);
      next.delete(code);
      return next;
    });
    if (res.error) {
      updateGroup(category, prevCodes); // revert
      setError(res.error);
    }
  };

  const onBulkApprove = async (category: string, status: ReviewStatus) => {
    const group = data?.groups.find((g) => g.category === category);
    if (!group) return;
    const codes = group.codes.map((c) => c.code);
    const prevCodes = group.codes;
    setApprovingCategory(category);
    setError(null);
    // Optimistic.
    updateGroup(
      category,
      group.codes.map((c) => ({ ...c, reviewStatus: status })),
    );
    const res = await approveCodes(slug, codes, status);
    setApprovingCategory(null);
    if (res.error) {
      updateGroup(category, prevCodes); // revert
      setError(res.error);
    }
  };

  const runMap = async (codes: string[], clearMappedFirst: boolean) => {
    setError(null);
    const primaryModel = readSpecForStage(slug, 'map_codes');
    if (!primaryModel) {
      setError(
        'No primary model configured for Map codes. Open the gear icon on the Map codes card to pick one.',
      );
      return;
    }
    const backupModel = readSpec(backupModelKey(slug)) ?? DEFAULT_BACKUP_MODEL;
    setMapping(true);
    try {
      const res = await fetch('/api/workflows/map-codes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          specialtySlug: slug,
          checkAgainstLibrary: true,
          codes,
          clearMappedFirst,
          primaryModel,
          backupModel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = missingApiKeyProvider(res.status, body);
        if (missing) {
          setMissingKey(missing);
          return;
        }
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // Mapping runs async; close so the tab's in-flight badge shows progress.
      router.refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMapping(false);
    }
  };

  const onMap = (group: CategoryManagerGroup) => {
    void runMap(
      group.codes.map((c) => c.code),
      false,
    );
  };

  const onRemap = (group: CategoryManagerGroup) => {
    const count = group.codes.filter(
      (c) => c.mapped && c.reviewStatus === 'approved',
    ).length;
    setConfirm({
      category: group.category,
      codes: group.codes.map((c) => c.code),
      count,
    });
  };

  // Scoped (single-category) mode matches the loader's grouping key: a code's
  // trimmed `category`, or "Uncategorized" when blank.
  const singleMode = initialCategory != null;
  const allGroups = data?.groups ?? [];
  const activeCategory = currentCategory ?? initialCategory?.trim() ?? 'Uncategorized';
  const activeIndex = allGroups.findIndex((g) => g.category === activeCategory);
  const canPrev = singleMode && activeIndex > 0;
  const canNext = singleMode && activeIndex >= 0 && activeIndex < allGroups.length - 1;
  const goPrev = () => {
    if (canPrev) setCurrentCategory(allGroups[activeIndex - 1].category);
  };
  const goNext = () => {
    if (canNext) setCurrentCategory(allGroups[activeIndex + 1].category);
  };

  // Keyboard review (single-category mode): ←/→ switch category, A approve all,
  // R reject all. Capture phase so the DS Modal focus trap doesn't swallow the
  // keys; suppressed while a confirm / missing-key dialog is up or focus is in
  // a form field.
  useEffect(() => {
    if (!open || !singleMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (confirm !== null || missingKey !== null) return;
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
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (activeIndex >= 0) void onBulkApprove(activeCategory, 'approved');
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (activeIndex >= 0) void onBulkApprove(activeCategory, 'rejected');
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  });

  if (!open) return null;

  const groups = singleMode
    ? activeIndex >= 0
      ? [allGroups[activeIndex]]
      : []
    : allGroups;

  return (
    <>
      <Modal
        header={singleMode ? 'Manage category codes' : 'Manage codes by category'}
        subHeader={
          singleMode
            ? activeCategory
            : 'Approve curriculum codes, then map or remap them by category.'
        }
        size="l"
        isDismissible
        actionButton={{ text: 'Done', onClick: onClose }}
        onAction={(action) => {
          if (action === 'cancel') onClose();
        }}
        closeButtonAriaLabel="Close category manager"
      >
        <Modal.Stack>
          <Stack space="s">
            {singleMode && allGroups.length > 1 ? (
              <Stack space="xxs">
                <Inline alignItems="spaceBetween" vAlignItems="center">
                  <Button
                    variant="secondary"
                    size="s"
                    leftIcon="arrow-left"
                    disabled={!canPrev || mapping}
                    onClick={goPrev}
                  >
                    Previous
                  </Button>
                  <Text size="s" color="secondary">
                    Category {activeIndex + 1} of {allGroups.length}
                  </Text>
                  <Button
                    variant="secondary"
                    size="s"
                    leftIcon="arrow-right"
                    disabled={!canNext || mapping}
                    onClick={goNext}
                  >
                    Next
                  </Button>
                </Inline>
                <Text size="xs" color="tertiary">
                  ←/→ switch category · A approve all · R reject all
                </Text>
              </Stack>
            ) : null}
            {mappingActive ? (
              <Stack space="xs">
                <Callout
                  type="warning"
                  text="A mapping run is already in progress. You can stop it before starting another."
                />
                <CancelMappingButton slug={slug} onCancelled={onClose} />
              </Stack>
            ) : null}
            {error ? <Callout type="error" text={error} /> : null}
            {loading && groups.length === 0 ? (
              <Text color="secondary">Loading categories…</Text>
            ) : groups.length === 0 ? (
              <Text color="secondary">
                {singleMode ? 'No codes in this category.' : 'No curriculum items yet.'}
              </Text>
            ) : (
              <Stack space="s">
                {groups.map((group) => (
                  <CategorySection
                    key={group.category}
                    group={group}
                    busy={mapping}
                    approvingBusy={approvingCategory === group.category}
                    togglingCodes={togglingCodes}
                    defaultExpanded={singleMode}
                    onApproveAll={() => onBulkApprove(group.category, 'approved')}
                    onRejectAll={() => onBulkApprove(group.category, 'rejected')}
                    onToggleCode={(code, approved) =>
                      onToggleCode(group.category, code, approved)
                    }
                    onMap={() => onMap(group)}
                    onRemap={() => onRemap(group)}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        </Modal.Stack>
      </Modal>
      <ConfirmRemapModal
        open={confirm !== null}
        category={confirm?.category ?? ''}
        count={confirm?.count ?? 0}
        submitting={mapping}
        onConfirm={() => {
          if (confirm) {
            const codes = confirm.codes;
            setConfirm(null);
            void runMap(codes, true);
          }
        }}
        onCancel={() => setConfirm(null)}
      />
      <MissingKeyModal
        open={missingKey !== null}
        provider={missingKey}
        onClose={() => setMissingKey(null)}
      />
    </>
  );
}

/**
 * Curriculum-plan entry point for category management, rendered in place of the
 * stock `RemapModal` on the Mapping tab. Unlike "Map by category…" it's **not**
 * greyed out when everything is mapped — remapping is the whole point — but it
 * still waits for the summary fetch and pauses during a full consolidation.
 */
export function CurriculumCategoryManagerButton({
  slug,
  supportReady,
  runningAll,
  mappingActive,
  onClosed,
}: {
  slug: string;
  supportReady: boolean;
  runningAll: boolean;
  mappingActive: boolean;
  /** Called after the modal closes so the toolbar can refetch its summary. */
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const canOpen = supportReady && !runningAll;

  const button = (
    <Button
      variant="secondary"
      size="m"
      disabled={!canOpen}
      onClick={() => setOpen(true)}
    >
      Map by category…
    </Button>
  );

  return (
    <>
      {supportReady && runningAll ? (
        <Tooltip content="A full consolidation is running — mapping resumes as soon as it finishes.">
          <span style={{ display: 'inline-flex' }}>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      <CurriculumCategoryManagerModal
        slug={slug}
        open={open}
        mappingActive={mappingActive}
        onClose={() => {
          setOpen(false);
          onClosed();
        }}
      />
    </>
  );
}
