# ARCHITECTURE

最終確認日: 2026-03-06

## ディレクトリ構成（概要）

```text
.
├─ app/                      # Next.js App Router pages + Next API routes
│  ├─ api/pdf-proxy/route.ts # PDF proxy (SSRF 対策)
│  ├─ upload/page.tsx        # メイン作業画面
│  ├─ debug/pdf/page.tsx     # PDF 単体デバッグ
│  ├─ results/page.tsx       # 旧プレースホルダ結果画面
│  └─ page.tsx               # トップ
├─ components/               # UI/機能コンポーネント
│  ├─ upload/                # Upload workspace 一式
│  ├─ viewer/ifc-viewer.tsx  # web-ifc-viewer 統合
│  ├─ pdf/                   # pdf.js 描画ラッパ
│  └─ layout/                # ヘッダ・シェル
├─ lib/                      # フロント共通ロジック
│  ├─ api.ts                 # FastAPI 呼び出し
│  ├─ annotations.ts         # 注釈型/重複排除ロジック
│  └─ upload.ts              # アップロード型/URL revoke 等
├─ api/                      # FastAPI backend
│  ├─ app/main.py            # API エントリポイント
│  ├─ app/job_store.py       # ジョブ保存・PDF 書込・plan_id 安全化
│  ├─ app/ifc_factory.py     # IFC 生成
│  ├─ app/autodetect.py      # OpenCV + PyMuPDF 線分抽出
│  ├─ data/jobs/             # ジョブ実データ（runtime）
│  └─ storage/artifacts/     # IFC 成果物
├─ public/vendor/            # wasm/pdf runtime 配置先
├─ scripts/copy-ifc-wasm.mjs # postinstall で runtime 配置
└─ README.md
```

## 主要ファイルの役割
- `components/upload/upload-workspace.tsx`
  - Upload/Annotations/Start/Rebuild の状態管理ハブ。
  - `?job=` クエリから既存ジョブを hydrate。
  - `needsRebuild` を使って再生成導線を制御。
- `components/upload/plan-trace-editor.tsx`
  - 手動トレース + Auto-detect ghost 操作 + 注釈取り込み。
- `components/upload/job-viewer-panel.tsx`
  - 進捗表示、Start/Rebuild CTA、IFC ビューア表示。
- `app/api/pdf-proxy/route.ts`
  - PDF fetch の安全化（allowlist, timeout, type/size check, redirect 拒否）。
- `api/app/main.py`
  - FastAPI endpoint 定義とレスポンス整形。
- `api/app/autodetect.py`
  - PDF 1ページ目 raster 化、HoughLinesP ベース線分抽出。
- `api/app/job_store.py`
  - ジョブ JSON/注釈 JSON のファイル保存、`plan_id` バリデーション。
- `api/app/ifc_factory.py`
  - 注釈セグメントから IFC wall を生成。`start_level` を elevation に反映。

## フロントエンド構成
- フレームワーク: Next.js 15 (App Router), React 19, TypeScript。
- 描画:
  - PDF: `pdfjs-dist` を `public/vendor/pdf` から `import()` して描画。
  - IFC: `web-ifc-viewer` + `public/vendor/ifc` の wasm。
- データ取得:
  - `lib/api.ts` の `request<T>()` 経由で FastAPI にアクセス。
  - API エラーは `ApiError(status, message)` として UI 表示。

## バックエンド構成
- フレームワーク: FastAPI + Uvicorn。
- 依存: `ifcopenshell`, `opencv-python-headless`, `PyMuPDF`。
- ストレージ:
  - `api/data/jobs/<job_id>/job.json`
  - `api/data/jobs/<job_id>/annotations.json`
  - `api/data/jobs/<job_id>/plans/*.pdf`
  - `api/storage/artifacts/<job_id>.ifc`
- 実行モデル:
  - 非同期キューは未導入。`started_at` から擬似 progress を算出。
  - 完了時に IFC 生成して artifact URL を返却。

## API エンドポイント一覧（確認できる範囲）

### FastAPI (`api/app/main.py`)
- `GET /api/health`
- `GET /api/sample-ifc`
- `HEAD /api/sample-ifc`
- `POST /api/jobs`
- `POST /api/jobs/{job_id}/start`
- `GET /api/jobs/{job_id}`
- `GET /api/jobs/{job_id}/annotations`
- `PUT /api/jobs/{job_id}/annotations`
- `POST /api/jobs/{job_id}/plans/{plan_id}/autodetect`
- Static mount:
  - `/job-files/*` (plan PDF)
  - `/artifacts/*` (IFC)

### Next API Route
- `GET /api/pdf-proxy?src=...` (`app/api/pdf-proxy/route.ts`)

## データフロー
1. ユーザーが `/upload` で PDF を追加。
2. `createJob()` で `POST /api/jobs` 実行し、PDF を base64 送信して保存。
3. UI で注釈編集し、`PUT /api/jobs/{id}/annotations` で保存。
4. `Start` / `Rebuild` で `POST /api/jobs/{id}/start`。
5. UI は `GET /api/jobs/{id}` をポーリングし progress を更新。
6. 完了時 `artifact_url` を `IfcViewer` に渡して表示。
7. PDF 表示時、異なる origin は `/api/pdf-proxy` を経由。

## 重要な環境変数
- `NEXT_PUBLIC_API_BASE_URL`
  - フロントが接続する FastAPI ベース URL。未指定時は `http://127.0.0.1:8000`。
- `PDF_PROXY_ALLOWED_ORIGINS`
  - PDF proxy の許可 origin（カンマ区切り）。未指定時は同一 origin + API base origin + ローカル既定値。

## 重要な依存関係
- Node/Frontend
  - `next`, `react`, `pdfjs-dist`, `react-pdf`, `web-ifc-viewer`
- Python/Backend (`api/requirements.txt`)
  - `fastapi`, `uvicorn`, `ifcopenshell`, `opencv-python-headless`, `PyMuPDF`

## 開発時に読む順番（推奨）
1. `README.md`（起動と制約）
2. `components/upload/upload-workspace.tsx`（状態管理の中心）
3. `components/upload/plan-trace-editor.tsx`（注釈と Auto-detect UI）
4. `lib/api.ts` / `lib/annotations.ts`（API 契約と取り込みルール）
5. `api/app/main.py`（API 全体像）
6. `api/app/job_store.py`（保存仕様と安全制約）
7. `api/app/autodetect.py` / `api/app/ifc_factory.py`（中核処理）
