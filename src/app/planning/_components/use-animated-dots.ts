'use client';

import { useEffect, useState } from 'react';

/**
 * Returns a cycling dot suffix — "." → ".." → "..." — advancing every 450ms.
 * Mount the consuming component only while work is running; the interval stops
 * on unmount so idle UI never burns a timer. Shared by `AnimatedDotsBadge` and
 * the "Running…" Start-extraction buttons so the animation stays identical.
 */
export function useAnimatedDots(intervalMs = 450): string {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((current) => (current >= 3 ? 1 : current + 1));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return '.'.repeat(dots);
}
