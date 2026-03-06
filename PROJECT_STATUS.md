# PROJECT STATUS

最終確認日: 2026-03-06

## プロジェクトの目的
- PDF 図面から壁中心線を注釈し、疑似 IFC を生成してブラウザで確認できる PoC ワークフローを提供する。
- 現在は「手動トレース + Auto-detect(beta) 補助 + 保存 + Start/Rebuild + IFC 閲覧」まで実装済み。

## 現在実装済み（コード確認ベース）
- フロント（Next.js App Router）
  - 複数 PDF アップロード、削除、並び替え、開始階選択。
  - 注釈エディタ（Draw/Select/Calibrate、壁線編集、`px_to_m` 校正、`wall_height_m`/`wall_thickness_m` 設定）。
  - 注釈保存 (`Save annotations`)。
  - Auto-detect(beta): ghost 線の表示、個別 toggle、`Accept all` / `Reject all` / `採用線を取り込む`。
  - ジョブ進捗表示、`Start` / `Rebuild`、IFC ビューア表示。
- バックエンド（FastAPI）
  - `POST /api/jobs`, `GET /api/jobs/{job_id}`, `POST /api/jobs/{job_id}/start`
  - `GET/PUT /api/jobs/{job_id}/annotations`
  - `POST /api/jobs/{job_id}/plans/{plan_id}/autodetect`（raster only / page 1 only）
  - IFC 生成（IfcOpenShell）。`start_level` を elevation 計算に反映。
  - `plan_id` の安全バリデーション、保存パス検証、重複時 409。
  - `/job-files` と `/artifacts` の static 配信。
- セキュリティ・安定化
  - `app/api/pdf-proxy/route.ts` で SSRF 対策（allowlist、redirect 拒否、10 秒 timeout、Content-Type チェック、20MB 制限）。
  - `URL.createObjectURL` の revoke（削除/差替え/unmount）。
  - `.gitignore` に `api/data/jobs/` と IFC artifact ignore が追加済み。

## 未実装・未完成
- vector PDF 自動解析（未対応。README にも `vector PDF not supported yet` 記載あり）。
- Auto-detect の複数ページ対応（現状 page=1 固定）。
- doors/windows/rooms などの自動検出。
- 本番運用向け機能（認証、ジョブキュー、永続 DB、監視、レート制限）。
- 自動テスト（ユニット/E2E）と CI が未整備。
- `/results` ページは現状プレースホルダ中心で、`/upload` の実ワークフローと分離。

## 現在確認されている問題点・不具合
- `README.md` 内に旧ローカルパス（`/Users/shotarokuriyama/Documents/Playground 2/...`）へのリンクが残っている。
- `api/data/jobs/` は ignore 追加済みだが、既存の job データが Git 追跡済み (`git ls-files api/data/jobs` で確認)。
- 自動回帰チェックがないため、修正時に「PDF→注釈→Start/Rebuild→IFC」の破壊に気づきにくい。

## 未確認事項
- ブラウザ上での完全手動 E2E（新規 PDF アップロードから IFC ダウンロードまで）を、この更新作業内では未実施。
- CI 環境での実行は未確認（CI 定義自体が未整備）。

## 直近で詰まりやすいポイント
- フロントと API を別プロセスで起動する必要がある（`NEXT_PUBLIC_API_BASE_URL` 未設定時は `http://127.0.0.1:8000` 固定）。
- `postinstall` が `public/vendor/ifc` と `public/vendor/pdf` に runtime ファイルをコピーする前提。欠けると Viewer/PDF 描画が壊れる。
- Auto-detect は beta 制約が強い（raster only / page 1 only）。仕様外入力は 400/422。
- CORS は localhost/127.0.0.1 向け設定のみ。

## 今の状態で起動可能か
- 起動可能。
- 2026-03-06 時点の実行確認:
  - `npm run build` 成功。
  - `uvicorn api.app.main:app --host 127.0.0.1 --port 8000` 起動成功。
  - `GET /api/health` 200 (`{"status":"ok"}`)。
  - `HEAD /api/sample-ifc` 200。
  - 既存ジョブに対する autodetect 呼び出しが 200、`segments=101` を返却。

## 起動手順（要約）
1. API
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r api/requirements.txt`
   - `python -m uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000`
2. Web
   - `npm install`
   - `npm run dev`
3. 動作確認
   - `http://127.0.0.1:3000`（使用中なら 3001）を開く
   - `/upload` で一連フロー確認

## バージョン前提（実測）
- Node: `v24.12.0`
- npm: `11.6.2`
- Python (system): `3.13.11`
- Python (`.venv`): `3.11.15`
- 備考: `package.json` に `engines` 指定は未設定。FastAPI 依存は `api/requirements.txt` 固定。

## 優先度順の次タスク
1. 最小スモークテスト（API + UI 導線）を追加して回帰を防ぐ。
2. 追跡済み `api/data/jobs/` をリポジトリから外し、クリーンな初期状態を保証する。
3. README の旧絶対パスリンクを整理し、参照先を現 repo 相対に統一する。
4. Auto-detect の失敗時 UX（再試行ガイド・入力制限表示）を強化する。
5. `/results` を実データ連携に寄せるか、用途を明確に分離する。

## まず最初に何を直すべきか
- **最初の 1 つは「最小スモークテストの追加」**。  
  理由: 現在の機能量に対して自動回帰検知がなく、次の開発者が安全に変更しづらい。
