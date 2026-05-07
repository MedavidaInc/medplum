import { Badge, Group, Stack, Text, Title } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { Task } from '@medplum/fhirtypes';
import type { JSX } from 'react';

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'red',
  asap: 'orange',
  routine: 'blue',
};

export function TasksPage(): JSX.Element {
  const medplum = useMedplum();
  const tasks = medplum.searchResources<Task>('Task', 'status=requested,in-progress&_sort=-_lastUpdated').read();

  return (
    <Stack gap="lg">
      <Title order={3}>Tasks</Title>
      {tasks.length === 0 && <Text c="dimmed">No open tasks.</Text>}
      {tasks.map((task) => (
        <div key={task.id} style={{ padding: '12px', border: '1px solid #eee', borderRadius: 8 }}>
          <Group justify="space-between">
            <Text fw={500}>{task.description ?? task.code?.coding?.[0]?.code ?? 'Task'}</Text>
            {task.priority && (
              <Badge color={PRIORITY_COLOR[task.priority] ?? 'gray'}>{task.priority}</Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed" mt={4}>
            {task.focus?.reference} — {task.status}
          </Text>
        </div>
      ))}
    </Stack>
  );
}
