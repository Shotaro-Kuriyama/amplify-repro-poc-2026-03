import { Suspense } from "react";

import { UploadWorkspace } from "@/components/upload/upload-workspace";

export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <UploadWorkspace />
    </Suspense>
  );
}
