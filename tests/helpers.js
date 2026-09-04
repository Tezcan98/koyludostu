// Test yardımcıları: her test dosyası kendi serve.js sürecini, kendi geçici
// KD_DATA_DIR'ıyla başlatır. Gerçek data/*.json dosyalarına ASLA dokunulmaz.
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-admin-pw';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(baseUrl + '/index.html');
      if (r.ok) return;
    } catch {
      // henüz ayakta değil, tekrar dene
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Sunucu zaman aşımında ayağa kalkmadı: ' + baseUrl);
}

async function startServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-test-data-'));
  const child = spawn(process.execPath, ['serve.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      KD_DATA_DIR: dataDir,
      ADMIN_PASSWORD,
    },
    stdio: 'ignore',
  });

  const baseUrl = `http://localhost:${port}`;
  await waitForServer(baseUrl, 8000);

  return {
    baseUrl,
    dataDir,
    adminPassword: ADMIN_PASSWORD,
    async stop() {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

let seq = 0;
// Her çağrıda benzersiz bir test telefon numarası üretir (5xx xxx xx xx formatında,
// gerçek/örnek kullanıcı numaralarıyla asla çakışmaz).
function nextTestPhone() {
  seq += 1;
  return '555' + String(1000000 + seq).slice(-7);
}

async function registerUser(baseUrl, { name, city, district, neighborhood, password, role, phone, businessInfo }) {
  const reg = await fetch(baseUrl + '/api/auth/register-start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, city, district: district || 'Test İlçe', neighborhood: neighborhood || '',
      password, role, termsAccepted: true, businessInfo,
    }),
  }).then((r) => r.json());

  await fetch(baseUrl + '/api/auth/request-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });

  const ver = await fetch(baseUrl + '/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '0000', regToken: reg.regToken }),
  }).then((r) => r.json());

  if (!ver.token) throw new Error('Test kullanıcısı oluşturulamadı: ' + JSON.stringify(ver));
  return { token: ver.token, phone, user: ver.user };
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function ownerLogin(baseUrl, password) {
  const r = await fetch(baseUrl + '/api/owner/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((r) => r.json());
  if (!r.token) throw new Error('Owner girişi başarısız: ' + JSON.stringify(r));
  return r.token;
}

// Testlerde gerçek bir fotoğraf gerekmediğinde kullanılan 1x1 şeffaf PNG.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_PDF_DATA_URL =
  'data:application/pdf;base64,' + Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>').toString('base64');

module.exports = {
  startServer, registerUser, authHeaders, ownerLogin, nextTestPhone,
  TINY_PNG_DATA_URL, TINY_PDF_DATA_URL,
};
