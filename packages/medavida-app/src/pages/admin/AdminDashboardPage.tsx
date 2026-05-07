import { Title, Text, SimpleGrid, Card, Stack } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { Link } from 'react-router';

export function AdminDashboardPage(): JSX.Element {
  const medplum = useMedplum();
  const projectName = medplum.getProject()?.name ?? 'MedaVida MSO';

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>{projectName}</Title>
        <Text c="dimmed">MSO Admin Dashboard</Text>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        <SummaryCard title="Clinics" href="/admin/clinics" description="Manage clinic organizations" />
        <SummaryCard title="Patients" href="/clinic/patients" description="View all patients across clinics" />
        <SummaryCard title="Pharmacy Orders" href="/clinic/pharmacy" description="Monitor active pharmacy orders" />
        <SummaryCard title="Tasks" href="/clinic/tasks" description="Pending clinical and admin tasks" />
        <SummaryCard title="Messages" href="/clinic/messages" description="Patient communications" />
        <SummaryCard title="Membership & Billing" href="/portal/membership" description="DPC membership overview" />
      </SimpleGrid>
    </Stack>
  );
}

function SummaryCard({ title, href, description }: { title: string; href: string; description: string }): JSX.Element {
  return (
    <Card component={Link} to={href} padding="lg" radius="md" withBorder style={{ textDecoration: 'none' }}>
      <Text fw={600} size="lg">
        {title}
      </Text>
      <Text c="dimmed" size="sm" mt={4}>
        {description}
      </Text>
    </Card>
  );
}
