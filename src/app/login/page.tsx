'use client';

import { Box, Button, Input, Stack, Text } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { AuthCard } from './_components/auth-card';
import { safeRedirectTarget } from './_lib/safe-redirect';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Sign-in screen. Replaces the previous Convex Auth multi-stage password +
 * OTP flow with a single Google OAuth button. The button is a plain link
 * to `/api/auth/login/google?next=...` — that route generates the PKCE
 * params in PocketBase, stashes them in a short-lived HttpOnly cookie,
 * and redirects to Google's consent screen. The callback at
 * `/auth/callback/google` completes the exchange and sets the auth cookie.
 *
 * Domain restriction (@amboss.com / @medicuja.com / @miamed.de) is
 * enforced server-side in `pb_hooks/main.pb.js`, not here.
 *
 * Dev sign-in form (rendered only when NODE_ENV === 'development') posts
 * straight to /api/auth/dev-login, which auto-provisions the user via
 * the admin SDK and signs them in with PB password auth. Removed in the
 * final cleanup PR — production is OAuth-only.
 */
export default function LoginPage() {
  const searchParams = useSearchParams();
  const next = safeRedirectTarget(searchParams.get('next'));
  const errorMessage = searchParams.get('error');

  const oauthHref = `/api/auth/login/google?next=${encodeURIComponent(next)}`;

  return (
    <AuthCard
      title="Sign in"
      description="Use your AMBOSS Google account to access the content planner."
    >
      <Stack space="m">
        {errorMessage ? (
          <Box>
            <Text color="error">{errorMessage}</Text>
          </Box>
        ) : null}
        <Button as="a" href={oauthHref} variant="primary">
          Continue with Google
        </Button>
        {IS_DEV ? <DevLoginForm next={next} /> : null}
      </Stack>
    </AuthCard>
  );
}

function DevLoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Box>
      <Stack space="s">
        <Text size="s" color="secondary">
          Dev sign-in (NODE_ENV=development only — auto-provisions the user)
        </Text>
        <form method="post" action="/api/auth/dev-login">
          <input type="hidden" name="next" value={next} />
          <Stack space="xs">
            <Input
              name="email"
              type="email"
              label="Email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              name="password"
              type="password"
              label="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" variant="secondary">
              Dev sign in
            </Button>
          </Stack>
        </form>
      </Stack>
    </Box>
  );
}
