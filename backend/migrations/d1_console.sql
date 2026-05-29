CREATE TABLE IF NOT EXISTS facilities (
  id            TEXT PRIMARY KEY,           
  name          TEXT NOT NULL,
  biz_type      TEXT NOT NULL,              
  address       TEXT,
  invoice_reg_no TEXT,                       
  collector     TEXT,                        
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS residents (
  id            TEXT PRIMARY KEY,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  room          TEXT,
  payer_name    TEXT,                        
  payer_relation TEXT,                       
  payer_phone   TEXT,
  pay_method    TEXT NOT NULL DEFAULT 'direct_debit', 
  square_card_id TEXT,                        
  consent_signed_at TEXT,                     
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_residents_facility ON residents(facility_id);
CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,           
  facility_id   TEXT NOT NULL REFERENCES facilities(id),
  resident_id   TEXT NOT NULL REFERENCES residents(id),
  period        TEXT NOT NULL,              
  amount        INTEGER NOT NULL,           
  tax10_amount  INTEGER NOT NULL DEFAULT 0, 
  tax8_amount   INTEGER NOT NULL DEFAULT 0, 
  doc_type      TEXT NOT NULL DEFAULT 'invoice',
  status        TEXT NOT NULL DEFAULT 'invoiced', 
  due_date      TEXT NOT NULL,
  hash          TEXT,                       
  issued_at     TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method        TEXT NOT NULL,              
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'processing', 
  external_id   TEXT,                       
  result_detail TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE TABLE IF NOT EXISTS dunning_logs (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  level         INTEGER NOT NULL,           
  channel       TEXT NOT NULL,              
  sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO facilities (id,name,biz_type,address,invoice_reg_no,collector) VALUES
 ('fac_sakura','介護老人保健施設 さくら苑','care_home','東京都〇〇区〇〇 4-5-6','T1234567890123','aplus'),
 ('fac_reiwa','令和ホーム','care_home','東京都〇〇区〇〇 9-9-9','T9876543210987','widenet')
ON CONFLICT(id) DO NOTHING;
