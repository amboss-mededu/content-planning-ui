'use client';

import { Card, CardBox, Column, Columns, H2, Stack, Text } from '@amboss/design-system';
import Link from 'next/link';
import type { CSSProperties } from 'react';

export interface StatItem {
  label: string;
  value: string | number;
  hint?: string;
  /** When set, the card becomes a link to this path. Renders an
   *  identical card visually; just adds a pointer cursor + hover affordance. */
  href?: string;
}

const fillStyle: CSSProperties = { height: '100%' };
const linkResetStyle: CSSProperties = {
  display: 'block',
  color: 'inherit',
  textDecoration: 'none',
  height: '100%',
};

function CardBody({ stat }: { stat: StatItem }) {
  return (
    <Card outlined>
      <CardBox>
        <Stack space="xs">
          <Text color="secondary" size="s">
            {stat.label}
          </Text>
          <H2>{stat.value}</H2>
          {stat.hint && (
            <Text color="tertiary" size="s">
              {stat.hint}
            </Text>
          )}
        </Stack>
      </CardBox>
    </Card>
  );
}

export function CoverageStats({ stats }: { stats: StatItem[] }) {
  return (
    <Columns gap="m" vAlignItems="stretch">
      {stats.map((s) => (
        <Column key={s.label} size={[12, 6, 3]}>
          <div className="card-fill" style={fillStyle}>
            {s.href ? (
              <Link href={s.href} style={linkResetStyle}>
                <CardBody stat={s} />
              </Link>
            ) : (
              <CardBody stat={s} />
            )}
          </div>
        </Column>
      ))}
    </Columns>
  );
}
