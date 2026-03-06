import { DownloadAccessForm } from "@/components/upload/download-access-form";
import { IfcViewer } from "@/components/viewer/ifc-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type JobViewerPanelProps = {
  artifactUrl: string | null;
  canStart: boolean;
  isStarting: boolean;
  jobId: string | null;
  planCount: number;
  progress: number;
  startLevelLabel: string;
  status: "idle" | "draft" | "queued" | "processing" | "completed" | "failed";
  viewerUrl: string | null;
  onStart: () => void;
};

const copyByStatus = {
  idle: {
    label: "開始前",
    title: "下書き作成前の状態です",
    description:
      "PDF管理とトレース編集は左カラムで進め、右カラムでは 3D 表示と生成進捗を確認します。",
    cta: "Save annotations または Start で下書きジョブを作成します。",
  },
  draft: {
    label: "下書き保存済み",
    title: "注釈データを保持しています",
    description:
      "annotations は server に保存済みです。Start を押すと、その線分データから IFC を生成します。",
    cta: "壁線の保存後に Start で IFC 生成を開始します。",
  },
  queued: {
    label: "キュー投入済み",
    title: "ジョブを受付けました",
    description:
      "現在は疑似進捗で 0 から 100 まで進みます。完了すると壁付きIFCの成果物URLが返ります。",
    cta: "キュー待ちから処理へ移行中です。",
  },
  processing: {
    label: "処理中",
    title: "壁付きIFCを生成しています",
    description:
      "IfcOpenShell で最低1本の壁を含む IFC を生成し、完了後はそのまま Viewer に自動ロードします。",
    cta: "進捗をポーリングしています。",
  },
  completed: {
    label: "完了",
    title: "成果物の準備ができました",
    description:
      "ジョブが 100% に到達すると、ダウンロード前フォームの送信後に成果物リンクを表示します。",
    cta: "フォーム送信後にダウンロードできます。",
  },
  failed: {
    label: "エラー",
    title: "ジョブの取得に失敗しました",
    description:
      "API到達不可やレスポンス失敗時は、エラー状態を表示して再実行を促します。",
    cta: "設定を確認して再試行してください。",
  },
};

function statusBadgeLabel(status: JobViewerPanelProps["status"]) {
  switch (status) {
    case "idle":
      return "待機中";
    case "draft":
      return "draft";
    case "queued":
      return "queued";
    case "processing":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

export function JobViewerPanel({
  artifactUrl,
  canStart,
  isStarting,
  jobId,
  planCount,
  progress,
  startLevelLabel,
  status,
  viewerUrl,
  onStart,
}: JobViewerPanelProps) {
  const copy = copyByStatus[status];
  const progressWidth = `${Math.max(progress, status === "completed" ? 100 : 4)}%`;
  const viewerStatusLabel = status === "completed" && viewerUrl ? "生成済みIFCを表示中" : "生成完了後に IFC を表示します";

  return (
    <div className="relative flex min-h-[720px] flex-col">
      <div className="surface-grid absolute inset-0 opacity-30" />
      <div className="relative z-10 flex items-center justify-between border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-sky-300">{copy.label}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2>
        </div>
        <Badge variant="outline" className="border-white/20 bg-white/5 text-white">
          {statusBadgeLabel(status)}
        </Badge>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-between p-6">
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
            <div className="grid gap-4">
              {status === "completed" && viewerUrl ? (
                <IfcViewer modelUrl={viewerUrl} statusLabel={viewerStatusLabel} />
              ) : (
                <div className="relative min-h-[420px] overflow-hidden rounded-[1.25rem] border border-dashed border-white/15 bg-slate-950">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(2,6,23,0.98))]" />
                  <div className="relative flex h-full min-h-[420px] flex-col justify-between p-6">
                    <div>
                      <div className="text-xs uppercase tracking-[0.28em] text-sky-300">
                        IFC Viewer
                      </div>
                      <div className="mt-2 text-sm text-slate-300">{viewerStatusLabel}</div>
                    </div>
                    <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-6 text-slate-300">
                      壁線トレースを保存し、Start 完了後にこの領域へ成果物 IFC を自動ロードします。
                    </div>
                  </div>
                </div>
              )}
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-sm uppercase tracking-[0.28em] text-slate-400">
                      処理進捗
                    </div>
                    <div className="mt-2 text-4xl font-semibold tracking-tight">{progress}%</div>
                  </div>
                  <div className="max-w-sm text-sm leading-6 text-slate-300">{copy.description}</div>
                </div>
                <div className="mt-4 h-3 rounded-full bg-white/10">
                  <div
                    className={cn(
                      "h-3 rounded-full bg-gradient-to-r from-sky-400 to-orange-300 transition-[width] duration-500",
                    )}
                    style={{ width: progressWidth }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm uppercase tracking-[0.28em] text-slate-400">ジョブ情報</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-200">
                <div className="rounded-2xl bg-white/5 px-4 py-3">
                  PDF数: <span className="font-semibold">{planCount}</span>
                </div>
                <div className="rounded-2xl bg-white/5 px-4 py-3">
                  開始階: <span className="font-semibold">{startLevelLabel}</span>
                </div>
                <div className="rounded-2xl bg-white/5 px-4 py-3">
                  ジョブID: <span className="font-semibold">{jobId ?? "未作成"}</span>
                </div>
              </div>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm uppercase tracking-[0.28em] text-slate-400">操作</p>
              <div className="mt-4 rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-4 text-sm text-sky-100">
                {copy.cta}
              </div>

              {status === "completed" && artifactUrl ? null : (
                <Button
                  className="mt-4 w-full bg-white text-slate-950 hover:bg-slate-100"
                  disabled={!canStart || isStarting}
                  type="button"
                  onClick={onStart}
                >
                  {isStarting ? "ジョブ作成中..." : "Start"}
                </Button>
              )}
            </div>
            {status === "completed" && artifactUrl ? (
              <DownloadAccessForm artifactUrl={artifactUrl} />
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-400">出力</div>
            <div className="mt-2 text-lg font-semibold">壁付きIFC</div>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-400">Viewer</div>
            <div className="mt-2 text-lg font-semibold">web-ifc-viewer</div>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-400">状態</div>
            <div className="mt-2 text-lg font-semibold">{statusBadgeLabel(status)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
