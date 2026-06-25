'use client';

import {
  Card,
  CardBox,
  Column,
  Columns,
  H1,
  Inline,
  Stack,
  Text,
} from '@amboss/design-system';
import NextLink from 'next/link';
import type { CSSProperties } from 'react';
import type { CurriculumPlanRow } from '@/lib/data/curriculum-plans';
import { AddCurriculumPlanButton } from './add-curriculum-plan-button';

const fillStyle: CSSProperties = { height: '100%' };
const linkStyle: CSSProperties = { textDecoration: 'none' };

/** Navigation card for one curriculum plan — links into the Teaching tab (not
 *  the Content Planner specialty page). Shows the plan name and a structural
 *  item count only. */
function CurriculumPlanCard({ row }: { row: CurriculumPlanRow }) {
  return (
    <div className="card-fill" style={fillStyle}>
      <NextLink
        href={`/teaching/curriculum-plans/${row.specialty.slug}`}
        style={linkStyle}
      >
        <Card title={row.specialty.name} titleAs="h3" outlined>
          <CardBox>
            <Text color="secondary">{row.stats.totalItems} curriculum items</Text>
          </CardBox>
        </Card>
      </NextLink>
    </div>
  );
}

/** Header-only placeholder shown while the plan list resolves. */
export function CurriculumPlansSkeleton() {
  return (
    <Stack space="s">
      <H1>Curriculum Plans</H1>
      <Text color="secondary">Loading…</Text>
    </Stack>
  );
}

export function CurriculumPlansView({ plans }: { plans: CurriculumPlanRow[] }) {
  return (
    <Stack space="xl">
      <Inline alignItems="spaceBetween" vAlignItems="center">
        <Stack space="s">
          <H1>Curriculum Plans</H1>
          <Text color="secondary">
            Select a curriculum to view its coverage and structure.
          </Text>
        </Stack>
        <AddCurriculumPlanButton />
      </Inline>

      {plans.length === 0 ? (
        <Text color="secondary">No curriculum plans yet.</Text>
      ) : (
        <Columns gap="m" vAlignItems="stretch">
          {plans.map((row) => (
            <Column key={row.specialty.slug} size={[12, 6, 4]}>
              <CurriculumPlanCard row={row} />
            </Column>
          ))}
        </Columns>
      )}
    </Stack>
  );
}
