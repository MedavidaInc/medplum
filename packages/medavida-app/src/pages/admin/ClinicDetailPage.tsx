import { Stack, Title, Text } from '@mantine/core';
import { ResourceTable, useMedplum } from '@medplum/react';
import type { Organization } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useParams } from 'react-router';

export function ClinicDetailPage(): JSX.Element {
  const { id } = useParams() as { id: string };
  const medplum = useMedplum();
  const clinic = medplum.readResource<Organization>('Organization', id).read();

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{clinic.name ?? 'Clinic'}</Title>
        <Text c="dimmed">Organization / {id}</Text>
      </div>
      <ResourceTable value={clinic} />
    </Stack>
  );
}
