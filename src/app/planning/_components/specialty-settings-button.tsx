'use client';

import { Button, Modal, Stack, Text } from '@amboss/design-system';
import { useState } from 'react';
import type { MappingSource, McpEnv, PipelineMode } from '@/lib/types';
import {
  COVERAGE_SOURCE_LABEL,
  coverageSourceHint,
  sourceIncludesRagDb,
} from './coverage-source-copy';
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
  const [source, setSource] = useState<MappingSource>(mappingSource);
  const sourceLocked = mode === 'curriculum-mapping';
  // Staging/prod only matters once the RAG DB is part of the source — shown in
  // any mode, since the RAG DB backs the guidelines track everywhere.
  const showMcpServer = sourceIncludesRagDb(source);
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
                <Text weight="bold">{COVERAGE_SOURCE_LABEL}</Text>
                <Text size="s" color="secondary">
                  {coverageSourceHint({ locked: sourceLocked })}
                </Text>
                <MappingSourceControl
                  slug={slug}
                  mappingSource={mappingSource}
                  disabled={sourceLocked}
                  onChange={setSource}
                />
              </Stack>
              {showMcpServer ? (
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
