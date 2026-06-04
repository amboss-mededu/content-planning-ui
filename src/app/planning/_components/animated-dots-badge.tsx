'use client';

import { Badge } from '@amboss/design-system';
import { useAnimatedDots } from './use-animated-dots';

type BadgeColor = 'green' | 'blue' | 'yellow' | 'brand' | 'purple' | 'red' | 'gray';

/**
 * A `Badge` whose label gains a cycling 1→2→3 dot suffix (".", "..", "...")
 * every 450ms, signalling live in-progress work. Mount it only while work is
 * actually running — the interval stops on unmount, so an idle card never
 * burns a timer. Shared by the consolidation review badges and the pipeline
 * dashboard stage cards so the "in progress" animation stays identical.
 */
export function AnimatedDotsBadge({
  label,
  color,
}: {
  label: string;
  color: BadgeColor;
}) {
  const dots = useAnimatedDots();
  return <Badge text={`${label}${dots}`} color={color} />;
}
