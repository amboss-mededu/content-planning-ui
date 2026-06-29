'use client';

import {
  Callout,
  Card,
  CardBox,
  Inline,
  Select,
  Stack,
  Text,
} from '@amboss/design-system';
import { useState } from 'react';
import { updateUserRole } from '@/app/settings/actions';
import type { UserRole } from '@/lib/auth/roles';
import type { TeamMember } from '@/lib/data/users';
import { log } from '@/lib/log';

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'editor', label: 'Editor — My Backlog only' },
  { value: 'architect', label: 'Architect — full access' },
];

export function TeamRolesPanel({
  initialMembers,
  viewerId,
}: {
  initialMembers: TeamMember[];
  viewerId: string;
}) {
  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleChange(member: TeamMember, next: UserRole) {
    if (next === member.role) return;
    setError(null);
    setPendingId(member.id);
    const previous = member.role;
    // Optimistic: reflect the change immediately, roll back on failure.
    setMembers((rows) =>
      rows.map((r) => (r.id === member.id ? { ...r, role: next } : r)),
    );
    try {
      const res = await updateUserRole(member.id, next);
      if (res.error) {
        setError(res.error);
        setMembers((rows) =>
          rows.map((r) => (r.id === member.id ? { ...r, role: previous } : r)),
        );
      }
    } catch (e) {
      log('settings').error('updateUserRole failed', e);
      setError('Failed to update role. Please try again.');
      setMembers((rows) =>
        rows.map((r) => (r.id === member.id ? { ...r, role: previous } : r)),
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card outlined title="Team roles" titleAs="h2">
      <CardBox>
        <Stack space="m">
          <Text color="secondary">
            Architects run the full pipeline and assign editors. Editors only see their
            assigned My Backlog. A role change takes effect the next time that person
            signs in.
          </Text>
          {error && <Callout type="error" text={error} />}
          <Stack space="s">
            {members.map((m) => (
              <Inline key={m.id} space="m" vAlignItems="center" alignItems="spaceBetween">
                <Stack space="zero">
                  <Text>{m.name ?? m.email}</Text>
                  {m.name && <Text color="secondary">{m.email}</Text>}
                </Stack>
                <div style={{ minWidth: 240 }}>
                  <Select
                    name={`role-${m.id}`}
                    label={`Role for ${m.name ?? m.email}`}
                    hideLabel
                    value={m.role}
                    disabled={pendingId === m.id || m.id === viewerId}
                    options={ROLE_OPTIONS}
                    onChange={(e) => handleChange(m, e.target.value as UserRole)}
                  />
                </div>
              </Inline>
            ))}
          </Stack>
        </Stack>
      </CardBox>
    </Card>
  );
}
