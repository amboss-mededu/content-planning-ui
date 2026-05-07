import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { EmotionRegistry } from './emotion-registry';
import { NavShell } from './nav-shell';

export const metadata: Metadata = {
  title: {
    template: '%s · amboss-content-planner-ui',
    default: 'amboss-content-planner-ui',
  },
  description: 'Scaffolded with create-amboss-app.',
  openGraph: {
    title: 'amboss-content-planner-ui',
    description: 'Scaffolded with create-amboss-app.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'amboss-content-planner-ui',
    description: 'Scaffolded with create-amboss-app.',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,300;0,400;0,700;0,900;1,400;1,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Suspense>
          <EmotionRegistry>
            <NavShell>{children}</NavShell>
          </EmotionRegistry>
        </Suspense>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
