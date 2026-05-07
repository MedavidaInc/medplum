import { ResourceHistoryTable, ResourceTable, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useParams } from 'react-router';

export function ResourcePage(): JSX.Element {
  const { resourceType, id } = useParams() as { resourceType: string; id: string };
  const medplum = useMedplum();
  const resource = medplum.readResource(resourceType as any, id).read();

  return (
    <div>
      <ResourceTable value={resource} />
      <ResourceHistoryTable resourceType={resourceType as any} id={id} />
    </div>
  );
}
