"use client";

import { useEffect, useState } from "react";

import { ReactPdfPage } from "@/components/pdf/react-pdf-page";
import { getJob, type JobSnapshot } from "@/lib/api";

type DebugPdfClientProps = {
  initialJobId: string | null;
  initialPlanId: string | null;
  initialSourceUrl: string | null;
};

export function DebugPdfClient({
  initialJobId,
  initialPlanId,
  initialSourceUrl,
}: DebugPdfClientProps) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(initialSourceUrl);
  const [jobSnapshot, setJobSnapshot] = useState<JobSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialSourceUrl || !initialJobId) {
      return;
    }

    const currentJobId = initialJobId;
    let cancelled = false;

    async function loadPlanUrl() {
      try {
        const snapshot = await getJob(currentJobId);
        if (cancelled) {
          return;
        }

        setJobSnapshot(snapshot);
        const targetPlan =
          snapshot.plans.find((plan) => plan.id === initialPlanId) ?? snapshot.plans[0] ?? null;

        if (!targetPlan) {
          setErrorMessage("対象の plan が見つかりません。");
          return;
        }

        setSourceUrl(targetPlan.pdf_url);
      } catch (error) {
        console.error("Debug PDF page failed", error);
        setErrorMessage(error instanceof Error ? error.message : "PDF 情報の取得に失敗しました。");
      }
    }

    void loadPlanUrl();

    return () => {
      cancelled = true;
    };
  }, [initialJobId, initialPlanId, initialSourceUrl]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 px-6 py-10">
      <div>
        <p className="text-sm uppercase tracking-[0.28em] text-sky-700">Debug PDF</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          PDF を単体表示して挙動を確認します
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          `?job=...&plan=...` で保存済み plan を表示するか、`?src=...` で直接 URL を指定します。
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div>job: {initialJobId ?? "未指定"}</div>
        <div>plan: {initialPlanId ?? "未指定"}</div>
        <div>src: {sourceUrl ?? "未指定"}</div>
        <div>plans: {jobSnapshot?.plans.length ?? 0}</div>
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {errorMessage}
        </div>
      ) : null}

      <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
        <ReactPdfPage
          pdfUrl={sourceUrl}
          zoom={1}
          onError={(message) => setErrorMessage(message)}
        />
      </div>
    </div>
  );
}
