import { Stack, Title, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMedplum } from '@medplum/react';
import type { Patient } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';

export function PatientListPage(): JSX.Element {
  const medplum = useMedplum();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);

  const patients = medplum
    .searchResources<Patient>('Patient', debounced ? `name=${debounced}` : '')
    .read();

  return (
    <Stack gap="lg">
      <Title order={3}>Patients</Title>
      <TextInput
        placeholder="Search by name..."
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        style={{ maxWidth: 400 }}
      />
      <div>
        {patients.map((p) => {
          const name = [p.name?.[0]?.given?.join(' '), p.name?.[0]?.family].filter(Boolean).join(' ');
          return (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <Link to={`/clinic/patients/${p.id}`}>{name || p.id}</Link>
            </div>
          );
        })}
      </div>
    </Stack>
  );
}
