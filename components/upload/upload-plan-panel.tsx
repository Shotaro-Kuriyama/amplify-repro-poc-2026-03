"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  startLevelOptions,
  type StartLevel,
  type UploadedPlan,
} from "@/lib/upload";

type UploadPlanPanelProps = {
  actionErrorMessage: string | null;
  fileErrorMessage: string | null;
  isPlanEditingLocked: boolean;
  plans: UploadedPlan[];
  selectedPlanId: string | null;
  startLevel: StartLevel;
  onDeletePlan: (planId: string) => void;
  onFilesAdded: (files: File[]) => void;
  onMovePlan: (fromId: string, toId: string) => void;
  onSelectPlan: (planId: string) => void;
  onStartLevelChange: (nextLevel: StartLevel) => void;
};

export function UploadPlanPanel({
  actionErrorMessage,
  fileErrorMessage,
  isPlanEditingLocked,
  plans,
  selectedPlanId,
  startLevel,
  onDeletePlan,
  onFilesAdded,
  onMovePlan,
  onSelectPlan,
  onStartLevelChange,
}: UploadPlanPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [draggingPlanId, setDraggingPlanId] = useState<string | null>(null);
  const [dragOverPlanId, setDragOverPlanId] = useState<string | null>(null);

  const orderSummary = useMemo(() => {
    if (plans.length === 0) {
      return "未追加";
    }

    return plans.map((plan, index) => `${index + 1}. ${plan.name}`).join(" → ");
  }, [plans]);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (!event.target.files) {
      return;
    }

    onFilesAdded(Array.from(event.target.files));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);

    const droppedFiles = event.dataTransfer.files;
    if (droppedFiles.length > 0) {
      onFilesAdded(Array.from(droppedFiles));
    }
  }

  function handlePlanDrop(targetId: string) {
    if (!draggingPlanId) {
      return;
    }

    onMovePlan(draggingPlanId, targetId);
    setDraggingPlanId(null);
    setDragOverPlanId(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm uppercase tracking-[0.28em] text-sky-700">PDF / 図面管理</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          複数階の図面を追加し、順序を整えてから生成フローへ渡します。
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          PDF は複数追加でき、Plan list で削除とドラッグ並び替えを行えます。
        </p>
      </div>

      {fileErrorMessage ? (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <AlertTitle>ファイル形式エラー</AlertTitle>
          <AlertDescription>{fileErrorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {actionErrorMessage ? (
        <Alert className="border-rose-300 bg-rose-50 text-rose-950">
          <AlertTitle>ジョブエラー</AlertTitle>
          <AlertDescription>{actionErrorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-dashed bg-secondary/60">
        <CardHeader>
          <CardTitle>PDF配置エリア</CardTitle>
          <CardDescription>
            複数PDFをドラッグ＆ドロップするか、選択ボタンから追加してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={inputRef}
            accept=".pdf,application/pdf"
            className="hidden"
            multiple
            type="file"
            onChange={handleInputChange}
          />
          <div
            className={cn(
              "rounded-[1.5rem] border border-dashed px-4 py-10 text-center transition-colors",
              isDragActive
                ? "border-sky-500 bg-sky-50"
                : "border-slate-300 bg-white/80",
              isPlanEditingLocked ? "cursor-not-allowed opacity-60" : undefined,
            )}
            onDragEnter={(event) => {
              if (isPlanEditingLocked) {
                return;
              }
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              if (isPlanEditingLocked) {
                return;
              }
              event.preventDefault();
              if (event.currentTarget === event.target) {
                setIsDragActive(false);
              }
            }}
            onDragOver={(event) => {
              if (isPlanEditingLocked) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsDragActive(true);
            }}
            onDrop={(event) => {
              if (isPlanEditingLocked) {
                return;
              }
              handleDrop(event);
            }}
          >
            <div className="text-sm font-medium text-slate-700">
              ここに各階のPDFをドロップ
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              複数ファイル対応。追加後は下の Plan list で並び順を保持します。
            </div>
            {isPlanEditingLocked ? (
              <div className="mt-3 text-sm text-amber-700">
                下書きジョブ作成後は plan 構成を固定しています。
              </div>
            ) : null}
            <Button
              className="mt-5"
              disabled={isPlanEditingLocked}
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              PDFを選択
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>開始階の設定</CardTitle>
          <CardDescription>
            最初の図面がどこから始まるかを選択します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="mb-2 block text-sm font-medium text-slate-800">
            最初の図面の開始階
          </label>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-sky-500"
            disabled={isPlanEditingLocked}
            value={startLevel}
            onChange={(event) => onStartLevelChange(event.target.value as StartLevel)}
          >
            {startLevelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.hint})
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-muted-foreground">
            地上階、地下階など、連番の起点をここで揃えます。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan list</CardTitle>
          <CardDescription>
            追加したPDFはここに並びます。ドラッグして順序変更、不要なものは削除できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-muted-foreground">
              まだPDFが追加されていません。
            </div>
          ) : (
            plans.map((plan, index) => (
              <div
                key={plan.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors",
                  dragOverPlanId === plan.id
                    ? "border-sky-500 bg-sky-50"
                    : selectedPlanId === plan.id
                      ? "border-sky-500 bg-sky-50"
                      : "border-slate-200 bg-slate-50",
                )}
                draggable={!isPlanEditingLocked}
                onDragStart={() => {
                  if (isPlanEditingLocked) {
                    return;
                  }
                  setDraggingPlanId(plan.id);
                  setDragOverPlanId(plan.id);
                }}
                onDragEnd={() => {
                  setDraggingPlanId(null);
                  setDragOverPlanId(null);
                }}
                onDragOver={(event) => {
                  if (isPlanEditingLocked) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverPlanId(plan.id);
                }}
                onDrop={(event) => {
                  if (isPlanEditingLocked) {
                    return;
                  }
                  event.preventDefault();
                  handlePlanDrop(plan.id);
                }}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  type="button"
                  onClick={() => onSelectPlan(plan.id)}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{index + 1}</Badge>
                    <span className="font-medium text-slate-900">{plan.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span>{plan.sizeLabel}</span>
                    <span>{isPlanEditingLocked ? "構成固定" : "ドラッグして並び替え"}</span>
                  </div>
                </button>
                <Button
                  disabled={isPlanEditingLocked}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => onDeletePlan(plan.id)}
                >
                  削除
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>現在の状態</CardTitle>
          <CardDescription>
            並び順と開始階はこの state に保持されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <span>追加済みPDF数</span>
            <span className="font-semibold">{plans.length}</span>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <span>開始階</span>
            <span className="font-semibold">
              {startLevelOptions.find((option) => option.value === startLevel)?.label}
            </span>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3">
            <div className="mb-1 text-xs uppercase tracking-[0.2em] text-slate-500">
              Plan list の順序
            </div>
            <div className="font-medium text-slate-900">{orderSummary}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
