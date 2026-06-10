'use client';

import {
  Button,
  Callout,
  Card,
  CardBox,
  Inline,
  Stack,
  Text,
  Textarea,
} from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { saveMilestones } from '../[specialty]/actions';

/**
 * Editor for the plain-text milestones blob on the Milestones tab. Two ways
 * in: paste/type directly, or load a `.txt` file (read client-side via
 * `FileReader` — it only fills the textarea, never auto-saves, so the editor
 * can review before committing). Save goes through the `saveMilestones`
 * server action, then `router.refresh()` re-renders the read-only preview in
 * `MilestonesView`.
 *
 * Disabled while the extract-milestones workflow is running — that workflow
 * writes the same field and would race a manual save.
 */
export function MilestonesEditor({
  slug,
  initialValue,
  extractionRunning,
}: {
  slug: string;
  initialValue: string;
  extractionRunning: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasExisting = initialValue.trim().length > 0;

  function openEditor() {
    setValue(initialValue);
    setError(null);
    setOpen(true);
  }

  function cancel() {
    setOpen(false);
    setError(null);
    setValue(initialValue);
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-fires onChange.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setValue(reader.result);
    };
    reader.onerror = () => setError('Could not read the selected file.');
    reader.readAsText(file);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveMilestones(slug, value);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Failed to save milestones. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button
          type="button"
          variant="tertiary"
          disabled={extractionRunning}
          onClick={openEditor}
        >
          {hasExisting ? 'Edit milestones' : 'Add milestones manually'}
        </Button>
        {extractionRunning ? (
          <Text size="s" color="secondary">
            Editing is disabled while a milestone extraction run is active.
          </Text>
        ) : null}
      </div>
    );
  }

  return (
    <Card title="Edit milestones" titleAs="h3" outlined>
      <CardBox>
        <Stack space="m">
          <Textarea
            label="Milestones"
            hint="Paste milestones text (plain text or the ACGME JSON output) or load a .txt file below."
            value={value}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setValue(e.target.value)
            }
            rows={16}
            resize="vertical"
            disabled={saving}
          />

          <Inline space="s" vAlignItems="center">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => fileInput.current?.click()}
            >
              Load from .txt file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".txt,text/plain"
              onChange={onFilePick}
              disabled={saving}
              style={{ display: 'none' }}
            />
            <Text size="s" color="secondary">
              Fills the editor only — nothing is saved until you click Save.
            </Text>
          </Inline>

          {hasExisting ? (
            <Callout
              type="warning"
              text="Saving overwrites the current milestones for this specialty."
            />
          ) : null}

          {error ? <Callout type="error" text={error} /> : null}

          <Inline space="s">
            <Button type="button" variant="primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="tertiary" disabled={saving} onClick={cancel}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      </CardBox>
    </Card>
  );
}
