import type { NextConfig } from 'next';
import './src/env';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The Milestones tab editor sends the full milestones blob through a
  // Server Action. Next defaults the action body to 1 MB; raise it so the
  // 2 MB cap enforced in `saveMilestones` is reachable (with headroom for
  // multipart framing).
  experimental: {
    serverActions: { bodySizeLimit: '3mb' },
  },
  // Dev-only: allow the cloudflared quick-tunnel host (random per restart)
  // to hit dev resources like /_next/hmr. Only relevant when the n8n
  // callback flow needs a public URL for local lit-search testing —
  // does not affect production.
  allowedDevOrigins: ['*.trycloudflare.com'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
