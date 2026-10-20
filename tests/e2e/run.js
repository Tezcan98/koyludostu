// E2E koşucusu: testlerden önce/sonra depo ve geçici klasör durumunu karşılaştırıp
// "her şey ilk haline döndü mü" kontrolünü yapar. Kullanım: npm run test:e2e
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.test.js')).map((f) => path.join('tests', 'e2e', f));

const repoState = () => execSync('git status --porcelain --untracked-files=all', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
const tmpLeftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('kd-test-data-') || n.startsWith('kd-e2e-'));

const repoBefore = repoState();
const tmpBefore = new Set(tmpLeftovers());

const res = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });

const repoAfter = repoState();
const newRepoChanges = repoAfter.filter((l) => !repoBefore.includes(l));
const newTmp = tmpLeftovers().filter((n) => !tmpBefore.has(n));

console.log('\n--- Temizlik kontrolü ---');
if (newRepoChanges.length) console.log('Depoda test kaynaklı yeni değişiklik:\n  ' + newRepoChanges.join('\n  '));
if (newTmp.length) console.log('Geçici klasörde kalan test dosyaları:\n  ' + newTmp.join('\n  '));
if (!newRepoChanges.length && !newTmp.length) console.log('Her şey ilk haline döndü: depo ve geçici klasörlerde test kalıntısı yok.');

process.exit(res.status || (newRepoChanges.length || newTmp.length ? 1 : 0));
