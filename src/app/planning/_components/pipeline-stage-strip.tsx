'use client';

import { Badge, Inline } from '@amboss/design-system';
import {
  PIPELINE_STAGE_NAMES,
  type PipelineCardState,
  type PipelineStageStates,
} from '@/lib/pipeline-stage-state';
import type { StageName } from '@/lib/workflows/lib/db-writes';

const STATE_COLOR: Record<PipelineCardState, 'gray' | 'blue' | 'green'> = {
  not_started: 'gray',
  in_progress: 'blue',
  complete: 'green',
  skipped: 'gray',
};

const STAGE_LABEL: Record<StageName, string> = {
  extract_codes: 'Codes',
  extract_milestones: 'Milestones',
  map_codes: 'Mapping',
  consolidate_primary: 'Consolidation',
  consolidate_articles: 'Articles 2nd',
  consolidate_sections: 'Sections 2nd',
  literature_search: 'Lit. search',
};

export function PipelineStageStrip({
  stageStates,
}: {
  stageStates?: PipelineStageStates;
}) {
  return (
    <Inline space="xxs">
      {PIPELINE_STAGE_NAMES.map((stageName) => {
        const state = stageStates?.[stageName] ?? 'not_started';
        const badge = (
          <Badge
            text={STAGE_LABEL[stageName]}
            color={STATE_COLOR[state]}
            data-e2e-test-id={`pipeline-stage-strip-${stageName}-${state}`}
          />
        );
        if (state === 'skipped') {
          return (
            <span
              key={stageName}
              style={{ textDecoration: 'line-through', textDecorationThickness: '1.5px' }}
            >
              {badge}
            </span>
          );
        }
        return <span key={stageName}>{badge}</span>;
      })}
    </Inline>
  );
}
