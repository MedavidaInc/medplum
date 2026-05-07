import { SimpleGrid, Stack, Text, Title, Card } from '@mantine/core';
import { useMedplumProfile } from '@medplum/react';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { Link } from 'react-router';

export function PatientPortalPage(): JSX.Element {
  const profile = useMedplumProfile() as Patient | undefined;
  const name = [profile?.name?.[0]?.given?.join(' '), profile?.name?.[0]?.family].filter(Boolean).join(' ');

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Welcome{name ? `, ${name}` : ''}</Title>
        <Text c="dimmed">Your health portal</Text>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card component={Link} to="/portal/membership" padding="lg" radius="md" withBorder style={{ textDecoration: 'none' }}>
          <Text fw={600}>Membership & Billing</Text>
          <Text c="dimmed" size="sm" mt={4}>View your DPC membership plan and payment status</Text>
        </Card>
        <Card component={Link} to={`/clinic/patients/${profile?.id}`} padding="lg" radius="md" withBorder style={{ textDecoration: 'none' }}>
          <Text fw={600}>My Health Record</Text>
          <Text c="dimmed" size="sm" mt={4}>View your medical records and visit history</Text>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
