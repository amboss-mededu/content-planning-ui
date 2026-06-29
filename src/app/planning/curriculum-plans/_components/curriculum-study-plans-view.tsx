'use client';

import { Badge, Button, Card, CardBox, Inline, Stack, Text } from '@amboss/design-system';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { deleteStudyPlanAction } from '@/app/planning/curriculum-plans/[plan]/actions';
import type { CodeRecord, StudyPlanRecord } from '@/lib/pb/types';
import { useLiveCollection } from '@/lib/pb/use-live-collection';

/**
 * Study Plans sub-tab — read-only board of the curriculum plan's saved study
 * plans. Seeded from the server snapshot and kept live via `useLiveCollection`
 * so a plan created from the Overview header shows up without a manual reload.
 * Each card shows the plan name, its categories, and how many curriculum items
 * those categories cover.
 */
export function CurriculumStudyPlansView({
  slug,
  codes,
  initialStudyPlans,
}: {
  slug: string;
  codes: CodeRecord[];
  initialStudyPlans: StudyPlanRecord[];
}) {
  const router = useRouter();
  const plans = useLiveCollection<StudyPlanRecord>('studyPlans', initialStudyPlans, {
    filter: `specialtySlug = "${slug}"`,
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Curriculum-item count per category, to size each plan's coverage.
  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of codes) {
      const cat = c.category?.trim();
      if (cat) m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    return m;
  }, [codes]);

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteStudyPlanAction(slug, id);
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  };

  if (plans.length === 0) {
    return (
      <Text color="secondary">
        No study plans yet. Use “Create study plan” on the Overview header to compose one
        from curriculum categories.
      </Text>
    );
  }

  // Newest first (server sorts by -created; live-inserted rows append).
  const sorted = [...plans].sort((a, b) => (a.created < b.created ? 1 : -1));

  return (
    <Stack space="s">
      {sorted.map((plan) => {
        const cats = plan.selectedCategories ?? [];
        const itemCount = cats.reduce(
          (sum, cat) => sum + (countByCategory.get(cat) ?? 0),
          0,
        );
        return (
          <Card key={plan.id} title={plan.name} titleAs="h3" outlined>
            <CardBox>
              <Stack space="s">
                <Text color="secondary">
                  {itemCount} curriculum item{itemCount === 1 ? '' : 's'} · {cats.length}{' '}
                  categor{cats.length === 1 ? 'y' : 'ies'}
                </Text>
                {cats.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {cats.map((cat) => (
                      <Badge key={cat} text={cat} color="gray" />
                    ))}
                  </div>
                ) : null}
                <Inline alignItems="spaceBetween" vAlignItems="center">
                  {plan.createdBy ? (
                    <Text size="s" color="tertiary">
                      Created by {plan.createdBy}
                    </Text>
                  ) : (
                    <span />
                  )}
                  <Button
                    variant="secondary"
                    size="s"
                    disabled={deletingId === plan.id}
                    onClick={() => onDelete(plan.id)}
                  >
                    {deletingId === plan.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </Inline>
              </Stack>
            </CardBox>
          </Card>
        );
      })}
    </Stack>
  );
}
