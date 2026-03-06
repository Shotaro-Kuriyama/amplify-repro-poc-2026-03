import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isAllowedProtocol(url: URL) {
  return url.protocol === "http:" || url.protocol === "https:";
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

  try {
    const response = await fetch(target, {
      headers: {
        Accept: "application/pdf,*/*",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { detail: `PDF の取得に失敗しました: ${response.status} ${response.statusText}` },
        { status: response.status },
      );
    }

    const buffer = await response.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/pdf",
      },
    });
  } catch (error) {
    console.error("PDF proxy failed", error);
    return NextResponse.json(
      { detail: "PDF のプロキシ取得中にエラーが発生しました。" },
      { status: 502 },
    );
  }
}
