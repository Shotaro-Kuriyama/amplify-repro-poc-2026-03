# AmpliFy風 UIスタブ

Next.js フロントエンドと FastAPI バックエンドを使って、PDF投入から疑似IFC生成までの導線を段階的に実装しています。  
現時点では PDF 解析や本家MLはまだ載せず、`/api/jobs` の疑似進捗とダミーIFC生成でフローを通しています。

## 技術構成

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui 風コンポーネント
- web-ifc-viewer
- react-pdf + pdfjs-dist
- FastAPI + IfcOpenShell

## 起動方法

### 1. API サーバー

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
python -m uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Web フロントエンド

```bash
npm install
npm run dev
```

必要なら `NEXT_PUBLIC_API_BASE_URL` で API の接続先を変更できます。未指定時は `http://127.0.0.1:8000` を使います。  
Next.js の開発サーバーが `3000` を使えない場合は `3001` などに切り替わりますが、FastAPI 側は `localhost` / `127.0.0.1` のローカルポートを許可するようにしています。

起動後に [http://localhost:3000](http://localhost:3000) を開くとトップページが表示されます。

## IFC Viewer の注意点

- `npm install` 時に `postinstall` で `node_modules/web-ifc` の WASM を `public/vendor/ifc` にコピーします。
- もし Viewer が `web-ifc.wasm` を見つけられない場合は、プロジェクトルートで `npm run copy-ifc-wasm` を再実行してください。
- 起動チェックとして `curl -I http://localhost:3000/vendor/ifc/web-ifc.wasm` を実行し、`HTTP/1.1 200 OK` を確認してください。
- DevTools Network では `/_next/static/chunks/vendor/ifc/web-ifc.wasm` ではなく、`/vendor/ifc/web-ifc.wasm` だけが参照されることを確認してください。
- ローカル確認用の IFC は [public/sample.ifc](/Users/shotarokuriyama/Documents/Playground%202/public/sample.ifc) に配置しています。
- `/upload` の右ペインはジョブ完了後だけ IFC をロードします。処理前はプレースホルダ表示のままなので、PDF トレース中に WASM 読み込みで画面全体が崩れないようにしています。
- IFC ロード時は `web worker` を使わず、`wasmPath = "/vendor/ifc/"`（先頭 `/`・末尾 `/` 必須）に固定しています。内部 `SetWasmPath(path, absolute=true)` も併用し、`/_next/static/chunks/...` 側へ解決されないようにしています。
- Viewer 起動時は DevTools Console に `WASM probe`（URL / status / content-type / bytes）と `wasmPath configured`（`isWasmPathAbsolute` を含む）を出力するため、解決先が `/_next/static/chunks/...` に寄っていないかをすぐ切り分けできます。
- FastAPI 側のサンプル IFC 生成確認は [http://127.0.0.1:8000/api/sample-ifc](http://127.0.0.1:8000/api/sample-ifc) で行えます。

## PDF 表示の注意点

- PDF 描画は [components/pdf/react-pdf-page.tsx](/Users/shotarokuriyama/Documents/Playground%202/components/pdf/react-pdf-page.tsx) から client-only の [components/pdf/react-pdf-page-client.tsx](/Users/shotarokuriyama/Documents/Playground%202/components/pdf/react-pdf-page-client.tsx) を `next/dynamic(..., { ssr: false })` で読み込みます。Server Component 側では `pdfjs` を実行しません。
- 実描画は `react-pdf` ではなく `pdfjs-dist/build/pdf.min.mjs` を使い、`/vendor/pdf/pdf.min.mjs` をブラウザのネイティブ `import()`（`webpackIgnore`）で読み込んで 1 ページ目を canvas へ直接描画しています。`pdfjs` 本体を Webpack バンドルに含めないため、`Object.defineProperty called on non-object` を回避できます。
- worker も同一バージョンの `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` を `public/vendor/pdf/pdf.worker.min.mjs` にコピーして使います。
- worker 設定は描画コンポーネント内で `pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf/pdf.worker.min.mjs"` を指定しています。
- Next.js 側では [next.config.ts](/Users/shotarokuriyama/Documents/Playground%202/next.config.ts) に `transpilePackages: ["pdfjs-dist"]` を追加しています。
- [next.config.ts](/Users/shotarokuriyama/Documents/Playground%202/next.config.ts) では `/vendor/pdf/*` と `/pdf.worker.min.mjs` に `Content-Type: application/javascript` を付ける header を設定しています。
- FastAPI の `pdf_url` は `127.0.0.1:8000` の別オリジンになるので、[app/api/pdf-proxy/route.ts](/Users/shotarokuriyama/Documents/Playground%202/app/api/pdf-proxy/route.ts) で同一オリジンへプロキシしてから `pdfjs` に渡しています。描画前にブラウザ側で PDF バイト列を fetch し、`getDocument({ data })` で読み込むため、URL 直読みに比べてエラー原因を特定しやすくしています。
- 単体確認用に [app/debug/pdf/page.tsx](/Users/shotarokuriyama/Documents/Playground%202/app/debug/pdf/page.tsx) を追加しています。`/debug/pdf?job=<job_id>&plan=<plan_id>` または `/debug/pdf?src=<pdf_url>` で PDF だけを表示できます。
- `postinstall` では [scripts/copy-ifc-wasm.mjs](/Users/shotarokuriyama/Documents/Playground%202/scripts/copy-ifc-wasm.mjs) を実行し、IFC 用の WASM とあわせて `pdf.min.mjs` / `pdf.worker.min.mjs` も `public/vendor/pdf` へコピーします。

## ページ

- `/` トップページ
- `/debug/pdf` PDF 単体デバッグページ
- `/upload` アップロード作業ページ
- `/results` 結果ページ

## トレース手順

1. `/upload` で複数の PDF を追加し、必要なら Plan list で順序を整えます。
2. 左側の `PDF トレース` で対象 plan を選び、`Draw` モードに切り替えます。
3. 壁の中心線に沿って点をクリックし、折れ線が引けたら `Enter` で確定します。
4. 線分を消したい場合は `Select` モードで線をクリックし、`Delete` を押します。
5. 壁厚と壁高を m 単位で入力し、`Save annotations` で server に保存します。
6. 保存後は URL に `?job=...` が付き、リロード時に保存済み注釈と PDF を再読込します。

## スケール校正手順

1. `Calibrate` モードに切り替えます。
2. 実寸が分かっている 2 点を PDF 上でクリックします。
3. 入力欄に実寸を m 単位で入力し、`Scale を確定` を押します。
4. `px_to_m` が保存され、IFC 生成時は `x_m = x_px * px_to_m`, `y_m = y_px * px_to_m` で変換します。
5. `Save annotations` 後はこのスケールも server 側に保存されます。

## 構成

```text
app/
  layout.tsx
  page.tsx
  upload/page.tsx
  results/page.tsx
components/
  pdf/
  layout/
  ui/
  pdf-plan-panel.tsx
  viewer-placeholder.tsx
  debug/
  upload/
    plan-trace-editor.tsx
  viewer/
api/
  app/job_store.py
  app/ifc_factory.py
  app/main.py
  requirements.txt
lib/
  annotations.ts
  api.ts
  upload.ts
scripts/
  copy-ifc-wasm.mjs
```

## 実装済み

- PDF ドロップゾーン、削除、並び替え
- 開始階の選択UI
- PDF トレース、壁線保存、スケール校正
- `react-pdf` ベースの PDF 表示と `/debug/pdf`
- `GET/PUT /api/jobs/{id}/annotations`
- FastAPI `POST /api/jobs`, `GET /api/jobs/{id}`
- `POST /api/jobs/{id}/start`
- 壁線 annotations からの IFC 生成とダウンロード前フォーム
- web-ifc-viewer による `sample.ifc` / 成果物 IFC の表示
