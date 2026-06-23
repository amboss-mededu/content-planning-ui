'use client';

import { Button, Stack, Text, Textarea } from '@amboss/design-system';
import { useState } from 'react';

// Shared grid template so "title + default-prompt button + add/remove button"
// line up across every PromptSection on the page.
const PROMPT_HEADER_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '260px 180px 180px',
  columnGap: 12,
  alignItems: 'center',
};

export function PromptSection({
  title,
  hint,
  value,
  onChange,
  onViewDefault,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  onViewDefault: () => void;
}) {
  // Keep the textarea open if the caller already has instructions (e.g. after
  // a router.refresh() rehydrates state); otherwise start collapsed so the
  // form stays compact and users opt in only when they need to tweak prompts.
  const [expanded, setExpanded] = useState(value.length > 0);

  return (
    <Stack space="xxs">
      <div style={PROMPT_HEADER_GRID}>
        <Text weight="bold">{title}</Text>
        <Button type="button" variant="tertiary" onClick={onViewDefault}>
          View default prompt
        </Button>
        {expanded ? (
          <Button
            type="button"
            variant="tertiary"
            onClick={() => {
              setExpanded(false);
              onChange('');
            }}
          >
            Remove instructions
          </Button>
        ) : (
          <Button type="button" variant="tertiary" onClick={() => setExpanded(true)}>
            + Add instructions
          </Button>
        )}
      </div>
      <Text color="secondary">{hint}</Text>
      {expanded ? (
        <Textarea
          name={title}
          label="Additional instructions (appended to default)"
          placeholder="Leave empty to use the default as-is."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          // The DS Textarea defaults maxLength to 256, which silently truncates
          // longer prompt instructions. Lift it well above any realistic prompt.
          maxLength={50000}
        />
      ) : null}
    </Stack>
  );
}
