'use client';

import { Badge } from '@amboss/design-system';
import { useEffect, useState } from 'react';

export function LitSearchProgressBadge() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((current) => (current >= 3 ? 1 : current + 1));
    }, 450);
    return () => window.clearInterval(id);
  }, []);

  return <Badge text={`Search in progress${'.'.repeat(dots)}`} color="yellow" />;
}
