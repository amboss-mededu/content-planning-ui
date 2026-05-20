'use client';

import { Box, Button, Icon, Popover, Stack, Text } from '@amboss/design-system';
import { MODEL_CATALOG, type ModelSpec } from '@/lib/workflows/lib/llm';
import { DEFAULT_MODELS } from './model-selection-storage';
import { MappingModelSelector, ModelSelector } from './model-selector';

function catalogLabel(spec: ModelSpec | undefined): string {
  if (!spec) return 'No default';
  const entry = MODEL_CATALOG.find(
    (m) => m.provider === spec.provider && m.model === spec.model,
  );
  return entry?.label ?? `${spec.provider}/${spec.model}`;
}

/**
 * Gear-icon trigger that opens a Popover containing the per-stage model
 * picker. Replaces the inline ModelSelector that used to live in every stage
 * card body — the body is now reserved for status / summary / actions, and
 * model selection is a side door for editors who actually want to override
 * the hard-coded defaults in `DEFAULT_MODELS`.
 *
 * For map_codes the popover renders the primary + backup pair; other stages
 * render the single-model selector.
 */
export function ModelSettingsPopover({
  specialtySlug,
  stage,
}: {
  specialtySlug: string;
  stage: string;
}) {
  const defaultLabel = catalogLabel(DEFAULT_MODELS[stage]);
  const isMapping = stage === 'map_codes';

  const content = (
    <Box vSpace="s" lSpace="s" rSpace="s">
      <Stack space="s">
        <Text color="secondary">Default: {defaultLabel}</Text>
        {isMapping ? (
          <MappingModelSelector specialtySlug={specialtySlug} />
        ) : (
          <ModelSelector specialtySlug={specialtySlug} stage={stage} />
        )}
      </Stack>
    </Box>
  );

  return (
    <Popover
      content={content}
      placement="bottom-right"
      maxWidth={520}
      disableInitialFocus
    >
      <Button
        variant="tertiary"
        size="s"
        aria-label="Model settings"
        title={`Model settings (default: ${defaultLabel})`}
      >
        <Icon name="settings" size="s" inline />
      </Button>
    </Popover>
  );
}
