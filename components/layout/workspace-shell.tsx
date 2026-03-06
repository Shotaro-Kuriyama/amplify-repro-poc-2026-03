import { ReactNode } from "react";

import { SiteHeader } from "@/components/layout/site-header";
import { Badge } from "@/components/ui/badge";

type WorkspaceShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  leftPanel: ReactNode;
  rightPanel: ReactNode;
};

const workflowSteps = [
  "PDFアップロード",
  "階構成の調整",
  "IFC生成",
  "確認とダウンロード",
];

export function WorkspaceShell({
  eyebrow,
  title,
  description,
  leftPanel,
  rightPanel,
}: WorkspaceShellProps) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 pb-10 pt-8">
        <section className="mb-6 rounded-[2rem] border border-white/70 bg-white/75 p-6 shadow-panel backdrop-blur-xl">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Badge>{eyebrow}</Badge>
            {workflowSteps.map((step, index) => (
              <Badge key={step} variant="secondary">
                {index + 1}. {step}
              </Badge>
            ))}
          </div>
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              {title}
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground md:text-lg">
              {description}
            </p>
          </div>
        </section>
        <section className="grid gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
          <aside className="rounded-[2rem] border border-white/70 bg-white/80 p-5 shadow-panel backdrop-blur-xl">
            {leftPanel}
          </aside>
          <section className="overflow-hidden rounded-[2rem] border border-slate-800/90 bg-slate-950 text-white shadow-panel">
            {rightPanel}
          </section>
        </section>
      </main>
    </div>
  );
}
