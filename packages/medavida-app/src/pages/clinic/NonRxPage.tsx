import { Badge, Group, Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { MedicationStatement } from '@medplum/fhirtypes';
import type { JSX } from 'react';
import { useParams } from 'react-router';
// Extension URLs mirrored from medavida-bots — keep in sync with non-rx-medication.types.ts
const EXT_URLS = {
  INTERACTION_FLAGS: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flags',
  INTERACTION_FLAG_SEVERITY: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flag-severity',
  INTERACTION_FLAG_NOTE: 'https://medavida.com/fhir/StructureDefinition/non-rx-interaction-flag-note',
};
const NON_RX_CATEGORY_SYSTEM = 'https://medavida.com/fhir/CodeSystem/non-rx-category';

const SEVERITY_COLOR: Record<string, string> = {
  contraindicated: 'red',
  major: 'orange',
  moderate: 'yellow',
  minor: 'blue',
  unknown: 'gray',
};

export function NonRxPage(): JSX.Element {
  const { patientId } = useParams() as { patientId: string };
  const medplum = useMedplum();
  const statements = medplum
    .searchResources<MedicationStatement>(
      'MedicationStatement',
      `subject=Patient/${patientId}&category=${NON_RX_CATEGORY_SYSTEM}|`
    )
    .read();

  return (
    <Stack gap="lg">
      <Title order={4}>Non-Prescription Recommendations</Title>
      {statements.length === 0 && <Text c="dimmed">No non-Rx recommendations on file.</Text>}
      {statements.map((stmt) => {
        const interactionFlags = (stmt.extension ?? []).filter((e) => e.url === EXT_URLS.INTERACTION_FLAGS);
        return (
          <div key={stmt.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: 8 }}>
            <Group justify="space-between">
              <Text fw={500}>{stmt.medicationCodeableConcept?.text ?? 'Unknown'}</Text>
              <Badge color={stmt.status === 'active' ? 'green' : stmt.status === 'intended' ? 'yellow' : 'gray'}>
                {stmt.status}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              {stmt.category?.coding?.[0]?.code} — {stmt.dosage?.[0]?.text ?? 'no dosage'}
            </Text>
            {interactionFlags.length > 0 && (
              <Stack gap={4} mt={8}>
                {interactionFlags.map((flag, i) => {
                  const nested = flag.extension ?? [];
                  const severity = nested.find((n) => n.url === EXT_URLS.INTERACTION_FLAG_SEVERITY)?.valueCode ?? 'unknown';
                  const note = nested.find((n) => n.url === EXT_URLS.INTERACTION_FLAG_NOTE)?.valueString;
                  return (
                    <Group key={i} gap="xs">
                      <Badge size="sm" color={SEVERITY_COLOR[severity] ?? 'gray'}>
                        {severity}
                      </Badge>
                      <Text size="xs">{note}</Text>
                    </Group>
                  );
                })}
              </Stack>
            )}
          </div>
        );
      })}
    </Stack>
  );
}
