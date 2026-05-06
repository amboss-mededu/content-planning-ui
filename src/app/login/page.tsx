'use client';

import { Box, Button, Stack, Text } from '@amboss/design-system';
import { useSearchParams } from 'next/navigation';
import { AuthCard } from './_components/auth-card';
import { safeRedirectTarget } from './_lib/safe-redirect';

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
 */
export default function LoginPage() {
  const searchParams = useSearchParams();
  const next = safeRedirectTarget(searchParams.get('next'));
  const errorMessage = searchParams.get('error');

  const href = `/api/auth/login/google?next=${encodeURIComponent(next)}`;

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
        <Button as="a" href={href} variant="primary">
          Continue with Google
        </Button>
      </Stack>
    </AuthCard>
  );
}
