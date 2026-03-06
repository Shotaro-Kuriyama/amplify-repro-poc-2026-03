import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PdfPlanPanelProps = {
  mode: "landing" | "upload" | "results";
};

const floorItems = [
  { name: "地下1階 駐車場", file: "parking-core.pdf", scale: "1:200" },
  { name: "1階 ロビー", file: "lobby-plan.pdf", scale: "1:100" },
  { name: "2階 オフィス", file: "office-plan.pdf", scale: "1:100" },
];

export function PdfPlanPanel({ mode }: PdfPlanPanelProps) {
  const heading =
    mode === "landing"
      ? "プロジェクト設定"
      : mode === "upload"
        ? "PDF / 図面管理"
        : "成果物";

  const description =
    mode === "landing"
      ? "静的なサンプルで、左カラムにどの情報を置くかを先に固定します。"
      : mode === "upload"
        ? "アップロード、階の順序、スケール指定がここにまとまる想定です。"
        : "結果ページでは生成済み IFC と提出前のメタ情報を同じ導線に保ちます。";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm uppercase tracking-[0.28em] text-sky-700">{heading}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          図面を形状化する前に、階構成と入力条件を整理します。
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>

      <Card className="border-dashed bg-secondary/60">
        <CardHeader>
          <CardTitle>PDF配置エリア</CardTitle>
          <CardDescription>
            ドラッグ＆ドロップ領域のプレースホルダです。実際のファイル入力は次のマイルストーンで実装します。
          </CardDescription>
        </CardHeader>
        <CardContent className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center">
          <div className="text-sm font-medium text-slate-700">ここに各階のPDFをドロップ</div>
          <div className="mt-1 text-sm text-muted-foreground">
            複数階、スケール情報、並び替え操作はこのブロックに集約される想定です。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>階構成リスト</CardTitle>
          <CardDescription>複数階PDFを扱うためのサンプル構造です。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {floorItems.map((item, index) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{index + 1}</Badge>
                  <span className="font-medium text-slate-900">{item.name}</span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{item.file}</div>
              </div>
              <div className="text-sm font-medium text-slate-700">{item.scale}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>スケールと出力情報</CardTitle>
          <CardDescription>左カラムにはプロジェクト条件と処理状態を集約します。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-700">
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <span>基準スケール</span>
            <span className="font-semibold">1:100</span>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <span>想定IFC出力</span>
            <span className="font-semibold">スタブ生成</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/upload">アップロード画面へ</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/results">結果画面へ</Link>
        </Button>
      </div>
    </div>
  );
}
