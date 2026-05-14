'use client';

import { Badge, Card, CardBox, Inline, Stack, Text } from '@amboss/design-system';
import NextLink from 'next/link';
import type { LastStep } from '@/lib/data/last-completed-step';
import type { Specialty } from '@/lib/types';

export function SpecialtyCard({
  specialty,
  lastStep,
  meta,
}: {
  specialty: Specialty;
  lastStep?: LastStep;
  meta?: { codes?: number; consolidatedArticles?: number; consolidatedSections?: number };
}) {
  const href = `/planning/${specialty.slug}`;
  const resolved: LastStep = lastStep ?? { rank: 0, label: 'Not started', color: 'gray' };
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
              <Inline space="xs">
                <Badge text={resolved.label} color={resolved.color} />
              </Inline>
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
