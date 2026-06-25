'use client';

import { Callout, Combobox, Input, Modal, Stack } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  createStudyPlanAction,
  loadStudyPlanCategoriesAction,
} from '@/app/teaching/curriculum-plans/[plan]/actions';
import type { StudyPlanCategoryOption } from '@/lib/data/study-plans';

/**
 * "Create study plan" modal — name + a multi-select of the curriculum's
 * categories, persisted to the `studyPlans` collection. Mirrors
 * `add-curriculum-plan-modal.tsx`; category options are loaded lazily when the
 * modal opens (the button lives in the shared header, so the codes aren't
 * already in scope here). On success it closes and `router.refresh()`es so the
 * Study Plans tab picks up the new row.
 */
export function CreateStudyPlanModal({
  slug,
  open,
  onClose,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [options, setOptions] = useState<StudyPlanCategoryOption[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load category options the first time the modal opens.
  useEffect(() => {
    if (!open || optionsLoaded || loadingOptions) return;
    let cancelled = false;
    setLoadingOptions(true);
    loadStudyPlanCategoriesAction(slug)
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        setOptionsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load categories.');
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug, optionsLoaded, loadingOptions]);

  if (!open) return null;

  const canSubmit = !submitting && name.trim().length > 0 && selected.length > 0;

  const reset = () => {
    setName('');
    setSelected([]);
    setOptions([]);
    setOptionsLoaded(false);
    setLoadingOptions(false);
    setSubmitting(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createStudyPlanAction(slug, name, selected);
      if (res.error) {
        setError(res.error);
        return;
      }
      reset();
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create study plan.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      header="Create study plan"
      subHeader="Name the plan and pick the curriculum categories it covers."
      size="m"
      isDismissible
      onAction={close}
      actionButton={{
        text: submitting ? 'Creating…' : 'Create study plan',
        onClick: submit,
        disabled: !canSubmit,
      }}
      secondaryButton={{
        text: 'Cancel',
        onClick: close,
      }}
    >
      <Modal.Stack>
        <Stack space="s">
          <Input
            name="study-plan-name"
            label="Name"
            placeholder="e.g. Year 1 core"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {optionsLoaded && options.length === 0 ? (
            <Callout
              type="info"
              text="No categories found for this curriculum yet — extract curriculum items first."
            />
          ) : (
            <Combobox
              name="study-plan-categories"
              label="Categories"
              labelHint="Curriculum categories to include in this study plan."
              hint={
                selected.length === 0
                  ? `${options.length} categor${options.length === 1 ? 'y' : 'ies'} available`
                  : `${selected.length} of ${options.length} selected`
              }
              multiple
              value={selected}
              onChange={(values) => setSelected(values as string[])}
              options={options}
              placeholder={loadingOptions ? 'Loading categories…' : 'Select categories…'}
              emptyStateMessage="No categories match the filter."
              maxHeight={320}
              disabled={loadingOptions || options.length === 0}
              slotProps={{
                tag: {
                  clearButtonAriaLabel: 'Remove category',
                },
              }}
            />
          )}
          {error ? <Callout type="error" text={error} /> : null}
        </Stack>
      </Modal.Stack>
    </Modal>
  );
}
