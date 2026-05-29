# CarePAY API（Cloudflare Workers + D1）

医療・介護・福祉の現場向け請求OSのバックエンド。契約 → 請求 → 回収 → 督促 を扱う最小構成。
フロント（`/` の GitHub Pages）から `fetch` で呼ぶ REST API。カード決済は Square、口座振替は収納代行へ連携する前提。

## 構成

```
backend/
├── wrangler.toml          # Worker + D1 バインディング設定
├── package.json
├── migrations/
│   └── 0001_init.sql      # D1 スキーマ（facilities / residents / invoices / payments / dunning_logs）
└── src/
    └── index.js           # ルーター本体
```

## セットアップ

```bash
cd backend
npm install

# 1) D1 を作成し、出力された database_id を wrangler.toml に貼る
npx wrangler d1 create carepay

# 2) マイグレーション適用（リモート本番DB）
npx wrangler d1 migrations apply carepay --remote
#   ローカル開発用： npx wrangler d1 migrations apply carepay --local

# 3) 機密を登録（コードには書かない）
npx wrangler secret put SQUARE_ACCESS_TOKEN   # Square Payments API トークン
npx wrangler secret put SQUARE_WEBHOOK_KEY    # Webhook 署名検証キー
npx wrangler secret put NTA_WEBAPI_ID         # 国税庁 公表 Web-API ID（登録番号照合）

# 4) ローカル起動 / デプロイ
npx wrangler dev
npx wrangler deploy
```

## エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| GET  | `/api/health` | 死活監視 |
| GET  | `/api/facilities` | 事業者一覧 |
| GET  | `/api/residents?facility_id=` | 利用者一覧 |
| POST | `/api/residents` | 利用者登録（契約・支払方法・署名日時） |
| GET  | `/api/invoices?status=` | 請求一覧（債権管理。status でフィルタ） |
| POST | `/api/billing/run` | 月次請求の一括発行（SHA-256 ハッシュ署名付与） |
| POST | `/api/payments/card` | Square でカード課金（フロントの tokenize 済みトークンを受領） |
| POST | `/api/dunning/run` | 期日超過を検出し督促レベル判定＋ログ（1:SMS / 2:文書 / 3:電話） |
| GET  | `/api/invoice-registration/:number` | 適格請求書発行事業者 登録番号（T+13桁）の照合 |
| POST | `/api/webhooks/square` | Square 決済結果の非同期反映 |

## フロントとの接続

フロント（`demo.html`）の Square カード登録で得た `result.token` を `/api/payments/card` の `source_id` に渡す。
`SQUARE_CFG`（demo.html）と Worker の `SQUARE_ACCESS_TOKEN` は同じ Square アプリ（sandbox→本番）で揃える。

## 注意

- 口座振替（収納代行）は Square ではなく外部会社（アプラス等）へ連携する。選定は `docs/collection-agency-selection.md` を参照。
- 社会保険診療・介護保険サービスは消費税 非課税。適格請求書の税額記載は自費（課税）取引のみ。
