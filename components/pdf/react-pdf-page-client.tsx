"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type PdfPageState = {
  renderedHeight: number;
  renderedWidth: number;
  sourceHeight: number;
  sourceWidth: number;
};

type PdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (
    input:
      | string
      | {
          data: Uint8Array;
        },
  ) => {
    promise: Promise<unknown>;
  };
};

type PdfDocumentProxy = {
  destroy: () => Promise<void>;
  getPage: (pageNumber: number) => Promise<PdfPageProxy>;
  numPages: number;
};

type PdfPageProxy = {
  getViewport: (input: { scale: number }) => {
    height: number;
    width: number;
  };
  render: (input: {
    background?: string;
    canvas?: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    transform?: [number, number, number, number, number, number];
    viewport: {
      height: number;
      width: number;
    };
  }) => {
    cancel: () => void;
    promise: Promise<void>;
  };
};

export type ReactPdfPageClientProps = {
  children?: (state: PdfPageState) => ReactNode;
  className?: string;
  onError?: (message: string) => void;
  onPageStateChange?: (state: PdfPageState | null) => void;
  pdfUrl: string | null;
  zoom: number;
};

function normalizePdfUrl(pdfUrl: string | null) {
  if (!pdfUrl) {
    return null;
  }

  if (pdfUrl.startsWith("blob:") || pdfUrl.startsWith("data:") || pdfUrl.startsWith("/")) {
    return pdfUrl;
  }

  if (typeof window === "undefined") {
    return pdfUrl;
  }

  try {
    const target = new URL(pdfUrl, window.location.origin);
    if (target.origin === window.location.origin) {
      return target.toString();
    }

    return `/api/pdf-proxy?src=${encodeURIComponent(target.toString())}`;
  } catch {
    return pdfUrl;
  }
}

async function loadPdfSource(pdfUrl: string): Promise<Uint8Array> {
  if (pdfUrl.startsWith("data:")) {
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error(`data URL の読込に失敗しました: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  const response = await fetch(pdfUrl, {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(`PDF の取得に失敗しました: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
    const responseText = await response.text().catch(() => "");
    const trimmed = responseText.slice(0, 180).trim();
    throw new Error(
      `PDF ではないレスポンスを受け取りました (${contentType})${trimmed ? `: ${trimmed}` : ""}`,
    );
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("PDF のレスポンスが空です。");
  }

  return new Uint8Array(buffer);
}

export default function ReactPdfPageClient({
  children,
  className,
  onError,
  onPageStateChange,
  pdfUrl,
  zoom,
}: ReactPdfPageClientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  const onPageStateChangeRef = useRef(onPageStateChange);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pdfPageState, setPdfPageState] = useState<PdfPageState | null>(null);

  const normalizedPdfUrl = useMemo(() => normalizePdfUrl(pdfUrl), [pdfUrl]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onPageStateChangeRef.current = onPageStateChange;
  }, [onPageStateChange]);

  function reportError(prefix: string, error: unknown) {
    const suffix = error instanceof Error ? error.message : "不明なエラー";
    const message = `${prefix}: ${suffix}`;
    console.error(prefix, error);
    setErrorMessage(message);
    onErrorRef.current?.(message);
  }

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let pdfDocument: PdfDocumentProxy | null = null;

    async function renderPdf() {
      if (!normalizedPdfUrl || !canvasRef.current) {
        setIsRendering(false);
        setPageCount(null);
        setPdfPageState(null);
        setErrorMessage(null);
        onPageStateChangeRef.current?.(null);
        return;
      }

      setIsRendering(true);
      setPageCount(null);
      setPdfPageState(null);
      setErrorMessage(null);
      onPageStateChangeRef.current?.(null);

      try {
        const pdfRuntimeUrl: string = "/vendor/pdf/pdf.min.mjs";
        const pdfjs = (await import(
          /* webpackIgnore: true */ pdfRuntimeUrl
        )) as PdfJsModule;
        pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf/pdf.worker.min.mjs";

        const pdfSource = await loadPdfSource(normalizedPdfUrl);
        const loadingTask = pdfjs.getDocument({ data: pdfSource });
        pdfDocument = (await loadingTask.promise) as unknown as PdfDocumentProxy;

        if (cancelled) {
          await pdfDocument.destroy();
          return;
        }

        setPageCount(pdfDocument.numPages);

        const page = await pdfDocument.getPage(1);

        if (cancelled || !canvasRef.current) {
          await pdfDocument.destroy();
          return;
        }

        const sourceViewport = page.getViewport({ scale: 1 });
        const renderedViewport = page.getViewport({ scale: zoom });
        const nextState = {
          renderedHeight: renderedViewport.height,
          renderedWidth: renderedViewport.width,
          sourceHeight: sourceViewport.height,
          sourceWidth: sourceViewport.width,
        };

        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });

        if (!context) {
          throw new Error("Canvas 2D context を取得できませんでした。");
        }

        const deviceScale = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(renderedViewport.width * deviceScale));
        canvas.height = Math.max(1, Math.floor(renderedViewport.height * deviceScale));
        canvas.style.width = `${renderedViewport.width}px`;
        canvas.style.height = `${renderedViewport.height}px`;

        renderTask = page.render({
          background: "rgb(255,255,255)",
          canvas,
          canvasContext: context,
          transform:
            deviceScale === 1 ? undefined : [deviceScale, 0, 0, deviceScale, 0, 0],
          viewport: renderedViewport,
        });

        await renderTask.promise;

        if (cancelled) {
          return;
        }

        setPdfPageState(nextState);
        onPageStateChangeRef.current?.(nextState);
      } catch (error) {
        if (
          cancelled ||
          (error instanceof Error &&
            (error.name === "RenderingCancelledException" ||
              error.name === "AbortException"))
        ) {
          return;
        }

        reportError("PDF描画エラー", error);
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      onPageStateChangeRef.current?.(null);

      if (pdfDocument) {
        void pdfDocument.destroy().catch((error) => {
          console.error("PDF document destroy failed", error);
        });
      }
    };
  }, [normalizedPdfUrl, zoom]);

  return (
    <div className={cn("relative", className)}>
      {!normalizedPdfUrl ? (
        <div className="flex min-h-[480px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-sm text-slate-500">
          PDF が未選択です。
        </div>
      ) : null}

      {normalizedPdfUrl ? (
        <div
          className="relative"
          style={
            pdfPageState
              ? {
                  height: pdfPageState.renderedHeight,
                  width: pdfPageState.renderedWidth,
                }
              : undefined
          }
        >
          <canvas ref={canvasRef} className="block rounded-lg bg-white shadow-sm" />
          {pdfPageState ? <div className="absolute inset-0">{children?.(pdfPageState)}</div> : null}

          {isRendering ? (
            <div className="absolute inset-0 flex min-h-[480px] items-center justify-center rounded-xl border border-slate-200 bg-white/90 text-sm text-slate-500">
              PDF を読み込んでいます...
            </div>
          ) : null}

          {errorMessage ? (
            <div className="absolute inset-0 flex min-h-[480px] items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-6 text-sm text-rose-900">
              {errorMessage}
            </div>
          ) : null}
        </div>
      ) : null}

      {pageCount ? (
        <div className="mt-2 text-xs text-slate-500">表示ページ: 1 / {pageCount}</div>
      ) : null}
    </div>
  );
}
