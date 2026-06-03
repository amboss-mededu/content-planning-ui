'use client';

import { Button, Inline } from '@amboss/design-system';
import { useAnimatedDots } from './use-animated-dots';

/**
 * Disabled, fixed-width button that animates "Running." → "Running…", shown in
 * place of a "Start extraction" button while that extraction is in progress so
 * the trigger reflects live state instead of vanishing. Mount it only while
 * running — the dot timer lives for the component's lifetime. Width matches the
 * Start-extraction button so the control doesn't shift.
 */
export function RunningButton() {
  const dots = useAnimatedDots();
  return (
    <Inline space="s">
      <div style={{ width: 220 }}>
        <Button fullWidth disabled>
          {`Running${dots}`}
        </Button>
      </div>
    </Inline>
  );
}
