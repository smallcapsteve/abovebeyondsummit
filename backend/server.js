'use strict';
// Above & Beyond Summit — registration intake service.
// Reads secrets from config.json (kept only on the droplet, never in the repo).
// Receives POST /api/register, saves a local backup, forwards to the CRM,
// and sends custom Resend emails (organizer notification + applicant confirmation).
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const DIR = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const LOG = path.join(DIR, 'registrations.jsonl');

function post(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr), data = Buffer.from(JSON.stringify(bodyObj));
    const req = https.request({
      method: 'POST', hostname: u.hostname, port: 443, path: u.pathname + u.search,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers)
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(data); req.end();
  });
}

// Form-encoded POST (Stripe API uses application/x-www-form-urlencoded)
function formPost(urlStr, headers, fields) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr), data = Buffer.from(new URLSearchParams(fields).toString());
    const req = https.request({
      method: 'POST', hostname: u.hostname, port: 443, path: u.pathname + u.search,
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length }, headers)
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.write(data); req.end();
  });
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmt(v) {
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object') return v.map(o => esc(Object.values(o).filter(Boolean).join(' — '))).join('<br>');
    return esc(v.join(', '));
  }
  if (v && typeof v === 'object') return esc(Object.entries(v).map(([k, val]) => k + ': ' + val).join(', '));
  return esc(v);
}

const GOLD = '#c8a24c', DARK = '#111111';
function shell(inner) {
  return '<div style="background:#f4f4f5;padding:24px 0;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">' +
    '<tr><td style="background:' + DARK + ';padding:22px 28px;"><div style="color:#fff;font-size:20px;font-weight:700;letter-spacing:1px;">ABOVE &amp; BEYOND <span style="color:' + GOLD + ';">SUMMIT</span></div>' +
    '<div style="color:#9a9a9a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Mining · Investments · Opportunities</div></td></tr>' +
    '<tr><td style="padding:28px;">' + inner + '</td></tr>' +
    '<tr><td style="background:#fafafa;padding:18px 28px;border-top:1px solid #eee;color:#888;font-size:12px;">November 22–24, 2026 · Andaz Scottsdale Resort · Scottsdale, Arizona<br>Presented by theDeepDive.ca</td></tr></table></div>';
}

function confirmHtml(d, co) {
  const name = esc(d.name || '');
  const opening = co ? 'Thank you for your application to present at' : 'Thank you for your interest in';
  const body = co
    ? "We've received your application. Presenting spaces are limited and allocated by review — a member of our team will be in touch personally to discuss availability, fees, and next steps. Submitting this registers your interest; your place will be confirmed once our team follows up with you."
    : "We've received your registration. If you haven't completed payment for your delegate pass (US$750 per attendee), you can do so securely at <a href=\"https://abovebeyondsummit.com/payment.html\">abovebeyondsummit.com/payment.html</a> — your registration is complete once payment is processed. Registrations are subject to review; if we're unable to accommodate you, your payment will be refunded in full.";
  return shell(
    '<p style="font-size:16px;margin:0 0 16px;">' + (name ? 'Hi ' + name + ',' : 'Hello,') + '</p>' +
    '<p style="font-size:15px;line-height:1.6;margin:0 0 16px;">' + opening + ' the <strong>Above &amp; Beyond Summit</strong>. ' + body + '</p>' +
    '<div style="background:#faf6ec;border-left:3px solid ' + GOLD + ';padding:14px 16px;margin:20px 0;font-size:14px;"><strong>Preferred hotel rate:</strong> $249/night (including resort fee, plus applicable taxes) at Andaz Scottsdale Resort, reserved for our delegates.</div>' +
    '<p style="font-size:15px;line-height:1.6;margin:0 0 4px;">We look forward to connecting with you.</p><p style="font-size:15px;margin:0;">— The Above &amp; Beyond Summit Team</p>'
  );
}

function notifyHtml(d, co) {
  const rows = Object.entries(d).filter(([k]) => !['_honey', 'conference_id', 'source'].includes(k))
    .map(([k, v]) => '<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;font-size:13px;vertical-align:top;">' + esc(k) + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;">' + fmt(v) + '</td></tr>').join('');
  return shell('<p style="font-size:16px;margin:0 0 6px;font-weight:700;">New ' + (co ? 'Company Application' : 'Investor Registration') + '</p><p style="font-size:13px;color:#888;margin:0 0 18px;">Submitted ' + esc(d.submitted_at || '') + '</p><table width="100%" style="border-collapse:collapse;">' + rows + '</table>');
}

function sendEmail(to, subject, html, replyTo) {
  return post('https://api.resend.com/emails', { 'Authorization': 'Bearer ' + cfg.resendKey }, { from: cfg.fromEmail, to: [to], subject: subject, html: html, reply_to: replyTo });
}

// Stripe Checkout: creates a session for the US$750 delegate pass.
// Promo codes (SUMMIT250/500/750) are entered on the Stripe-hosted page.
// Flip cfg.stripeTax to true in config.json once AZ tax registration is done.
const STRIPE_PRICE = 'price_1U2bXSK5aG5XdzTWLTBJszHJ';
async function handleCheckout(d, res) {
  const qty = Math.max(1, Math.min(20, parseInt(d.quantity, 10) || 1));
  const site = cfg.siteUrl || 'https://abovebeyondsummit.com';
  const fields = {
    'mode': 'payment',
    'line_items[0][price]': cfg.stripePrice || STRIPE_PRICE,
    'line_items[0][quantity]': String(qty),
    'line_items[0][adjustable_quantity][enabled]': 'true',
    'line_items[0][adjustable_quantity][minimum]': '1',
    'line_items[0][adjustable_quantity][maximum]': '20',
    'allow_promotion_codes': 'true',
    'automatic_tax[enabled]': cfg.stripeTax ? 'true' : 'false',
    'success_url': site + '/payment-success.html?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url': site + '/payment.html'
  };
  if (d.email) fields['customer_email'] = String(d.email).slice(0, 200);
  try {
    const r = await formPost('https://api.stripe.com/v1/checkout/sessions',
      { 'Authorization': 'Basic ' + Buffer.from(cfg.stripeKey + ':').toString('base64') }, fields);
    const s = JSON.parse(r.body);
    if (r.status >= 200 && r.status < 300 && s.url) { res.writeHead(200); return res.end(JSON.stringify({ url: s.url })); }
    console.error('stripe', r.status, r.body.slice(0, 500));
    res.writeHead(502); return res.end(JSON.stringify({ error: 'Could not start checkout. Please try again or contact us.' }));
  } catch (e) {
    console.error('stripeErr', e);
    res.writeHead(502); return res.end(JSON.stringify({ error: 'Could not start checkout. Please try again or contact us.' }));
  }
}

http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const isRegister = req.url.startsWith('/api/register'), isCheckout = req.url.startsWith('/api/checkout');
  if (req.method !== 'POST' || (!isRegister && !isCheckout)) { res.writeHead(404); return res.end(JSON.stringify({ error: 'Not found' })); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 512000) req.destroy(); });
  req.on('end', async () => {
    let d;
    try { d = JSON.parse(body || '{}'); } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'Bad JSON' })); }
    if (isCheckout) return handleCheckout(d, res);
    if (d._honey) { res.writeHead(200); return res.end(JSON.stringify({ ok: true })); }
    if (!d.type || (!d.email && !d.organization)) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Missing required fields' })); }
    delete d._honey;
    d.conference_id = cfg.conferenceId;
    d.source = d.source || 'abovebeyondsummit.com';
    d.submitted_at = d.submitted_at || new Date().toISOString();
    const co = d.type === 'company';
    try { fs.appendFileSync(LOG, JSON.stringify(d) + '\n'); } catch (e) { console.error('log', e); }
    post(cfg.crmUrl, { 'X-API-Key': cfg.crmKey }, d).then(r => { if (r.status < 200 || r.status >= 300) console.error('CRM', r.status, r.body); }).catch(e => console.error('CRMerr', e));
    sendEmail(cfg.notifyEmail, 'New ' + (co ? 'Company Application' : 'Investor Registration') + ' — ' + (d.name || d.organization || 'Summit'), notifyHtml(d, co), d.email || cfg.replyTo).catch(e => console.error('notify', e));
    if (d.email) sendEmail(d.email, co ? 'We received your Above & Beyond Summit application' : 'We received your Above & Beyond Summit request', confirmHtml(d, co), cfg.replyTo).catch(e => console.error('confirm', e));
    res.writeHead(200); res.end(JSON.stringify({ ok: true }));
  });
}).listen(cfg.port || 4100, '127.0.0.1', () => console.log('abovebeyond-api on ' + (cfg.port || 4100)));
