/// <reference path="../pb_data/types.d.ts" />

// Server-side hooks. Loaded automatically by `pocketbase serve`. Replaces the
// authorizeEmail() check in the deleted convex/auth.ts.
//
// AMBOSS staff allowlist: by default any @amboss.com / @medicuja.com /
// @miamed.de address can sign in. Override with an explicit comma-separated
// list via the STAFF_EMAIL_ALLOWLIST env var on the PocketBase process.

const ALLOWED_DOMAINS = ['amboss.com', 'medicuja.com', 'miamed.de'];

onRecordAuthWithOAuth2Request((e) => {
  const oauthEmail = String(e.oauth2User && e.oauth2User.email ? e.oauth2User.email : '')
    .trim()
    .toLowerCase();

  if (!oauthEmail) {
    throw new BadRequestError('OAuth provider did not return an email — cannot authorize.');
  }

  // Explicit allowlist takes precedence; falls back to domain check.
  const allowlistRaw = String($os.getenv('STAFF_EMAIL_ALLOWLIST') || '').trim();
  if (allowlistRaw) {
    const allowed = new Set(
      allowlistRaw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    );
    if (!allowed.has(oauthEmail)) {
      throw new BadRequestError(
        'Sign-in is restricted to AMBOSS staff. Contact your admin to be added to the allowlist.',
      );
    }
  } else {
    const at = oauthEmail.indexOf('@');
    const domain = at >= 0 ? oauthEmail.slice(at + 1) : '';
    if (!ALLOWED_DOMAINS.includes(domain)) {
      throw new BadRequestError(
        'Sign-in is restricted to AMBOSS staff. Please use your @amboss.com / @medicuja.com / @miamed.de address.',
      );
    }
  }

  // For brand-new sign-ups, mirror the OAuth profile name onto the user
  // record so the UI has something to display before the user edits.
  if (e.isNewRecord && e.record) {
    const oauthName = String(e.oauth2User && e.oauth2User.name ? e.oauth2User.name : '').trim();
    if (oauthName) {
      e.record.set('name', oauthName);
    }
    const avatar = String(e.oauth2User && e.oauth2User.avatarUrl ? e.oauth2User.avatarUrl : '').trim();
    if (avatar) {
      e.record.set('avatarUrl', avatar);
    }

    // Assign the initial role. Default is 'editor' (least privilege — My Backlog
    // only). Bootstrap the first content architects via the comma-separated
    // CONTENT_ARCHITECT_ALLOWLIST env on the PocketBase process; thereafter
    // architects promote others from the in-app Settings "Team roles" panel.
    const architectsRaw = String($os.getenv('CONTENT_ARCHITECT_ALLOWLIST') || '').trim();
    const architects = new Set(
      architectsRaw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    );
    e.record.set('role', architects.has(oauthEmail) ? 'architect' : 'editor');
  }

  e.next();
}, 'users');
