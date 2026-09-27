import { RoadmapClient } from './roadmap-client';

interface RoadmapPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function RoadmapPage({ params }: RoadmapPageProps) {
  const { projectId } = await params;

  return <RoadmapClient projectId={projectId} />;
}
