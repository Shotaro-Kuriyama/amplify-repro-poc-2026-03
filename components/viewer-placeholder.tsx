import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ViewerPlaceholderProps = {
  status: "preview" | "waiting" | "complete";
};

const statusCopy = {
  preview: {
    label: "プレビュー骨組み",
    title: "3Dビュー領域プレースホルダ",
    description:
      "後続のIFC体験が主役になるよう、ビューア領域は意図的に大きく確保しています。",
    cta: "ジョブ接続待ち",
  },
  waiting: {
    label: "アップロード待機中",
    title: "生成された形状はここに表示されます",
    description:
      "この領域は three.js と IFC 描画のために確保しています。M1では余白、レイヤー、操作配置だけを定義します。",
    cta: "生成開始待ち",
  },
  complete: {
    label: "スタブ結果",
    title: "結果確認ワークスペース",
    description:
      "最終形ではこのプレースホルダがIFCシーン、進捗オーバーレイ、ダウンロード操作に置き換わります。",
    cta: "ダウンロード導線の仮置き",
  },
};

export function ViewerPlaceholder({ status }: ViewerPlaceholderProps) {
  const copy = statusCopy[status];

  return (
    <div className="relative flex min-h-[720px] flex-col">
      <div className="surface-grid absolute inset-0 opacity-30" />
      <div className="relative z-10 flex items-center justify-between border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-sky-300">{copy.label}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">{copy.title}</h2>
        </div>
        <Badge variant="outline" className="border-white/20 bg-white/5 text-white">
          IFCビューア領域
        </Badge>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-between p-6">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
            <div className="aspect-[16/10] rounded-[1.25rem] border border-dashed border-sky-300/30 bg-gradient-to-br from-sky-500/10 via-transparent to-orange-400/10" />
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">{copy.description}</p>
          </div>
          <div className="space-y-4">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm uppercase tracking-[0.28em] text-slate-400">ビューア操作</p>
              <div className="mt-4 grid gap-3 text-sm text-slate-200">
                <div className="rounded-2xl bg-white/5 px-4 py-3">回転 / パン / ズーム</div>
                <div className="rounded-2xl bg-white/5 px-4 py-3">階ごとの切り分け</div>
                <div className="rounded-2xl bg-white/5 px-4 py-3">ダウンロード導線</div>
              </div>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
              <p className="text-sm uppercase tracking-[0.28em] text-slate-400">処理ステータス</p>
              <div className="mt-4 rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-4 text-sm text-sky-100">
                {copy.cta}
              </div>
              <Button className="mt-4 w-full bg-white text-slate-950 hover:bg-slate-100">
                メイン操作
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-400">出力</div>
            <div className="mt-2 text-lg font-semibold">IFCモデル</div>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-400">入力</div>
            <div className="mt-2 text-lg font-semibold">複数階PDF</div>
          </div>
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4">
            <div className="text-sm uppercase tracking-[0.28em] text-slate-400">表示モード</div>
            <div className="mt-2 text-lg font-semibold">スタブ表示</div>
          </div>
        </div>
      </div>
    </div>
  );
}
