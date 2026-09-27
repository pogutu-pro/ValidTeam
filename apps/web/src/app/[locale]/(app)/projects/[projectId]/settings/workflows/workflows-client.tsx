'use client';

import { WorkflowBuilder } from '@/components/workflows/workflow-builder';
import { PageFrame } from '@/components/ui/page-frame';

export function ProjectWorkflowsClient({ projectId }: { projectId: string }) {
  return (
    <PageFrame contentClassName="max-w-7xl">
      <WorkflowBuilder projectId={projectId} />
    </PageFrame>
  );
}
