'use client';

import { Button, Modal, Stack, Text } from '@amboss/design-system';
import { useState } from 'react';
import type { MappingSource, McpEnv, PipelineMode } from '@/lib/types';
import { MappingSourceControl } from './mapping-source-control';
import { McpServerControl } from './mcp-server-control';
import { PipelineModeControl } from './pipeline-mode-control';

/**
 * Header "Settings" button → modal holding the per-specialty workflow controls
 * (workflow mode + mapping source, plus the MCP server for rag-corpus). Each
 * control persists on change via its own PATCH handler, so the modal needs no
 * save button — closing it just dismisses. curriculum-mapping pins the source
 * to AMBOSS, so the source control is disabled while it is selected; rag-corpus
 * lets the user pick RAG DB / AMBOSS / both and choose the MCP environment.
 */
export function SpecialtySettingsButton({
  slug,
  pipelineMode,
  mappingSource,
  mcpEnv,
}: {
  slug: string;
  pipelineMode: PipelineMode;
  mappingSource: MappingSource;
  mcpEnv: McpEnv;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PipelineMode>(pipelineMode);
  const sourceLocked = mode === 'curriculum-mapping';
  const isRagCorpus = mode === 'rag-corpus';
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
                <Text weight="bold">
                  {isRagCorpus ? 'Coverage source' : 'Mapping source'}
                </Text>
                <Text size="s" color="secondary">
                  {isRagCorpus
                    ? "Which content this specialty's coverage is assessed against — the RAG DB, AMBOSS content, or both."
                    : mode === 'curriculum-mapping'
                      ? 'Curriculum mapping always assesses coverage against AMBOSS.'
                      : "Which content this specialty's coverage is assessed against — AMBOSS articles, clinical guidelines, or both."}
                </Text>
                <MappingSourceControl
                  slug={slug}
                  mappingSource={mappingSource}
                  disabled={sourceLocked}
                  ragCorpus={isRagCorpus}
                />
              </Stack>
              {isRagCorpus ? (
                <Stack space="xs">
                  <Text weight="bold">MCP server</Text>
                  <Text size="s" color="secondary">
                    Which AMBOSS MCP environment RAG corpus runs query.
                  </Text>
                  <McpServerControl slug={slug} mcpEnv={mcpEnv} />
                </Stack>
              ) : null}
            </Stack>
          </Modal.Stack>
        </Modal>
      ) : null}
    </>
  );
}
