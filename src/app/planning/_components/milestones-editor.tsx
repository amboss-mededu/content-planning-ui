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
 * Editor panel for the plain-text milestones blob on the Milestones tab. Two
 * ways in: paste/type directly, or load a `.txt` file (read client-side via
 * `FileReader` — it only fills the textarea, never auto-saves, so the editor
 * can review before committing). Save goes through the `saveMilestones`
 * server action, then `router.refresh()` re-renders the read-only preview in
 * `MilestonesView`.
 *
 * Controlled by the parent (`open` / `onClose`) so the trigger button can sit
 * inline next to the extraction button while this panel drops below it.
 * Mounted only while open, so `useState(initialValue)` always seeds from the
 * latest saved value.
 */
export function MilestonesEditor({
  slug,
  initialValue,
  onClose,
}: {
  slug: string;
  initialValue: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasExisting = initialValue.trim().length > 0;

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
      onClose();
      router.refresh();
    } catch {
      setError('Failed to save milestones. Please try again.');
    } finally {
      setSaving(false);
    }
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
            // The DS Textarea defaults maxLength to 256, which silently truncates
            // pasted milestone documents. Lift it to the 2 MB server cap.
            maxLength={2 * 1024 * 1024}
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
            <Button type="button" variant="tertiary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      </CardBox>
    </Card>
  );
}
