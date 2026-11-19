// Spielt eine Runde der Liga: laedt das Spiel ohne Bild im Browser, laesst alle Cores spielen und schreibt die Ergebnisse nach data/.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { SAMPLE_CORES, assemble, coreHash, PLACE_POINTS } from '../engine/arena.mjs';

const ROOT = process.env.LEAGUE_ROOT || '.', DATA = 'data', force = process.argv.includes('--force');
const league = JSON.parse(fs.readFileSync(DATA + '/league.json', 'utf8'));
const subs = JSON.parse(fs.readFileSync(DATA + '/submissions.json', 'utf8'));
// Nur rechnen, wenn es neue Cores gibt oder die letzte Runde laenger her ist
const fresh = Object.values(subs).some(s => !s.played);
if (!force && !fresh && league.lastRun && Date.now() - Date.parse(league.lastRun) < (league.idleHours || 6) * 3600e3) { console.log('Nothing new, no round.'); process.exit(0); }

const cores = [];
for (const [k, src] of Object.entries(SAMPLE_CORES)) cores.push({ key: 'hexplanet/' + k, code: src, v: 1 });
for (const f of fs.readdirSync('cores').filter(f => f.endsWith('.hex')).sort()) {
  const login = f.slice(0, -4), src = fs.readFileSync('cores/' + f, 'utf8');
  if (assemble(src).errors.length) continue;
  cores.push({ key: login, code: src, v: (subs[login] && subs[login].v) || 1 });
}
const seed = (Number(process.env.GITHUB_RUN_ID || Date.now()) % 1e9) | 0;

// Kleiner Webserver fuer das Spiel
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\.\./g, '')); fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto('http://localhost:' + port + '/' + (process.env.LEAGUE_PAGE || 'index.html') + '?league=run');
await page.waitForFunction('window.__leagueReady === true', null, { timeout: 180000 });
console.log('Round with', cores.length, 'cores, seed', seed);
const res = await page.evaluate(a => window.hexLeagueRun(a), { cores: cores.map(c => ({ key: c.key, code: c.code })), seed });
await browser.close(); srv.close();
console.log('Ticks', res.ticks, 'in', res.ms, 'ms');

// Ergebnisse eintragen
const id = (league.n || 0) + 1, at = new Date().toISOString();
league.n = id; league.lastRun = at; league.table = league.table || {}; league.cores = league.cores || [];
const results = res.results.map(r => Object.assign({ points: (PLACE_POINTS[r.place - 1] || 0) + r.kills }, r));
for (const r of results) {
  const t = league.table[r.key] || (league.table[r.key] = { rounds: 0, wins: 0, points: 0, kills: 0, surv: 0 });
  t.rounds++; t.wins += r.place === 1 && r.alive ? 1 : 0; t.points += r.points; t.kills += r.kills; t.surv += r.survived;
}
// Alle Cores dieser Runde werden oeffentlich
for (const c of cores) {
  const asm = assemble(c.code), hash = coreHash(c.code);
  let e = league.cores.find(x => x.key === c.key); if (!e) { e = { key: c.key, versions: [] }; league.cores.push(e); }
  if (!e.versions.some(v => v.hash === hash)) e.versions.push({ v: c.v, name: asm.meta.name, author: asm.meta.author, motive: asm.meta.motive, goal: asm.meta.goal, hash, played: true, src: c.code, round: id });
  if (subs[c.key]) subs[c.key].played = true;
}
league.rounds = [{ id, seed, ticks: res.ticks, at, results }].concat(league.rounds || []).slice(0, 50);
league.pending = [];
fs.writeFileSync(DATA + '/rounds/' + id + '.json', JSON.stringify({ id, seed, ticks: res.ticks, at, order: cores.map(c => ({ key: c.key, v: c.v, src: c.code })), results, log: res.log }));
fs.writeFileSync(DATA + '/league.json', JSON.stringify(league, null, 1));
fs.writeFileSync(DATA + '/submissions.json', JSON.stringify(subs, null, 1));
// alte Rundendateien aufraeumen
for (const f of fs.readdirSync(DATA + '/rounds')) { const n = parseInt(f); if (n && n <= id - 50) fs.unlinkSync(DATA + '/rounds/' + f); }
console.log(results.map(r => r.place + '. ' + r.name + (r.alive ? ' (alive)' : ' died ' + r.cause)).join('\n'));
