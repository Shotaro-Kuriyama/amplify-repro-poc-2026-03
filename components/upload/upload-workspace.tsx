"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { JobViewerPanel } from "@/components/upload/job-viewer-panel";
import { PlanTraceEditor } from "@/components/upload/plan-trace-editor";
import { UploadPlanPanel } from "@/components/upload/upload-plan-panel";
import {
  autodetectPlanSegments,
  ApiError,
  createJob,
  getJob,
  getJobAnnotations,
  saveJobAnnotations,
  startJob,
  type AutoDetectResult,
  type JobSnapshot,
  type JobStatus,
} from "@/lib/api";
import {
  createDefaultPlanAnnotations,
  type JobAnnotations,
  type PlanAnnotations,
} from "@/lib/annotations";
import {
  createRemotePlan,
  createUploadedPlan,
  fileToDataUrl,
  isPdfFile,
  reorderPlans,
  revokeObjectUrlIfNeeded,
  startLevelOptions,
  type StartLevel,
  type UploadedPlan,
} from "@/lib/upload";

type JobUiState = {
  artifactUrl: string | null;
  id: string | null;
  progress: number;
  status: "idle" | JobStatus;
};

const initialJobState: JobUiState = {
  artifactUrl: null,
  id: null,
  progress: 0,
  status: "idle",
};

function toUserErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    if (error.name === "ApiError") {
      return error.message;
    }

    return `${fallbackMessage} APIサーバーが起動しているか確認してください。`;
  }

  return fallbackMessage;
}

function synchronizeAnnotations(plans: UploadedPlan[], current: JobAnnotations): JobAnnotations {
  const currentById = new Map(current.plans.map((plan) => [plan.plan_id, plan]));

  return {
    plans: plans.map((plan, index) => {
      const existing = currentById.get(plan.id);

      if (!existing) {
        return createDefaultPlanAnnotations(plan.id, plan.name, index);
      }

      return {
        ...existing,
        plan_id: plan.id,
        plan_name: plan.name,
        storey_index: index,
      };
    }),
  };
}

function plansFromSnapshot(snapshot: JobSnapshot): UploadedPlan[] {
  return snapshot.plans
    .slice()
    .sort((left, right) => left.storey_index - right.storey_index)
    .map((plan) =>
      createRemotePlan({
        id: plan.id,
        name: plan.name,
        pdfUrl: plan.pdf_url,
        sizeLabel: plan.size_label,
      }),
    );
}

function remapPlanIds(
  plans: UploadedPlan[],
  annotations: JobAnnotations,
  selectedPlanId: string | null,
) {
  const idMap = new Map<string, string>();
  for (const plan of plans) {
    idMap.set(plan.id, crypto.randomUUID());
  }

  const remappedPlans = plans.map((plan) => ({
    ...plan,
    id: idMap.get(plan.id) ?? plan.id,
  }));
  const remappedAnnotations: JobAnnotations = {
    plans: annotations.plans.map((plan) => ({
      ...plan,
      plan_id: idMap.get(plan.plan_id) ?? plan.plan_id,
    })),
  };

  return {
    annotations: remappedAnnotations,
    plans: remappedPlans,
    selectedPlanId:
      selectedPlanId && idMap.has(selectedPlanId) ? idMap.get(selectedPlanId)! : selectedPlanId,
  };
}

export function UploadWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const jobParam = searchParams.get("job");

  const [plans, setPlans] = useState<UploadedPlan[]>([]);
  const [annotations, setAnnotations] = useState<JobAnnotations>({ plans: [] });
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [startLevel, setStartLevel] = useState<StartLevel>("ground");
  const [fileErrorMessage, setFileErrorMessage] = useState<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [job, setJob] = useState<JobUiState>(initialJobState);
  const [isStarting, setIsStarting] = useState(false);
  const [isSavingAnnotations, setIsSavingAnnotations] = useState(false);
  const [needsRebuild, setNeedsRebuild] = useState(false);
  const previousPlansRef = useRef<UploadedPlan[]>([]);

  const startLevelLabel = useMemo(
    () => startLevelOptions.find((option) => option.value === startLevel)?.label ?? "未設定",
    [startLevel],
  );
  const isPlanEditingLocked = Boolean(job.id);

  useEffect(() => {
    setAnnotations((current) => synchronizeAnnotations(plans, current));
  }, [plans]);

  useEffect(() => {
    const previousPlans = previousPlansRef.current;
    const currentUrls = new Set(plans.map((plan) => plan.pdfUrl));

    for (const previousPlan of previousPlans) {
      if (!currentUrls.has(previousPlan.pdfUrl)) {
        revokeObjectUrlIfNeeded(previousPlan.pdfUrl);
      }
    }

    previousPlansRef.current = plans;
  }, [plans]);

  useEffect(() => {
    return () => {
      for (const plan of previousPlansRef.current) {
        revokeObjectUrlIfNeeded(plan.pdfUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!jobParam) {
      return;
    }

    const currentJobId = jobParam;
    let cancelled = false;

    async function hydrateJob() {
      try {
        const snapshot = await getJob(currentJobId);
        if (cancelled) {
          return;
        }

        const nextPlans = plansFromSnapshot(snapshot);
        setPlans(nextPlans);
        setSelectedPlanId((current) => current ?? nextPlans[0]?.id ?? null);
        setJob({
          artifactUrl: snapshot.artifact_url,
          id: snapshot.id,
          progress: snapshot.progress,
          status: snapshot.status,
        });
        setNeedsRebuild(false);
        setStartLevel(snapshot.start_level);

        const savedAnnotations = await getJobAnnotations(currentJobId);
        if (cancelled) {
          return;
        }

        setAnnotations(synchronizeAnnotations(nextPlans, savedAnnotations));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setActionErrorMessage(toUserErrorMessage(error, "保存済みジョブの読込に失敗しました。"));
      }
    }

    void hydrateJob();

    return () => {
      cancelled = true;
    };
  }, [jobParam]);

  useEffect(() => {
    if (!job.id || (job.status !== "queued" && job.status !== "processing")) {
      return;
    }

    let cancelled = false;

    async function pollJob() {
      try {
        const snapshot = await getJob(job.id!);
        if (cancelled) {
          return;
        }

        setJob({
          artifactUrl: snapshot.artifact_url,
          id: snapshot.id,
          progress: snapshot.progress,
          status: snapshot.status,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setActionErrorMessage(
          toUserErrorMessage(error, "ジョブ状態の取得に失敗しました。"),
        );
        setJob((current) => ({
          ...current,
          status: "failed",
        }));
      }
    }

    void pollJob();
    const timerId = window.setInterval(() => {
      void pollJob();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [job.id, job.status]);

  function applySnapshot(snapshot: JobSnapshot) {
    const nextPlans = plansFromSnapshot(snapshot);
    setPlans(nextPlans);
    setSelectedPlanId((current) => {
      const exists = nextPlans.some((plan) => plan.id === current);
      return exists ? current : nextPlans[0]?.id ?? null;
    });
    setJob({
      artifactUrl: snapshot.artifact_url,
      id: snapshot.id,
      progress: snapshot.progress,
      status: snapshot.status,
    });
    setNeedsRebuild(false);
    setStartLevel(snapshot.start_level);
  }

  async function ensureDraftJob() {
    if (job.id) {
      return job.id;
    }

    if (plans.length === 0) {
      throw new Error("ジョブを作成するには、少なくとも1つのPDFを追加してください。");
    }

    async function toPayloadPlans(sourcePlans: UploadedPlan[]) {
      return Promise.all(
        sourcePlans.map(async (plan, index) => {
          if (!plan.file) {
            throw new Error("PDFファイルを再アップロードしてください。");
          }

          return {
            plan_id: plan.id,
            name: plan.name,
            storey_index: index,
            pdf_data_base64: await fileToDataUrl(plan.file),
          };
        }),
      );
    }

    try {
      const payloadPlans = await toPayloadPlans(plans);
      const snapshot = await createJob({
        plans: payloadPlans,
        start_level: startLevel,
      });
      applySnapshot(snapshot);
      router.replace(`${pathname}?job=${snapshot.id}`, { scroll: false });
      return snapshot.id;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const remapped = remapPlanIds(plans, annotations, selectedPlanId);
        const synchronized = synchronizeAnnotations(remapped.plans, remapped.annotations);
        setPlans(remapped.plans);
        setAnnotations(synchronized);
        setSelectedPlanId(remapped.selectedPlanId);

        const retryPayloadPlans = await toPayloadPlans(remapped.plans);
        const snapshot = await createJob({
          plans: retryPayloadPlans,
          start_level: startLevel,
        });
        applySnapshot(snapshot);
        router.replace(`${pathname}?job=${snapshot.id}`, { scroll: false });
        return snapshot.id;
      }

      throw error;
    }
  }

  function handleFilesAdded(files: File[]) {
    if (isPlanEditingLocked) {
      return;
    }

    const validFiles = files.filter(isPdfFile);

    if (validFiles.length !== files.length) {
      setFileErrorMessage("Only .pdf のみ追加できます。");
    } else {
      setFileErrorMessage(null);
    }

    if (validFiles.length === 0) {
      return;
    }

    setActionErrorMessage(null);
    setSaveErrorMessage(null);

    const nextPlans = validFiles.map(createUploadedPlan);
    setPlans((current) => [...current, ...nextPlans]);
    setSelectedPlanId((current) => current ?? nextPlans[0]?.id ?? null);
  }

  function handleDeletePlan(planId: string) {
    if (isPlanEditingLocked) {
      return;
    }

    setPlans((current) => current.filter((plan) => plan.id !== planId));
    setSelectedPlanId((current) => (current === planId ? null : current));
  }

  function handleMovePlan(fromId: string, toId: string) {
    if (isPlanEditingLocked) {
      return;
    }

    setPlans((current) => reorderPlans(current, fromId, toId));
  }

  function handleChangePlanAnnotations(planId: string, nextPlan: PlanAnnotations) {
    setAnnotations((current) => ({
      plans: current.plans
        .map((plan) => (plan.plan_id === planId ? nextPlan : plan))
        .sort((left, right) => left.storey_index - right.storey_index),
    }));
    setNeedsRebuild((current) => current || job.status === "completed");
  }

  async function handleSaveAnnotations() {
    if (plans.length === 0) {
      setSaveErrorMessage("保存する前に少なくとも1つの PDF を追加してください。");
      return;
    }

    setIsSavingAnnotations(true);
    setSaveErrorMessage(null);
    setActionErrorMessage(null);

    try {
      const ensuredJobId = await ensureDraftJob();
      const payload = synchronizeAnnotations(plans, annotations);
      const saved = await saveJobAnnotations(ensuredJobId, payload);
      setAnnotations(synchronizeAnnotations(plans, saved));
      setJob((current) => ({
        ...current,
        id: ensuredJobId,
        status: current.status === "idle" ? "draft" : current.status,
      }));
    } catch (error) {
      setSaveErrorMessage(toUserErrorMessage(error, "annotations の保存に失敗しました。"));
    } finally {
      setIsSavingAnnotations(false);
    }
  }

  async function handleStart() {
    if (plans.length === 0) {
      setActionErrorMessage("ジョブを開始するには、少なくとも1つのPDFを追加してください。");
      return;
    }

    setActionErrorMessage(null);
    setSaveErrorMessage(null);
    setIsStarting(true);

    try {
      const ensuredJobId = await ensureDraftJob();
      const payload = synchronizeAnnotations(plans, annotations);
      const saved = await saveJobAnnotations(ensuredJobId, payload);
      setAnnotations(synchronizeAnnotations(plans, saved));

      const snapshot = await startJob(ensuredJobId);
      applySnapshot(snapshot);
    } catch (error) {
      setActionErrorMessage(
        toUserErrorMessage(error, "ジョブ作成に失敗しました。"),
      );
      setJob((current) => ({
        ...current,
        status: "failed",
      }));
    } finally {
      setIsStarting(false);
    }
  }

  async function handleAutoDetectPlan(planId: string): Promise<AutoDetectResult> {
    const ensuredJobId = await ensureDraftJob();
    return autodetectPlanSegments(ensuredJobId, planId, {
      page: 1,
      mode: "raster",
    });
  }

  return (
    <WorkspaceShell
      description="複数階の PDF を積み上げ、順序や開始階を調整してからトレース保存と IFC 生成へ進める画面です。"
      eyebrow="アップロード作業"
      leftPanel={
        <div className="space-y-4">
          <UploadPlanPanel
            actionErrorMessage={actionErrorMessage}
            fileErrorMessage={fileErrorMessage}
            isPlanEditingLocked={isPlanEditingLocked}
            plans={plans}
            selectedPlanId={selectedPlanId}
            startLevel={startLevel}
            onDeletePlan={handleDeletePlan}
            onFilesAdded={handleFilesAdded}
            onMovePlan={handleMovePlan}
            onSelectPlan={setSelectedPlanId}
            onStartLevelChange={setStartLevel}
          />
          <PlanTraceEditor
            annotations={annotations}
            isSaving={isSavingAnnotations}
            jobId={job.id}
            plans={plans}
            saveErrorMessage={saveErrorMessage}
            selectedPlanId={selectedPlanId}
            onChangeAnnotations={handleChangePlanAnnotations}
            onSaveAnnotations={handleSaveAnnotations}
            onAutoDetectPlan={handleAutoDetectPlan}
            onSelectedPlanIdChange={setSelectedPlanId}
          />
        </div>
      }
      rightPanel={
        <JobViewerPanel
          artifactUrl={job.artifactUrl}
          canStart={plans.length > 0}
          isStarting={isStarting}
          jobId={job.id}
          needsRebuild={needsRebuild}
          planCount={plans.length}
          progress={job.progress}
          startLevelLabel={startLevelLabel}
          status={job.status}
          viewerUrl={job.artifactUrl}
          onStart={handleStart}
        />
      }
      title="左で PDF と壁線を管理し、右でジョブ進捗と IFC ビューアを確認します。"
    />
  );
}
