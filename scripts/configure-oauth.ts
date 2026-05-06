/**
 * Push Google OAuth client credentials onto the local PocketBase instance.
 *
 *   POCKETBASE_URL=http://localhost:8090 \
 *   POCKETBASE_ADMIN_EMAIL=... \
 *   POCKETBASE_ADMIN_PASSWORD=... \
 *   GOOGLE_OAUTH_CLIENT_ID=... \
 *   GOOGLE_OAUTH_CLIENT_SECRET=... \
 *     npm run configure-oauth
 *
 * Idempotent: re-running with the same env updates the existing provider
 * config in place. Run once per environment (local / preview / prod) when
 * credentials change.
 *
 * Replaces the manual "edit users → Auth providers → Google" click-path in
 * the PocketBase admin UI so the credentials never live anywhere outside
 * .env.local.
 */
import 'dotenv/config';
import PocketBase from 'pocketbase';

type Provider = {
  name: string;
  clientId: string;
  clientSecret: string;
  authUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  displayName?: string;
  pkce?: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv('POCKETBASE_URL');
  const adminEmail = requireEnv('POCKETBASE_ADMIN_EMAIL');
  const adminPassword = requireEnv('POCKETBASE_ADMIN_PASSWORD');
  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');

  const pb = new PocketBase(url);
  await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
  console.log(`Authenticated as superuser ${adminEmail}`);

  const users = await pb.collections.getOne('users');

  const existingOauth2 = (users as unknown as { oauth2?: { providers?: Provider[] } })
    .oauth2;
  const existingProviders = existingOauth2?.providers ?? [];
  const otherProviders = existingProviders.filter((p) => p.name !== 'google');
  const googleProvider: Provider = { name: 'google', clientId, clientSecret };

  const updated = await pb.collections.update('users', {
    oauth2: {
      enabled: true,
      providers: [...otherProviders, googleProvider],
    },
  });

  const providerCount = (updated as unknown as { oauth2?: { providers?: Provider[] } })
    .oauth2?.providers?.length;
  console.log(
    `OK — users collection now has ${providerCount ?? 0} OAuth provider(s) configured.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
