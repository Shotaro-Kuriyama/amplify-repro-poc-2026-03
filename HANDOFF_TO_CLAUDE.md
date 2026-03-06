# HANDOFF TO CLAUDE

最終更新: 2026-03-06

## 初見エージェント向け要約
- この repo は「PDF 図面を壁線注釈し、疑似 IFC を生成・閲覧する」PoC。
- 現在の主戦場は `/upload`。`/results` はプレースホルダ寄り。
- Milestone7（手動トレース）と Milestone8（Auto-detect beta）は実装済み。
- 直近の優先は「回帰を防ぐ最小スモークテスト整備」。

## この repo の目的
- 複数 PDF を plan として取り込み、注釈 (`annotations.segments`) を保存し、`Start/Rebuild` で IFC に反映して Viewer で確認する。

## 現状の実装レベル
- フロント:
  - PDF アップロード、並び替え、開始階設定。
  - 手動トレース、スケール校正、注釈保存。
  - Auto-detect(beta) の ghost 表示・採用/破棄・注釈取り込み。
  - ジョブ進捗、Start/Rebuild、IFC 表示。
- バック:
  - Job/Annotations/Autodetect API、ファイル保存、IFC 生成。
  - セキュリティ対策（plan_id 安全化、pdf-proxy SSRF 対策）。

## 今動いている部分
- `npm run build`（実行済み、成功）。
- FastAPI 起動（実行済み、成功）。
- `GET /api/health` 200、`HEAD /api/sample-ifc` 200（実行済み）。
- 既存ジョブに対する autodetect が 200（`segments=101` を確認）。

## 未確認
- この作業ではブラウザ操作による完全手動 E2E（新規アップロードからダウンロードまで）は未実施。

## 今動いていない/未完了の部分
- vector PDF 解析（未対応）。
- Auto-detect の複数ページ対応（未対応）。
- 本格テスト基盤（未整備）。
- `/results` は実ワークフローと未統合（主導線は `/upload`）。

## 既知の不具合・注意点
- `README.md` に旧ローカル絶対パスリンクが残存。
- `api/data/jobs/` が Git 追跡済みファイルを含む（ignore 追加済みだが既存追跡は別処理が必要）。
- 実行環境はローカル前提（CORS が localhost/127.0.0.1 向け）。

## 起動コマンド

### API
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
python -m uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000
```

### Web
```bash
npm install
npm run dev
```

## テスト・確認コマンド（現状）
```bash
# build
npm run build

# health
curl -s http://127.0.0.1:8000/api/health

# sample IFC header
curl -I http://127.0.0.1:8000/api/sample-ifc
```

## 実行環境メモ（確認値）
- Node: `v24.12.0`
- npm: `11.6.2`
- Python (system): `3.13.11`
- Python (`.venv`): `3.11.15`
- `package.json` の `engines` 指定は未設定（実行時はローカル環境に依存）。

## まず読むべきファイル
1. `README.md`
2. `components/upload/upload-workspace.tsx`
3. `components/upload/plan-trace-editor.tsx`
4. `lib/api.ts`
5. `api/app/main.py`
6. `api/app/job_store.py`
7. `api/app/autodetect.py`
8. `api/app/ifc_factory.py`

## 次にやるべきこと
- `TASK_NEXT.md` のタスク（最小スモークテスト追加）を実装する。

## 修正時の注意事項
- 既存の安全制約は壊さない:
  - `plan_id` 正規表現制約
  - pdf-proxy の allowlist/timeout/type/size チェック
  - Auto-detect の `raster only / page 1 only` beta 制約
- 変更は最小単位で行い、`npm run build` と API スモークを毎回通す。
- Auto-detect 候補は server 保存しない（採用後に注釈へ取り込み）。

## 不明点が出たときに読む場所
- API 仕様・エラーコード: `api/app/main.py`
- 画像処理パラメータ: `api/app/autodetect.py`
- 保存フォーマット: `api/app/job_store.py` と `api/data/jobs/*`
- UI 状態遷移: `components/upload/upload-workspace.tsx`
- 注釈重複排除ルール: `lib/annotations.ts`

## 次に触る AI 向け 5 行サマリ
1. 主導線は `/upload`、`/results` はまだ補助的です。  
2. 手動トレースと Auto-detect(beta) はすでに統合済みです。  
3. まず `npm run build` と `GET /api/health` を通して基準を作ってください。  
4. 次タスクは「最小スモークテスト追加」で、回帰防止を先に作るのが最優先です。  
5. `plan_id`/pdf-proxy/Auto-detect 制約の安全ラインは変更しないでください。  
