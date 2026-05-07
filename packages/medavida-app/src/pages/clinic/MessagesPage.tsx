import { Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { Communication } from '@medplum/fhirtypes';
import type { JSX } from 'react';

export function MessagesPage(): JSX.Element {
  const medplum = useMedplum();
  const messages = medplum
    .searchResources<Communication>('Communication', 'status=in-progress&_sort=-sent')
    .read();

  return (
    <Stack gap="lg">
      <Title order={3}>Messages</Title>
      {messages.length === 0 && <Text c="dimmed">No pending messages.</Text>}
      {messages.map((msg) => (
        <div key={msg.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: 8 }}>
          <Text fw={500}>{msg.subject?.reference ?? 'Unknown patient'}</Text>
          <Text size="sm" c="dimmed">
            {msg.payload?.[0]?.contentString ?? '(no content)'}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Sent: {msg.sent ? new Date(msg.sent).toLocaleString() : 'unknown'}
          </Text>
        </div>
      ))}
    </Stack>
  );
}
