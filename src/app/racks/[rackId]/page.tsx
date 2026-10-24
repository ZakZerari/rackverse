import { Suspense } from "react";
import StudioPage from "@/components/studio/StudioPage";

export default function RackPage({ params }: { params: Promise<{ rackId: string }> }) {
  return <Suspense fallback={<div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading rack…</div>}>
    <RackPageContent params={params} />
  </Suspense>;
}

async function RackPageContent({ params }: { params: Promise<{ rackId: string }> }) {
  const { rackId } = await params;
  return <StudioPage rackId={rackId} />;
}
