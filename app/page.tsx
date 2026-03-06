import { ViewerPlaceholder } from "@/components/viewer-placeholder";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { PdfPlanPanel } from "@/components/pdf-plan-panel";

export default function HomePage() {
  return (
    <WorkspaceShell
      eyebrow="スタブ構成"
      title="PDFアップロードからIFC確認までの導線を、まずは画面骨組みとして再実装します。"
      description="本家MLはまだ載せず、PDF管理と3Dレビュー領域の情報設計を先に固定するためのトップページです。"
      leftPanel={<PdfPlanPanel mode="landing" />}
      rightPanel={<ViewerPlaceholder status="preview" />}
    />
  );
}
