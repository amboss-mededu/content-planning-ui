'use client';

import {
  Button,
  Callout,
  Inline,
  Input,
  Modal,
  Stack,
  Text,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { refreshSpecialty } from '../../actions';

type RerunStage = 'extract_codes' | 'extract_milestones';

const STAGE_NOUN: Record<RerunStage, string> = {
  extract_codes: 'code extraction',
  extract_milestones: 'milestone extraction',
};

/**
 * The "Re run extraction" control shown once an extraction stage has completed.
 *
 * Re-running clears the stage's output so it can run again. For code extraction
 * with downstream work already done (`hasDownstream`), that wipe is destructive
 * — it cascades through mapping, categories, consolidations, the backlog,
 * approvals, sources, lit-search runs and drafts — so it's gated behind a
 * three-step confirm ending in typing `<slug>-reset`. Otherwise (milestones, or
 * codes before mapping) a single plain confirm is enough. After the reset the
 * parent reopens the start form via `onResetComplete`.
 */
export function RerunExtractionButton({
  specialtySlug,
  runId,
  stage,
  hasDownstream,
  onResetComplete,
}: {
  specialtySlug: string;
  runId: string;
  stage: RerunStage;
  hasDownstream: boolean;
  onResetComplete: () => void;
}) {
  const router = useRouter();
  const [gate, setGate] = useState<0 | 1 | 2 | 3>(0);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phrase = `${specialtySlug}-reset`;
  const noun = STAGE_NOUN[stage];

  const close = () => {
    if (submitting) return;
    setGate(0);
    setConfirmText('');
    setError(null);
  };

  const doReset = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows/reset-stage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, specialtySlug, stage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setGate(0);
      setConfirmText('');
      // router.refresh() only clears the current route's client cache; the
      // reset wiped data the Mapping / Categories / consolidation tabs read, so
      // purge the whole /planning/<slug> client cache via revalidatePath in a
      // server action — otherwise those tabs show stale rows on next visit.
      await refreshSpecialty(specialtySlug);
      router.refresh();
      onResetComplete();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onTrigger = () => {
    if (!hasDownstream) {
      if (
        window.confirm(
          `Re-run ${noun}? This clears the current extraction so you can run it again.`,
        )
      ) {
        void doReset();
      }
      return;
    }
    setGate(1);
  };

  return (
    <>
      <div style={{ width: 220 }}>
        <Button variant="primary" fullWidth onClick={onTrigger} disabled={submitting}>
          Re run extraction
        </Button>
      </div>

      {gate > 0 ? (
        <Modal
          header={
            gate === 1
              ? 'Re-run code extraction?'
              : gate === 2
                ? 'This permanently deletes all downstream work'
                : 'Final confirmation'
          }
          subHeader={`Specialty: ${specialtySlug}`}
          size="m"
          role="alertdialog"
          isDismissible={!submitting}
          onAction={(action) => {
            if (action === 'cancel') close();
          }}
        >
          <Modal.Stack>
            {gate === 1 ? (
              <Modal.Text>
                Re-running code extraction replaces the codes for this specialty. Because
                mapping has already run, everything derived from the current codes will be
                deleted. Continue to review exactly what will be removed.
              </Modal.Text>
            ) : null}
            {gate === 2 ? (
              <Stack space="xs">
                <Modal.Text>
                  The following will be permanently deleted for this specialty:
                </Modal.Text>
                <Text>
                  • Mapping results and the category sheet
                  <br />• Consolidations — new-article & section suggestions, consolidated
                  articles/sections
                  <br />• Article & section approvals and consolidation-category flags
                  <br />• The article backlog
                  <br />• Gathered sources, literature-search runs, and drafts
                </Text>
                <Modal.Text>Milestones are not affected.</Modal.Text>
              </Stack>
            ) : null}
            {gate === 3 ? (
              <Stack space="s">
                <Modal.Text>Type {phrase} to confirm. This cannot be undone.</Modal.Text>
                <Input
                  label="Confirmation phrase"
                  hideLabel
                  name="rerun-confirm"
                  value={confirmText}
                  placeholder={phrase}
                  disabled={submitting}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </Stack>
            ) : null}
            {error ? <Callout type="error" text={error} /> : null}
            <Inline space="s">
              <Button
                variant="secondary"
                disabled={submitting}
                onClick={
                  gate === 1 ? close : () => setGate((g) => (g - 1) as 0 | 1 | 2 | 3)
                }
              >
                {gate === 1 ? 'Cancel' : 'Back'}
              </Button>
              {gate < 3 ? (
                <Button
                  variant="primary"
                  onClick={() => setGate((g) => (g + 1) as 0 | 1 | 2 | 3)}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  variant="primary"
                  destructive
                  loading={submitting}
                  disabled={confirmText !== phrase}
                  onClick={doReset}
                >
                  Wipe & re-run
                </Button>
              )}
            </Inline>
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}
