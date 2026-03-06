import { DebugPdfClient } from "@/components/debug/debug-pdf-client";

type DebugPdfPageProps = {
  searchParams?: Promise<{
    job?: string;
    plan?: string;
    src?: string;
  }>;
};

export default async function DebugPdfPage({ searchParams }: DebugPdfPageProps) {
  const params = (await searchParams) ?? {};

  return (
    <DebugPdfClient
      initialJobId={params.job ?? null}
      initialPlanId={params.plan ?? null}
      initialSourceUrl={params.src ?? null}
    />
  );
}
