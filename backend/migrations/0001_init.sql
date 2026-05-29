-- CarePAY D1 初期スキーマ
-- 医療・介護・福祉の現場向け：契約 → 請求 → 回収 → 債権管理 を一気通貫で扱う最小構成

PRAGMA foreign_keys = ON;

-- 事業者（テナント）
CREATE TABLE IF NOT EXISTS facilities (
  id            TEXT PRIMARY KEY,           -- 例: fac_sakura
  name          TEXT NOT NULL,
  biz_type      TEXT NOT NULL,              -- medical_ins / medical_pay / care_home / care_visit / care_home_residence / welfare
  address       TEXT,
  invoice_reg_no TEXT,                       -- 適格請求書発行事業者 登録番号 (T+13桁)
  collector     TEXT,                        -- 裏側の収納代行会社（aplus / widenet / zeus / dsk / ogf / panda 等）
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 利用者（入居者・患者）と契約者（家族）
CREATE TABLE IF NOT EXISTS residents (
  id            TEXT PRIMARY KEY,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  room          TEXT,
  payer_name    TEXT,                        -- 支払者（家族）氏名
  payer_relation TEXT,                       -- 続柄
  payer_phone   TEXT,
  pay_method    TEXT NOT NULL DEFAULT 'direct_debit', -- direct_debit / card / card_bridge / transfer / paper
  square_card_id TEXT,                        -- カード払い時の Square Card-on-file ID
  consent_signed_at TEXT,                     -- 同意・署名の取得日時
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_residents_facility ON residents(facility_id);

-- 請求（月次）
CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,           -- 例: inv_20260531_0001
  facility_id   TEXT NOT NULL REFERENCES facilities(id),
  resident_id   TEXT NOT NULL REFERENCES residents(id),
  period        TEXT NOT NULL,              -- 例: 2026-05
  amount        INTEGER NOT NULL,           -- 税込合計（円）
  tax10_amount  INTEGER NOT NULL DEFAULT 0, -- 10%対象 消費税額
  tax8_amount   INTEGER NOT NULL DEFAULT 0, -- 8%軽減 消費税額
  doc_type      TEXT NOT NULL DEFAULT 'invoice',
  status        TEXT NOT NULL DEFAULT 'invoiced', -- invoiced/pending/paid/unpaid/dunning1/dunning2/dunning3/legal
  due_date      TEXT NOT NULL,
  hash          TEXT,                       -- 電子発行時の SHA-256（改ざん防止）
  issued_at     TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);

-- 入出金（Square / 収納代行 / 振込）
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method        TEXT NOT NULL,              -- card / direct_debit / transfer
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'processing', -- processing/completed/failed
  external_id   TEXT,                       -- Square payment_id / 収納代行の照合キー
  result_detail TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- 督促ログ
CREATE TABLE IF NOT EXISTS dunning_logs (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  level         INTEGER NOT NULL,           -- 1:SMS 2:文書 3:電話
  channel       TEXT NOT NULL,              -- sms / letter / call
  sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 動作確認用シード
INSERT INTO facilities (id,name,biz_type,address,invoice_reg_no,collector) VALUES
 ('fac_sakura','介護老人保健施設 さくら苑','care_home','東京都〇〇区〇〇 4-5-6','T1234567890123','aplus'),
 ('fac_reiwa','令和ホーム','care_home','東京都〇〇区〇〇 9-9-9','T9876543210987','widenet')
ON CONFLICT(id) DO NOTHING;
