import { Stack, Title, Text } from '@mantine/core';
import { ResourceTable, useMedplum } from '@medplum/react';
import type { Encounter } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useParams } from 'react-router';

export function EncounterPage(): JSX.Element {
  const { encounterId } = useParams() as { encounterId: string };
  const medplum = useMedplum();
  const encounter = medplum.readResource<Encounter>('Encounter', encounterId).read();

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Encounter</Title>
        <Text c="dimmed">{encounter.status} — {encounter.class?.display ?? encounter.class?.code}</Text>
      </div>
      <ResourceTable value={encounter} />
    </Stack>
  );
}
