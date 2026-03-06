import { ViewerPlaceholder } from "@/components/viewer-placeholder";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { PdfPlanPanel } from "@/components/pdf-plan-panel";

export default function ResultsPage() {
  return (
    <WorkspaceShell
      eyebrow="結果確認"
      title="右カラムはIFCプレビューとダウンロード操作のための領域として確保しています。"
      description="M1 では 3D はプレースホルダのままにして、結果ページの情報密度と操作位置だけ決めます。"
      leftPanel={<PdfPlanPanel mode="results" />}
      rightPanel={<ViewerPlaceholder status="complete" />}
    />
  );
}
