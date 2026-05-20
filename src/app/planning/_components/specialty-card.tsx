'use client';

import { Card, CardBox, Stack, Text } from '@amboss/design-system';
import NextLink from 'next/link';
import type { PipelineStageStates } from '@/lib/pipeline-stage-state';
import type { Specialty } from '@/lib/types';
import { PipelineStageStrip } from './pipeline-stage-strip';

export function SpecialtyCard({
  specialty,
  stageStates,
  meta,
}: {
  specialty: Specialty;
  stageStates?: PipelineStageStates;
  meta?: { codes?: number; consolidatedArticles?: number; consolidatedSections?: number };
}) {
  const href = `/planning/${specialty.slug}`;
  const hasCounts =
    meta?.codes !== undefined ||
    meta?.consolidatedArticles !== undefined ||
    meta?.consolidatedSections !== undefined;
  return (
    <div className="card-fill">
      <NextLink href={href} style={{ textDecoration: 'none' }}>
        <Card title={specialty.name} titleAs="h3" outlined>
          <CardBox>
            <Stack space="s">
              <PipelineStageStrip stageStates={stageStates} />
              {hasCounts ? (
                <Text color="secondary">
                  {meta?.codes !== undefined ? `${meta.codes} codes` : ''}
                  {meta?.consolidatedArticles !== undefined
                    ? `${meta?.codes !== undefined ? ' · ' : ''}${meta.consolidatedArticles} articles`
                    : ''}
                  {meta?.consolidatedSections !== undefined
                    ? ` · ${meta.consolidatedSections} sections`
                    : ''}
                </Text>
              ) : null}
            </Stack>
          </CardBox>
        </Card>
      </NextLink>
    </div>
  );
}
