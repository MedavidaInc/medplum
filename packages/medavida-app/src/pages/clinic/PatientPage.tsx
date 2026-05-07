import { Stack, Title, Text, Tabs } from '@mantine/core';
import { ResourceTable, useMedplum } from '@medplum/react';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';

export function PatientPage(): JSX.Element {
  const { patientId } = useParams() as { patientId: string };
  const medplum = useMedplum();
  const patient = medplum.readResource<Patient>('Patient', patientId).read();

  const name = [patient.name?.[0]?.given?.join(' '), patient.name?.[0]?.family].filter(Boolean).join(' ');

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>{name || 'Patient'}</Title>
        <Text c="dimmed">Patient / {patientId}</Text>
      </div>
      <Tabs defaultValue="summary">
        <Tabs.List>
          <Tabs.Tab value="summary">Summary</Tabs.Tab>
          <Tabs.Tab value="non-rx" component={Link} to={`/clinic/patients/${patientId}/non-rx`}>
            Non-Rx
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="summary" pt="md">
          <ResourceTable value={patient} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
