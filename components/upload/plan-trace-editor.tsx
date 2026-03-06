"use client";

import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { ReactPdfPage } from "@/components/pdf/react-pdf-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobAnnotations, PlanAnnotations, PlanSegment } from "@/lib/annotations";
import type { UploadedPlan } from "@/lib/upload";
import { cn } from "@/lib/utils";

type EditorMode = "draw" | "select" | "calibrate";

type Point = {
  x: number;
  y: number;
};

type PlanTraceEditorProps = {
  annotations: JobAnnotations;
  isSaving: boolean;
  jobId: string | null;
  plans: UploadedPlan[];
  saveErrorMessage: string | null;
  selectedPlanId: string | null;
  onChangeAnnotations: (planId: string, nextPlan: PlanAnnotations) => void;
  onSaveAnnotations: () => void;
  onSelectedPlanIdChange: (planId: string) => void;
};

export function PlanTraceEditor({
  annotations,
  isSaving,
  jobId,
  plans,
  saveErrorMessage,
  selectedPlanId,
  onChangeAnnotations,
  onSaveAnnotations,
  onSelectedPlanIdChange,
}: PlanTraceEditorProps) {
  const [mode, setMode] = useState<EditorMode>("draw");
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState<{ height: number; width: number } | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [calibrationMeters, setCalibrationMeters] = useState("3.64");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId],
  );
  const activeAnnotations = useMemo(
    () => annotations.plans.find((plan) => plan.plan_id === activePlan?.id) ?? null,
    [activePlan?.id, annotations.plans],
  );

  useEffect(() => {
    if (!activePlan) {
      return;
    }

    if (selectedPlanId !== activePlan.id) {
      onSelectedPlanIdChange(activePlan.id);
    }
  }, [activePlan, onSelectedPlanIdChange, selectedPlanId]);

  useEffect(() => {
    setDraftPoints([]);
    setCalibrationPoints([]);
    setSelectedSegmentId(null);
  }, [activePlan?.id, mode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }

      if (mode === "draw" && event.key === "Enter" && draftPoints.length >= 2 && activeAnnotations) {
        event.preventDefault();
        const nextSegments: PlanSegment[] = [];
        for (let index = 0; index < draftPoints.length - 1; index += 1) {
          const start = draftPoints[index];
          const end = draftPoints[index + 1];
          nextSegments.push({
            id: crypto.randomUUID(),
            x1_px: start.x,
            y1_px: start.y,
            x2_px: end.x,
            y2_px: end.y,
          });
        }

        onChangeAnnotations(activeAnnotations.plan_id, {
          ...activeAnnotations,
          segments: [...activeAnnotations.segments, ...nextSegments],
        });
        setDraftPoints([]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDraftPoints([]);
        setCalibrationPoints([]);
        setSelectedSegmentId(null);
        return;
      }

      const isDeleteKey =
        event.key === "Delete" ||
        event.key === "Backspace" ||
        event.code === "Delete" ||
        event.code === "Backspace";

      if (mode === "select" && isDeleteKey && selectedSegmentId && activeAnnotations) {
        event.preventDefault();
        event.stopPropagation();
        onChangeAnnotations(activeAnnotations.plan_id, {
          ...activeAnnotations,
          segments: activeAnnotations.segments.filter((segment) => segment.id !== selectedSegmentId),
        });
        setSelectedSegmentId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeAnnotations, draftPoints, mode, onChangeAnnotations, selectedSegmentId]);

  const calibrationDistancePx = useMemo(() => {
    if (calibrationPoints.length !== 2) {
      return null;
    }

    const [start, end] = calibrationPoints;
    return Math.hypot(end.x - start.x, end.y - start.y);
  }, [calibrationPoints]);

  function toSvgPoint(event: ReactMouseEvent<SVGSVGElement, MouseEvent>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * (viewport?.width ?? 1);
    const y = ((event.clientY - bounds.top) / bounds.height) * (viewport?.height ?? 1);
    return { x, y };
  }

  function handleOverlayClick(event: ReactMouseEvent<SVGSVGElement, MouseEvent>) {
    if (!activeAnnotations || !viewport) {
      return;
    }

    const point = toSvgPoint(event);

    if (mode === "draw") {
      setDraftPoints((current) => [...current, point]);
      return;
    }

    if (mode === "calibrate") {
      setCalibrationPoints((current) => {
        if (current.length >= 2) {
          return [point];
        }

        return [...current, point];
      });
      return;
    }

    setSelectedSegmentId(null);
  }

  function updatePlanNumber(field: "wall_height_m" | "wall_thickness_m", value: string) {
    if (!activeAnnotations) {
      return;
    }

    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      return;
    }

    onChangeAnnotations(activeAnnotations.plan_id, {
      ...activeAnnotations,
      [field]: nextValue,
    });
  }

  function applyCalibration() {
    if (!activeAnnotations || !calibrationDistancePx || calibrationDistancePx <= 0) {
      return;
    }

    const actualMeters = Number(calibrationMeters);
    if (!Number.isFinite(actualMeters) || actualMeters <= 0) {
      return;
    }

    onChangeAnnotations(activeAnnotations.plan_id, {
      ...activeAnnotations,
      px_to_m: actualMeters / calibrationDistancePx,
    });
    setCalibrationPoints([]);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>PDF トレース</CardTitle>
        <CardDescription>
          PDF 上で壁の中心線を入力し、スケール校正と壁パラメータを plan ごとに保存します。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {saveErrorMessage ? (
          <Alert className="border-rose-300 bg-rose-50 text-rose-950">
            <AlertTitle>保存エラー</AlertTitle>
            <AlertDescription>{saveErrorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {plans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-muted-foreground">
            先に PDF を追加してください。
          </div>
        ) : null}

        {plans.length > 0 ? (
          <>
            <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="mb-2 block text-sm font-medium text-slate-800">編集中の plan</label>
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
                    value={activePlan?.id ?? ""}
                    onChange={(event) => onSelectedPlanIdChange(event.target.value)}
                  >
                    {plans.map((plan, index) => (
                      <option key={plan.id} value={plan.id}>
                        {index + 1}. {plan.name}
                      </option>
                    ))}
                  </select>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                    <Badge variant="secondary">job: {jobId ?? "未保存"}</Badge>
                    <Badge variant="secondary">
                      px_to_m: {activeAnnotations?.px_to_m ? activeAnnotations.px_to_m.toFixed(5) : "未校正"}
                    </Badge>
                    <Badge variant="secondary">
                      segments: {activeAnnotations?.segments.length ?? 0}
                    </Badge>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-800">操作モード</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ["draw", "Draw"],
                      ["select", "Select"],
                      ["calibrate", "Calibrate"],
                    ].map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        variant={mode === value ? "default" : "outline"}
                        onClick={() => setMode(value as EditorMode)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Draw: クリックで点追加、Enterで確定。Select: 線分選択後 Delete / Backspace
                    で削除。Calibrate:
                    2点指定後に実寸を入力します。
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-medium text-slate-800">壁パラメータ</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm text-slate-700">
                      <span className="mb-1 block">壁厚 (m)</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
                        min="0.01"
                        step="0.01"
                        type="number"
                        value={activeAnnotations?.wall_thickness_m ?? 0.12}
                        onChange={(event) => updatePlanNumber("wall_thickness_m", event.target.value)}
                      />
                    </label>
                    <label className="text-sm text-slate-700">
                      <span className="mb-1 block">壁高 (m)</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
                        min="0.1"
                        step="0.1"
                        type="number"
                        value={activeAnnotations?.wall_height_m ?? 2.4}
                        onChange={(event) => updatePlanNumber("wall_height_m", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-800">スケール校正</div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Calibrate モードで 2 点を打ち、実寸を m 単位で入力してください。
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" onClick={() => setZoom((current) => Math.max(0.5, current - 0.25))}>
                        -
                      </Button>
                      <div className="min-w-14 text-center text-sm font-medium text-slate-700">
                        {zoom.toFixed(2)}x
                      </div>
                      <Button type="button" variant="outline" onClick={() => setZoom((current) => Math.min(2.5, current + 0.25))}>
                        +
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                    <input
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      min="0.01"
                      step="0.01"
                      placeholder="実寸 (m)"
                      type="number"
                      value={calibrationMeters}
                      onChange={(event) => setCalibrationMeters(event.target.value)}
                    />
                    <Button
                      disabled={!calibrationDistancePx}
                      type="button"
                      onClick={applyCalibration}
                    >
                      Scale を確定
                    </Button>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {calibrationDistancePx
                      ? `計測距離: ${calibrationDistancePx.toFixed(2)} px`
                      : "2 点を選択するとピクセル距離を表示します。"}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm leading-6 text-slate-700">
                    Save annotations で server に保存します。保存後はリロードしても再読込できます。
                  </div>
                  <Button disabled={isSaving || !activeAnnotations} type="button" onClick={onSaveAnnotations}>
                    {isSaving ? "保存中..." : "Save annotations"}
                  </Button>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-950/95 p-3 text-white">
                <div className="mb-3 flex items-center justify-between gap-3 px-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.28em] text-sky-300">PDF Overlay</div>
                    <div className="mt-1 text-sm text-slate-300">
                      {activePlan?.name ?? "plan 未選択"}
                    </div>
                  </div>
                  <Badge className="border-white/20 bg-white/10 text-white" variant="outline">
                    {mode}
                  </Badge>
                </div>

                {renderErrorMessage ? (
                  <Alert className="mb-3 border-rose-400/40 bg-rose-400/10 text-rose-100">
                    <AlertTitle>PDF 読み込みエラー</AlertTitle>
                    <AlertDescription>{renderErrorMessage}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="max-h-[780px] overflow-auto rounded-[1.25rem] border border-white/10 bg-slate-900 p-3">
                  <div className={cn("mx-auto", !viewport ? "min-h-[480px] min-w-[320px]" : undefined)}>
                    <ReactPdfPage
                      pdfUrl={activePlan?.pdfUrl ?? null}
                      zoom={zoom}
                      onError={(message) => {
                        console.error("PDF overlay render failed", message);
                        setRenderErrorMessage(message);
                      }}
                      onPageStateChange={(state) => {
                        if (!state) {
                          setViewport(null);
                          return;
                        }

                        setViewport({
                          width: state.sourceWidth,
                          height: state.sourceHeight,
                        });
                        setRenderErrorMessage(null);
                      }}
                    >
                      {(pageState) => (
                        <svg
                          className="absolute inset-0 h-full w-full"
                          viewBox={`0 0 ${pageState.sourceWidth} ${pageState.sourceHeight}`}
                          onClick={handleOverlayClick}
                        >
                          <rect
                            fill="transparent"
                            height={pageState.sourceHeight}
                            width={pageState.sourceWidth}
                            x={0}
                            y={0}
                          />

                          {activeAnnotations?.segments.map((segment) => {
                            const isSelected = segment.id === selectedSegmentId;
                            return (
                              <g key={segment.id}>
                                <line
                                  stroke="transparent"
                                  strokeWidth={18}
                                  x1={segment.x1_px}
                                  x2={segment.x2_px}
                                  y1={segment.y1_px}
                                  y2={segment.y2_px}
                                  onClick={(event) => {
                                    if (mode !== "select") {
                                      return;
                                    }

                                    event.stopPropagation();
                                    setSelectedSegmentId(segment.id);
                                  }}
                                />
                                <line
                                  stroke={isSelected ? "#f97316" : "#38bdf8"}
                                  strokeLinecap="round"
                                  strokeWidth={isSelected ? 5 : 3}
                                  x1={segment.x1_px}
                                  x2={segment.x2_px}
                                  y1={segment.y1_px}
                                  y2={segment.y2_px}
                                />
                              </g>
                            );
                          })}

                          {draftPoints.length >= 1 ? (
                            <>
                              <polyline
                                fill="none"
                                points={draftPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                                stroke="#facc15"
                                strokeDasharray="10 8"
                                strokeLinecap="round"
                                strokeWidth={4}
                              />
                              {draftPoints.map((point, index) => (
                                <circle
                                  key={`${point.x}-${point.y}-${index}`}
                                  cx={point.x}
                                  cy={point.y}
                                  fill="#facc15"
                                  r={5}
                                />
                              ))}
                            </>
                          ) : null}

                          {calibrationPoints.length >= 1 ? (
                            <>
                              {calibrationPoints.length === 2 ? (
                                <line
                                  stroke="#34d399"
                                  strokeDasharray="10 8"
                                  strokeWidth={4}
                                  x1={calibrationPoints[0].x}
                                  x2={calibrationPoints[1].x}
                                  y1={calibrationPoints[0].y}
                                  y2={calibrationPoints[1].y}
                                />
                              ) : null}
                              {calibrationPoints.map((point, index) => (
                                <circle
                                  key={`${point.x}-${point.y}-${index}`}
                                  cx={point.x}
                                  cy={point.y}
                                  fill="#34d399"
                                  r={6}
                                />
                              ))}
                            </>
                          ) : null}
                        </svg>
                      )}
                    </ReactPdfPage>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
