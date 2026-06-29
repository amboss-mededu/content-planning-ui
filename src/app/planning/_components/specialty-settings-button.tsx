'use client';

import { Button, Modal, Stack, Text } from '@amboss/design-system';
import { useState } from 'react';
import type { MappingSource, PipelineMode } from '@/lib/types';
import { MappingSourceControl } from './mapping-source-control';
import { PipelineModeControl } from './pipeline-mode-control';

/**
 * Header "Settings" button → modal holding the per-specialty workflow controls
 * (workflow mode + mapping source). Both controls persist on change via their
 * own PATCH handlers, so the modal needs no save button — closing it just
 * dismisses. RAG-corpus pins the source to guidelines and curriculum-mapping
 * pins it to AMBOSS, so the source control is disabled while either is selected.
 */
export function SpecialtySettingsButton({
  slug,
  pipelineMode,
  mappingSource,
}: {
  slug: string;
  pipelineMode: PipelineMode;
  mappingSource: MappingSource;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PipelineMode>(pipelineMode);
  const sourceLocked = mode === 'rag-corpus' || mode === 'curriculum-mapping';
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
                <Text weight="bold">Workflow</Text>
                <Text size="s" color="secondary">
                  Mapping only, RAG corpus expansion (mapping → literature search),
                  curriculum mapping (curriculum → AMBOSS coverage), or full content
                  pipeline (mapping → articles).
                </Text>
                <PipelineModeControl
                  slug={slug}
                  pipelineMode={pipelineMode}
                  onChange={setMode}
                />
              </Stack>
              <Stack space="xs">
                <Text weight="bold">Mapping source</Text>
                <Text size="s" color="secondary">
                  {mode === 'rag-corpus'
                    ? 'RAG corpus always assesses coverage against clinical guidelines.'
                    : mode === 'curriculum-mapping'
                      ? 'Curriculum mapping always assesses coverage against AMBOSS.'
                      : "Which content this specialty's coverage is assessed against — AMBOSS articles, clinical guidelines, or both."}
                </Text>
                <MappingSourceControl
                  slug={slug}
                  mappingSource={mappingSource}
                  disabled={sourceLocked}
                />
              </Stack>
            </Stack>
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}
