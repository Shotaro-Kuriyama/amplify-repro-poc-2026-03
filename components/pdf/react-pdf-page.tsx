"use client";

import dynamic from "next/dynamic";

import type { ReactPdfPageClientProps } from "@/components/pdf/react-pdf-page-client";

const DynamicReactPdfPageClient = dynamic(
  () => import("@/components/pdf/react-pdf-page-client"),
  { ssr: false },
);

export function ReactPdfPage(props: ReactPdfPageClientProps) {
  return <DynamicReactPdfPageClient {...props} />;
}
