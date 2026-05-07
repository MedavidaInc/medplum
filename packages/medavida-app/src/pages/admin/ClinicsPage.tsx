import { Button, Group, Stack, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import { ResourceTable } from '@medplum/react';
import type { Organization } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { Link } from 'react-router';

export function ClinicsPage(): JSX.Element {
  const medplum = useMedplum();
  const clinics = medplum.searchResources<Organization>('Organization', 'type=prov').read();

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Clinics</Title>
        <Button component={Link} to="/admin/clinics/new" size="sm">
          Add Clinic
        </Button>
      </Group>
      <ResourceTable value={clinics[0]} />
    </Stack>
  );
}
