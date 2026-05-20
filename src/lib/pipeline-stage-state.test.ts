import { describe, expect, it } from 'vitest';
import {
  canSkipPipelineStage,
  isPipelineStageName,
  normalizePipelineStageStates,
} from './pipeline-stage-state';

describe('pipeline stage state normalization', () => {
  it('keeps valid new string states', () => {
    expect(
      normalizePipelineStageStates({
        states: {
          extract_codes: 'in_progress',
          map_codes: 'complete',
          consolidate_articles: 'skipped',
        },
      }),
    ).toMatchObject({
      extract_codes: 'in_progress',
      map_codes: 'complete',
      consolidate_articles: 'skipped',
    });
  });

  it('falls back from legacy skipped, then legacy complete, then not started', () => {
    expect(
      normalizePipelineStageStates({
        overrides: { map_codes: true, consolidate_articles: true },
        skipped: { consolidate_articles: true },
      }),
    ).toMatchObject({
      extract_codes: 'not_started',
      map_codes: 'complete',
      consolidate_articles: 'skipped',
    });
  });

  it('rejects unknown stages through the stage-name guard', () => {
    expect(isPipelineStageName('map_codes')).toBe(true);
    expect(isPipelineStageName('bogus_stage')).toBe(false);
  });

  it('does not allow skipped for non-2nd-consolidation stages', () => {
    expect(canSkipPipelineStage('consolidate_articles')).toBe(true);
    expect(canSkipPipelineStage('consolidate_sections')).toBe(true);
    expect(canSkipPipelineStage('map_codes')).toBe(false);
    expect(
      normalizePipelineStageStates({
        states: { map_codes: 'skipped' },
      }).map_codes,
    ).toBe('not_started');
  });
});
