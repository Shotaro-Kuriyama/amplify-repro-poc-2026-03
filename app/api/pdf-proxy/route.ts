import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function isAllowedProtocol(url: URL) {
  return url.protocol === "http:" || url.protocol === "https:";
}

function parseEnvOrigins(rawValue: string | undefined): Set<string> {
  if (!rawValue) {
    return new Set();
  }

  const origins = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const normalized = new Set<string>();
  for (const origin of origins) {
    try {
      normalized.add(new URL(origin).origin.toLowerCase());
    } catch {
      // Ignore invalid origin entries.
    }
  }

  return normalized;
}

function buildAllowedOrigins(request: NextRequest): Set<string> {
  const allowed = parseEnvOrigins(process.env.PDF_PROXY_ALLOWED_ORIGINS);
  allowed.add(request.nextUrl.origin.toLowerCase());

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (apiBase) {
    try {
      allowed.add(new URL(apiBase).origin.toLowerCase());
    } catch {
      // Ignore invalid NEXT_PUBLIC_API_BASE_URL.
    }
  }

  allowed.add("http://127.0.0.1:8000");
  allowed.add("http://localhost:8000");
  return allowed;
}

function isRedirectStatus(status: number) {
  return status >= 300 && status < 400;
}

function isPdfContentType(contentType: string | null) {
  if (!contentType) {
    return false;
  }

  return contentType.toLowerCase().includes("application/pdf");
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      const error = new Error(`PDF がサイズ上限 ${Math.floor(maxBytes / (1024 * 1024))}MB を超えています。`);
      (error as Error & { status?: number }).status = 413;
      throw error;
    }
  }

  if (!response.body) {
    return new ArrayBuffer(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      const error = new Error(`PDF がサイズ上限 ${Math.floor(maxBytes / (1024 * 1024))}MB を超えています。`);
      (error as Error & { status?: number }).status = 413;
      throw error;
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

export async function GET(request: NextRequest) {
  const source = request.nextUrl.searchParams.get("src");

  if (!source) {
    return NextResponse.json({ detail: "src クエリが必要です。" }, { status: 400 });
  }

  let target: URL;

  try {
    target = new URL(source);
  } catch {
    return NextResponse.json({ detail: "src の URL 形式が不正です。" }, { status: 400 });
  }

  if (!isAllowedProtocol(target)) {
    return NextResponse.json({ detail: "http/https のみ許可しています。" }, { status: 400 });
  }

  const allowedOrigins = buildAllowedOrigins(request);
  if (!allowedOrigins.has(target.origin.toLowerCase())) {
    return NextResponse.json(
      { detail: `許可されていないオリジンです: ${target.origin}` },
      { status: 403 },
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      headers: {
        Accept: "application/pdf,*/*",
      },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    if (isRedirectStatus(response.status)) {
      return NextResponse.json(
        { detail: "PDF プロキシではリダイレクトを許可していません。" },
        { status: 502 },
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { detail: `PDF の取得に失敗しました: ${response.status} ${response.statusText}` },
        { status: response.status },
      );
    }

    const contentType = response.headers.get("content-type");
    if (!isPdfContentType(contentType)) {
      return NextResponse.json(
        { detail: `PDF 以外の Content-Type は許可されません: ${contentType ?? "unknown"}` },
        { status: 415 },
      );
    }

    const body = await readBodyWithLimit(response, MAX_PDF_BYTES);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    if ((error as Error & { status?: number }).status === 413) {
      return NextResponse.json(
        { detail: `PDF サイズが上限 (${Math.floor(MAX_PDF_BYTES / (1024 * 1024))}MB) を超えています。` },
        { status: 413 },
      );
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json(
        { detail: `PDF 取得がタイムアウトしました (${Math.floor(DEFAULT_TIMEOUT_MS / 1000)}秒)。` },
        { status: 504 },
      );
    }

    console.error("PDF proxy failed", error);
    return NextResponse.json(
      { detail: "PDF のプロキシ取得中にエラーが発生しました。" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
