# TASK NEXT

最終更新: 2026-03-06

## 次に着手すべきタスク（1つ）
- **「最小スモークテスト（CLI）を追加し、主要フロー回帰を自動検知できる状態にする」**

## このタスクを選んだ理由
- 現在、機能は揃っているが自動テストがない。
- 既存実装はフロント/バック/API 契約が密結合なので、軽微な変更でも `PDF→注釈→Start/Rebuild→IFC` が壊れやすい。
- 次エージェントが安全に実装を進めるために、まず「壊れていないことを機械的に確認する基盤」が必要。

## 完了条件（Definition of Done）
- 1 本のスモークスクリプト（例: `scripts/smoke-e2e.sh`）で以下を自動確認できる。
  1. API 起動後に `GET /api/health` が 200。
  2. `POST /api/jobs` でジョブ作成が成功。
  3. `PUT /api/jobs/{id}/annotations` で保存成功。
  4. `POST /api/jobs/{id}/start` 後、`GET /api/jobs/{id}` で最終的に `completed` を確認。
  5. （任意だが推奨）`POST /autodetect` が 200 または仕様通りの 4xx を返す。
- `README.md` に実行コマンドと失敗時の切り分けを追記。
- CI まで入れない場合でも、ローカルで `1コマンド` 実行できる状態にする。

## 関連ファイル
- `api/app/main.py`
- `api/app/job_store.py`
- `api/app/autodetect.py`
- `lib/api.ts`（API 契約参照）
- `README.md`
- `scripts/`（新規スモークスクリプト配置先）

## 作業手順（たたき台）
1. 既存 API 契約を `api/app/main.py` で確定する。
2. 最小入力の PDF data URL（小さなダミー）で `POST /api/jobs` が通るか確認。
3. `curl` ベースでエンドツーエンド手順をシェル化する。
4. ステータスポーリングに timeout を入れる（無限待ち回避）。
5. 終了コードを厳密化し、どの段階で落ちたかを標準出力に残す。
6. README に「実行前提（API 起動済み等）」と「失敗時のチェックポイント」を追記。

## 検証手順
1. API を起動:
   - `python -m uvicorn api.app.main:app --host 127.0.0.1 --port 8000`
2. スモーク実行:
   - `bash scripts/smoke-e2e.sh`
3. 期待結果:
   - 最終行で `PASS` など成功表示。
   - 失敗時は HTTP ステータスと失敗ステップ名が出る。

## 失敗しやすい点
- `NEXT_PUBLIC_API_BASE_URL` と API 実ポートの不一致。
- `plan_id` 制約 (`^[A-Za-z0-9_-]{1,64}$`) を満たさない入力。
- `autodetect` の仕様制限（raster only / page 1 only）を無視した入力。
- IFC 生成完了前に短い timeout で false negative を出す。

## このタスクで触らない範囲
- Auto-detect 精度改善（アルゴリズム変更）。
- vector PDF 対応、複数ページ対応。
- UI 大幅改修（デザイン・状態管理のリファクタ）。
- DB/キュー導入などのアーキテクチャ拡張。
