# AGENTS.md

このファイルは、この repo で作業する AI コーディングエージェント向けのローカル運用ルールです。

## 作業方針
- 変更は **最小限・高信頼** を優先する（PoC の既存導線を壊さない）。
- 場当たり対応より **根本原因** を優先する。
- 大規模リファクタは行わない（明確な依頼がある場合のみ）。
- 仕様の推測を避け、必ずコード/実行結果を根拠に判断する。
- 不明点は「未確認」と明示する。

## 実装時の必須ルール
- セキュリティ制約を維持する:
  - `app/api/pdf-proxy/route.ts` の SSRF 対策（allowlist/timeout/type/size/redirect 拒否）
  - `api/app/job_store.py` の `plan_id` 安全制約とパス検証
- Auto-detect beta の制約を維持する:
  - `raster only`, `page 1 only`, `vector PDF not supported yet`
- ghost 候補はサーバ保存しない。採用後に `annotations.segments` へ取り込む。

## 変更後に必ず行う確認
- フロント:
  - `npm run build`
- バックエンド最低限:
  - `GET /api/health` が 200
  - 可能なら `POST /api/jobs -> PUT annotations -> POST start -> GET job` のスモーク
- 変更した機能に対応する手動再現手順を、PRコメントまたはドキュメントに残す。

## 実行コマンド（基準）

### API 起動
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r api/requirements.txt
python -m uvicorn api.app.main:app --reload --host 127.0.0.1 --port 8000
```

### Front 起動
```bash
npm install
npm run dev
```

### 最低限の確認
```bash
npm run build
curl -s http://127.0.0.1:8000/api/health
curl -I http://127.0.0.1:8000/api/sample-ifc
```

## 重要ファイル
- フロントの中心状態管理:
  - `components/upload/upload-workspace.tsx`
  - `components/upload/plan-trace-editor.tsx`
  - `components/upload/job-viewer-panel.tsx`
- API 契約:
  - `lib/api.ts`
  - `api/app/main.py`
- 保存/安全制約:
  - `api/app/job_store.py`
  - `app/api/pdf-proxy/route.ts`
- 幾何処理:
  - `api/app/autodetect.py`
  - `api/app/ifc_factory.py`

## よくある落とし穴
- `NEXT_PUBLIC_API_BASE_URL` 未設定時の API 宛先は `http://127.0.0.1:8000` 固定。
- `npm install` 後の `postinstall` で runtime ファイルが `public/vendor/*` にコピーされる前提。
- `api/data/jobs/` は ignore 対象だが、既に追跡済みのファイルは別途 untrack が必要。
- `results` ページは主導線ではない。実運用フロー確認は `/upload` を使う。

## この repo 特有の注意点
- `Start` は既存 IFC を削除して再生成する設計（Rebuild 導線）。
- `start_level` は IFC storey elevation 計算に使われる。
- 注釈重複排除は `lib/annotations.ts` にロジックがあるため、取り込み仕様変更時はここを更新する。
- README に旧絶対パスリンクが一部残っているため、編集時に相対パスへ統一すること。

## ドキュメント更新ポリシー
- コード変更時に仕様や操作手順が変わるなら、同コミットで `README.md` と引き継ぎドキュメントを更新する。
- 最低更新候補:
  - `PROJECT_STATUS.md`
  - `TASK_NEXT.md`
  - `HANDOFF_TO_CLAUDE.md`
