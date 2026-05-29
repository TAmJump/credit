/**
 * CarePAY API — Cloudflare Worker + D1
 *
 * 契約 → 請求 → 回収 → 督促 を扱う最小バックエンド。
 * カード決済トークンは Square Web Payments SDK（フロント）で生成し、
 * ここ（サーバ）で Payments API に渡す。口座振替は収納代行へ連携する想定（本ファイルでは枠だけ）。
 *
 * デプロイ:
 *   npm i
 *   npx wrangler d1 create carepay        # database_id を wrangler.toml に貼る
 *   npx wrangler d1 migrations apply carepay --remote
 *   npx wrangler secret put SQUARE_ACCESS_TOKEN
 *   npx wrangler deploy
 */

const json = (data, status = 200, origin = '*') =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    },
  });

const uid = (p) => p + '_' + crypto.randomUUID().slice(0, 8);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 適格請求書発行事業者 登録番号：T + 半角数字13桁
function isValidInvoiceRegNo(n) {
  return /^T\d{13}$/.test((n || '').trim().toUpperCase());
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    if (request.method === 'OPTIONS') return json({}, 204, origin);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const seg = path.split('/').filter(Boolean); // ['api','residents',...]

    try {
      // --- ヘルスチェック ---
      if (path === '/api/health') return json({ ok: true, ts: new Date().toISOString() }, 200, origin);

      // --- 事業者 ---
      if (path === '/api/facilities' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM facilities ORDER BY created_at').all();
        return json({ facilities: results }, 200, origin);
      }

      // --- 利用者 ---
      if (path === '/api/residents' && request.method === 'GET') {
        const fid = url.searchParams.get('facility_id');
        const stmt = fid
          ? env.DB.prepare('SELECT * FROM residents WHERE facility_id=? ORDER BY created_at DESC').bind(fid)
          : env.DB.prepare('SELECT * FROM residents ORDER BY created_at DESC');
        const { results } = await stmt.all();
        return json({ residents: results }, 200, origin);
      }
      if (path === '/api/residents' && request.method === 'POST') {
        const b = await request.json();
        const id = uid('res');
        await env.DB.prepare(
          `INSERT INTO residents (id,facility_id,name,room,payer_name,payer_relation,payer_phone,pay_method,square_card_id,consent_signed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).bind(id, b.facility_id, b.name, b.room || null, b.payer_name || null, b.payer_relation || null,
               b.payer_phone || null, b.pay_method || 'direct_debit', b.square_card_id || null,
               b.consent_signed_at || new Date().toISOString()).run();
        return json({ id }, 201, origin);
      }

      // --- 請求一覧（債権管理）---
      if (path === '/api/invoices' && request.method === 'GET') {
        const status = url.searchParams.get('status');
        const stmt = status
          ? env.DB.prepare('SELECT * FROM invoices WHERE status=? ORDER BY due_date').bind(status)
          : env.DB.prepare('SELECT * FROM invoices ORDER BY due_date');
        const { results } = await stmt.all();
        return json({ invoices: results }, 200, origin);
      }

      // --- 月次請求の発行（請求書を電子発行・ハッシュ署名付与）---
      if (path === '/api/billing/run' && request.method === 'POST') {
        const b = await request.json(); // { facility_id, period:'2026-05', due_date:'2026-06-27' }
        const { results: residents } = await env.DB.prepare(
          'SELECT * FROM residents WHERE facility_id=? AND status=?'
        ).bind(b.facility_id, 'active').all();
        const created = [];
        for (const r of residents) {
          const amount = b.amount || 138000;
          const tax10 = b.taxable ? Math.round(amount * 10 / 110) : 0;
          const id = uid('inv');
          const hash = await sha256(`${id}|${r.id}|${amount}|${b.period}`);
          await env.DB.prepare(
            `INSERT INTO invoices (id,facility_id,resident_id,period,amount,tax10_amount,status,due_date,hash,issued_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).bind(id, b.facility_id, r.id, b.period, amount, tax10, 'invoiced', b.due_date, hash, new Date().toISOString()).run();
          created.push({ id, resident_id: r.id, hash });
        }
        return json({ issued: created.length, invoices: created }, 201, origin);
      }

      // --- カード課金（Square Payments API。フロントの tokenize 済みトークンを受領）---
      if (path === '/api/payments/card' && request.method === 'POST') {
        const b = await request.json(); // { invoice_id, source_id(token), amount }
        if (!env.SQUARE_ACCESS_TOKEN) return json({ error: 'SQUARE_ACCESS_TOKEN 未設定' }, 500, origin);
        const sqRes = await fetch('https://connect.squareupsandbox.com/v2/payments', {
          method: 'POST',
          headers: {
            'Square-Version': '2025-01-23',
            authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            source_id: b.source_id,
            amount_money: { amount: b.amount, currency: 'JPY' },
          }),
        });
        const sq = await sqRes.json();
        const ok = sqRes.ok && sq.payment;
        const pid = uid('pay');
        await env.DB.prepare(
          `INSERT INTO payments (id,invoice_id,method,amount,status,external_id,result_detail)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(pid, b.invoice_id, 'card', b.amount, ok ? 'completed' : 'failed',
               sq.payment?.id || null, ok ? 'OK' : JSON.stringify(sq.errors || sq)).run();
        if (ok) {
          await env.DB.prepare('UPDATE invoices SET status=?, paid_at=? WHERE id=?')
            .bind('paid', new Date().toISOString(), b.invoice_id).run();
        }
        return json({ ok, payment_id: pid, square: sq.payment?.id || null }, ok ? 200 : 402, origin);
      }

      // --- 督促バッチ（期日超過を検出 → レベル判定 → ログ）---
      if (path === '/api/dunning/run' && request.method === 'POST') {
        const today = new Date().toISOString().slice(0, 10);
        const { results: overdue } = await env.DB.prepare(
          `SELECT * FROM invoices WHERE status IN ('invoiced','unpaid','pending','dunning1','dunning2') AND due_date < ?`
        ).bind(today).all();
        const actions = [];
        for (const inv of overdue) {
          const days = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 86400000);
          let level = 1, channel = 'sms', next = 'dunning1';
          if (days >= 60) { level = 3; channel = 'call'; next = 'dunning3'; }
          else if (days >= 30) { level = 2; channel = 'letter'; next = 'dunning2'; }
          await env.DB.prepare('INSERT INTO dunning_logs (id,invoice_id,level,channel) VALUES (?,?,?,?)')
            .bind(uid('dun'), inv.id, level, channel).run();
          await env.DB.prepare('UPDATE invoices SET status=? WHERE id=?').bind(next, inv.id).run();
          // 本番：level=1 ならここで SMS 送信（Square 請求書リンク等）
          actions.push({ invoice_id: inv.id, days, level, channel });
        }
        return json({ processed: actions.length, actions }, 200, origin);
      }

      // --- 登録番号 照合（本番は国税庁 公表 Web-API を叩く。ここは形式検証）---
      if (seg[0] === 'api' && seg[1] === 'invoice-registration' && seg[2]) {
        const n = decodeURIComponent(seg[2]).toUpperCase();
        if (!isValidInvoiceRegNo(n)) return json({ valid: false, reason: 'format' }, 200, origin);
        // 本番：fetch(`https://web-api.invoice-kohyo.nta.go.jp/...?id=${env.NTA_WEBAPI_ID}&number=${n.slice(1)}`)
        return json({ valid: true, number: n, source: 'format-check (本番は国税庁公表サイトWeb-APIで実在照合)' }, 200, origin);
      }

      // --- Square Webhook（決済結果の非同期反映。署名検証は本番で実装）---
      if (path === '/api/webhooks/square' && request.method === 'POST') {
        const evt = await request.json().catch(() => ({}));
        // 本番：env.SQUARE_WEBHOOK_KEY で x-square-hmacsha256-signature を検証
        const type = evt?.type || 'unknown';
        return json({ received: true, type }, 200, origin);
      }

      return json({ error: 'not found', path }, 404, origin);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500, origin);
    }
  },
};
