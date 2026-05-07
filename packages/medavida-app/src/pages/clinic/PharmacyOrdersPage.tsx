import { Badge, Group, Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { Task } from '@medplum/fhirtypes';
import type { JSX } from 'react';

const STATUS_COLOR: Record<string, string> = {
  completed: 'green',
  'in-progress': 'blue',
  failed: 'red',
  requested: 'gray',
};

export function PharmacyOrdersPage(): JSX.Element {
  const medplum = useMedplum();
  const orders = medplum
    .searchResources<Task>(
      'Task',
      'code=https://medavida.com/fhir/CodeSystem/task-type|pharmacy-order&_sort=-_lastUpdated'
    )
    .read();

  return (
    <Stack gap="lg">
      <Title order={3}>Pharmacy Orders</Title>
      {orders.length === 0 && <Text c="dimmed">No pharmacy orders found.</Text>}
      {orders.map((order) => (
        <div key={order.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: 8 }}>
          <Group justify="space-between">
            <Text fw={500}>{order.focus?.reference ?? 'Unknown prescription'}</Text>
            <Badge color={STATUS_COLOR[order.status] ?? 'gray'}>{order.status}</Badge>
          </Group>
          <Text size="sm" c="dimmed" mt={4}>
            Patient: {order.for?.reference}
          </Text>
          <Text size="sm" c="dimmed">
            Order ID: {order.identifier?.[0]?.value ?? '—'}
          </Text>
          {order.note?.map((n, i) => (
            <Text key={i} size="xs" c="dimmed" mt={2}>
              {n.text}
            </Text>
          ))}
        </div>
      ))}
    </Stack>
  );
}
