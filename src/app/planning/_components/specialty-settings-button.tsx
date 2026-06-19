'use client';

import { Button, Modal, Stack, Text } from '@amboss/design-system';
import { useState } from 'react';
import type { MappingSource } from '@/lib/types';
import { MappingOnlyToggle } from './mapping-only-toggle';
import { MappingSourceControl } from './mapping-source-control';

/**
 * Header "Settings" button → modal holding the per-specialty mapping controls
 * (mapping source + mapping-only mode). Both controls persist on change via
 * their own PATCH handlers, so the modal needs no save button — closing it
 * just dismisses.
 */
export function SpecialtySettingsButton({
  slug,
  mappingOnly,
  mappingSource,
}: {
  slug: string;
  mappingOnly: boolean;
  mappingSource: MappingSource;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="tertiary"
        size="s"
        leftIcon="settings"
        onClick={() => setOpen(true)}
      >
        Settings
      </Button>
      {open ? (
        <Modal
          header="Specialty settings"
          subHeader="Changes apply to the next mapping run."
          size="m"
          isDismissible
          onAction={() => setOpen(false)}
          actionButton={{ text: 'Done', onClick: () => setOpen(false) }}
        >
          <Modal.Stack>
            <Stack space="l">
              <Stack space="xs">
                <Text weight="bold">Mapping source</Text>
                <Text size="s" color="secondary">
                  Which content this specialty's coverage is assessed against — AMBOSS
                  articles, clinical guidelines, or both.
                </Text>
                <MappingSourceControl slug={slug} mappingSource={mappingSource} />
              </Stack>
              <Stack space="xs">
                <Text weight="bold">Mapping only</Text>
                <Text size="s" color="secondary">
                  Skip consolidation &amp; suggestions — run coverage mapping only.
                </Text>
                <MappingOnlyToggle slug={slug} mappingOnly={mappingOnly} />
              </Stack>
            </Stack>
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}
