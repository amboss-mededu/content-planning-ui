'use client';

import { Card, CardBox, Column, Columns, Stack } from '@amboss/design-system';
import { SkeletonLine } from './skeleton';

const PLACEHOLDER_LABELS = [
  'Codes',
  'Categories',
  'Consolidated articles',
  'Consolidated sections',
];

export function OverviewSkeleton() {
  return (
    <Stack space="l">
      <Card outlined>
        <CardBox>
          <SkeletonLine width={'95%'} height={20} />
        </CardBox>
      </Card>
      <Columns gap="m" vAlignItems="stretch">
        {PLACEHOLDER_LABELS.map((label) => (
          <Column key={label} size={[12, 6, 3]}>
            <div className="card-fill">
              <Card outlined>
                <CardBox>
                  <Stack space="xs">
                    <SkeletonLine width={80} height={12} />
                    <SkeletonLine width={64} height={28} />
                    <SkeletonLine width={96} height={12} />
                  </Stack>
                </CardBox>
              </Card>
            </div>
          </Column>
        ))}
      </Columns>
    </Stack>
  );
}
