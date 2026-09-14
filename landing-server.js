// Köylü Dostu açılış sayfası (koyludostu.com) için AYRI, minik bir servis.
// Bilerek ana uygulamadan (serve.js, data/*.json) tamamen bağımsız: kendi portu,
// kendi veri dizini var — pazarlama/ön kayıt verisi gerçek kullanıcı hesaplarıyla
// (data/users.json) hiçbir şekilde karışmaz, aynı süreci de paylaşmaz.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.LANDING_PORT || 3011;
const DATA_DIR = process.env.LANDING_DATA_DIR || path.join(__dirname, 'landing-data');
const DATA_PATH = path.join(DATA_DIR, 'preregistrations.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, '[]');

function readAll() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { return []; }
}
function writeAll(list) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2));
}

// ---------- IP başına basit hız sınırlaması (spam/otomatik gönderime karşı) ----------
const attemptMap = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
function isRateLimited(ip) {
  const entry = attemptMap.get(ip);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) return false;
  return entry.count >= MAX_PER_WINDOW;
}
function recordAttempt(ip) {
  const now = Date.now();
  const entry = attemptMap.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attemptMap.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of attemptMap) {
    if (now - entry.windowStart > WINDOW_MS) attemptMap.delete(k);
  }
}, 10 * 60 * 1000).unref();

function isValidEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function isValidTrPhone(s) {
  const digits = String(s || '').replace(/\D/g, '').replace(/^90/, '').replace(/^0/, '');
  return /^5\d{9}$/.test(digits);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10_000) { reject(new Error('İstek çok büyük')); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  try {
    if (url.pathname === '/api/preregister/count' && req.method === 'GET') {
      return json(res, 200, { count: readAll().length });
    }

    if (url.pathname === '/api/preregister' && req.method === 'POST') {
      if (isRateLimited(ip)) return json(res, 429, { error: 'Çok fazla deneme. Lütfen biraz sonra tekrar dene.' });
      recordAttempt(ip);

      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 80);
      const contactRaw = String(body.contact || '').trim().slice(0, 120);
      if (name.length < 2) return json(res, 400, { error: 'Lütfen adını gir.' });
      const isEmail = contactRaw.includes('@');
      if (isEmail && !isValidEmail(contactRaw)) return json(res, 400, { error: 'Geçerli bir e-posta adresi gir.' });
      if (!isEmail && !isValidTrPhone(contactRaw)) return json(res, 400, { error: 'Geçerli bir e-posta ya da telefon numarası gir.' });

      const list = readAll();
      const normalizedContact = contactRaw.toLowerCase();
      if (list.some((r) => r.contact.toLowerCase() === normalizedContact)) {
        return json(res, 200, { ok: true, alreadyRegistered: true, count: list.length });
      }
      list.push({
        id: 'pr_' + crypto.randomBytes(8).toString('hex'),
        name,
        contact: contactRaw,
        contactType: isEmail ? 'email' : 'phone',
        createdAt: new Date().toISOString(),
        ip,
      });
      writeAll(list);
      return json(res, 200, { ok: true, count: list.length });
    }

    json(res, 404, { error: 'Bulunamadı' });
  } catch (e) {
    json(res, 500, { error: 'Bir şeyler ters gitti.' });
  }
});

server.listen(PORT, () => {
  console.log(`Köylü Dostu ön kayıt servisi http://localhost:${PORT} üzerinde (veri: ${DATA_PATH})`);
});
