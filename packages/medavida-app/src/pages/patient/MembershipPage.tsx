import { Badge, Group, Stack, Text, Title } from '@mantine/core';
import { useMedplum, useMedplumProfile } from '@medplum/react';
import type { Coverage, Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  draft: 'yellow',
  cancelled: 'red',
};

export function MembershipPage(): JSX.Element {
  const medplum = useMedplum();
  const profile = useMedplumProfile() as Patient | undefined;

  const coverages = profile?.id
    ? medplum.searchResources<Coverage>('Coverage', `beneficiary=Patient/${profile.id}`).read()
    : [];

  const dpcCoverage = coverages.find((c) =>
    c.type?.coding?.some((t) => t.code === 'PUBLICPOL')
  );

  return (
    <Stack gap="lg">
      <Title order={3}>Membership & Billing</Title>
      {!dpcCoverage ? (
        <Text c="dimmed">No active DPC membership found. Contact your clinic to enroll.</Text>
      ) : (
        <div style={{ padding: '16px', border: '1px solid #eee', borderRadius: 8 }}>
          <Group justify="space-between">
            <Text fw={600}>DPC Membership</Text>
            <Badge color={STATUS_COLOR[dpcCoverage.status ?? ''] ?? 'gray'}>{dpcCoverage.status}</Badge>
          </Group>
          <Text size="sm" c="dimmed" mt={8}>
            Plan:{' '}
            {dpcCoverage.class?.find((c) => c.type?.coding?.some((t) => t.code === 'plan'))?.value ?? 'Individual'}
          </Text>
          {dpcCoverage.period?.start && (
            <Text size="sm" c="dimmed">
              Member since: {new Date(dpcCoverage.period.start).toLocaleDateString()}
            </Text>
          )}
        </div>
      )}
    </Stack>
  );
}
