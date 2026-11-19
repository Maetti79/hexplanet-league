import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));   // erst die Seite zeigen, dann die Welt bauen

/* ============================================================
   Hex-Planet Prototyp
   Welt = Kugel aus krummen Hex-Zellen. Je rund 36 Zellen bilden ein Feld.
   Zustand pro Zelle: Hoehe, Material, Farbe, Wasser.
   ============================================================ */

const TAU = Math.PI * 2;
const HASH = (location.hash || '').replace('#', '');
const N = HASH === 'small' ? 42 : HASH === 'medium' ? 96 : 222;   // Teilung der Kugel, durch 6 teilbar (6x6 Zellen je Feld)
const BIG = N > 42;
const HS = N / 42;                    // mehr Zellen, mehr Hoehenstufen
const KS = Math.PI * 2 * 100 / (5 * N) / 3;   // Massstab kleiner Dinge relativ zur Zellgroesse
const R = 100;
const CELLW = TAU * R / (5 * N);
const LAYER = CELLW * 0.26;
const GS = CELLW * 0.105;            // Massstab der Wichte: ein Wicht ist gut ein Fuenftel einer Zelle hoch
const HOUSESC = [0.30, 0.42, 0.60, 0.62, 0.95, 0.95, 0.95];   // Massstab je Hausstufe, in Zellbreiten
const BIGTIER = 4;                   // ab hier belegt ein Haus sieben Bauflaechen
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

function hashI(i, s) {
  let x = Math.imul(i + 0x7ed55d16, 0x9e3779b1) ^ Math.imul(s + 1, 0x85ebca6b);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
function h3(x, y, z, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = h3(xi, yi, zi, s), b = h3(xi + 1, yi, zi, s), c = h3(xi, yi + 1, zi, s), d = h3(xi + 1, yi + 1, zi, s);
  const e = h3(xi, yi, zi + 1, s), f = h3(xi + 1, yi, zi + 1, s), g = h3(xi, yi + 1, zi + 1, s), k = h3(xi + 1, yi + 1, zi + 1, s);
  const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (k - g) * fx;
  const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
  return (y1 + (y2 - y1) * fz) * 2 - 1;
}
function fbm(x, y, z, s, o) {
  let a = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < o; i++) { a += vnoise(x * f, y * f, z * f, s + i) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return a / n;
}

/* ---------------- Gitter: unterteiltes Ikosaeder, Zellen = Ecken ---------------- */
function buildGrid(n) {
  const t = (1 + Math.sqrt(5)) / 2;
  const iv = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // Nummern: 12 Ecken, dann 30 Kanten, dann 20 Flaechen
  const edgeIdx = new Map(), edges = [];
  for (const f of faces) for (const e of [[f[0], f[1]], [f[1], f[2]], [f[0], f[2]]]) { const lo = Math.min(e[0], e[1]), hi = Math.max(e[0], e[1]); if (!edgeIdx.has(lo * 12 + hi)) { edgeIdx.set(lo * 12 + hi, edges.length); edges.push([lo, hi]); } }
  const E0 = 12, F0 = 12 + 30 * (n - 1), perFace = (n - 1) * (n - 2) / 2, nc = F0 + 20 * perFace;
  const X = new Float64Array(nc), Y = new Float64Array(nc), Z = new Float64Array(nc), isCenter = new Uint8Array(nc);
  const put = (id, x, y, z) => { const l = Math.hypot(x, y, z); X[id] = x / l; Y[id] = y / l; Z[id] = z / l; };
  for (let v = 0; v < 12; v++) { put(v, iv[v][0], iv[v][1], iv[v][2]); isCenter[v] = 1; }
  edges.forEach((e, ei) => { const a = iv[e[0]], b = iv[e[1]]; for (let w = 1; w < n; w++) { const id = E0 + ei * (n - 1) + w - 1; put(id, a[0] * w + b[0] * (n - w), a[1] * w + b[1] * (n - w), a[2] * w + b[2] * (n - w)); isCenter[id] = w % 6 === 0 ? 1 : 0; } });
  const rowStart = new Int32Array(n + 1); { let acc = 0; for (let i = 1; i <= n - 2; i++) { rowStart[i] = acc; acc += n - 1 - i; } }
  for (let f = 0; f < 20; f++) {
    const A = iv[faces[f][0]], B = iv[faces[f][1]], Cv = iv[faces[f][2]];
    for (let i = 1; i <= n - 2; i++) for (let j = 1; j <= n - 1 - i; j++) {
      const k = n - i - j, id = F0 + f * perFace + rowStart[i] + j - 1;
      put(id, A[0] * i + B[0] * j + Cv[0] * k, A[1] * i + B[1] * j + Cv[1] * k, A[2] * i + B[2] * j + Cv[2] * k); isCenter[id] = i % 6 === 0 && j % 6 === 0 ? 1 : 0;
    }
  }
  const eid = (a, wa, b) => { const lo = a < b ? a : b, hi = a < b ? b : a; return E0 + edgeIdx.get(lo * 12 + hi) * (n - 1) + (a < b ? wa : n - wa) - 1; };
  function vid(f, i, j) {
    const A = faces[f][0], B = faces[f][1], Cv = faces[f][2], k = n - i - j;
    if (i === n) return A; if (j === n) return B; if (k === n) return Cv;
    if (k === 0) return eid(A, i, B); if (i === 0) return eid(B, j, Cv); if (j === 0) return eid(A, i, Cv);
    return F0 + f * perFace + rowStart[i] + j - 1;
  }
  const nt = 20 * n * n, tv = new Int32Array(nt * 3); let tq = 0;
  for (let f = 0; f < 20; f++) for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
    const a = vid(f, i, j), b = vid(f, i + 1, j), c = vid(f, i, j + 1);
    tv[tq++] = a; tv[tq++] = b; tv[tq++] = c;
    if (i + j < n - 1) { tv[tq++] = b; tv[tq++] = vid(f, i + 1, j + 1); tv[tq++] = c; }
  }
  const vn = new Int32Array(nc * 6), vnc = new Uint8Array(nc), vt = new Int32Array(nc * 6), vtc = new Uint8Array(nc);
  const link = (a, b) => { const o = a * 6; for (let q = 0; q < vnc[a]; q++) if (vn[o + q] === b) return; vn[o + vnc[a]++] = b; };
  for (let q = 0; q < nt; q++) {
    const a = tv[q * 3], b = tv[q * 3 + 1], c = tv[q * 3 + 2];
    vt[a * 6 + vtc[a]++] = q; vt[b * 6 + vtc[b]++] = q; vt[c * 6 + vtc[c]++] = q;
    link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
  }
  // Glaetten: gleichmaessigere Zellgroessen
  const X2 = new Float64Array(nc), Y2 = new Float64Array(nc), Z2 = new Float64Array(nc);
  for (let it = 0; it < 20; it++) {
    for (let v = 0; v < nc; v++) {
      let x = 0, y = 0, z = 0; const m = vnc[v], o = v * 6;
      for (let q = 0; q < m; q++) { const w = vn[o + q]; x += X[w]; y += Y[w]; z += Z[w]; }
      x = X[v] * 0.4 + x / m * 0.6; y = Y[v] * 0.4 + y / m * 0.6; z = Z[v] * 0.4 + z / m * 0.6;
      const l = Math.hypot(x, y, z); X2[v] = x / l; Y2[v] = y / l; Z2[v] = z / l;
    }
    X.set(X2); Y.set(Y2); Z.set(Z2);
  }
  const cdir = new Float32Array(nc * 3);
  for (let v = 0; v < nc; v++) { cdir[v * 3] = X[v]; cdir[v * 3 + 1] = Y[v]; cdir[v * 3 + 2] = Z[v]; }
  // Ecken der Zellen = Schwerpunkte der Dreiecke, mit festem Zufallsversatz
  const cbase = new Float32Array(nt * 3), coff = new Float32Array(nt * 3), triCells = tv;
  const edgeAng = (TAU * 100 / (5 * n) / Math.sqrt(3)) / 100;
  for (let q = 0; q < nt; q++) {
    const a = tv[q * 3], b = tv[q * 3 + 1], c = tv[q * 3 + 2];
    let x = X[a] + X[b] + X[c], y = Y[a] + Y[b] + Y[c], z = Z[a] + Z[b] + Z[c];
    const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
    cbase[q * 3] = x; cbase[q * 3 + 1] = y; cbase[q * 3 + 2] = z;
    const ax = Math.abs(x) < 0.8 ? 1 : 0, ay = ax ? 0 : 1;
    let e1x = ay * z, e1y = -ax * z, e1z = ax * y - ay * x;
    const l1 = Math.hypot(e1x, e1y, e1z); e1x /= l1; e1y /= l1; e1z /= l1;
    const e2x = y * e1z - z * e1y, e2y = z * e1x - x * e1z, e2z = x * e1y - y * e1x;
    const ang = hashI(q, 11) * TAU, mag = edgeAng * 0.34 * (0.45 + 0.55 * hashI(q, 12)), ca = Math.cos(ang) * mag, sa = Math.sin(ang) * mag;
    coff[q * 3] = e1x * ca + e2x * sa; coff[q * 3 + 1] = e1y * ca + e2y * sa; coff[q * 3 + 2] = e1z * ca + e2z * sa;
  }
  // Ring je Zelle ordnen
  const ncnt = new Uint8Array(nc), cellCorner = new Int32Array(nc * 6), cellNb = new Int32Array(nc * 6).fill(-1);
  const rq = new Int32Array(6), ra = new Float64Array(6);
  for (let v = 0; v < nc; v++) {
    const x = X[v], y = Y[v], z = Z[v];
    const ax = Math.abs(x) < 0.8 ? 1 : 0, ay = ax ? 0 : 1;
    let e1x = ay * z, e1y = -ax * z, e1z = ax * y - ay * x;
    const l1 = Math.hypot(e1x, e1y, e1z); e1x /= l1; e1y /= l1; e1z /= l1;
    const e2x = y * e1z - z * e1y, e2y = z * e1x - x * e1z, e2z = x * e1y - y * e1x;
    const m = vtc[v];
    for (let i = 0; i < m; i++) {
      const q = vt[v * 6 + i], a = Math.atan2(cbase[q * 3] * e2x + cbase[q * 3 + 1] * e2y + cbase[q * 3 + 2] * e2z, cbase[q * 3] * e1x + cbase[q * 3 + 1] * e1y + cbase[q * 3 + 2] * e1z);
      let j = i; while (j > 0 && ra[j - 1] > a) { ra[j] = ra[j - 1]; rq[j] = rq[j - 1]; j--; }
      ra[j] = a; rq[j] = q;
    }
    ncnt[v] = m;
    for (let k = 0; k < 6; k++) cellCorner[v * 6 + k] = rq[k < m ? k : 0];
    for (let k = 0; k < m; k++) {
      const q1 = rq[k], q2 = rq[(k + 1) % m];
      for (let a = 0; a < 3; a++) {
        const o = tv[q1 * 3 + a]; if (o === v) continue;
        if (tv[q2 * 3] === o || tv[q2 * 3 + 1] === o || tv[q2 * 3 + 2] === o) { cellNb[v * 6 + k] = o; break; }
      }
    }
  }
  // Felder: jede Zelle gehoert zum naechsten Feldmittelpunkt (Breitensuche)
  const fieldOf = new Int32Array(nc).fill(-1), queue = new Int32Array(nc); let qh = 0, qt = 0, nf = 0;
  for (let v = 0; v < nc; v++) if (isCenter[v]) { fieldOf[v] = nf++; queue[qt++] = v; }
  const fieldCenter = new Int32Array(nf); for (let i = 0; i < nf; i++) fieldCenter[i] = queue[i];
  while (qh < qt) {
    const v = queue[qh++];
    for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (fieldOf[o] < 0) { fieldOf[o] = fieldOf[v]; queue[qt++] = o; } }
  }
  const fieldStart = new Int32Array(nf + 1), fieldCells = new Int32Array(nc);
  for (let v = 0; v < nc; v++) fieldStart[fieldOf[v] + 1]++;
  for (let f = 0; f < nf; f++) fieldStart[f + 1] += fieldStart[f];
  { const fill = fieldStart.slice(0, nf); for (let v = 0; v < nc; v++) fieldCells[fill[fieldOf[v]]++] = v; }
  return { nc, nt, cdir, cbase, coff, triCells, ncnt, cellCorner, cellNb, fieldOf, fieldCenter, fieldStart, fieldCells };
}

const G = buildGrid(N);
const NC = G.nc, NT = G.nt;
const { cdir, cbase, coff, triCells, ncnt, cellCorner, cellNb, fieldOf, fieldCenter, fieldStart, fieldCells } = G;
const NF = fieldCenter.length;
// Nur Felder in der Naehe der Kamera liegen als volle Zellen auf der Grafikkarte. Der Rest der Kugel ist ein grobes Netz, ein Sechseck je Feld.
let BLOCK = 0; for (let f = 0; f < NF; f++) BLOCK = Math.max(BLOCK, fieldStart[f + 1] - fieldStart[f]);
const NEARF = Math.min(NF, 2700), SLOTS = NEARF * BLOCK, ALLNEAR = NEARF === NF;
const slotOf = new Int32Array(NC).fill(-1), fieldBlock = new Int32Array(NF).fill(-1);
const freeBlocks = []; for (let i = NEARF - 1; i >= 0; i--) freeBlocks.push(i);
const NEAR_RMAX = ALLNEAR ? 4 : Math.acos(1 - 2 * NEARF * 0.86 / NF);

/* ---------------- Materialien ---------------- */
const SEABED = 0, SAND = 1, GRASS = 2, FOREST = 3, ROCK = 4, SNOW = 5, DIRT = 6, CONCRETE = 7, PLAZA = 8, LAVA = 9;
const MCOL = [[0.80, 0.74, 0.54], [0.93, 0.84, 0.60], [0.50, 0.74, 0.34], [0.33, 0.60, 0.30], [0.58, 0.57, 0.58], [0.95, 0.96, 0.99], [0.60, 0.45, 0.30], [0.82, 0.82, 0.80], [0.88, 0.76, 0.62], [0.15, 0.10, 0.09]];
const WCOL = [[0.74, 0.66, 0.47], [0.82, 0.72, 0.50], [0.68, 0.62, 0.55], [0.64, 0.58, 0.52], [0.62, 0.60, 0.58], [0.66, 0.66, 0.70], [0.62, 0.50, 0.38], [0.74, 0.74, 0.72], [0.70, 0.60, 0.50], [0.20, 0.13, 0.11]];
const LAVAFAR = [1.5, 0.5, 0.12];
const ROUGH = [0.9, 0.85, 1.0, 1.0, 1.15, 0.85, 1.0, 0.03, 0.2, 1.1];
const PALETTE = [[0.90, 0.30, 0.26], [0.98, 0.72, 0.20], [0.24, 0.52, 0.86], [0.96, 0.96, 0.94], [0.20, 0.20, 0.24], [0.76, 0.38, 0.78]];
const PALNAMES = ['Red', 'Yellow', 'Blue', 'White', 'Black', 'Purple'];

const H = new Int8Array(NC), ORIG = new Int8Array(NC), MAT = new Uint8Array(NC), PAINT = new Int8Array(NC).fill(-1);
const W = new Float32Array(NC), DW = new Float32Array(NC), LASTW = new Float32Array(NC).fill(-9);
const SH = new Int8Array(NC), SH2 = new Int8Array(NC);   // Abstand zum Ufer in Zellen, nur fuer das Meer
const OCEAN = new Uint8Array(NC), CONT = new Int8Array(NC);
let springs = [];
const refuges = [];
for (let c = 0; c < NC; c++) if (ncnt[c] === 5) refuges.push(c);

const CONTC = [[1, 0.35, 0.2], [-0.5, 0.3, 0.85], [-0.45, -0.4, -0.8]].map(v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
const CONTR = [0.66, 0.58, 0.62];
const CONTNAME = ['Waldland', 'Bergland', 'Flachland'];

function genWorld() {
  PAINT.fill(-1); W.fill(0); OCEAN.fill(0);
  for (let c = 0; c < NC; c++) {
    const x = cdir[c * 3], y = cdir[c * 3 + 1], z = cdir[c * 3 + 2];
    const warp = fbm(x * 2.2 + 5, y * 2.2, z * 2.2, 3, 3) * 0.3;
    let m = 0, cid = -1;
    for (let i = 0; i < 3; i++) {
      const ang = Math.acos(clamp(x * CONTC[i][0] + y * CONTC[i][1] + z * CONTC[i][2], -1, 1)) + warp;
      const mi = 1 - smooth(CONTR[i] * 0.5, CONTR[i] * 1.12, ang);
      if (mi > m) { m = mi; cid = i; }
    }
    let f = (m - 0.5) * 1.9 + fbm(x * 4, y * 4, z * 4, 20, 4) * 0.4;
    const isl = smooth(0.42, 0.7, vnoise(x * 7 + 11, y * 7, z * 7, 40)) * (1 - smooth(0.0, 0.35, m)) * 1.1;
    f += isl;
    if (m < 0.12) cid = -1;
    CONT[c] = cid;
    let hh;
    if (f < 0) hh = -1 - Math.floor(Math.min(5 * HS, -f * 6 * HS));
    else {
      let e = f;
      if (cid === 0) e *= 0.8;
      else if (cid === 1) { const rd = 1 - Math.abs(vnoise(x * 6, y * 6, z * 6, 60)); e = e * 0.7 + rd * rd * e * 1.3; }
      else if (cid === 2) e *= 0.42;
      else e *= 0.6;
      hh = Math.min(Math.round(14 * HS), Math.floor(e * 7 * HS));
    }
    H[c] = hh;
  }
  for (const c of refuges) {
    if (H[c] < 1) H[c] = 1;
    for (let k = 0; k < 5; k++) { const o = cellNb[c * 6 + k]; if (H[o] < 0) H[o] = 0; }
  }
  // Strand: flaches Land am Meer wird abgesenkt und sandig, dahinter ein zweiter, lueckiger Streifen
  const beach = new Uint8Array(NC);
  for (let c = 0; c < NC; c++) if (H[c] >= 0 && H[c] <= 1.6 * HS) for (let k = 0; k < ncnt[c]; k++) if (H[cellNb[c * 6 + k]] < 0) { beach[c] = 1; break; }
  for (let c = 0; c < NC; c++) if (H[c] >= 0 && !beach[c] && H[c] <= 2.2 * HS && hashI(c, 61) < 0.65) for (let k = 0; k < ncnt[c]; k++) if (beach[cellNb[c * 6 + k]] === 1) { beach[c] = 2; break; }
  for (let c = 0; c < NC; c++) if (beach[c]) H[c] = Math.min(H[c], beach[c]);
  for (let c = 0; c < NC; c++) {
    const x = cdir[c * 3], y = cdir[c * 3 + 1], z = cdir[c * 3 + 2], hh = H[c], cid = CONT[c];
    let mt;
    if (hh < 0) mt = SEABED;
    else if (hh === 0) mt = SAND;
    else if (hh >= 11 * HS) mt = SNOW;
    else if (hh >= 8 * HS) mt = ROCK;
    else {
      mt = GRASS;
      const fb = cid === 0 ? 0.42 : cid === 1 ? -0.05 : cid === 2 ? -0.32 : -0.1;
      const dn = vnoise(x * 4.5 + 31, y * 4.5, z * 4.5, 130) > 0.22;      // dichter Wald: geschlossen und dunkel
      if (vnoise(x * 8 + 7, y * 8, z * 8, 80) + fb + (dn ? (cid === 2 ? 0.3 : 0.75) : 0) > 0.12) mt = FOREST;
      if (cid === 2 && hh < 3 * HS && vnoise(x * 5 + 3, y * 5, z * 5, 90) > 0.38) mt = SAND;
      let drop = 0; for (let k = 0; k < ncnt[c]; k++) drop = Math.max(drop, hh - H[cellNb[c * 6 + k]]);
      if (drop >= CLIFF + 2) mt = ROCK;
    }
    if (beach[c] && hh >= 0) mt = SAND;
    MAT[c] = mt; ORIG[c] = hh;
  }
  for (const c of refuges) MAT[c] = PLAZA;
  placeNpcs();
  springs = [];
  let cand = 0; for (let c = 0; c < NC; c++) if (H[c] >= 3 * HS && H[c] <= 7 * HS) cand++;
  const p = Math.round(15 * HS) / Math.max(1, cand);
  for (let c = 0; c < NC; c++) if (H[c] >= 3 * HS && H[c] <= 7 * HS && npcAt[c] < 0 && hashI(c, 31) < p) springs.push(c);
}

// Ein Haendler auf jeder grossen Landflaeche
let npcs = [];
const market = new Uint8Array(NC);
const npcAt = new Int16Array(NC).fill(-1);
const NPCNAMES = ['Marta', 'Tack', 'Grob', 'Wynn', 'Odalie', 'Brisk', 'Hemma', 'Pell'];
function placeNpcs() {
  npcs = []; npcAt.fill(-1);
  const comp = new Int32Array(NC).fill(-1), q = new Int32Array(NC), comps = [];
  for (let c0 = 0; c0 < NC; c0++) {
    if (H[c0] < 0 || comp[c0] >= 0) continue;
    let qh = 0, qt = 0, sx = 0, sy = 0, sz = 0; const id = comps.length; q[qt++] = c0; comp[c0] = id;
    while (qh < qt) {
      const v = q[qh++]; sx += cdir[v * 3]; sy += cdir[v * 3 + 1]; sz += cdir[v * 3 + 2];
      for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (H[o] >= 0 && comp[o] < 0) { comp[o] = id; q[qt++] = o; } }
    }
    const l = Math.hypot(sx, sy, sz) || 1; comps.push({ id, size: qt, x: sx / l, y: sy / l, z: sz / l });
  }
  const big = comps.filter(c => c.size >= Math.max(120, NC * 0.004)).sort((a, b) => b.size - a.size).slice(0, 8);
  for (const cp of big) {
    let best = -1, bd = -9;
    for (let pass = 0; pass < 2 && best < 0; pass++) for (let f = 0; f < NF; f++) {
      const c = fieldCenter[f]; if (comp[c] !== cp.id || H[c] < 1 || ncnt[c] === 5) continue;
      if (pass === 0) { if (H[c] > 5 * HS) continue; let low = false; for (let k = 0; k < ncnt[c]; k++) if (H[cellNb[c * 6 + k]] < H[c]) low = true; if (!low) continue; }
      const d = cdir[c * 3] * cp.x + cdir[c * 3 + 1] * cp.y + cdir[c * 3 + 2] * cp.z; if (d > bd) { bd = d; best = c; }
    }
    if (best < 0) continue;
    npcAt[best] = npcs.length; npcs.push({ cell: best, name: NPCNAMES[npcs.length % NPCNAMES.length], size: cp.size });
    MAT[best] = PLAZA;
  }
  // Marktplatz: drei Zellen um jeden Stand bleiben, wie sie sind, damit niemand den Haendler auf eine Saeule graebt
  market.fill(0);
  for (const n of npcs) {
    const q = [n.cell], d = new Map([[n.cell, 0]]);
    while (q.length) { const v = q.shift(), dv = d.get(v); market[v] = 1; if (dv >= 3) continue; for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (!d.has(o) && H[o] >= 0) { d.set(o, dv + 1); q.push(o); } } }
  }
}

function floodOcean() {
  OCEAN.fill(0);
  const q = new Int32Array(NC); let qh = 0, qt = 0;
  for (let c = 0; c < NC; c++) if (H[c] <= -3) { OCEAN[c] = 1; q[qt++] = c; }
  while (qh < qt) {
    const v = q[qh++];
    for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (!OCEAN[o] && H[o] < 0) { OCEAN[o] = 1; q[qt++] = o; } }
  }
  oceanCount = 0;
  for (let c = 0; c < NC; c++) if (OCEAN[c]) { oceanCount++; W[c] = Math.max(0, seaLevel - H[c]); }
  if (!oceanCount) oceanCount = 1;
}

/* ---------------- Wasser: fliesst zum tieferen Nachbarn ---------------- */
const EVAP = 0.0009, SPRING = 0.065 * HS;
// Das Meer verliert kein Wasser: was Land verdraengt oder in Senken laeuft, hebt oder senkt den Spiegel ueberall.
let seaLevel = 0, oceanCount = 1, natural = 0, simLive = false;
const fl = new Float32Array(6);
function simStep() {
  DW.fill(0);
  for (let c = 0; c < NC; c++) {
    const wi = W[c]; if (wi <= 1e-4 || (OCEAN[c] && SH[c] >= 2)) continue;      // offenes Meer ruht
    const si = H[c] + wi, m = ncnt[c], b = c * 6; let tot = 0;
    for (let k = 0; k < m; k++) {
      const o = cellNb[b + k], d = si - (H[o] + W[o]);
      if (d > 0) { const f = Math.min(wi * 0.2 * (d < 1 ? d : 1), d / 7); fl[k] = f; tot += f; } else fl[k] = 0;
    }
    if (tot > 0) {
      const sc = tot > wi ? wi / tot : 1;
      for (let k = 0; k < m; k++) if (fl[k] > 0) { const f = fl[k] * sc; DW[c] -= f; DW[cellNb[b + k]] += f; }
    }
  }
  let net = 0;
  for (let c = 0; c < NC; c++) {
    if (OCEAN[c] && H[c] < seaLevel) { net += DW[c]; W[c] = seaLevel - H[c]; continue; }
    let v = W[c] + DW[c];
    if (v > 0) { v -= EVAP; if (v < 0) v = 0; }
    W[c] = v;
  }
  for (let i = 0; i < springs.length; i++) W[springs[i]] += SPRING;
  if (simLive) { natural += (net - natural) * 0.0005; seaLevel += (net - natural) / oceanCount; } else natural += (net - natural) * 0.05;
}

/* ---------------- Geometrie ---------------- */
// Gespielt wird auf Zellen mit ganzen Hoehenstufen. Gezeichnet wird eine weiche Flaeche: jede Ecke liegt auf dem Mittel
// der Zellen, die sich dort sanft treffen. Nur an steilen Spruengen, Beton, Farbe und Gebaeuden bleibt eine Kante stehen.
const VPC = 31;
const CLIFF = 6;
const P = new Float32Array(SLOTS * VPC * 3), C = new Float32Array(SLOTS * VPC * 3), MT = new Uint8Array(SLOTS * VPC);
const NRM = new Float32Array(SLOTS * VPC * 3), WT = new Uint8Array(SLOTS * VPC * 4);
const IDX = new Uint32Array(SLOTS * 54);
const LP = new Float32Array(SLOTS * 36);                 // Feldgrenzen
const WP = new Float32Array(SLOTS * 21), WD = new Float32Array(SLOTS * 7), WS = new Float32Array(SLOTS * 7);
const WIDX = new Uint32Array(SLOTS * 18);
for (let c = 0; c < SLOTS; c++) { const b = c * 7; let o = c * 18; for (let k = 0; k < 6; k++) { WIDX[o++] = b; WIDX[o++] = b + 1 + k; WIDX[o++] = b + 1 + (k + 1) % 6; } }
// Familie der Oberflaeche je Material: 0 Wiese, 1 Sand, 2 Fels, 3 Erde, -1 glatt
const FAM = [1, 1, 0, 0, 2, 1, 3, -1, 3, 2];
const CCOL = new Float32Array(NC * 3), CCV = new Uint8Array(NC);
const hardC = c => MAT[c] === CONCRETE || PAINT[c] >= 0 || BN[c] > 0;
const famOf = c => PAINT[c] >= 0 ? -1 : FAM[MAT[c]];
const linked = (a, b) => { const d = H[a] - H[b]; return d <= CLIFF && d >= -CLIFF && !hardC(a) && !hardC(b); };
const CMP = [0, 0, 0]; let cmpN = 0;
// Zellen um Ecke t, die mit c eine weiche Flaeche bilden (zusammenhaengend, also fuer alle Nachbarn gleich)
function compo(c, t) {
  const a = triCells[t * 3], b = triCells[t * 3 + 1], d = triCells[t * 3 + 2];
  const o1 = a === c ? b : a, o2 = a === c ? d : b === c ? d : b;
  const l1 = linked(c, o1), l2 = linked(c, o2), l12 = linked(o1, o2);
  CMP[0] = c; cmpN = 1;
  if (l1 || (l2 && l12)) CMP[cmpN++] = o1;
  if (l2 || (l1 && l12)) CMP[cmpN++] = o2;
}
function cornerH(c, t) { compo(c, t); let s = 0; for (let i = 0; i < cmpN; i++) s += H[CMP[i]]; return s / cmpN; }
function cellColor(c) {
  const hc = H[c], m = ncnt[c], mat = MAT[c], pi = PAINT[c], mc = pi >= 0 ? PALETTE[pi] : MCOL[mat];
  const v = (0.93 + 0.14 * hashI(c, 7)) * (hc < 0 ? 1 - 0.07 / HS * Math.min(-hc, 6 * HS) : 1);
  let tr = mc[0] * v, tg = mc[1] * v, tb = mc[2] * v;
  if (pi < 0 && (mat === GRASS || mat === FOREST)) {
    // Wiese: grosse Flecken von gelbgruen bis sattgruen, am Wasser frischer
    const x = cdir[c * 3], y = cdir[c * 3 + 1], z = cdir[c * 3 + 2];
    const g = clamp(fbm(x * 13 + 2, y * 13, z * 13, 300, 3) * 2.4, -1, 1), sun = g > 0 ? g * 0.6 : 0, deep = g < 0 ? -g * 0.6 : 0;
    let r0 = MCOL[GRASS][0], g0 = MCOL[GRASS][1], b0 = MCOL[GRASS][2];
    r0 += (0.74 - r0) * sun + (0.24 - r0) * deep; g0 += (0.80 - g0) * sun + (0.56 - g0) * deep; b0 += (0.30 - b0) * sun + (0.34 - b0) * deep;
    let wet = 0; for (let k = 0; k < m; k++) if (W[cellNb[c * 6 + k]] > 0.1) { wet = 1; break; }
    if (wet) { r0 += (0.30 - r0) * 0.45; g0 += (0.70 - g0) * 0.45; b0 += (0.32 - b0) * 0.45; }
    const j = 0.94 + 0.12 * hashI(c, 7), fo = mat === FOREST ? (denseAt(c) ? 0.62 : 0.78) : 1;
    tr = r0 * j * fo; tg = g0 * j * fo; tb = b0 * j * fo;
  }
  if (pi < 0 && mat === SAND && hc >= 0) for (let k = 0; k < m; k++) if (W[cellNb[c * 6 + k]] > 0.1) { tr *= 0.86; tg *= 0.85; tb *= 0.82; break; }
  CCOL[c * 3] = tr; CCOL[c * 3 + 1] = tg; CCOL[c * 3 + 2] = tb; CCV[c] = 1;
}
const tmp = [0, 0, 0];
function cornerDir(t) {
  const r = (ROUGH[MAT[triCells[t * 3]]] + ROUGH[MAT[triCells[t * 3 + 1]]] + ROUGH[MAT[triCells[t * 3 + 2]]]) / 3;
  const x = cbase[t * 3] + coff[t * 3] * r, y = cbase[t * 3 + 1] + coff[t * 3 + 1] * r, z = cbase[t * 3 + 2] + coff[t * 3 + 2] * r;
  const l = 1 / Math.hypot(x, y, z); tmp[0] = x * l; tmp[1] = y * l; tmp[2] = z * l;
}
const cx = new Float32Array(18), shade = new Float32Array(6), chh = new Float32Array(6), cnn = new Float32Array(18), ccl = new Float32Array(18), cwt = new Float32Array(24);
function writeCell(c) {
  const sl = slotOf[c]; if (sl < 0) return;
  cellColor(c);
  const hc = H[c], m = ncnt[c], mat = MAT[c], hard = hardC(c);
  let snx = 0, sny = 0, snz = 0;
  for (let k = 0; k < 6; k++) {
    const t = cellCorner[c * 6 + k]; cornerDir(t);
    cx[k * 3] = tmp[0]; cx[k * 3 + 1] = tmp[1]; cx[k * 3 + 2] = tmp[2];
    compo(c, t);
    let hs = 0, r = 0, g = 0, b = 0; cwt[k * 4] = cwt[k * 4 + 1] = cwt[k * 4 + 2] = cwt[k * 4 + 3] = 0;
    for (let i = 0; i < cmpN; i++) {
      const o = CMP[i]; hs += H[o]; if (!CCV[o]) cellColor(o);
      r += CCOL[o * 3]; g += CCOL[o * 3 + 1]; b += CCOL[o * 3 + 2];
      if (MAT[o] === LAVA && PAINT[o] < 0) { for (let f = 0; f < 4; f++) cwt[k * 4 + f] += 1 / cmpN; } else { const f = famOf(o); if (f >= 0) cwt[k * 4 + f] += 1 / cmpN; }
    }
    const ch = hs / cmpN; chh[k] = ch;
    ccl[k * 3] = r / cmpN; ccl[k * 3 + 1] = g / cmpN; ccl[k * 3 + 2] = b / cmpN;
    // Normale der Ecke: Ebene durch die drei Zellmitten, fremde Zellen auf Eckhoehe
    let p0x = 0, p0y = 0, p0z = 0, p1x = 0, p1y = 0, p1z = 0, p2x = 0, p2y = 0, p2z = 0, ao = 0;
    for (let q = 0; q < 3; q++) {
      const oc = triCells[t * 3 + q]; let inC = false; for (let i = 0; i < cmpN; i++) if (CMP[i] === oc) inC = true;
      const rr = R + (inC ? H[oc] : ch) * LAYER, x = cdir[oc * 3] * rr, y = cdir[oc * 3 + 1] * rr, z = cdir[oc * 3 + 2] * rr;
      if (q === 0) { p0x = x; p0y = y; p0z = z; } else if (q === 1) { p1x = x; p1y = y; p1z = z; } else { p2x = x; p2y = y; p2z = z; }
      if (!inC) { const d = H[oc] - ch; if (d > 0) ao += (d < 4 ? d : 4) * 0.07; }
    }
    const ax = p1x - p0x, ay = p1y - p0y, az = p1z - p0z, bx = p2x - p0x, by = p2y - p0y, bz = p2z - p0z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (nx * tmp[0] + ny * tmp[1] + nz * tmp[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const nl = 1 / (Math.hypot(nx, ny, nz) || 1); nx *= nl; ny *= nl; nz *= nl;
    if (hard) { nx = tmp[0]; ny = tmp[1]; nz = tmp[2]; }
    cnn[k * 3] = nx; cnn[k * 3 + 1] = ny; cnn[k * 3 + 2] = nz;
    if (k < m) { snx += nx; sny += ny; snz += nz; }
    shade[k] = (1 - (ao < 0.4 ? ao : 0.4)) * (0.95 + 0.1 * hashI(t, 77));
  }
  const fam = famOf(c), tr = CCOL[c * 3], tg = CCOL[c * 3 + 1], tb = CCOL[c * 3 + 2];
  const mb = sl * VPC;
  for (let q = 0; q < VPC; q++) MT[mb + q] = q < 7 ? 0 : 16 + (mat === SAND || mat === SEABED || mat === PLAZA ? 1 : mat === CONCRETE ? 3 : hard ? 3 : 2);
  { let io = sl * 54; for (let k = 0; k < 6; k++) { IDX[io++] = mb; IDX[io++] = mb + 1 + k; IDX[io++] = mb + 1 + (k + 1) % 6; } }
  const rC = R + hc * LAYER;
  let b = sl * VPC * 3;
  P[b] = cdir[c * 3] * rC; P[b + 1] = cdir[c * 3 + 1] * rC; P[b + 2] = cdir[c * 3 + 2] * rC;
  C[b] = tr; C[b + 1] = tg; C[b + 2] = tb;
  { const l = 1 / (Math.hypot(snx, sny, snz) || 1); NRM[b] = hard ? cdir[c * 3] : snx * l; NRM[b + 1] = hard ? cdir[c * 3 + 1] : sny * l; NRM[b + 2] = hard ? cdir[c * 3 + 2] : snz * l; }
  { const w = mb * 4; WT[w] = WT[w + 1] = WT[w + 2] = WT[w + 3] = 0; if (mat === LAVA && PAINT[c] < 0) WT[w] = WT[w + 1] = WT[w + 2] = WT[w + 3] = 255; else if (fam >= 0) WT[w + fam] = 255; }
  for (let k = 0; k < 6; k++) {
    const o = b + 3 + k * 3, rk = R + chh[k] * LAYER;
    P[o] = cx[k * 3] * rk; P[o + 1] = cx[k * 3 + 1] * rk; P[o + 2] = cx[k * 3 + 2] * rk;
    const sh = shade[k];
    C[o] = ccl[k * 3] * sh; C[o + 1] = ccl[k * 3 + 1] * sh; C[o + 2] = ccl[k * 3 + 2] * sh;
    NRM[o] = cnn[k * 3]; NRM[o + 1] = cnn[k * 3 + 1]; NRM[o + 2] = cnn[k * 3 + 2];
    const w = (mb + 1 + k) * 4; for (let f = 0; f < 4; f++) WT[w + f] = Math.round(cwt[k * 4 + f] * 255);
  }
  // Waende nur dort, wo die beiden Flaechen an der Kante nicht zusammenfallen
  const wc = WCOL[hard ? CONCRETE : mat], lb = sl * 36, fid = fieldOf[c];
  for (let k = 0; k < 6; k++) {
    const nb = k < m ? cellNb[c * 6 + k] : -1, k2 = (k + 1) % 6;
    const io = sl * 54 + 18 + k * 6, vb = mb, wv = vb + 7 + k * 4, o = b + 21 + k * 12, lo = lb + k * 6;
    let draw = false, b1 = 0, b2 = 0;
    if (nb >= 0) {
      b1 = cornerH(nb, cellCorner[c * 6 + k]); b2 = cornerH(nb, cellCorner[c * 6 + k2]);
      const d1 = chh[k] - b1, d2 = chh[k2] - b2;
      if (Math.abs(d1) > 1e-4 || Math.abs(d2) > 1e-4) { const s = d1 + d2; draw = s > 1e-4 || (s > -1e-4 && c < nb); }
    }
    if (draw) { IDX[io] = wv; IDX[io + 1] = wv + 3; IDX[io + 2] = wv + 2; IDX[io + 3] = wv; IDX[io + 4] = wv + 2; IDX[io + 5] = wv + 1; }
    else { IDX[io] = IDX[io + 1] = IDX[io + 2] = IDX[io + 3] = IDX[io + 4] = IDX[io + 5] = vb; }
    const rT1 = R + chh[k] * LAYER, rT2 = R + chh[k2] * LAYER, rB1 = draw ? R + b1 * LAYER : rT1, rB2 = draw ? R + b2 * LAYER : rT2;
    P[o] = cx[k * 3] * rT1; P[o + 1] = cx[k * 3 + 1] * rT1; P[o + 2] = cx[k * 3 + 2] * rT1;
    P[o + 3] = cx[k2 * 3] * rT2; P[o + 4] = cx[k2 * 3 + 1] * rT2; P[o + 5] = cx[k2 * 3 + 2] * rT2;
    P[o + 6] = cx[k2 * 3] * rB2; P[o + 7] = cx[k2 * 3 + 1] * rB2; P[o + 8] = cx[k2 * 3 + 2] * rB2;
    P[o + 9] = cx[k * 3] * rB1; P[o + 10] = cx[k * 3 + 1] * rB1; P[o + 11] = cx[k * 3 + 2] * rB1;
    const drop = draw ? Math.max(chh[k] - b1, chh[k2] - b2) : 0, bt = hc < 0 ? 0.86 : Math.max(0.55, 0.95 - 0.06 / HS * drop);
    for (let q = 0; q < 3; q++) { C[o + q] = wc[q] * 0.97; C[o + 3 + q] = wc[q] * 0.97; C[o + 6 + q] = wc[q] * bt; C[o + 9 + q] = wc[q] * bt; }
    for (let q = 0; q < 12; q += 3) { NRM[o + q] = cdir[c * 3]; NRM[o + q + 1] = cdir[c * 3 + 1]; NRM[o + q + 2] = cdir[c * 3 + 2]; }
    for (let q = 0; q < 4; q++) { const w = (wv + q) * 4; WT[w] = WT[w + 1] = WT[w + 2] = WT[w + 3] = 0; }
    if (nb > c && fieldOf[nb] !== fid && !(hc < 0 && H[nb] < 0)) {
      const lift = 0.05 * KS, r1 = Math.max(rT1, rB1) + lift, r2 = Math.max(rT2, rB2) + lift;
      LP[lo] = cx[k * 3] * r1; LP[lo + 1] = cx[k * 3 + 1] * r1; LP[lo + 2] = cx[k * 3 + 2] * r1;
      LP[lo + 3] = cx[k2 * 3] * r2; LP[lo + 4] = cx[k2 * 3 + 1] * r2; LP[lo + 5] = cx[k2 * 3 + 2] * r2;
    } else { LP[lo] = LP[lo + 1] = LP[lo + 2] = LP[lo + 3] = LP[lo + 4] = LP[lo + 5] = 0; }
  }
}
// Hoehe der sichtbaren Flaeche an einer Ecke, fuer Umrisse und Dinge, die zwischen Mitte und Ecke stehen
function cornerSurf(c, t) { const h = cornerH(c, t); return W[c] > 0.35 ? Math.max(h, H[c] + W[c] - 0.3) : h; }
const isSea = c => OCEAN[c] === 1 && H[c] < seaLevel;
function computeShore(out) {
  out.fill(0); const q = new Int32Array(NC); let qh = 0, qt = 0;
  for (let c = 0; c < NC; c++) {
    if (!isSea(c)) continue;
    for (let k = 0; k < ncnt[c]; k++) if (!isSea(cellNb[c * 6 + k])) { out[c] = 1; q[qt++] = c; break; }
  }
  while (qh < qt) {
    const v = q[qh++]; if (out[v] >= 6) continue;
    for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (isSea(o) && out[o] === 0) { out[o] = out[v] + 1; q[qt++] = o; } }
  }
  for (let c = 0; c < NC; c++) if (isSea(c) && out[c] === 0) out[c] = 7;
}
function writeWater(c) {
  const sl = slotOf[c]; if (sl < 0) { LASTW[c] = W[c]; return; }
  const sea = isSea(c);
  const w = W[c], wet = w > 0.1, hc = H[c];
  // Trockene Zelle am Wasser: die Wasserflaeche laeuft unter dem Ufer weiter, so entsteht die Uferlinie dort, wo das Gelaende sie schneidet
  let lvl = 1e9, nearSea = false;
  if (!wet) for (let k = 0; k < ncnt[c]; k++) { const o = cellNb[c * 6 + k]; if (W[o] > 0.1) { const l = H[o] + W[o]; if (l < lvl) lvl = l; if (isSea(o)) nearSea = true; } }
  const bank = !wet && lvl < 1e8;
  WS[sl * 7] = sea ? SH[c] : bank && nearSea ? 0 : -1;
  const rS = wet ? R + (hc + w - 0.07) * LAYER : bank ? R + (lvl - 0.07) * LAYER : R + (hc - 3) * LAYER;
  const b = sl * 21, d = sl * 7;
  const lv = wet ? hc + w : bank ? lvl : hc - 3;
  WP[b] = cdir[c * 3] * rS; WP[b + 1] = cdir[c * 3 + 1] * rS; WP[b + 2] = cdir[c * 3 + 2] * rS; WD[d] = Math.max(0, lv - hc);
  for (let k = 0; k < 6; k++) {
    const t = cellCorner[c * 6 + k]; cornerDir(t);
    const o = b + 3 + k * 3;
    WP[o] = tmp[0] * rS; WP[o + 1] = tmp[1] * rS; WP[o + 2] = tmp[2] * rS;
    WD[d + 1 + k] = Math.max(0, lv - cornerH(c, t));
    if (sea) { let sm = SH[c]; for (let q = 0; q < 3; q++) { const oc = triCells[t * 3 + q], os = isSea(oc) ? SH[oc] : 0; if (os < sm) sm = os; } WS[d + 1 + k] = sm; } else WS[d + 1 + k] = bank && nearSea ? 0 : -1;
  }
  LASTW[c] = w;
}

/* ---------------- Renderer und Shader ---------------- */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setClearColor(0x04060d, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
const U = { uSun: { value: new THREE.Vector3(1, 0.4, 0.3).normalize() }, uFog: { value: 0 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3() }, uPx: { value: 600 }, uFocus: { value: new THREE.Vector3() } };

const LIT_VS = `
varying vec3 vCol; varying vec3 vW;
void main(){
  vCol = color;
  #ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0);
  #else
  vec4 wp = modelMatrix * vec4(position,1.0);
  #endif
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const LIGHT_FN = `
uniform vec3 uSun; uniform float uFog; uniform float uStorm; uniform float uFlash;
vec3 sunColor(vec3 up){ return mix(vec3(1.0,0.50,0.26), vec3(1.0,0.92,0.76), smoothstep(-0.05, 0.42, dot(up,uSun))) * (1.0 - 0.72*uStorm); }
const vec3 HORIZON = vec3(0.70,0.84,0.97);
vec3 skyAmb(float day, float hemi){ vec3 a = mix(vec3(0.16,0.20,0.36), mix(vec3(0.34,0.40,0.52), vec3(0.52,0.66,0.86), hemi), day); return mix(a, vec3(dot(a, vec3(0.3)))*vec3(0.9,0.95,1.05), uStorm*0.8) + vec3(0.75,0.8,0.95)*uFlash; }
float wrapL(vec3 n, float k){ return clamp((dot(n,uSun) + k)/(1.0 + k), 0.0, 1.0); }
vec3 applyFog(vec3 col, vec3 vW, float day){
  vec3 V = cameraPosition - vW; float dist = length(V);
  float fog = 1.0 - exp(-dist*uFog);
  float rim = pow(1.0 - max(dot(normalize(vW), V/dist), 0.0), 3.0) * (1.0 - min(uFog*${(120 * KS).toFixed(1)}, 1.0));
  vec3 fc = mix(vec3(0.07,0.09,0.20), HORIZON, day);
  col = mix(col, fc, fog*0.92);
  return mix(col, fc, rim*0.55);
}`;
const LIT_FS = `
varying vec3 vCol; varying vec3 vW;
${LIGHT_FN}
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 up = normalize(vW);
  float day = smoothstep(-0.25, 0.30, dot(up,uSun));
  float ndl = max(dot(n,uSun), 0.0);
  float hemi = 0.5 + 0.5*dot(n,up);
  vec3 lit = vCol * (skyAmb(day, hemi) + sunColor(up) * ndl * day * 0.9);
  gl_FragColor = vec4(applyFog(lit, vW, day), 1.0);
}`;
const NOISE_FN = `
float h31(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z); }`;
const TERRAIN_VS = `
attribute float aMat; attribute vec4 aW; varying vec3 vCol; varying vec3 vW; varying vec3 vN; varying float vMat; varying vec4 vWt;
void main(){ vCol = color; vMat = aMat; vWt = aW; vN = normal; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position,1.0); }`;
// Oberflaechen ohne Bilddateien: Muster entstehen aus Rauschen im Weltraum. Die Gewichte vWt mischen Wiese, Sand, Fels und Erde,
// darum fliessen die Uebergaenge; steile Hänge zeigen von selbst Fels.
const TERRAIN_FS = `
varying vec3 vCol; varying vec3 vW; varying vec3 vN; varying float vMat; varying vec4 vWt; uniform float uTime;
${LIGHT_FN}
${NOISE_FN}
void main(){
  vec3 up = normalize(vW);
  vec3 fn = normalize(cross(dFdx(vW), dFdy(vW)));
  bool wall = vMat > 15.5;
  vec3 n = wall ? fn : normalize(vN);
  float dist = length(cameraPosition - vW);
  float det = 1.0 - smoothstep(${(55 * KS).toFixed(1)}, ${(170 * KS).toFixed(1)}, dist);
  vec3 col = vCol; vec3 lavaE = vec3(0.0);
  vec3 p = vW * ${(1 / KS).toFixed(4)};
  float n1 = vn(p*0.8), n2 = vn(p*3.1 + 11.0), n3 = det > 0.001 ? vn(p*10.0 + 5.0) : 0.5;
  vec3 rockC = vec3(0.70,0.64,0.58) * (0.84 + 0.24*n1) * (0.92 + 0.12*floor(n2*4.0)/4.0);
  if (wall) {
    float lay = (length(vW) - ${R.toFixed(1)}) / ${LAYER.toFixed(5)};
    float line = smoothstep(0.42, 0.5, abs(fract(lay*0.5) - 0.5));
    vec3 hz = normalize(cross(up, n));
    float hc = dot(vW, hz) * ${(1 / KS).toFixed(4)};
    float streak = vn(vec3(hc*5.0, lay*0.18, 0.0)), blk = floor(vn(vec3(hc*1.3, lay*0.35, 7.0))*4.0)/4.0;
    vec3 c = col * (1.0 - 0.10*line*det) * (0.80 + 0.22*blk + 0.06*n3) * (0.88 + 0.2*streak);
    c *= 0.9 + 0.12*smoothstep(-0.2, 0.6, dot(n, uSun));
    if (vMat < 18.5) c = mix(c, c*vec3(0.80,0.92,0.70), smoothstep(0.62, 0.8, vn(p*1.4 + 3.0))*0.5);   // Moos in Felswaenden
    col = c;
  } else {
    vec4 w = vWt; float ws = w.x + w.y + w.z + w.w;
    vec3 c = col;
    vec3 g = c * (0.86 + 0.18*n1 + 0.12*n2);
    g = mix(g, g*vec3(1.18,1.10,0.70), smoothstep(0.55,0.85,n2)*0.40);
    g = mix(g, g*vec3(0.78,0.94,0.90), smoothstep(0.60,0.90,vn(p*1.7+31.0))*0.35);
    g *= 0.93 + 0.14*n3;
    float fl = step(0.80, vn(p*7.0 + 3.0)) * step(0.70, n3) * step(0.5, n1) * det;
    g = mix(g, mix(vec3(1.0,0.97,0.86), mix(vec3(1.0,0.70,0.22), vec3(0.95,0.52,0.70), step(0.6, vn(p*1.1+9.0))), step(0.5, vn(p*2.3))), fl*0.8);
    float bare = smoothstep(0.66, 0.76, vn(p*0.42 + 70.0)) * smoothstep(0.35, 0.6, n2);                   // kahle Erdstellen
    g = mix(g, vec3(0.50,0.40,0.28)*(0.85 + 0.3*n3), bare*0.75);
    g = mix(g, vec3(0.64,0.62,0.58)*(0.8 + 0.3*n2), step(0.87, vn(p*5.0 + 13.0))*step(0.55, n1)*det*0.85);  // Steinchen
    g = mix(g, g*vec3(0.70,0.78,0.72), smoothstep(0.55, 0.8, vn(p*0.23 + 40.0))*0.35);                    // dunklere, feuchte Senken
    vec3 sd = c * (0.93 + 0.08*n2 + 0.06*n3) * (1.0 + 0.035*sin(dot(p, vec3(2.1,1.3,1.7))*3.2 + n1*7.0));
    sd *= 1.0 - 0.14*smoothstep(0.5, 0.8, vn(p*0.9 + 23.0));
    sd = mix(sd, vec3(0.36,0.30,0.24), step(0.90, vn(p*9.0 + 3.0))*0.45*det);
    sd = mix(sd, vec3(0.97,0.95,0.90), step(0.93, vn(p*13.0 + 8.0))*0.6*det);
    vec3 rk = c * (0.82 + 0.22*n1) * (0.90 + 0.14*floor(n2*4.0)/4.0) * (0.95 + 0.1*n3);
    rk = mix(rk, rk*vec3(1.12,1.08,0.78), smoothstep(0.6, 0.8, vn(p*2.2 + 90.0))*0.4);
    rk = mix(rk, rk*vec3(0.70,0.84,0.62), smoothstep(0.62, 0.86, vn(p*0.9 + 60.0))*0.4);
    vec3 dt = c * (0.82 + 0.22*n2 + 0.14*n3);
    dt = mix(dt, dt*vec3(0.74,0.72,0.70), smoothstep(0.5, 0.8, vn(p*1.1 + 33.0))*0.5);
    dt = mix(dt, vec3(0.62,0.60,0.56), step(0.88, vn(p*6.0 + 17.0))*0.7*det);
    vec3 pl = c * (0.96 + 0.05*n3 + 0.03*n2);
    vec3 mixed = (g*w.x + sd*w.y + rk*w.z + dt*w.w + pl*max(0.0, 1.0 - ws)) / max(ws + max(0.0, 1.0 - ws), 0.001);
    col = mix(col, mixed, det);
    // steile Haenge: Fels schaut durch die Wiese
    float slope = 1.0 - dot(n, up);
    float nat = clamp(w.x + w.w + w.y*0.6 + w.z, 0.0, 1.0);
    float lava = clamp((ws - 1.0) / 3.0, 0.0, 1.0);
    float rkk = smoothstep(0.22, 0.42, slope + (n2 - 0.5)*0.16) * nat * (1.0 - lava);
    float ln = smoothstep(0.40, 0.5, abs(fract((length(vW) - ${R.toFixed(1)}) / ${LAYER.toFixed(5)} * 0.5 + n2*0.7) - 0.5));
    col = mix(col, rockC * (1.0 - 0.12*ln*det), rkk);
    if (lava > 0.01) {          // Lava: dunkle Kruste, darunter gluehende Risse, die langsam wandern
      float fl = vn(p*1.5 + vec3(uTime*0.04, uTime*0.06, 0.0));
      float cr = smoothstep(0.09, 0.0, abs(vn(p*2.7 + 11.0 + uTime*0.015) - 0.5));
      float heat = clamp(cr*1.0 + smoothstep(0.52, 0.9, fl)*0.9, 0.0, 1.0) * smoothstep(0.05, 0.7, lava);
      col = mix(col, vec3(0.13,0.09,0.08)*(0.7 + 0.6*n2), smoothstep(0.0, 0.45, lava));
      lavaE = mix(vec3(1.0,0.26,0.03), vec3(1.0,0.86,0.36), heat*heat) * heat * 1.7;
    }
  }
  float day = smoothstep(-0.25, 0.30, dot(up,uSun));
  float hemi = 0.5 + 0.5*dot(n,up);
  float ndl = wrapL(n, 0.18);
  vec3 lit = col * (skyAmb(day, hemi)*0.95 + sunColor(up) * ndl * day * 0.92) + lavaE;
  gl_FragColor = vec4(applyFog(lit, vW, day), 1.0);
}`;
function litMaterial() {
  return new THREE.ShaderMaterial({ uniforms: U, vertexShader: LIT_VS, fragmentShader: LIT_FS, vertexColors: true });
}

const terrainGeo = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(P, 3), colAttr = new THREE.BufferAttribute(C, 3);
posAttr.setUsage(THREE.DynamicDrawUsage); colAttr.setUsage(THREE.DynamicDrawUsage);
terrainGeo.setAttribute('position', posAttr); terrainGeo.setAttribute('color', colAttr);
const idxAttr = new THREE.BufferAttribute(IDX, 1); idxAttr.setUsage(THREE.DynamicDrawUsage);
terrainGeo.setIndex(idxAttr);
const matAttr = new THREE.BufferAttribute(MT, 1); matAttr.setUsage(THREE.DynamicDrawUsage);
terrainGeo.setAttribute('aMat', matAttr);
const nrmAttr = new THREE.BufferAttribute(NRM, 3); nrmAttr.setUsage(THREE.DynamicDrawUsage); terrainGeo.setAttribute('normal', nrmAttr);
const wtAttr = new THREE.BufferAttribute(WT, 4, true); wtAttr.setUsage(THREE.DynamicDrawUsage); terrainGeo.setAttribute('aW', wtAttr);
const terrain = new THREE.Mesh(terrainGeo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, vertexColors: true, side: THREE.DoubleSide })); terrain.frustumCulled = false; scene.add(terrain);

const lineMat = (r, g, b, a) => new THREE.ShaderMaterial({
  uniforms: { uC: { value: new THREE.Vector4(r, g, b, a) } }, transparent: true, depthWrite: false,
  vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec4 uC; void main(){gl_FragColor=uC;}'
});
const borderGeo = new THREE.BufferGeometry();
const borderAttr = new THREE.BufferAttribute(LP, 3); borderAttr.setUsage(THREE.DynamicDrawUsage);
borderGeo.setAttribute('position', borderAttr);
const borderMat = lineMat(1, 1, 1, 0.22);
const borders = new THREE.LineSegments(borderGeo, borderMat); borders.frustumCulled = false; scene.add(borders);

const waterGeo = new THREE.BufferGeometry();
const wposAttr = new THREE.BufferAttribute(WP, 3), wdAttr = new THREE.BufferAttribute(WD, 1);
wposAttr.setUsage(THREE.DynamicDrawUsage); wdAttr.setUsage(THREE.DynamicDrawUsage);
const wsAttr = new THREE.BufferAttribute(WS, 1); wsAttr.setUsage(THREE.DynamicDrawUsage);
waterGeo.setAttribute('position', wposAttr); waterGeo.setAttribute('aDepth', wdAttr); waterGeo.setAttribute('aShore', wsAttr);
waterGeo.setIndex(new THREE.BufferAttribute(WIDX, 1));
const WAVE_FN = `
const vec3 D1 = vec3(0.62,0.31,0.72); const vec3 D2 = vec3(-0.48,0.82,0.31); const vec3 D3 = vec3(0.26,-0.55,0.79);
const float K1 = ${(TAU / (7 * CELLW)).toFixed(4)}; const float K2 = ${(TAU / (4.6 * CELLW)).toFixed(4)}; const float K3 = ${(TAU / (3.1 * CELLW)).toFixed(4)};
const float AMP = ${(0.085 * CELLW).toFixed(4)};
float waveH(vec3 p, float t){ return sin(dot(p,D1)*K1 + t*0.8)*0.5 + sin(dot(p,D2)*K2 - t*0.62)*0.32 + sin(dot(p,D3)*K3 + t*1.05)*0.18; }
vec3 waveG(vec3 p, float t){ return D1*(cos(dot(p,D1)*K1 + t*0.8)*0.5*K1) + D2*(cos(dot(p,D2)*K2 - t*0.62)*0.32*K2) + D3*(cos(dot(p,D3)*K3 + t*1.05)*0.18*K3); }`;
const waterMat = new THREE.ShaderMaterial({
  uniforms: U, transparent: true, depthWrite: false,
  vertexShader: `
attribute float aDepth; attribute float aShore; uniform float uTime; varying float vD; varying float vS; varying vec3 vW;
${WAVE_FN}
void main(){
  vD = aDepth; vS = aShore;
  vec3 p = position;
  if (aShore >= 0.0) p += normalize(p) * waveH(p, uTime) * AMP * clamp(aShore*0.6, 0.12, 1.0);   // nur das Meer bewegt sich
  vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p,1.0);
}`,
  fragmentShader: `
varying float vD; varying float vS; varying vec3 vW; uniform float uTime;
${LIGHT_FN}
${NOISE_FN}
${WAVE_FN}
void main(){
  vec3 up = normalize(vW); vec3 V = normalize(cameraPosition - vW); float t = uTime;
  float day = smoothstep(-0.25, 0.30, dot(up,uSun));
  float dist = length(cameraPosition - vW);
  bool sea = vS > -0.5;
  vec3 n = up; float crest = 0.0; float foam = 0.0;
  vec3 base;
  if (sea) {
    float fade = clamp(vS*0.6, 0.12, 1.0);
    vec3 g = waveG(vW, t); g -= up*dot(g, up);
    n = normalize(up - g*AMP*fade*1.8);
    vec3 q = vW * ${(4 / CELLW).toFixed(4)};
    vec3 rip = vec3(vn(q + vec3(t*0.35,0.0,0.0)), vn(q*1.3 + vec3(0.0,t*0.30,5.0)), vn(q*0.9 + vec3(3.0,0.0,-t*0.32))) - 0.5;
    n = normalize(n + rip*0.15*(1.0 - smoothstep(${(12 * CELLW).toFixed(1)}, ${(45 * CELLW).toFixed(1)}, dist)));
    crest = waveH(vW, t)*fade;
    float dd = vD / ${HS.toFixed(3)};
    base = mix(mix(vec3(0.42,0.90,0.82), vec3(0.10,0.62,0.72), smoothstep(0.0, 1.2, dd)), vec3(0.04,0.22,0.52), smoothstep(1.0, 4.5, dd));
    // Brandung: Schaumlinien rollen ueber das flache Wasser auf das Ufer zu, dazu ein Saum genau an der Wasserlinie
    float br = vn(vW * ${(1.5 / CELLW).toFixed(4)} + vec3(0.0, t*0.18, 0.0));
    float band = smoothstep(0.80, 0.97, sin(dd*7.0 + t*0.7 + br*2.4)*0.5 + 0.5);
    float mask = (1.0 - smoothstep(0.5, 1.4, dd)) * smoothstep(0.06, 0.25, dd);
    foam = band*mask*(0.45 + 0.55*br);
    float wash = 1.0 - smoothstep(0.0, 0.10 + 0.07*sin(t*0.75 + br*6.0), dd);
    foam = max(foam, wash*0.95);
  } else {
    base = mix(vec3(0.34,0.72,0.72), vec3(0.09,0.33,0.50), smoothstep(0.0, 2.5, vD));   // Seen und Fluesse: ruhig
    foam = (1.0 - smoothstep(0.0, 0.3, vD))*0.3;
  }
  float fres = pow(1.0 - max(dot(n,V),0.0), 4.0);
  vec3 sky = mix(vec3(0.10,0.14,0.30), vec3(0.64,0.82,0.97), day);
  vec3 col = base * (0.36 + 0.64*day) + crest*0.035*day;
  col = mix(col, sky, fres*0.6);
  float spec = pow(max(dot(reflect(-uSun,n),V),0.0), sea ? 70.0 : 160.0) * day;
  col += sunColor(up) * spec * 0.9;
  col = mix(col, vec3(0.97,0.99,1.0)*(0.42+0.58*day), clamp(foam,0.0,1.0)*0.88);
  float a = max(max(mix(0.38,0.96,smoothstep(0.0,${(2.2 * HS).toFixed(2)},vD)), fres*0.8), foam);
  gl_FragColor = vec4(applyFog(col, vW, day), a);
}`
});
const water = new THREE.Mesh(waterGeo, waterMat); water.frustumCulled = false; water.renderOrder = 5; scene.add(water);

// ---------- Fernes Netz: ein Sechseck je Feld ----------
const far = { on: !ALLNEAR };
const farDirty = new Set();
if (far.on) {
  const cg = buildGrid(N / 6), n2 = cg.nc;
  far.n = n2; far.cg = cg; far.fid = new Int32Array(n2); far.of = new Int32Array(NF).fill(-1); far.rr = new Float32Array(n2).fill(R);
  { let st = 0; for (let i = 0; i < n2; i++) {       // grobe Zelle -> Feld
      let best = st, bd = -2; const x = cg.cdir[i * 3], y = cg.cdir[i * 3 + 1], z = cg.cdir[i * 3 + 2];
      bd = cdir[best * 3] * x + cdir[best * 3 + 1] * y + cdir[best * 3 + 2] * z;
      for (; ;) { let mv = false; for (let k = 0; k < ncnt[best]; k++) { const o = cellNb[best * 6 + k], d = cdir[o * 3] * x + cdir[o * 3 + 1] * y + cdir[o * 3 + 2] * z; if (d > bd) { bd = d; best = o; mv = true; } } if (!mv) break; }
      st = best; far.fid[i] = fieldOf[best]; far.of[fieldOf[best]] = i; } }
  // je Feld 19 Ecken: Deckel (7) und ein Mantel (12), der bis tief in die Kugel reicht. So bleibt zwischen Feldern verschiedener Hoehe keine Luecke.
  far.P = new Float32Array(n2 * 57); far.C = new Float32Array(n2 * 57); far.M = new Uint8Array(n2 * 19);
  far.WP = new Float32Array(n2 * 21); far.WD = new Float32Array(n2 * 7); far.WS = new Float32Array(n2 * 7).fill(7);
  const ix = new Uint32Array(n2 * 18); for (let c = 0; c < n2; c++) { const b = c * 7; let o = c * 18; for (let k = 0; k < 6; k++) { ix[o++] = b; ix[o++] = b + 1 + k; ix[o++] = b + 1 + (k + 1) % 6; } }
  const g1 = new THREE.BufferGeometry();
  far.pa = new THREE.BufferAttribute(far.P, 3); far.ca = new THREE.BufferAttribute(far.C, 3); far.pa.setUsage(THREE.DynamicDrawUsage); far.ca.setUsage(THREE.DynamicDrawUsage);
  for (let c = 0; c < n2; c++) for (let k = 7; k < 19; k++) far.M[c * 19 + k] = 18;
  const ixl = new Uint32Array(n2 * 54); for (let c = 0; c < n2; c++) { const b = c * 19; let o = c * 54; for (let k = 0; k < 6; k++) { ixl[o++] = b; ixl[o++] = b + 1 + k; ixl[o++] = b + 1 + (k + 1) % 6; }
    for (let k = 0; k < 6; k++) { const k1 = (k + 1) % 6; ixl[o++] = b + 7 + k; ixl[o++] = b + 13 + k; ixl[o++] = b + 13 + k1; ixl[o++] = b + 7 + k; ixl[o++] = b + 13 + k1; ixl[o++] = b + 7 + k1; } }
  far.NR = new Float32Array(n2 * 57); far.na = new THREE.BufferAttribute(far.NR, 3); far.na.setUsage(THREE.DynamicDrawUsage);
  g1.setAttribute('position', far.pa); g1.setAttribute('color', far.ca); g1.setAttribute('aMat', new THREE.BufferAttribute(far.M, 1)); g1.setAttribute('normal', far.na); g1.setAttribute('aW', new THREE.BufferAttribute(new Uint8Array(n2 * 76), 4, true)); g1.setIndex(new THREE.BufferAttribute(ixl, 1));
  far.land = new THREE.Mesh(g1, terrain.material); far.land.frustumCulled = false; far.land.renderOrder = 1; scene.add(far.land);      // nach dem nahen Gelaende zeichnen, das meiste ist dann verdeckt
  const g2 = new THREE.BufferGeometry();
  far.wpa = new THREE.BufferAttribute(far.WP, 3); far.wda = new THREE.BufferAttribute(far.WD, 1); far.wpa.setUsage(THREE.DynamicDrawUsage); far.wda.setUsage(THREE.DynamicDrawUsage);
  g2.setAttribute('position', far.wpa); g2.setAttribute('aDepth', far.wda); g2.setAttribute('aShore', new THREE.BufferAttribute(far.WS, 1)); g2.setIndex(new THREE.BufferAttribute(ix, 1));
  far.water = new THREE.Mesh(g2, waterMat); far.water.frustumCulled = false; far.water.renderOrder = 4; scene.add(far.water);
}
function writeFar(f) {
  const i = far.of[f]; if (i < 0) return;
  const cg = far.cg, s0 = fieldStart[f], s1 = fieldStart[f + 1], cnt = s1 - s0;
  let hs = 0, hmin = 127, r = 0, g = 0, b = 0, wet = 0, ws = 0, wd = 0;
  for (let q = s0; q < s1; q++) {
    const c = fieldCells[q], h = H[c], mc = PAINT[c] >= 0 ? PALETTE[PAINT[c]] : MAT[c] === LAVA ? LAVAFAR : MCOL[MAT[c]], dk = h < 0 ? 1 - 0.07 / HS * Math.min(-h, 6 * HS) : MAT[c] === FOREST ? 0.78 : 1;
    hs += h; if (h < hmin) hmin = h; r += mc[0] * dk; g += mc[1] * dk; b += mc[2] * dk;
    if (W[c] > 0.3) { wet++; ws += h + W[c]; wd += W[c]; }
  }
  const near = fieldBlock[f] >= 0, rr = R + (near ? hmin - 2.5 : hs / cnt) * LAYER, o = i * 57, ow = i * 21;
  // Mantel nur so tief wie das tiefste Nachbarfeld: die Luecke ist zu, ohne dass sich Waende hintereinander stapeln
  far.rr[i] = rr; let rb = rr; for (let k = 0; k < cg.ncnt[i]; k++) { const v = far.rr[cg.cellNb[i * 6 + k]]; if (v < rb) rb = v; } rb -= 0.3 * LAYER;
  const sea = wet * 2 > cnt && !near, rw = sea ? R + (ws / wet - 0.07) * LAYER : 0, dep = sea ? wd / wet : 0;
  r = r / cnt * 0.97; g = g / cnt * 0.97; b = b / cnt * 0.97;
  for (let k = 0; k < 7; k++) {
    let x, y, z;
    if (k === 0) { x = cg.cdir[i * 3]; y = cg.cdir[i * 3 + 1]; z = cg.cdir[i * 3 + 2]; }
    else { const t = cg.cellCorner[i * 6 + k - 1]; x = cg.cbase[t * 3]; y = cg.cbase[t * 3 + 1]; z = cg.cbase[t * 3 + 2]; }
    far.P[o + k * 3] = x * rr; far.P[o + k * 3 + 1] = y * rr; far.P[o + k * 3 + 2] = z * rr;
    far.C[o + k * 3] = r; far.C[o + k * 3 + 1] = g; far.C[o + k * 3 + 2] = b;
    far.NR[o + k * 3] = x; far.NR[o + k * 3 + 1] = y; far.NR[o + k * 3 + 2] = z;
    far.WP[ow + k * 3] = x * rw; far.WP[ow + k * 3 + 1] = y * rw; far.WP[ow + k * 3 + 2] = z * rw; far.WD[i * 7 + k] = dep;
    if (k > 0) {      // Mantel: oben an der Kante, unten tief in der Kugel
      const a = o + (6 + k) * 3, q = o + (12 + k) * 3, wr = r * 0.45 + 0.24, wg = g * 0.45 + 0.22, wb = b * 0.45 + 0.20;
      far.P[a] = x * rr; far.P[a + 1] = y * rr; far.P[a + 2] = z * rr; far.P[q] = x * rb; far.P[q + 1] = y * rb; far.P[q + 2] = z * rb;
      far.C[a] = wr; far.C[a + 1] = wg; far.C[a + 2] = wb; far.C[q] = wr * 0.7; far.C[q + 1] = wg * 0.7; far.C[q + 2] = wb * 0.7;
      far.NR[a] = far.NR[q] = x; far.NR[a + 1] = far.NR[q + 1] = y; far.NR[a + 2] = far.NR[q + 2] = z;
    }
  }
}
function flushFar(all) {
  if (!far.on) return;
  if (all) { for (let p = 0; p < 2; p++) for (let f = 0; f < NF; f++) writeFar(f); farDirty.clear(); for (const a of [far.pa, far.ca, far.na, far.wpa, far.wda]) { a.clearUpdateRanges(); a.needsUpdate = true; } return; }
  if (!farDirty.size) return;
  const list = [], cg = far.cg;
  for (const f of farDirty) { writeFar(f); const i = far.of[f]; if (i < 0) continue; list.push(i);
    for (let k = 0; k < cg.ncnt[i]; k++) { const j = cg.cellNb[i * 6 + k]; writeFar(far.fid[j]); list.push(j); } }       // Nachbarn passen ihren Mantel an
  farDirty.clear();
  list.sort((x, y) => x - y);
  markRanges(far.pa, list, 57); markRanges(far.ca, list, 57); markRanges(far.na, list, 57); markRanges(far.wpa, list, 21); markRanges(far.wda, list, 7);
}
// ---------- Nahe Felder laden und freigeben ----------
const loadedFields = [];
function loadField(f, mark) {
  const blk = freeBlocks.pop(); if (blk === undefined) return false;
  fieldBlock[f] = blk; loadedFields.push(f);
  const s0 = fieldStart[f], s1 = fieldStart[f + 1], base = blk * BLOCK;
  for (let q = s0; q < s1; q++) slotOf[fieldCells[q]] = base + q - s0;
  for (let q = s0; q < s1; q++) { writeCell(fieldCells[q]); writeWater(fieldCells[q]); }
  if (mark) markBlock(blk);
  farDirty.add(f); return true;
}
function unloadField(f, mark) {
  const blk = fieldBlock[f]; if (blk < 0) return;
  const s0 = fieldStart[f], s1 = fieldStart[f + 1], base = blk * BLOCK;
  for (let q = s0; q < s1; q++) slotOf[fieldCells[q]] = -1;
  IDX.fill(0, base * 54, (base + BLOCK) * 54); WP.fill(0, base * 21, (base + BLOCK) * 21); LP.fill(0, base * 36, (base + BLOCK) * 36);
  fieldBlock[f] = -1; freeBlocks.push(blk); if (mark) markBlock(blk); farDirty.add(f);
}
function markBlock(blk) {
  const a = blk * BLOCK;
  for (const e of [[posAttr, VPC * 3], [colAttr, VPC * 3], [nrmAttr, VPC * 3], [wtAttr, VPC * 4], [matAttr, VPC], [borderAttr, 36], [idxAttr, 54], [wposAttr, 21], [wdAttr, 7], [wsAttr, 7]]) { e[0].addUpdateRange(a * e[1], BLOCK * e[1]); e[0].needsUpdate = true; }
}
const _cand = [];
function updateStream() {
  if (ALLNEAR) return;
  const ux = cam.u.x, uy = cam.u.y, uz = cam.u.z;
  const rad = cam.z < 0.2 ? -1 : Math.min(NEAR_RMAX, 0.1 + cam.s / R * 1.15), wc = rad < 0 ? 2 : Math.cos(rad), uc = rad < 0 ? 2 : Math.cos(Math.min(3.1, rad * 1.12 + 0.02));
  let un = 0;
  for (let i = loadedFields.length - 1; i >= 0 && un < 120; i--) {
    const f = loadedFields[i], c = fieldCenter[f];
    if (cdir[c * 3] * ux + cdir[c * 3 + 1] * uy + cdir[c * 3 + 2] * uz < uc) { unloadField(f, true); loadedFields[i] = loadedFields[loadedFields.length - 1]; loadedFields.pop(); un++; }
  }
  if (wc > 1 || !freeBlocks.length) return;
  _cand.length = 0;
  for (let f = 0; f < NF; f++) {
    if (fieldBlock[f] >= 0) continue; const c = fieldCenter[f], d = cdir[c * 3] * ux + cdir[c * 3 + 1] * uy + cdir[c * 3 + 2] * uz;
    if (d > wc) _cand.push(d, f);
  }
  const want = Math.min(48, _cand.length / 2, freeBlocks.length);
  for (let k = 0; k < want; k++) {         // die naechsten zuerst
    let bi = -1, bd = -2; for (let i = 0; i < _cand.length; i += 2) if (_cand[i] > bd) { bd = _cand[i]; bi = i; }
    loadField(_cand[bi + 1], true); _cand[bi] = -3;
  }
  if (want) treesDirty = true;
}

// Atmosphaere
const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.13, 48, 32), new THREE.ShaderMaterial({
  uniforms: U, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: 'varying vec3 vW; void main(){ vW=position; gl_Position=projectionMatrix*viewMatrix*vec4(position,1.0);}',
  fragmentShader: `
varying vec3 vW; uniform vec3 uSun;
void main(){
  vec3 rd = normalize(vW - cameraPosition);
  float tca = dot(-cameraPosition, rd);
  vec3 cp = tca > 0.0 ? cameraPosition + rd*tca : cameraPosition;
  float x = clamp((length(cp) - ${(R - 1).toFixed(1)}) / ${(R * 0.14).toFixed(1)}, 0.0, 1.0);
  float day = smoothstep(-0.35, 0.4, dot(normalize(cp), uSun));
  float i = pow(1.0 - x, 2.6) * (0.10 + 0.90*day);
  gl_FragColor = vec4(vec3(0.34,0.60,1.0)*i*0.85, 1.0);
}`
}));
atmo.renderOrder = 6; atmo.frustumCulled = false; scene.add(atmo);

// Sterne
{
  const n = 1400, sp = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const zz = hashI(i, 201) * 2 - 1, a = hashI(i, 202) * TAU, rr = Math.sqrt(1 - zz * zz);
    sp[i * 3] = rr * Math.cos(a) * 1800; sp[i * 3 + 1] = zz * 1800; sp[i * 3 + 2] = rr * Math.sin(a) * 1800;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  U.uStarA = { value: 1 };
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: U, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    vertexShader: 'void main(){ gl_PointSize = 1.6; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform float uStarA; void main(){ gl_FragColor = vec4(vec3(0.75,0.82,1.0)*uStarA, 1.0); }'
  }));
  stars.frustumCulled = false; stars.renderOrder = -9; scene.add(stars);
}

// Himmel: nahe am Boden ein gemalter blauer Himmel mit Sonne, von weit draussen der Weltraum
U.uSkyA = { value: 0 }; U.uDip = { value: 0 }; U.uStorm = { value: 0 }; U.uFlash = { value: 0 };
const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
  uniforms: U, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0); }',
  fragmentShader: `
varying vec3 vD; uniform float uSkyA; uniform float uDip;
${LIGHT_FN}
void main(){
  vec3 d = normalize(vD), u = normalize(cameraPosition);
  float e = dot(d, u) + uDip;
  float sh = dot(u, uSun), day = smoothstep(-0.22, 0.25, sh);
  vec3 zen = mix(vec3(0.02,0.04,0.12), vec3(0.10,0.33,0.76), day);
  vec3 hor = mix(vec3(0.07,0.09,0.22), HORIZON, day);
  vec3 col = mix(hor, zen, pow(clamp(e*1.6, 0.0, 1.0), 0.55));
  float sd = max(dot(d, uSun), 0.0);
  float dusk = (1.0 - smoothstep(0.05, 0.35, sh)) * smoothstep(-0.2, 0.05, sh);
  col = mix(col, vec3(1.0,0.62,0.38), dusk * pow(1.0 - clamp(e*2.5, 0.0, 1.0), 2.0) * (0.35 + 0.65*pow(sd, 3.0)));
  col += sunColor(u) * (smoothstep(0.9993, 0.9997, sd)*2.0 + pow(sd, 14.0)*0.30) * day;
  col = mix(col, HORIZON*mix(0.12, 1.0, day), smoothstep(0.02, -0.06, e));
  col = mix(col, vec3(0.36,0.39,0.45)*mix(0.2, 1.0, day), uStorm*0.88) + vec3(0.5)*uFlash;
  gl_FragColor = vec4(mix(vec3(0.016,0.024,0.051), col, uSkyA), 1.0);
}`
}));
sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

// Wolken: Haufen weicher Kugeln, als Flaechen zur Kamera gedreht. Oben hell und warm, unten blaugrau, harte gemalte Kanten
const clouds = (() => {
  const NCL = 150, puffs = [];
  const tA = new THREE.Vector3(), tB = new THREE.Vector3(), c0 = new THREE.Vector3();
  for (let i = 0; i < NCL; i++) {
    const zz = hashI(i, 701) * 2 - 1, a = hashI(i, 702) * TAU, rr = Math.sqrt(1 - zz * zz);
    c0.set(rr * Math.cos(a), zz, rr * Math.sin(a));
    tA.set(0.3, 1, 0.5).cross(c0).normalize(); tB.crossVectors(c0, tA);
    const S = 1.6 + 2.6 * hashI(i, 703), alt = R + 6.5 + 2.5 * hashI(i, 704), tall = 0.5 + hashI(i, 705) * 1.1;
    const n = 9 + Math.floor(hashI(i, 706) * 9);
    for (let j = 0; j < n; j++) {
      const k = i * 64 + j, f = j / n;
      const towerP = f > 0.55;
      const ex = (hashI(k, 711) - 0.5) * S * (towerP ? 1.0 : 2.6), ey = (hashI(k, 712) - 0.5) * S * (towerP ? 0.8 : 1.4);
      const hgt = towerP ? S * tall * (0.4 + 0.8 * hashI(k, 713)) : S * 0.18 * hashI(k, 714);
      const pr = S * (towerP ? 0.42 + 0.25 * hashI(k, 715) : 0.38 + 0.22 * hashI(k, 715));
      const p = c0.clone().multiplyScalar(alt + hgt).addScaledVector(tA, ex).addScaledVector(tB, ey);
      puffs.push(p.x, p.y, p.z, pr, clamp(hgt / (S * (tall + 0.2)), 0, 1), hashI(k, 716));
    }
  }
  const np = puffs.length / 6, g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const ac = new Float32Array(np * 3), ar = new Float32Array(np), ah = new Float32Array(np), as = new Float32Array(np);
  for (let i = 0; i < np; i++) { ac[i * 3] = puffs[i * 6]; ac[i * 3 + 1] = puffs[i * 6 + 1]; ac[i * 3 + 2] = puffs[i * 6 + 2]; ar[i] = puffs[i * 6 + 3]; ah[i] = puffs[i * 6 + 4]; as[i] = puffs[i * 6 + 5]; }
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(ac, 3)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(ar, 1));
  g.setAttribute('aH', new THREE.InstancedBufferAttribute(ah, 1)); g.setAttribute('aS', new THREE.InstancedBufferAttribute(as, 1));
  g.instanceCount = np;
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: `
attribute vec3 aC; attribute float aR; attribute float aH; attribute float aS;
varying vec2 vUv; varying float vH; varying float vS; varying vec3 vC; varying vec3 vRt; varying vec3 vUp; varying vec3 vTo; varying vec3 vWp; varying float vR;
void main(){
  vec3 c = (modelMatrix * vec4(aC, 1.0)).xyz;
  vec3 to = normalize(cameraPosition - c);
  vec3 cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 rt = normalize(cross(cu, to)), upv = cross(to, rt);
  vec3 p = c + (rt*position.x + upv*position.y) * aR + to * aR * 0.5;
  vUv = position.xy; vH = aH; vS = aS; vC = c; vRt = rt; vUp = upv; vTo = to; vWp = p; vR = aR;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: `
varying vec2 vUv; varying float vH; varying float vS; varying vec3 vC; varying vec3 vRt; varying vec3 vUp; varying vec3 vTo; varying vec3 vWp; varying float vR;
uniform vec3 uFocus;
${LIGHT_FN}
${NOISE_FN}
void main(){
  float a = atan(vUv.y, vUv.x);
  float edge = 1.0 + (vn(vec3(cos(a)*2.2, sin(a)*2.2, vS*37.0)) - 0.5) * 0.28;
  float r2 = dot(vUv, vUv); if (r2 > edge*edge) discard;
  // Wolken vor dem Blickpunkt ausblenden, damit das Spiel frei bleibt
  vec3 pa = vWp - cameraPosition, ba = uFocus - cameraPosition; float bl = length(ba);
  float hh = dot(pa, ba) / (bl*bl), dl = length(pa - ba*hh), rad = min(bl * 0.42, 11.0);
  float dith = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (hh < 1.0 && dl < rad && dith < smoothstep(rad, rad*0.55, dl)) discard;
  if (length(cameraPosition - vC) < vR * 1.3) discard;
  float z = sqrt(max(0.0, 1.0 - r2/(edge*edge)));
  vec3 nS = normalize(vRt*vUv.x + vUp*vUv.y + vTo*z);
  vec3 up = normalize(vC);
  float sh = dot(up, uSun), day = smoothstep(-0.25, 0.30, sh);
  float l = dot(nS, uSun)*0.5 + 0.5;
  float top = clamp(vH*0.7 + dot(nS, up)*0.45 + 0.15, 0.0, 1.0);
  float k = smoothstep(0.30, 0.62, l*0.55 + top*0.55);
  vec3 col = mix(vec3(0.56,0.64,0.82), vec3(1.0,0.985,0.95), floor(k*3.0 + 0.5)/3.0*0.35 + k*0.65);
  col = mix(col, sunColor(up), pow(l, 5.0)*0.35*(1.0 - smoothstep(0.2, 0.6, sh)));
  col *= mix(vec3(0.10,0.12,0.22), vec3(1.0), day);
  vec3 V = cameraPosition - vWp; float fog = 1.0 - exp(-length(V)*uFog*0.5);
  col = mix(col, mix(vec3(0.07,0.09,0.20), HORIZON, day), fog*0.6);
  gl_FragColor = vec4(col, 1.0);
}`
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 3; scene.add(m);
  return m;
})();

/* ---------------- Kleine Bauteile: Baeume, Haus, Figur ---------------- */
const Z0 = [0, 0];
// Baut Modelle aus Koerpern zusammen. Jeder Eckpunkt traegt Farbe, Normale und eine Materialnummer,
// aus der der Shader das Muster macht (Planken, Ziegel, Schindeln, Stoff, Glas ...).
function geoBuilder() {
  const p = [], c = [], nn = [], mm = [], ix = []; let M = null, mat = 0, det = 1, auto = null;
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3();
  const PT = a => M ? t1.set(a[0], a[1], a[2]).applyMatrix4(M).toArray() : a;
  const NT = a => M ? t2.set(a[0], a[1], a[2]).transformDirection(M).toArray() : a;
  const push = (v, n, col, m) => { p.push(v[0], v[1], v[2]); nn.push(n[0], n[1], n[2]); c.push(col[0], col[1], col[2]); mm.push(m); };
  const faceN = (a, b, cc) => { t1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); t2.set(cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]); t3.crossVectors(t1, t2); const l = t3.length(); return l < 1e-12 ? null : [t3.x / l, t3.y / l, t3.z / l]; };
  const quad = (a, b, cc, d, col, na, nb, nc, nd) => {
    a = PT(a); b = PT(b); cc = PT(cc); d = PT(d);
    const m = auto ? auto(col) : mat, o = p.length / 3;
    if (na) { push(a, NT(na), col, m); push(b, NT(nb), col, m); push(cc, NT(nc), col, m); push(d, NT(nd), col, m); }
    else { const n = faceN(a, b, cc) || faceN(a, cc, d) || [0, 1, 0]; push(a, n, col, m); push(b, n, col, m); push(cc, n, col, m); push(d, n, col, m); }
    ix.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const tri = (a, b, cc, col) => {
    a = PT(a); b = PT(b); cc = PT(cc);
    const m = auto ? auto(col) : mat, o = p.length / 3, n = faceN(a, b, cc) || [0, 1, 0];
    push(a, n, col, m); push(b, n, col, m); push(cc, n, col, m); ix.push(o, o + 1, o + 2);
  };
  const api = {
    xf(m) { M = m || null; return api; }, mat(id) { mat = id; return api; }, auto(fn) { auto = fn; return api; }, detail(d) { det = d; return api; },
    quad(a, b, cc, d, col) { quad(a, b, cc, d, col); }, tri,
    box(x, y, z, sx, sy, sz, col) {
      const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y, y1 = y + sy, z0 = z - sz / 2, z1 = z + sz / 2;
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);
      quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);
      quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col);
    },
    cone(x, y, z, r, hgt, sides, col, spin = 0) {
      for (let i = 0; i < sides; i++) {
        const a0 = spin + i / sides * TAU, a1 = spin + (i + 1) / sides * TAU;
        tri([x + Math.sin(a0) * r, y, z + Math.cos(a0) * r], [x + Math.sin(a1) * r, y, z + Math.cos(a1) * r], [x, y + hgt, z], col);
      }
    },
    // Satteldach, First entlang x
    gable(y, w, d, h, col) {
      const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
      quad([x0, y, z1], [x1, y, z1], [x1, y + h, 0], [x0, y + h, 0], col); quad([x1, y, z0], [x0, y, z0], [x0, y + h, 0], [x1, y + h, 0], col);
    },
    gableEnds(y, w, d, h, col) { const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2; tri([x1, y, z1], [x1, y, z0], [x1, y + h, 0], col); tri([x0, y, z0], [x0, y, z1], [x0, y + h, 0], col); },
    // Drehkoerper aus einem Profil [[Radius, Hoehe], ...], von unten nach oben, mit weichen Normalen
    lathe(prof, sides, col, o = {}) {
      const a0 = o.a0 === undefined ? 0 : o.a0, a1 = o.a1 === undefined ? TAU : o.a1, ox = o.x || 0, oz = o.z || 0, L = prof.length - 1;
      sides = Math.max(3, Math.round(sides * det));
      const nr = [], ny = [];
      for (let i = 0; i <= L; i++) { const a = prof[Math.max(i - 1, 0)], b = prof[Math.min(i + 1, L)]; let dr = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dr, dy) || 1; nr.push(dy / l); ny.push(-dr / l); }
      for (let i = 0; i < L; i++) {
        const r0 = prof[i][0], y0 = prof[i][1], r1 = prof[i + 1][0], y1 = prof[i + 1][1];
        const b0 = o.bend ? o.bend(i) : Z0, b1 = o.bend ? o.bend(i + 1) : Z0;
        for (let q = 0; q < sides; q++) {
          const cc = typeof col === 'function' ? col(i, q) : col;
          const aa = a0 + (a1 - a0) * q / sides, ab = a0 + (a1 - a0) * (q + 1) / sides;
          const sa = Math.sin(aa), ca = Math.cos(aa), sb = Math.sin(ab), cb = Math.cos(ab);
          const A = [ox + b0[0] + sa * r0, y0, oz + b0[1] + ca * r0], B = [ox + b0[0] + sb * r0, y0, oz + b0[1] + cb * r0],
            Cc = [ox + b1[0] + sb * r1, y1, oz + b1[1] + cb * r1], D = [ox + b1[0] + sa * r1, y1, oz + b1[1] + ca * r1];
          if (o.flat) quad(A, B, Cc, D, cc);
          else quad(A, B, Cc, D, cc, [sa * nr[i], ny[i], ca * nr[i]], [sb * nr[i], ny[i], cb * nr[i]], [sb * nr[i + 1], ny[i + 1], cb * nr[i + 1]], [sa * nr[i + 1], ny[i + 1], ca * nr[i + 1]]);
        }
      }
    },
    ball(x, y, z, r, col, sy = 1, sides = 8, rings = 5) {
      rings = Math.max(3, Math.round(rings * det));
      const prof = []; for (let i = 0; i <= rings; i++) { const ph = Math.PI * i / rings; prof.push([r * Math.sin(ph), y - r * sy * Math.cos(ph)]); }
      api.lathe(prof, sides, col, { x, z });
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nn), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(c), 3));
      g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(mm), 1));
      g.setIndex(ix); return g;
    }
  };
  return api;
}

/* ---------------- Wichte: Koerper, Kleidung, Farben ---------------- */
const HATC = [[0.86, 0.22, 0.20], [0.20, 0.52, 0.30], [0.22, 0.40, 0.80], [0.93, 0.72, 0.22], [0.56, 0.32, 0.72], [0.16, 0.62, 0.62], [0.93, 0.48, 0.62], [0.26, 0.27, 0.32]];
const OUTC = [[0.22, 0.44, 0.70], [0.25, 0.56, 0.36], [0.80, 0.28, 0.26], [0.90, 0.66, 0.24], [0.52, 0.34, 0.66], [0.18, 0.58, 0.60], [0.90, 0.52, 0.64], [0.44, 0.34, 0.26]];
const ACCC = [[0.45, 0.30, 0.18], [0.93, 0.89, 0.78], [0.18, 0.24, 0.42], [0.46, 0.50, 0.24], [0.56, 0.18, 0.24], [0.52, 0.53, 0.56]];
const HAIRC = [[0.95, 0.95, 0.93], [0.66, 0.67, 0.70], [0.93, 0.80, 0.42], [0.86, 0.44, 0.18], [0.42, 0.27, 0.16], [0.14, 0.12, 0.13], [0.55, 0.86, 0.74]];
const SKINC = [[0.98, 0.83, 0.72], [0.90, 0.70, 0.54], [0.72, 0.50, 0.36], [0.50, 0.33, 0.24], [0.68, 0.80, 0.56]];
const GNAMES = ['Bramble', 'Pip', 'Moss', 'Tilda', 'Fenn', 'Hazel', 'Nub', 'Wilma', 'Grum', 'Odo', 'Juniper', 'Bix', 'Marla', 'Tock'];
const SKILLS = [
  { key: 'strider', name: 'Strider', desc: 'Walks 8% faster per point' },
  { key: 'digger', name: 'Digger', desc: 'Each point: 10% chance a shovel use is free' },
  { key: 'trader', name: 'Trader', desc: 'Sells for 10% more per point' },
  { key: 'gardener', name: 'Gardener', desc: 'Each point: 15% chance a seed is free' }
];
const SKILLPTS = 6, SKILLMAX = 3;
function randomAvatar() {
  const r = n => Math.floor(Math.random() * n);
  return { body: r(2), hat: r(5), outfit: r(4), hair: r(4), size: r(3), build: r(3), cHat: r(HATC.length), cOutfit: r(OUTC.length), cAccent: r(ACCC.length), cHair: r(HAIRC.length), cSkin: r(SKINC.length),
    name: GNAMES[r(GNAMES.length)], skills: { strider: 0, digger: 0, trader: 0, gardener: 0 } };
}
const _mx = new THREE.Matrix4(), _mr = new THREE.Matrix4();
function buildGnome(av, part) {
  const b = geoBuilder().detail(1.7), S = 10;
  const hat = HATC[av.cHat], out = OUTC[av.cOutfit], acc = ACCC[av.cAccent], hair = HAIRC[av.cHair], skin = SKINC[av.cSkin];
  const dark = (c, f = 0.72) => [c[0] * f, c[1] * f, c[2] * f], lite = (c, f = 0.3) => [c[0] + (1 - c[0]) * f, c[1] + (1 - c[1]) * f, c[2] + (1 - c[2]) * f];
  const mixc = (a, c, f) => [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
  const boot = [0.33, 0.22, 0.15], gold = [0.96, 0.78, 0.26], cream = [0.96, 0.94, 0.88], eye = [0.10, 0.08, 0.10];
  const cm = new Map([[skin, 6], [hair, 15], [boot, 0], [gold, 10], [eye, 0]]); if (av.hat === 3) cm.set(hat, 11);
  const shadeOf = (q, base) => { const k = q[0] / (base[0] || 1e-6); return k > 0.5 && k < 1.1 && Math.abs(q[1] - base[1] * k) < 0.015 && Math.abs(q[2] - base[2] * k) < 0.015; };
  b.auto(q => cm.has(q) ? cm.get(q) : shadeOf(q, hair) ? 15 : shadeOf(q, skin) ? 6 : 5);
  const her = av.body === 1, fit = av.outfit;
  const at = (x, y, z, rz) => { _mx.makeTranslation(x, y, z); if (rz) { _mr.makeRotationZ(rz); _mx.multiply(_mr); } return _mx; };
  // Stiefel und Beine
  const legc = fit === 3 ? cream : fit === 1 ? out : dark(acc, 0.9);
  if (!part || part === 'leg') for (const sx of part ? [0] : [-1, 1]) {
    const lx = part ? 0 : sx * 0.15;
    b.box(lx, 0, 0.06, 0.2, 0.12, 0.34, boot);
    b.lathe([[0.115, 0.02], [0.105, 0.22]], 8, boot, { x: lx });
    b.lathe([[0.125, 0.20], [0.125, 0.26], [0.0, 0.26]], 8, lite(boot, 0.2), { x: lx });
    b.lathe([[0.085, 0.24], [0.095, 0.48]], 8, legc, { x: lx });
  }
  if (part === 'leg') { const lg = b.build(); lg.translate(0, -0.44, 0); return lg; }
  // Rumpf je nach Kleidung
  let prof, waistR;
  if (fit === 3) { prof = [[0.47, 0.17], [0.43, 0.30], [0.33, 0.48], [0.24, 0.60], [0.26, 0.74], [0.21, 0.90], [0.12, 0.97], [0, 0.98]]; waistR = 0.25; }
  else if (fit === 2) { prof = her ? [[0.37, 0.15], [0.35, 0.32], [0.28, 0.54], [0.27, 0.72], [0.21, 0.90], [0.12, 0.97], [0, 0.98]] : [[0.38, 0.15], [0.38, 0.32], [0.35, 0.52], [0.29, 0.74], [0.22, 0.91], [0.12, 0.97], [0, 0.98]]; waistR = her ? 0.285 : 0.355; }
  else { prof = her ? [[0.33, 0.30], [0.31, 0.44], [0.24, 0.58], [0.26, 0.74], [0.21, 0.90], [0.12, 0.97], [0, 0.98]] : [[0.34, 0.30], [0.38, 0.46], [0.35, 0.62], [0.29, 0.78], [0.22, 0.91], [0.12, 0.97], [0, 0.98]]; waistR = her ? 0.25 : 0.365; }
  const shirt = lite(acc, 0.35);
  if (!part || part === 'body') {
  b.lathe(prof, S, i => {
    if (fit === 1) return prof[i][1] < 0.6 ? out : shirt;
    if (i === 0 && fit !== 1) return fit === 2 ? cream : lite(out, 0.35);
    return out;
  });
  b.lathe([[prof[0][0], prof[0][1]], [0, prof[0][1] + 0.02]], S, dark(out, 0.6));   // Unterseite
  const wy = fit === 3 ? 0.60 : 0.56;
  if (fit === 0 || fit === 2) {
    b.lathe([[waistR, wy], [waistR, wy + 0.07]], S, dark(acc, 0.8));
    b.box(0, wy - 0.005, waistR, 0.1, 0.08, 0.035, gold);
  }
  if (fit === 1) {
    b.box(0, 0.60, 0.33, 0.26, 0.22, 0.05, out);
    for (const sx of [-1, 1]) { b.box(sx * 0.11, 0.78, 0.25, 0.05, 0.18, 0.05, out); b.box(sx * 0.11, 0.76, 0.345, 0.045, 0.045, 0.03, gold); }
  }
  if (fit === 2) { for (const y of [0.30, 0.47, 0.64, 0.80]) b.box(0, y, (y < 0.4 ? 0.37 : y < 0.6 ? 0.335 : y < 0.75 ? 0.285 : 0.23) * (her ? 0.9 : 1), 0.05, 0.05, 0.03, gold); b.lathe([[0.17, 0.93], [0.21, 1.0]], S, cream); }
  if (fit === 3) {
    b.lathe([[0.485, 0.20], [0.445, 0.30], [0.345, 0.48], [0.255, 0.60]], 5, cream, { a0: -0.62, a1: 0.62 });     // Schuerze
    b.lathe([[0.255, 0.585], [0.255, 0.64]], S, acc);
  }
  }
  // Arme
  const sleeve = fit === 1 ? shirt : out;
  if (!part || part === 'armL' || part === 'armR') for (const sx of part === 'armL' ? [-1] : part === 'armR' ? [1] : [-1, 1]) {
    b.xf(part ? at(0, 0, 0, sx * 0.55) : at(sx * 0.2, 0.9, 0, sx * 0.55));
    b.lathe([[0.0, 0.02], [0.09, 0.0], [0.098, -0.30]], 7, sleeve);
    b.lathe([[0.108, -0.30], [0.108, -0.35], [0.0, -0.35]], 7, fit === 2 ? cream : lite(sleeve, 0.3));
    b.ball(0, -0.41, 0, 0.078, skin, 1, 7, 4);
    b.xf(null);
  }
  if (part === 'armL' || part === 'armR') return b.build();
  if (part !== 'hat') {
  // Kopf
  const rosy = mixc(skin, [0.96, 0.45, 0.45], 0.42), nosec = mixc(skin, [0.92, 0.40, 0.34], 0.34);
  cm.set(rosy, 6); cm.set(nosec, 6);
  b.ball(0, 1.18, 0, 0.25, skin, 0.94, S, 6);
  b.ball(0, 1.15, 0.26, 0.092, nosec, 1, 8, 4);
  for (const sx of [-1, 1]) {
    b.ball(sx * 0.15, 1.12, 0.175, 0.058, rosy, 1, 6, 3);
    b.box(sx * 0.095, 1.20, 0.218, 0.048, 0.062, 0.03, eye);
    b.box(sx * 0.105, 1.235, 0.238, 0.018, 0.018, 0.012, cream);
    b.xf(at(sx * 0.22, 1.16, 0, -sx * 1.15)); b.cone(0, 0, 0, 0.075, 0.24, 5, skin); b.xf(null);
    if (!her) b.box(sx * 0.095, 1.285, 0.21, 0.1, 0.028, 0.04, dark(hair, 0.92));
  }
  // Haar unter dem Hut
  b.lathe([[0.262, 1.00], [0.272, 1.18], [0.24, 1.33]], 8, hair, { a0: 0.95, a1: TAU - 0.95 });
  const stache = (len, lift) => { for (const sx of [-1, 1]) { b.xf(at(sx * 0.03, 1.085 + lift, 0.255, -sx * (1.75 - lift * 3))); b.cone(0, 0, 0, 0.055, len, 5, hair); b.xf(null); } };
  if (!her) {
    if (av.hair === 0) { b.lathe([[0.0, 0.50], [0.10, 0.68], [0.19, 0.88], [0.238, 1.05], [0.235, 1.13]], 8, i => i % 2 ? hair : dark(hair, 0.93), { z: 0.07, a0: -2.1, a1: 2.1 }); stache(0.2, 0); }
    else if (av.hair === 1) { b.lathe([[0.0, 0.84], [0.14, 0.94], [0.228, 1.05], [0.235, 1.13]], 8, hair, { z: 0.06, a0: -2.1, a1: 2.1 }); stache(0.18, 0); }
    else if (av.hair === 2) { stache(0.3, 0.05); b.box(0, 1.03, 0.225, 0.07, 0.018, 0.02, [0.62, 0.22, 0.24]); }
    else b.box(0, 1.04, 0.228, 0.11, 0.02, 0.02, [0.62, 0.22, 0.24]);
  } else {
    b.lathe([[0.262, 1.26], [0.25, 1.34]], 5, hair, { a0: -0.95, a1: 0.95 });
    b.box(0, 1.045, 0.228, 0.085, 0.022, 0.02, [0.80, 0.26, 0.32]);
    if (av.hair === 0) for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) b.ball(sx * (0.25 + i * 0.012), 1.06 - i * 0.115, 0.03 + i * 0.012, 0.078 - i * 0.006, i % 2 ? dark(hair, 0.92) : hair, 1, 6, 3);
      b.box(sx * 0.31, 0.50, 0.09, 0.07, 0.05, 0.07, acc);
    }
    else if (av.hair === 1) { b.ball(0, 1.14, -0.29, 0.13, hair, 1, 7, 4); b.box(0, 1.20, -0.4, 0.05, 0.05, 0.05, acc); }
    else if (av.hair === 2) b.lathe([[0.31, 0.62], [0.30, 0.85], [0.275, 1.05]], 7, i => i ? hair : dark(hair, 0.92), { a0: 1.15, a1: TAU - 1.15 });
    else b.lathe([[0.30, 0.95], [0.285, 1.05]], 7, hair, { a0: 1.0, a1: TAU - 1.0 });
  }
  }
  // Hut
  if (av.hat === 0 || av.hat === 1) {
    const flop = av.hat === 1, n = flop ? 9 : 7, pr = [], bends = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (flop) { pr.push([0.30 * (1 - t) + 0.025 * t, 1.33 + 0.62 * Math.sin(t * 2.25)]); bends.push([0.62 * (1 - Math.cos(t * 2.25)) * 0.9, -0.08 * t]); }
      else { pr.push([0.30 * Math.pow(1 - t, 0.9), 1.33 + t * 0.92]); bends.push([0.10 * t * t, -0.12 * t * t]); }
    }
    b.lathe([[0.30, 1.30], [0.375, 1.30], [0.375, 1.335], [0.30, 1.335]], S, dark(hat, 0.86));
    b.lathe(pr, S, i => i === 0 ? lite(acc, 0.15) : (i % 2 ? hat : dark(hat, 0.95)), { bend: i => bends[i] });
    if (flop) b.ball(bends[n][0], pr[n][1] - 0.03, bends[n][1], 0.085, cream, 1, 7, 4);
  } else if (av.hat === 2) {
    const pr = []; for (let i = 0; i <= 6; i++) { const ph = 0.55 + (Math.PI - 0.55) * (1 - i / 6); pr.push([0.31 * Math.sin(ph), 1.21 - 0.33 * Math.cos(ph)]); }
    b.lathe(pr, 9, hat, { a0: 0.72, a1: TAU - 0.72, z: -0.02 });
    b.cone(0, 1.5, -0.05, 0.1, 0.2, 5, hat);
    b.lathe([[0.275, 0.9], [0.22, 1.0]], S, dark(hat, 0.9));
  } else {
    b.lathe([[0.26, 1.30], [0.52, 1.30], [0.52, 1.325], [0.245, 1.345], [0.225, 1.52], [0.0, 1.55]], 12, i => i === 3 ? lite(hat, 0.12) : hat);
    b.lathe([[0.25, 1.36], [0.245, 1.42]], 12, acc);
    b.ball(0.17, 1.41, 0.19, 0.06, [0.95, 0.5, 0.62], 1, 6, 3); b.ball(0.185, 1.415, 0.235, 0.025, gold, 1, 5, 3);
  }
  return b.build();
}
// Ein Wicht als Gelenkpuppe: Rumpf mit Kopf, zwei Beine, zwei Arme, jeweils um Huefte und Schulter drehbar
function makeGnome(av) {
  const avg = makeAvatar(av); if (avg) return avg;
  const g = new THREE.Group(), rig = new THREE.Group(); rig.scale.setScalar(GS); g.add(rig);
  const mk = geo => { const m = new THREE.Mesh(geo, propMat); m.frustumCulled = false; rig.add(m); return m; };
  const body = mk(buildGnome(av, 'body')), legGeo = buildGnome(av, 'leg');
  const legL = mk(legGeo), legR = mk(legGeo.clone()); legL.position.set(-0.15, 0.44, 0); legR.position.set(0.15, 0.44, 0);
  const armL = mk(buildGnome(av, 'armL')), armR = mk(buildGnome(av, 'armR')); armL.position.set(-0.2, 0.9, 0); armR.position.set(0.2, 0.9, 0);
  g.userData.rig = { rig, body, legL, legR, armL, armR, phase: Math.random() * 6, work: 0 };
  return g;
}
function disposeGnome(g) { if (g.userData.avr) { g.userData.avr.mixer.stopAllAction(); g.traverse(m => { if (m.isSkinnedMesh) m.material.dispose(); else if (m.isMesh && m.geometry) m.geometry.dispose(); }); return; } g.traverse(m => { if (m.isMesh && m.geometry) m.geometry.dispose(); }); }
// walk: Beine und Arme schwingen gegengleich, der Rumpf wippt und pendelt; work: der rechte Arm holt aus und schlaegt zu;
// idle: Atmen und leichtes Wiegen; sit: Beine angewinkelt
function animateGnome(g, mode, dt, speed = 1) {
  if (g.userData.avr) { animateAvatar(g, mode, dt, speed); return; }
  const r = g.userData.rig; if (!r) return;
  r.phase += dt * (mode === 'walk' ? 7.5 * speed : mode === 'work' ? 6.5 * Math.min(speed, 2) : 1.7);
  const p = r.phase, s = Math.sin(p);
  let ll = 0, lr = 0, al = 0, ar = 0, bob = 0, lean = 0, roll = 0, yaw = 0;
  if (mode === 'walk') { ll = s * 0.65; lr = -s * 0.65; al = -s * 0.55; ar = s * 0.55; bob = Math.abs(Math.cos(p)) * 0.045; lean = 0.07; roll = s * 0.05; yaw = s * 0.06; }
  else if (mode === 'work') { const w = Math.sin(p); ar = -1.25 + w * 1.15; al = -0.45 + w * 0.25; lean = 0.12 + Math.max(0, w) * 0.14; bob = -Math.max(0, -w) * 0.025; ll = 0.15; lr = -0.2; }
  else if (mode === 'sit') { ll = -1.35; lr = -1.35; al = -0.25; ar = -0.25; bob = -0.12; }
  else { al = 0.05 + Math.sin(p) * 0.05; ar = 0.05 - Math.sin(p) * 0.05; bob = Math.sin(p * 0.5) * 0.008; roll = Math.sin(p * 0.37) * 0.02; }
  const k = 1 - Math.exp(-dt * 14), L = (a, b) => a + (b - a) * k;
  r.legL.rotation.x = L(r.legL.rotation.x, ll); r.legR.rotation.x = L(r.legR.rotation.x, lr);
  r.armL.rotation.x = L(r.armL.rotation.x, al); r.armR.rotation.x = L(r.armR.rotation.x, ar);
  r.rig.position.y = L(r.rig.position.y, bob * GS); r.rig.rotation.x = L(r.rig.rotation.x, lean); r.rig.rotation.z = L(r.rig.rotation.z, roll); r.rig.rotation.y = L(r.rig.rotation.y, yaw);
}


/* ---------------- Figuren aus den 3D-Modellen ---------------- */
// Zwei Grundmodelle (er, sie) mit Skelett. Farben stehen als Klasse im Alpha der Eckfarbe: 1 Haut, 2 Haar, 3 Kleidung, 4 Akzent, 5 Hemd.
// Gehen und Laufen kommen aus den Modellen, Stehen, Arbeiten und Sitzen werden auf demselben Skelett berechnet.
const AVB = { m: '__AV_M__', f: '__AV_F__' }, AVM = {};
const LEAGUE_MODE = (new URLSearchParams(location.search).get('league') || '').replace(/[^a-z]/g, '') || null;
const AV_HEIGHT = [0.84, 1.0, 1.16], AV_BUILD = [0.88, 1.0, 1.14];
for (const k of ['m', 'f']) {
  try {
    const bin = Uint8Array.from(atob(AVB[k]), ch => ch.charCodeAt(0));
    const g = await new GLTFLoader().parseAsync(bin.buffer, '');
    let mesh = null; g.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    const col = mesh.geometry.attributes.color, ref = [], cnt = [];
    for (let q = 0; q < 6; q++) { ref.push([0, 0, 0]); cnt.push(0); }
    for (let i = 0; i < col.count; i++) { const q = Math.round(col.getW(i) * 255 / 32); if (q < 6) { ref[q][0] += col.getX(i); ref[q][1] += col.getY(i); ref[q][2] += col.getZ(i); cnt[q]++; } }
    g.ref = ref.map((r, q) => new THREE.Vector3(r[0], r[1], r[2]).multiplyScalar(1 / Math.max(1, cnt[q])));
    g.scene.updateMatrixWorld(true);
    g.h = new THREE.Box3().setFromObject(mesh).max.y;
    AVM[k] = g;
  } catch (e) { console.warn('avatar model ' + k + ' failed, using the old gnome', e); }
}
const AV_VS = `
#include <common>
#include <skinning_pars_vertex>
uniform vec3 uTint[6]; uniform vec3 uRef[6];
varying vec3 vCol; varying vec3 vW; varying vec3 vN;
void main(){
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec3 c = color.rgb; int k = int(floor(color.a*255.0/32.0 + 0.5));
  if (k > 0 && k < 6) { float l = dot(c, vec3(0.3,0.5,0.2)), lr = dot(uRef[k], vec3(0.3,0.5,0.2)); c = uTint[k]*clamp(l/max(lr, 0.02), 0.45, 1.55); }
  vCol = c;
  vec4 w = modelMatrix*vec4(transformed, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*objectNormal);
  gl_Position = projectionMatrix*viewMatrix*w;
}`;
const AV_FS = `
varying vec3 vCol; varying vec3 vW; varying vec3 vN;
${LIGHT_FN}
void main(){
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; vec3 up = normalize(vW);
  float day = smoothstep(-0.25, 0.30, dot(up,uSun)), hemi = 0.5 + 0.5*dot(n,up), ndl = wrapL(n, 0.3);
  vec3 V = normalize(cameraPosition - vW); float rim = pow(1.0 - max(dot(n,V), 0.0), 3.0);
  vec3 lit = vCol*(skyAmb(day, hemi)*1.05 + sunColor(up)*ndl*day*0.95) + rim*0.18*mix(vec3(0.3,0.35,0.5), sunColor(up), day);
  gl_FragColor = vec4(applyFog(lit, vW, day), 1.0);
}`;
const AV_PV_FS = `
varying vec3 vCol; varying vec3 vW; varying vec3 vN;
void main(){ vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, normalize(vec3(0.45,0.75,0.6))), 0.0), bk = max(dot(n, normalize(vec3(-0.6,0.2,-0.7))), 0.0);
  gl_FragColor = vec4(vCol*(0.50 + 0.55*d + 0.10*(0.5 + 0.5*n.y)) + vec3(0.25,0.35,0.6)*bk*0.25, 1.0); }`;
function avTints(av) {
  const lite = (c, f) => [c[0] + (1 - c[0]) * f, c[1] + (1 - c[1]) * f, c[2] + (1 - c[2]) * f];
  const acc = ACCC[av.cAccent] || ACCC[0];
  return [[1, 1, 1], SKINC[av.cSkin] || SKINC[0], HAIRC[av.cHair] || HAIRC[0], OUTC[av.cOutfit] || OUTC[0], acc, lite(acc, 0.55)].map(c => new THREE.Vector3(c[0], c[1], c[2]));
}
function makeAvatar(av) {
  const src = AVM[av.body === 1 ? 'f' : 'm']; if (!src) return null;
  const root = SkeletonUtils.clone(src.scene);
  let mesh = null; root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  mesh.frustumCulled = false;
  mesh.material = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, { uTint: { value: avTints(av) }, uRef: { value: src.ref } }), vertexShader: AV_VS, fragmentShader: AV_FS, vertexColors: true, side: THREE.DoubleSide });
  const bones = {}; root.traverse(o => { if (o.isBone) bones[o.name] = o; });
  // Hut auf den Kopfknochen setzen, solange das Skelett in Ruhe steht
  if (av.hat !== undefined && av.hat < 4 && bones.Head) {
    root.updateMatrixWorld(true);
    const top = new THREE.Vector3(); (bones.head_end || bones.Head).getWorldPosition(top);
    const s = 0.40, hat = new THREE.Mesh(buildGnome(av, 'hat'), propMat); hat.frustumCulled = false;
    const m = new THREE.Matrix4().makeTranslation(0, top.y - 0.06 - 1.30 * s, -0.01).multiply(new THREE.Matrix4().makeScale(s, s, s));
    hat.matrixAutoUpdate = false; hat.matrix.copy(bones.Head.matrixWorld).invert().multiply(m); bones.Head.add(hat);
  }
  const hs = AV_HEIGHT[av.size ?? 1], bw = AV_BUILD[av.build ?? 1], sc = CELLW * 0.31 * 0.62 / src.h;
  root.scale.set(sc * hs * bw, sc * hs, sc * hs * bw);
  const g = new THREE.Group(); g.add(root);
  const mixer = new THREE.AnimationMixer(root), clip = n => src.animations.find(a => a.name === n);
  const walk = mixer.clipAction(clip('Walking')), run = mixer.clipAction(clip('Running'));
  walk.play(); run.play(); run.weight = 0;
  const list = Object.values(bones), bind = new Map(list.map(b => [b, b.quaternion.clone()])), hip0 = bones.Hips ? bones.Hips.position.clone() : null;
  g.userData.avr = { root, mixer, walk, run, bones, list, bind, hip0, cur: new Map(list.map(b => [b, b.quaternion.clone()])), curHip: hip0 ? hip0.clone() : null, phase: Math.random() * 6, blink: 0 };
  return g;
}
// Drehung um eine Achse des Modells (x seitlich, y hoch, z nach vorn) in die Eigendrehung eines Knochens umrechnen
const _aq = new THREE.Quaternion(), _ap = new THREE.Quaternion(), _ae = new THREE.Euler();
function boneTurn(b, x, y, z) {
  if (!b) return;
  _ap.identity(); for (let p = b.parent; p && p.isBone; p = p.parent) _ap.premultiply(p.quaternion);
  _aq.setFromEuler(_ae.set(x, y, z, 'XYZ'));
  b.quaternion.premultiply(_ap.clone().invert().multiply(_aq).multiply(_ap));
}
function animateAvatar(g, mode, dt, speed) {
  const a = g.userData.avr, B = a.bones;
  a.phase += dt * (mode === 'work' ? 6.0 * Math.min(speed, 2) : 1.6);
  const p = a.phase, w = Math.sin(p);
  if (mode === 'walk') {
    const fast = speed > 1.6 ? 1 : 0;
    a.run.weight += (fast - a.run.weight) * Math.min(1, dt * 6); a.walk.weight = 1 - a.run.weight;
    a.mixer.timeScale = 0.9 * Math.min(speed, 2.5) / (fast ? 1.6 : 1);
    a.mixer.update(dt);
  } else {
    for (const b of a.list) b.quaternion.copy(a.bind.get(b));
    if (B.Hips && a.hip0) B.Hips.position.copy(a.hip0);
    // Grundhaltung: Arme hängen, Ellbogen leicht gebeugt
    boneTurn(B.LeftArm, 0, 0, -0.95); boneTurn(B.RightArm, 0, 0, 0.95);
    boneTurn(B.LeftForeArm, -0.25, 0, 0); boneTurn(B.RightForeArm, -0.25, 0, 0);
    if (mode === 'work') {          // Hacke oder Schaufel: beide Arme holen vorn aus und schlagen nach unten, der Rumpf geht mit
      const up = (w + 1) / 2;
      boneTurn(B.Spine02, 0.18 + 0.22 * (1 - up), 0, 0); boneTurn(B.Spine, 0.08, 0, 0);
      for (const [arm, fa, sx] of [[B.LeftArm, B.LeftForeArm, -1], [B.RightArm, B.RightForeArm, 1]]) { boneTurn(arm, -(0.5 + 1.9 * up), 0, sx * -0.35); boneTurn(fa, -(0.6 - 0.4 * up), 0, 0); }
      boneTurn(B.LeftUpLeg, -0.25, 0, 0); boneTurn(B.LeftLeg, 0.35, 0, 0); boneTurn(B.RightUpLeg, 0.15, 0, 0);
      if (B.Hips && a.hip0) B.Hips.position.y = a.hip0.y - 0.04 * (1 - up) * (a.hip0.y > 10 ? 100 : 1);
    } else if (mode === 'sit') {    // Sitzen: Oberschenkel nach vorn, Unterschenkel hängen, Hände auf den Knien
      for (const [ul, ll] of [[B.LeftUpLeg, B.LeftLeg], [B.RightUpLeg, B.RightLeg]]) { boneTurn(ul, -1.45, 0, 0); boneTurn(ll, 1.45, 0, 0); }
      boneTurn(B.LeftArm, -0.7, 0, 0.25); boneTurn(B.RightArm, -0.7, 0, -0.25); boneTurn(B.Spine02, -0.06, 0, 0);
      if (B.Hips && a.hip0) B.Hips.position.y = a.hip0.y * 0.55;
    } else {                        // Stehen: atmen, Gewicht verlagern, ab und zu umschauen
      boneTurn(B.Spine01, Math.sin(p * 1.1) * 0.025, 0, 0); boneTurn(B.Spine02, 0, 0, Math.sin(p * 0.35) * 0.03);
      boneTurn(B.Head, 0, Math.sin(p * 0.23) * 0.35 * Math.max(0, Math.sin(p * 0.11)), 0);
      boneTurn(B.LeftArm, Math.sin(p * 0.9) * 0.04, 0, 0); boneTurn(B.RightArm, -Math.sin(p * 0.9) * 0.04, 0, 0);
    }
  }
  // weich zwischen den Haltungen ueberblenden
  const k = 1 - Math.exp(-dt * 12);
  for (const b of a.list) { const c = a.cur.get(b); c.slerp(b.quaternion, k); b.quaternion.copy(c); }
  if (B.Hips && a.curHip) { a.curHip.lerp(B.Hips.position, k); B.Hips.position.copy(a.curHip); }
}

const PROP_VS = `
attribute float aMat; uniform float uTime; uniform vec3 uWind;
#ifdef LOCATTR
attribute vec3 aLoc;
#endif
varying vec3 vCol; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vMat;
void main(){
  vCol = color; vMat = aMat;
  #ifdef LOCATTR
  vL = aLoc;
  #else
  vL = position;
  #endif
  #ifdef USE_INSTANCING
  mat4 mm = modelMatrix * instanceMatrix;
  #else
  mat4 mm = modelMatrix;
  #endif
  vec4 wp = mm * vec4(position,1.0);
  #ifdef SWAY
  wp.xyz += uWind * (sin(uTime*1.7 + dot(wp.xyz, vec3(0.37,0.21,0.29))*${(1.2 / KS).toFixed(3)})*0.6 + 0.5) * position.y*position.y * ${(0.05 * CELLW).toFixed(4)};
  #endif
  vW = wp.xyz; vN = normalize(mat3(mm) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
// Materialnummern: 0 glatt, 1 Planken, 2 Staemme, 3 Mauerwerk, 4 Schindeln, 5 Stoff, 6 Haut, 7 Fenster, 8 Beton,
// 9 Glasfassade, 10 Metall, 11 Stroh und Korb, 12 Laub, 13 Flamme und Lampe, 14 Ballonhuelle, 15 Haar und Rinde
const PROP_FS = `
varying vec3 vCol; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vMat; uniform float uTime; uniform vec3 uFocus;
${LIGHT_FN}
${NOISE_FN}
void main(){
  #ifdef CUTOUT
  { // Baeume und Haeuser zwischen Kamera und Blickpunkt ausblenden, damit die Wichte sichtbar bleiben
    vec3 pa = vW - cameraPosition, ba = uFocus - cameraPosition; float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float dl = length(pa - ba * hh), rad = ${(0.6 * CELLW).toFixed(4)} * (0.35 + hh);
    if (hh < 0.97 && dl < rad && length(ba) < ${(8 * CELLW).toFixed(2)}) { if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) < smoothstep(rad, rad * 0.6, dl)) discard; }
  }
  #endif
  vec3 n = normalize(vN); vec3 up = normalize(vW); vec3 V = normalize(cameraPosition - vW);
  float flag = 0.0;
  #ifdef LOCATTR
  flag = vL.z; if (!gl_FrontFacing) n = -n;
  #endif
  vec3 wp = vW * ${(1 / CELLW).toFixed(4)};
  float grime = vn(wp*1.3 + 7.0), blot = vn(wp*3.7 + 19.0);     // Schmutz und Flecken im Weltraum: keine Wand gleicht der anderen
  float day = smoothstep(-0.25, 0.30, dot(up,uSun)), night = 1.0 - day;
  float det = 1.0 - smoothstep(${(30 * CELLW).toFixed(1)}, ${(90 * CELLW).toFixed(1)}, length(cameraPosition - vW));
  float m = floor(vMat + 0.5);
  vec3 c = vCol, L = vL, emis = vec3(0.0); float spec = 0.0, u = L.x + L.z;
  if (m < 0.5) { c *= 0.95 + 0.09*vn(L*9.0)*det; }
  else if (m < 1.5) {
    float row = L.y/0.17, id = floor(row);
    float ln = smoothstep(0.40, 0.5, abs(fract(row) - 0.5));
    float g = vn(vec3(u*3.0 + id*7.3, L.y*42.0, id));
    c *= (1.0 - 0.30*ln*det) * (0.84 + 0.22*g*det + 0.10*h31(vec3(id, 1.0, 2.0)));
    c *= 1.0 - 0.22*step(0.965, fract(u*0.9 + h31(vec3(id, 3.0, 1.0))))*det;
    c = mix(c, vec3(dot(c, vec3(0.33)))*vec3(0.92,0.90,0.86), smoothstep(0.45, 0.9, grime)*0.5);       // vergrautes Holz
    c *= 1.0 - 0.22*smoothstep(0.6, 0.9, blot);
  } else if (m < 2.5) {
    float row = L.y/0.2;
    c *= 0.60 + 0.44*abs(sin(row*3.14159));
    c *= 0.88 + 0.2*vn(vec3(u*16.0, L.y*3.0, 1.0))*det;
  } else if (m < 3.5) {
    float row = floor(L.y/0.13), uu = u/0.27 + 0.5*mod(row, 2.0);
    float mort = max(smoothstep(0.42, 0.5, abs(fract(uu) - 0.5)), smoothstep(0.36, 0.5, abs(fract(L.y/0.13) - 0.5)));
    c *= mix(0.82 + 0.30*h31(vec3(floor(uu), row, 5.0)), 0.60, mort*det);
    c *= 0.93 + 0.12*vn(L*30.0)*det;
    c *= 0.84 + 0.22*grime;
    c = mix(c, c*vec3(0.62,0.82,0.52), smoothstep(0.58, 0.85, blot)*0.55);                             // Moos in den Fugen
    c = mix(c, c*vec3(1.12,1.0,0.86), step(0.8, h31(vec3(floor(uu), row, 9.0)))*0.5);                  // einzelne waermere Steine
  } else if (m < 4.5) {
    float row = L.y/0.105, uu = u/0.15 + 0.5*mod(floor(row), 2.0);
    c *= 0.70 + 0.30*smoothstep(0.0, 0.4, fract(row));
    c *= 1.0 - 0.22*smoothstep(0.42, 0.5, abs(fract(uu) - 0.5))*det;
    float tid = h31(vec3(floor(uu), floor(row), 3.0));
    c *= 0.84 + 0.28*tid;
    c *= 1.0 - 0.38*step(0.94, tid)*det;                                                               // fehlende, dunkle Schindeln
    c = mix(c, c*vec3(1.25,1.12,0.9), step(tid, 0.07)*0.6);                                            // frisch ersetzte
    c = mix(c, vec3(0.30,0.42,0.20)*(0.8 + 0.4*blot), smoothstep(0.60, 0.82, vn(wp*2.1 + 50.0))*0.6);  // Moospolster
    c = mix(c, vec3(0.80,0.80,0.66), step(0.9, vn(wp*11.0 + 4.0))*0.35*det);                           // Flechten
    c *= 0.86 + 0.22*grime;
  } else if (m < 5.5) {
    c *= 0.93 + 0.08*vn(L*60.0)*det;
    c *= 0.95 + 0.06*sin(u*17.0 + L.y*3.0);
  } else if (m < 6.5) { c *= 0.97 + 0.04*vn(L*18.0)*det; spec = 0.12; }
  else if (m < 7.5) {
    float fr = 0.0; vec3 frc = vec3(0.92,0.90,0.84);
    #ifdef LOCATTR
    if (flag > 0.5 && flag < 1.5) {            // rundes Fenster
      vec2 q = L.xy*2.0 - 1.0; float r = length(q); if (r > 1.0) discard;
      fr = max(step(0.78, r), max(step(abs(q.x), 0.07), step(abs(q.y), 0.07))); frc = vCol;
    } else if (flag > 2.5) {                   // Sprossenfenster
      vec2 g = L.xy * vec2(2.0, 3.0); fr = max(smoothstep(0.42, 0.47, abs(fract(g.x) - 0.5)), smoothstep(0.44, 0.48, abs(fract(g.y) - 0.5)));
    }
    #endif
    c = vec3(0.17,0.24,0.34) + 0.30*pow(1.0 - max(dot(n,V),0.0), 2.0);
    c *= 0.85 + 0.25*blot;
    emis = mix(vec3(1.0,0.70,0.34), vec3(1.0,0.86,0.56), grime) * night * 1.05 * (1.0 - fr); spec = 0.6*(1.0 - fr);
    c = mix(c, frc*(0.9 + 0.1*grime), fr);
  } else if (m < 8.5) {
    c *= 0.92 + 0.09*vn(L*26.0)*det;
    c *= 1.0 - 0.13*max(smoothstep(0.46, 0.5, abs(fract(L.y/0.5) - 0.5)), smoothstep(0.47, 0.5, abs(fract(u/0.62) - 0.5)))*det;
    c *= 1.0 - 0.22*smoothstep(0.55, 0.9, vn(vec3(u*7.0, L.y*0.7, 2.0)))*det;                          // Regenstreifen
    c *= 0.86 + 0.20*grime; c = mix(c, c*vec3(0.84,0.80,0.70), smoothstep(0.6, 0.9, blot)*0.4);
  } else if (m < 9.5) {
    vec2 g = vec2(u/0.21, L.y/0.25), f = fract(g);
    float mull = max(smoothstep(0.40, 0.5, abs(f.x - 0.5)), smoothstep(0.42, 0.5, abs(f.y - 0.5)));
    float id = h31(vec3(floor(g), 9.0));
    vec3 glass = mix(vec3(0.18,0.32,0.50), vec3(0.58,0.78,0.95), pow(1.0 - max(dot(n,V),0.0), 1.5)) * (0.85 + 0.3*id);
    c = mix(glass, vec3(0.15,0.17,0.21), mull);
    emis = vec3(1.0,0.82,0.50) * night * step(0.5, id) * (1.0 - mull) * 0.95; spec = 0.8*(1.0 - mull);
  } else if (m < 10.5) { c *= 0.95 + 0.08*vn(L*12.0); spec = 0.7; }
  else if (m < 11.5) {
    c *= 0.80 + 0.30*vn(vec3(L.x*38.0, L.y*5.0, L.z*38.0))*det;
    c *= 0.92 + 0.12*sin(L.y*64.0)*sin(u*64.0)*det;
  } else if (m < 12.5) {
    c *= 0.78 + 0.36*vn(vW*${(6 / CELLW).toFixed(3)} + L*2.0);
    c = mix(c, c*vec3(1.18,1.10,0.66), smoothstep(0.62, 0.9, vn(vW*${(2.2 / CELLW).toFixed(3)}))*0.35);
  } else if (m < 13.5) {
    emis = c * (1.15 + 0.35*sin(uTime*9.0 + L.y*18.0 + L.x*7.0));
  } else if (m < 14.5) { c *= 0.96 + 0.05*vn(L*7.0); spec = 0.30; }
  else if (m < 15.5) { c *= 0.82 + 0.26*vn(vec3(L.x*46.0, L.y*4.0, L.z*46.0))*det; c *= 0.85 + 0.25*grime; }
  else if (m < 16.5) {                         // Putz: fleckig, am Sockel schmutzig und bemoost, mit Rissen und abgeplatzten Stellen
    float gnd = 1.0 - smoothstep(0.0, 0.30, L.y);
    c *= 0.88 + 0.16*grime;
    c = mix(c, c*vec3(0.80,0.75,0.66), smoothstep(0.55, 0.85, blot)*0.38);
    c = mix(c, c*vec3(0.60,0.58,0.50), gnd*(0.30 + 0.45*grime));
    c = mix(c, c*vec3(0.66,0.80,0.56), gnd*smoothstep(0.45, 0.8, blot)*0.6);
    c *= 1.0 - 0.20*smoothstep(0.60, 0.9, vn(vec3(u*9.0, L.y*1.1, 3.0)))*smoothstep(0.05, 0.5, 1.0 - fract(L.y*2.0))*det;
    float crack = smoothstep(0.014, 0.0, abs(vn(wp*2.3 + 41.0) - 0.5)) * step(0.55, vn(wp*0.7 + 5.0)); c *= 1.0 - 0.40*crack*det;
    float chip = smoothstep(0.72, 0.78, vn(wp*2.9 + 77.0)) * step(0.5, grime);
    float brow = floor(L.y/0.07), bu = u/0.16 + 0.5*mod(brow, 2.0);
    vec3 brick = vec3(0.64,0.36,0.27) * (0.8 + 0.4*h31(vec3(floor(bu), brow, 2.0))) * (1.0 - 0.4*max(smoothstep(0.42, 0.5, abs(fract(bu) - 0.5)), smoothstep(0.38, 0.5, abs(fract(L.y/0.07) - 0.5))));
    c = mix(c, brick, chip*det);
    c *= 0.96 + 0.06*vn(L*40.0)*det;
  } else if (m < 17.5) {                       // Rundbogen: Tuerblatt (1) oder Rahmen (2)
    vec2 q = vec2(L.x*2.0 - 1.0, L.y);
    if ((q.y < 0.62 ? abs(q.x) : length(vec2(q.x, (q.y - 0.62)/0.38))) > 1.0) discard;
    if (flag < 1.5) {
      float pid = floor(L.x*5.0);
      c *= (1.0 - 0.30*smoothstep(0.40, 0.5, abs(fract(L.x*5.0) - 0.5))) * (0.82 + 0.24*vn(vec3(pid*7.0, L.y*22.0, 1.0)));
      c = mix(c, vec3(0.13,0.13,0.15), max(step(abs(q.y - 0.18), 0.022), step(abs(q.y - 0.56), 0.022)));
      c = mix(c, vec3(0.9,0.72,0.3), step(length(vec2(q.x - 0.62, (q.y - 0.38)*1.6)), 0.09));
      c *= 0.86 + 0.2*grime;
    } else c *= 0.90 + 0.12*grime;
  } else if (m < 18.5) {                       // Blumen: Laub mit Blueten in der Farbe des Punktes
    vec3 leaf = vec3(0.20,0.44,0.19) * (0.75 + 0.5*vn(vW*${(40 / CELLW).toFixed(2)}));
    c = mix(leaf, vCol*(0.9 + 0.2*blot), step(0.56, vn(vW*${(85 / CELLW).toFixed(2)} + 3.0)));
  } else if (m < 19.5) {                       // Efeu: ausgefranster Bewuchs, unten dicht
    vec2 q = L.xy; float seed = flag;
    float env = smoothstep(0.0, 0.3, q.x) * smoothstep(1.0, 0.7, q.x) * smoothstep(1.03, 0.55, q.y);
    float nz = vn(vec3(q*vec2(5.0, 7.0), seed*13.0))*0.6 + vn(vec3(q*vec2(15.0, 19.0), seed*7.0))*0.4;
    if (nz < 1.0 - env*0.78) discard;
    c *= 0.65 + 0.7*vn(vec3(q*vec2(34.0, 40.0), seed));
    c = mix(c, vCol*vec3(1.35,1.28,0.7), step(0.80, vn(vec3(q*46.0, seed + 3.0)))*0.6);
    c = mix(c, vec3(0.92,0.86,0.95), step(0.93, vn(vec3(q*60.0, seed + 9.0)))*0.8);
  } else {                                      // Markise: Streifen, ausgeblichen
    c = mix(c, vec3(0.96,0.94,0.88), step(0.5, fract(L.x)));
    c *= (0.86 + 0.18*grime) * (0.94 + 0.08*vn(L*40.0));
  }
  float ndl = wrapL(n, 0.15), hemi = 0.5 + 0.5*dot(n,up);
  vec3 sc = sunColor(up);
  vec3 lit = c * (skyAmb(day, hemi) + sc * ndl * day * 0.92);
  lit += c * pow(1.0 - max(dot(n,V),0.0), 3.0) * 0.16 * (0.3 + 0.7*day);
  lit += sc * pow(max(dot(n, normalize(uSun + V)), 0.0), 42.0) * spec * day;
  lit = (m > 12.5 && m < 13.5) ? emis : applyFog(lit, vW, day) + emis;
  gl_FragColor = vec4(lit, 1.0);
}`;
function propMaterial(sway, loc) { return new THREE.ShaderMaterial({ uniforms: U, vertexShader: PROP_VS, fragmentShader: PROP_FS, vertexColors: true, defines: sway ? { SWAY: 1, CUTOUT: 1 } : loc ? { LOCATTR: 1, CUTOUT: 1 } : {} }); }
const propMat = propMaterial(false), treeMat = propMaterial(true);
const MAXTREES = 36000;
let trees, trees2;
{
  const b = geoBuilder();
  b.mat(15).lathe([[0.085, 0], [0.06, 0.42]], 5, [0.45, 0.31, 0.20]);
  b.mat(12).lathe([[0.44, 0.30], [0.16, 0.62], [0.0, 0.66]], 7, [0.22, 0.47, 0.24]);
  b.lathe([[0.35, 0.56], [0.12, 0.90], [0.0, 0.94]], 7, [0.26, 0.53, 0.26]);
  b.lathe([[0.25, 0.84], [0.0, 1.26]], 7, [0.32, 0.60, 0.29]);
  trees = new THREE.InstancedMesh(b.build(), treeMat, MAXTREES);
  trees.frustumCulled = false; trees.count = 0; scene.add(trees);
  // Laubbaum: krummer Stamm, Krone aus mehreren Ballen
  const d = geoBuilder();
  d.mat(15).lathe([[0.10, 0], [0.065, 0.25], [0.055, 0.55], [0.07, 0.72]], 6, [0.40, 0.29, 0.20], { bend: i => [i * 0.03, i * 0.015] });
  d.mat(12); d.ball(0.08, 0.95, 0.03, 0.36, [0.25, 0.52, 0.22], 0.85, 7, 4); d.ball(-0.20, 0.82, 0.12, 0.26, [0.20, 0.45, 0.20], 0.9, 6, 4); d.ball(0.30, 0.80, -0.10, 0.25, [0.31, 0.58, 0.24], 0.9, 6, 4); d.ball(0.02, 0.84, -0.26, 0.24, [0.23, 0.49, 0.22], 0.9, 6, 4); d.ball(0.10, 1.22, 0.0, 0.22, [0.36, 0.63, 0.26], 0.9, 6, 4);
  trees2 = new THREE.InstancedMesh(d.build(), treeMat, MAXTREES);
  trees2.frustumCulled = false; trees2.count = 0; scene.add(trees2);
}
const YAX = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3();
function cellPos(c, lift, out) {
  const r = R + surfH(c) * LAYER + lift;
  return out.set(cdir[c * 3] * r, cdir[c * 3 + 1] * r, cdir[c * 3 + 2] * r);
}
function surfH(c) { return W[c] > 0.35 ? H[c] + W[c] - 0.3 : H[c]; }
const treeC = new THREE.Vector3(0, 0, 0); let treeRad = -1;
function rebuildTrees() {
  let n = 0, n2 = 0; const sapl = (state.nature && state.nature.sap) || {};
  const rad = Math.min(0.5, 0.05 + cam.s / R * 0.9), cl = Math.cos(rad);
  treeC.copy(cam.u); treeRad = rad;
  for (let c = 0; c < NC && n < MAXTREES - 2 && n2 < MAXTREES - 2; c++) {
    if (MAT[c] !== FOREST || W[c] > 0.3 || slotOf[c] < 0) continue;
    if (cdir[c * 3] * treeC.x + cdir[c * 3 + 1] * treeC.y + cdir[c * 3 + 2] * treeC.z < cl) continue;
    const r = R + H[c] * LAYER;
    _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]);
    _q.setFromUnitVectors(YAX, _v);
    const dense = denseAt(c), born = sapl[c], grow = born === undefined ? 1 : 0.22 + 0.78 * Math.min(1, Math.max(0, (state.clock - born) / NAT.growH));
    for (let j = 0, cnt = dense ? 4 : 2; j < cnt; j++) {
      // Versatz Richtung der Ecken, im dichten Wald stehen vier Baeume je Zelle
      const i = j * 16, t = cellCorner[c * 6 + (Math.floor(hashI(c, 50) * ncnt[c]) + j * (dense ? 1 : 3) + (j > 1 ? 1 : 0)) % ncnt[c]], f = (dense ? 0.2 : 0.25) + (dense ? 0.5 : 0.3) * hashI(c, 52 + i);
      const rt = r + (cornerH(c, t) - H[c]) * LAYER * f - CELLW * 0.03;
      _v2.set(cdir[c * 3] + (cbase[t * 3] - cdir[c * 3]) * f, cdir[c * 3 + 1] + (cbase[t * 3 + 1] - cdir[c * 3 + 1]) * f, cdir[c * 3 + 2] + (cbase[t * 3 + 2] - cdir[c * 3 + 2]) * f).normalize().multiplyScalar(rt);
      const sc = CELLW * 0.55 * (0.8 + 0.55 * hashI(c, 54 + i)) * grow * (dense ? 1.0 + 0.45 * hashI(c, 64 + i) : 1);
      _q2.setFromAxisAngle(YAX, hashI(c, 56 + i) * TAU); _q2.premultiply(_q);
      // Laubbaeume in Flecken, dazwischen Nadelbaeume
      const leafy = vnoise(cdir[c * 3] * 23 + 4, cdir[c * 3 + 1] * 23, cdir[c * 3 + 2] * 23, 95) + (hashI(c, 60 + i) - 0.5) * 0.5 > (CONT[c] === 1 ? 0.35 : -0.05);
      if (leafy) { const s2 = sc * (1.05 + 0.5 * hashI(c, 62 + i)); _m.compose(_v2, _q2, _s.set(s2, s2 * (0.85 + 0.35 * hashI(c, 58 + i)), s2)); trees2.setMatrixAt(n2++, _m); }
      else { _m.compose(_v2, _q2, _s.set(sc, sc * (0.9 + 0.4 * hashI(c, 58 + i)), sc)); trees.setMatrixAt(n++, _m); }
    }
  }
  trees.count = n; trees.instanceMatrix.needsUpdate = true; trees2.count = n2; trees2.instanceMatrix.needsUpdate = true;
}

const TIERS = ['Zelt', 'Baumhaus', 'Holzhuette', 'Blockhaus', 'Steinhaus', 'Betonhaus', 'Stahlskeletthaus'];
const TIERNAMES = ['Tent', 'Treehouse', 'Wooden hut', 'Log cabin', 'Stone house', 'Concrete house', 'Steel-frame tower'];
const TIERCOST = [0, 40, 80, 160, 300, 500, 800];
let houseMesh = null;
function buildHouse(tier) {
  const b = geoBuilder(), glass = [0.2, 0.28, 0.38], trim = [0.93, 0.90, 0.82], dwood = [0.36, 0.24, 0.15], gold = [0.96, 0.78, 0.26];
  // etwas auf eine der vier Seiten setzen: 0 vorn, 1 rechts, 2 hinten, 3 links
  const side = (sd, off, y, ww, hh, dp, col, w, d) => {
    if (sd === 0) b.box(off, y, d / 2 + dp / 2 - 0.004, ww, hh, dp, col); else if (sd === 2) b.box(off, y, -d / 2 - dp / 2 + 0.004, ww, hh, dp, col);
    else if (sd === 1) b.box(w / 2 + dp / 2 - 0.004, y, off, dp, hh, ww, col); else b.box(-w / 2 - dp / 2 + 0.004, y, off, dp, hh, ww, col);
  };
  const windows = (y, w, d, per, ww = 0.17, hh = 0.22, tc = trim) => {
    for (let sd = 0; sd < 4; sd++) for (let i = 0; i < per; i++) {
      const off = ((i + 0.5) / per - 0.5) * (sd % 2 ? d : w) * 0.8;
      b.mat(0); side(sd, off, y - 0.025, ww + 0.05, hh + 0.05, 0.025, tc, w, d);
      b.mat(7); side(sd, off, y, ww, hh, 0.04, glass, w, d);
      b.mat(0); side(sd, off, y + hh / 2 - 0.008, ww, 0.016, 0.05, tc, w, d);
    }
  };
  const door = (w, d, col = dwood) => { b.mat(0); side(0, 0, 0, 0.3, 0.42, 0.03, trim, w, d); b.mat(1); side(0, 0, 0, 0.24, 0.38, 0.05, col, w, d); b.mat(10); b.box(0.07, 0.17, d / 2 + 0.05, 0.03, 0.03, 0.03, gold); };
  const chimney = (x, z, y0, y1) => { b.mat(3).box(x, y0, z, 0.2, y1 - y0, 0.2, [0.62, 0.56, 0.52]); b.mat(0).box(x, y1, z, 0.25, 0.05, 0.25, [0.30, 0.28, 0.28]); };
  const fh = 0.5;
  if (tier === 0) {
    const canvas = [0.93, 0.88, 0.72];
    b.mat(5); b.gable(0, 1.25, 1.1, 0.9, canvas); b.gableEnds(0, 1.25, 1.1, 0.9, [0.86, 0.80, 0.64]);
    b.mat(0); b.tri([0.63, 0, 0.3], [0.63, 0, -0.3], [0.63, 0.62, 0], [0.16, 0.13, 0.12]);
    b.mat(15); b.box(0, 0.86, 0, 1.5, 0.05, 0.05, dwood);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.6, 0, sz * 0.66, 0.05, 0.1, 0.05, dwood);
    b.mat(3); for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; b.box(1.15 + Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2, 0.1, 0.07, 0.1, [0.52, 0.52, 0.55]); }
    b.mat(15); b.box(1.15, 0.03, 0, 0.3, 0.06, 0.07, dwood); b.box(1.15, 0.03, 0, 0.07, 0.06, 0.3, dwood);
    b.mat(13); b.cone(1.15, 0.07, 0, 0.11, 0.34, 6, [1.0, 0.62, 0.18]); b.cone(1.15, 0.07, 0, 0.06, 0.22, 5, [1.0, 0.88, 0.45], 0.5);
  } else if (tier === 1) {
    b.mat(15).lathe([[0.36, 0], [0.26, 0.3], [0.2, 0.9], [0.19, 1.4], [0.24, 1.55]], 9, [0.42, 0.29, 0.18]);
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.6; b.box(Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3, 0.14, 0.14, 0.14, [0.40, 0.27, 0.17]); }
    b.mat(1).box(0, 1.5, 0, 1.7, 0.08, 1.7, [0.62, 0.44, 0.27]);
    b.box(0, 1.58, 0, 1.1, 0.6, 1.1, [0.76, 0.56, 0.35]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.8, 1.58, sz * 0.8, 0.05, 0.3, 0.05, dwood);
    for (const sx of [-1, 1]) { b.box(sx * 0.8, 1.84, 0, 0.04, 0.04, 1.6, dwood); b.box(0, 1.84, sx * 0.8, 1.6, 0.04, 0.04, dwood); }
    b.mat(7); b.box(0.3, 1.78, 0.56, 0.2, 0.22, 0.03, glass); b.box(0.56, 1.78, 0, 0.03, 0.22, 0.2, glass); b.box(-0.56, 1.78, 0, 0.03, 0.22, 0.2, glass);
    b.mat(1).box(-0.25, 1.58, 0.56, 0.24, 0.4, 0.03, dwood);
    b.mat(4); b.xf(new THREE.Matrix4().makeTranslation(0, 2.18, 0)); b.gable(0, 1.45, 1.4, 0.55, [0.62, 0.30, 0.22]); b.mat(1); b.gableEnds(0, 1.1, 1.1, 0.42, [0.70, 0.52, 0.32]); b.xf(null);
    b.mat(15); for (const sx of [-1, 1]) b.box(sx * 0.13, 0, 0.9, 0.04, 1.55, 0.04, dwood); for (let i = 1; i < 8; i++) b.box(0, i * 0.19, 0.9, 0.26, 0.035, 0.035, dwood);
    b.mat(12); b.ball(0, 3.25, -0.2, 0.95, [0.26, 0.52, 0.27], 0.85, 9, 6); b.ball(0.95, 2.75, -0.5, 0.62, [0.22, 0.47, 0.24], 0.9, 8, 5); b.ball(-0.95, 2.8, 0.1, 0.66, [0.30, 0.57, 0.28], 0.9, 8, 5); b.ball(0.2, 2.85, -1.0, 0.6, [0.24, 0.50, 0.25], 0.9, 8, 5);
  } else if (tier === 2 || tier === 3) {
    const w = 1.4, d = 1.25, fl = tier === 2 ? 2 : 3, hgt = fl * fh, log = tier === 3;
    b.mat(3).box(0, 0, 0, w + 0.08, 0.12, d + 0.08, [0.60, 0.58, 0.56]);
    b.mat(log ? 2 : 1).box(0, 0.12, 0, w, hgt - 0.12, d, log ? [0.58, 0.40, 0.25] : [0.80, 0.60, 0.38]);
    b.mat(15); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * w / 2, 0, sz * d / 2, 0.1, hgt, 0.1, log ? [0.40, 0.27, 0.17] : [0.52, 0.36, 0.22]);
    for (let f = 1; f < fl; f++) { b.mat(1); b.box(0, f * fh - 0.03, 0, w + 0.06, 0.06, d + 0.06, dwood); }
    for (let f = 0; f < fl; f++) windows(f * fh + 0.17, w, d, 2, 0.16, 0.2, log ? [0.80, 0.72, 0.58] : trim);
    door(w, d, log ? [0.30, 0.20, 0.13] : [0.46, 0.24, 0.18]);
    if (log) { b.mat(1).box(0, fh * 2 - 0.02, d / 2 + 0.2, 0.9, 0.05, 0.4, dwood); b.mat(15); for (const sx of [-1, 0, 1]) b.box(sx * 0.42, fh * 2, d / 2 + 0.38, 0.04, 0.22, 0.04, dwood); b.box(0, fh * 2 + 0.2, d / 2 + 0.38, 0.9, 0.04, 0.04, dwood); }
    b.xf(new THREE.Matrix4().makeTranslation(0, hgt, 0));
    b.mat(4).gable(0, w + 0.3, d + 0.34, 0.72, log ? [0.34, 0.30, 0.30] : [0.68, 0.30, 0.22]);
    b.mat(log ? 2 : 1).gableEnds(0, w, d, 0.6, log ? [0.58, 0.40, 0.25] : [0.80, 0.60, 0.38]); b.xf(null);
    b.mat(7).box(w / 2 + 0.005, hgt + 0.12, 0, 0.03, 0.2, 0.18, glass);
    chimney(-0.4, -0.25, hgt + 0.2, hgt + 0.95);
  } else if (tier === 4) {
    const w = 1.45, d = 1.35, fl = 5, hgt = fl * fh, stone = [0.70, 0.68, 0.64];
    b.mat(3).box(0, 0, 0, w + 0.1, 0.16, d + 0.1, [0.52, 0.51, 0.50]);
    b.box(0, 0.16, 0, w, hgt - 0.16, d, stone);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * w / 2, 0, sz * d / 2, 0.14, hgt, 0.14, [0.82, 0.80, 0.76]);
    for (let f = 1; f < fl; f++) b.mat(0).box(0, f * fh - 0.025, 0, w + 0.05, 0.05, d + 0.05, [0.84, 0.82, 0.78]);
    for (let f = 0; f < fl; f++) windows(f * fh + 0.16, w, d, 2, 0.17, 0.24);
    door(w, d, [0.34, 0.22, 0.14]); b.mat(0).box(0, 0.42, d / 2 + 0.04, 0.4, 0.06, 0.08, [0.84, 0.82, 0.78]);
    b.mat(0).box(0, hgt, 0, w + 0.16, 0.07, d + 0.16, [0.84, 0.82, 0.78]);
    b.mat(4).cone(0, hgt + 0.07, 0, (w + 0.2) * 0.72, 0.95, 4, [0.33, 0.36, 0.44], 0.785);
    chimney(0.45, 0.3, hgt + 0.1, hgt + 0.95); chimney(-0.45, -0.3, hgt + 0.1, hgt + 0.85);
  } else if (tier === 5) {
    const w = 1.5, d = 1.4, fl = 7, hgt = fl * fh, conc = [0.86, 0.86, 0.84];
    b.mat(8).box(0, 0, 0, w, hgt, d, conc);
    for (let f = 0; f < fl; f++) {
      b.mat(7); for (let sd = 0; sd < 4; sd++) { if (f === 0 && sd === 0) continue; side(sd, 0, f * fh + 0.16, (sd % 2 ? d : w) * 0.82, 0.2, 0.03, glass, w, d); }
      b.mat(8); if (f > 0) { b.box(0, f * fh - 0.03, d / 2 + 0.14, w * 0.7, 0.06, 0.28, [0.78, 0.78, 0.76]); b.mat(10).box(0, f * fh + 0.03, d / 2 + 0.27, w * 0.7, 0.14, 0.02, [0.30, 0.32, 0.36]); }
    }
    b.mat(7); side(0, -0.4, 0.14, 0.34, 0.24, 0.03, glass, w, d); side(0, 0.4, 0.14, 0.34, 0.24, 0.03, glass, w, d); door(w, d, [0.26, 0.28, 0.32]);
    b.mat(8).box(0, hgt, 0, w + 0.08, 0.14, d + 0.08, [0.78, 0.78, 0.76]); b.box(0, hgt + 0.02, 0, w - 0.12, 0.13, d - 0.12, [0.62, 0.62, 0.60]);
    b.mat(10).lathe([[0.22, hgt + 0.3], [0.22, hgt + 0.62], [0.0, hgt + 0.7]], 10, [0.55, 0.58, 0.62], { x: 0.4, z: -0.35 }); for (const a of [0, 2.1, 4.2]) b.box(0.4 + Math.sin(a) * 0.17, hgt + 0.14, -0.35 + Math.cos(a) * 0.17, 0.04, 0.18, 0.04, [0.30, 0.32, 0.36]);
    b.mat(12).ball(-0.4, hgt + 0.32, 0.3, 0.22, [0.28, 0.56, 0.28], 0.9, 7, 4); b.mat(0).box(-0.4, hgt + 0.14, 0.3, 0.3, 0.1, 0.3, [0.62, 0.40, 0.28]);
  } else {
    const w = 1.5, d = 1.5, fl = 12, steel = [0.20, 0.23, 0.29];
    b.mat(8).box(0, 0, 0, w + 0.16, 0.1, d + 0.16, [0.70, 0.70, 0.70]);
    b.mat(9).box(0, 0.1, 0, w, 9 * fh, d, [0.5, 0.7, 0.85]); b.box(0, 0.1 + 9 * fh, 0, w - 0.4, 3 * fh, d - 0.4, [0.5, 0.7, 0.85]);
    b.mat(10); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.box(sx * w / 2, 0.1, sz * d / 2, 0.09, 9 * fh, 0.09, steel); b.box(sx * (w - 0.4) / 2, 0.1 + 9 * fh, sz * (d - 0.4) / 2, 0.07, 3 * fh, 0.07, steel); }
    for (const y of [0.1 + 3 * fh, 0.1 + 6 * fh, 0.1 + 9 * fh]) b.box(0, y - 0.03, 0, w + 0.08, 0.06, d + 0.08, steel);
    b.box(0, 0.1 + 12 * fh, 0, w - 0.32, 0.07, d - 0.32, steel); door(w, d, steel);
    b.box(0, 0.17 + 12 * fh, 0, 0.3, 0.3, 0.3, [0.42, 0.45, 0.50]); b.lathe([[0.03, 0.47 + 12 * fh], [0.012, 1.7 + 12 * fh]], 5, steel);
    b.mat(13).ball(0, 1.74 + 12 * fh, 0, 0.05, [1.0, 0.25, 0.2], 1, 6, 3);
  }
  return new THREE.Mesh(b.build(), propMat);
}
// Bauflaechen, die das Lager belegt: eine, bei grossen Haeusern die Zelle und ihre sechs Nachbarn
function campCells(tier) { return state.camp >= 0 ? homeCellsOf(state.camp, tier) : []; }
function placeHouse() {
  if (houseMesh) { scene.remove(houseMesh); houseMesh.geometry.dispose(); houseMesh = null; }
  const key = state.home >= 0 && state.camp >= 0 ? state.camp + ':' + state.tier : '';
  if (key !== homeKey) {
    if (!key && homeKey) { const q = homeKey.split(':'); releaseHome(+q[0], +q[1]); }     // Feld verloren: das Haus bleibt als herrenloser Bau stehen
    if (key && state.tier > 0) stampHome(state.camp, state.tier, homeKey === '');
    homeKey = key;
  }
  if (state.home < 0 || state.camp < 0 || state.tier > 0) return;        // nur das Zelt ist noch ein eigenes Modell
  const c = state.camp;
  houseMesh = buildHouse(0); houseMesh.frustumCulled = false;
  const sc = CELLW * HOUSESC[0];
  houseMesh.scale.set(sc, sc, sc);
  _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]);
  houseMesh.quaternion.setFromUnitVectors(YAX, _v);
  houseMesh.position.copy(_v).multiplyScalar(R + H[c] * LAYER);
  scene.add(houseMesh);
}

// Leuchtfeuer auf den Zufluchten
{
  const b = geoBuilder();
  b.mat(3).lathe([[0.42, 0], [0.34, 0.3], [0.28, 2.2], [0.36, 2.3], [0.36, 2.4]], 10, [0.86, 0.80, 0.72]);
  b.mat(10); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; b.box(Math.sin(a) * 0.3, 2.4, Math.cos(a) * 0.3, 0.04, 0.42, 0.04, [0.26, 0.28, 0.32]); }
  b.mat(13).ball(0, 2.62, 0, 0.2, [1.0, 0.80, 0.36], 1, 8, 5);
  b.mat(4).lathe([[0.42, 2.82], [0.0, 3.3]], 8, [0.66, 0.28, 0.22]);
  const beacons = new THREE.InstancedMesh(b.build(), propMat, refuges.length);
  beacons.frustumCulled = false; scene.add(beacons);
  window.__placeBeacons = () => {
    refuges.forEach((c, i) => {
      _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); _q.setFromUnitVectors(YAX, _v);
      _v2.copy(_v).multiplyScalar(R + H[c] * LAYER); const sc = CELLW / 3;
      _m.compose(_v2, _q, _s.set(sc, sc, sc)); beacons.setMatrixAt(i, _m);
    });
    beacons.instanceMatrix.needsUpdate = true;
  };
}

// Figur
const figure = new THREE.Group();
{
  const body = makeGnome(randomAvatar()); const sc = GS;
  figure.add(body);
  const mk = geoBuilder(); mk.cone(0, 0, 0, 0.5, -0.9, 4, [1.0, 0.80, 0.30]); mk.cone(0, 0, 0, 0.5, 0.45, 4, [1.0, 0.90, 0.55]);
  const marker = new THREE.Mesh(mk.build(), new THREE.ShaderMaterial({
    vertexColors: true, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vC; void main(){ vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor=vec4(vC,1.0);}'
  }));
  marker.frustumCulled = false; figure.add(marker); figure.userData.marker = marker; figure.userData.body = body;
  const wood = [0.60, 0.42, 0.25], dwood = [0.38, 0.26, 0.16];
  const bb = geoBuilder().mat(1);
  { // Rumpf aus Spanten
    const zs = [-0.80, -0.58, -0.22, 0.2, 0.52, 0.76, 0.98], ws = [0.24, 0.38, 0.46, 0.46, 0.36, 0.20, 0.0], ks = [-0.04, -0.14, -0.19, -0.19, -0.14, -0.05, 0.16], gy = [0.25, 0.2, 0.18, 0.18, 0.21, 0.27, 0.36];
    const K = i => [0, ks[i], zs[i]], Cs = (i, sx) => [sx * ws[i] * 0.78, (ks[i] + gy[i]) / 2 - 0.04, zs[i]], Gs = (i, sx) => [sx * ws[i], gy[i], zs[i]], Dk = (i, sx) => [sx * ws[i] * 0.9, gy[i] - 0.09, zs[i]];
    for (let i = 0; i < zs.length - 1; i++) {
      bb.quad(K(i), Cs(i, 1), Cs(i + 1, 1), K(i + 1), wood); bb.quad(Cs(i, 1), Gs(i, 1), Gs(i + 1, 1), Cs(i + 1, 1), [0.66, 0.47, 0.28]);
      bb.quad(K(i + 1), Cs(i + 1, -1), Cs(i, -1), K(i), wood); bb.quad(Cs(i + 1, -1), Gs(i + 1, -1), Gs(i, -1), Cs(i, -1), [0.66, 0.47, 0.28]);
      bb.quad(Dk(i, -1), Dk(i + 1, -1), Dk(i + 1, 1), Dk(i, 1), [0.74, 0.58, 0.38]);
      bb.quad(Gs(i, 1), Dk(i, 1), Dk(i + 1, 1), Gs(i + 1, 1), dwood); bb.quad(Gs(i + 1, -1), Dk(i + 1, -1), Dk(i, -1), Gs(i, -1), dwood);
    }
    bb.quad(Gs(0, -1), Gs(0, 1), Cs(0, 1), Cs(0, -1), dwood); bb.tri(Cs(0, -1), Cs(0, 1), K(0), dwood);
    bb.box(0, 0.1, -0.35, 0.8, 0.05, 0.16, dwood); bb.box(0, -0.02, -0.86, 0.04, 0.3, 0.14, dwood);
    bb.mat(15).lathe([[0.04, 0.1], [0.022, 2.35]], 6, dwood, { z: 0.1 });
    bb.mat(10).ball(0, 2.37, 0.1, 0.035, [0.96, 0.78, 0.26], 1, 6, 3);
  }
  const boat = new THREE.Group(); boat.visible = false;
  const hull = new THREE.Mesh(bb.build(), propMat); hull.frustumCulled = false; hull.scale.set(sc, sc, sc); boat.add(hull);
  const sb = geoBuilder().mat(5);
  { // Segel, gewoelbt, von beiden Seiten sichtbar
    const rows = 6, cols = 5, pt = (i, j) => { const y = 0.5 + 1.6 * i / rows, wd = 0.95 * (1 - 0.82 * i / rows), sx = j / cols; return [0.16 * Math.sin(Math.PI * sx) * (1 - 0.5 * i / rows), y, -wd * sx]; };
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const col = i % 2 ? [0.96, 0.93, 0.84] : [0.88, 0.30, 0.26];
      sb.quad(pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j), col); sb.quad(pt(i, j + 1), pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), col);
    }
    sb.mat(15).box(0, 0.46, -0.48, 0.035, 0.035, 1.0, dwood);
  }
  const sail = new THREE.Mesh(sb.build(), propMat); sail.frustumCulled = false; sail.scale.set(sc, sc, sc); sail.position.set(0, 0, 0.1 * sc); boat.add(sail);
  const pb = geoBuilder().mat(5); pb.tri([0, 2.3, 0], [0, 2.14, 0], [0, 2.22, -0.4], [0.9, 0.25, 0.22]); pb.tri([0, 2.14, 0], [0, 2.3, 0], [0, 2.22, -0.4], [0.9, 0.25, 0.22]);
  const pennant = new THREE.Mesh(pb.build(), propMat); pennant.frustumCulled = false; pennant.scale.set(sc, sc, sc); pennant.position.set(0, 0, 0.1 * sc); boat.add(pennant);
  boat.scale.setScalar(1.5);
  figure.add(boat); figure.userData.boat = boat; figure.userData.sail = sail; figure.userData.pennant = pennant;
  // Heissluftballon
  const ba = geoBuilder();
  ba.mat(11).box(0, -0.05, 0, 1.0, 0.72, 1.0, [0.66, 0.48, 0.28]); ba.mat(15).box(0, 0.64, 0, 1.08, 0.07, 1.08, dwood);
  ba.mat(15); for (const sx of [-1, 1]) for (const sz of [-1, 1]) ba.box(sx * 0.46, 0.7, sz * 0.46, 0.025, 2.25, 0.025, [0.80, 0.74, 0.60]);
  ba.mat(10).box(0, 2.35, 0, 0.3, 0.14, 0.3, [0.40, 0.42, 0.46]);
  ba.mat(13).cone(0, 2.49, 0, 0.12, 0.42, 6, [1.0, 0.66, 0.2]); ba.cone(0, 2.49, 0, 0.06, 0.28, 5, [1.0, 0.9, 0.5], 0.5);
  const stripes = [[0.90, 0.28, 0.24], [0.97, 0.93, 0.82], [0.96, 0.72, 0.22], [0.97, 0.93, 0.82]];
  ba.mat(14).lathe([[0.50, 2.92], [0.70, 3.12], [1.32, 3.9], [1.78, 4.8], [1.92, 5.5], [1.74, 6.2], [1.18, 6.76], [0.5, 7.02], [0, 7.07]], 16, (i, q) => stripes[q % 4]);
  ba.mat(5).lathe([[0.50, 2.80], [0.50, 2.94]], 16, [0.50, 0.20, 0.18]);
  const balloon = new THREE.Mesh(ba.build(), propMat); balloon.frustumCulled = false; balloon.scale.set(sc, sc, sc); balloon.visible = false;
  balloon.scale.multiplyScalar(1.25);
  figure.add(balloon); figure.userData.balloon = balloon;
  figure.visible = false; scene.add(figure);
}

// Markierungen: Zelle unter dem Zeiger, eigenes Feld
const hoverGeo = new THREE.BufferGeometry(); hoverGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21), 3));
const hoverLine = new THREE.LineLoop(hoverGeo, lineMat(1, 1, 1, 0.95)); hoverLine.frustumCulled = false; hoverLine.visible = false; hoverLine.renderOrder = 7; scene.add(hoverLine);
const homeGeo = new THREE.BufferGeometry(); homeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
const homeLine = new THREE.LineSegments(homeGeo, lineMat(1.0, 0.78, 0.30, 1)); homeLine.frustumCulled = false; homeLine.renderOrder = 7; scene.add(homeLine);
function setHover(c) {
  if (c < 0) { hoverLine.visible = false; return; }
  const a = hoverGeo.attributes.position.array, m = ncnt[c];
  for (let k = 0; k < 7; k++) { const t = cellCorner[c * 6 + (k < m ? k : 0)], rr = R + cornerSurf(c, t) * LAYER + 0.07 * KS; cornerDir(t); a[k * 3] = tmp[0] * rr; a[k * 3 + 1] = tmp[1] * rr; a[k * 3 + 2] = tmp[2] * rr; }
  hoverGeo.setDrawRange(0, m); hoverGeo.attributes.position.needsUpdate = true; hoverLine.visible = true;
}
const prevGeo = new THREE.BufferGeometry(); prevGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
const prevLine = new THREE.LineSegments(prevGeo, lineMat(1, 1, 1, 0.9)); prevLine.frustumCulled = false; prevLine.renderOrder = 7; prevLine.visible = false; scene.add(prevLine);
let prevField = -1;
function setPreviewField(f) {
  if (f === prevField) return; prevField = f;
  if (f >= 0 && state.home < 0) $('cnt-home').textContent = (fieldOwner[f] !== -1 ? 'owned' : fieldPrice(f) + ' T'); else if (state.home < 0) $('cnt-home').textContent = 'from ' + FIELDPRICE + ' T';
  if (f < 0) { prevLine.visible = false; return; }
  fieldOutline(f, prevGeo); prevLine.visible = true;
}
function rebuildHomeLine() { fieldOutline(state.home, homeGeo); }
function fieldOutline(fid, geo) {
  const pts = [];
  if (fid >= 0) for (let c = 0; c < NC; c++) {
    if (fieldOf[c] !== fid) continue;
    for (let k = 0; k < ncnt[c]; k++) {
      const nb = cellNb[c * 6 + k]; if (fieldOf[nb] === fid) continue;
      for (const t of [cellCorner[c * 6 + k], cellCorner[c * 6 + (k + 1) % ncnt[c]]]) {
        const rr = R + Math.max(cornerSurf(c, t), cornerSurf(nb, t)) * LAYER + 0.09 * KS;
        cornerDir(t); pts.push(tmp[0] * rr, tmp[1] * rr, tmp[2] * rr);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.length ? pts : [0, 0, 0]), 3));
  geo.setDrawRange(0, pts.length / 3);
}

/* ---------------- Nachbearbeitung: Unschaerfe am Rand ---------------- */
let rt = null;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  uniforms: { tD: { value: null }, uPx: { value: new THREE.Vector2() }, uBlur: { value: 0 } },
  depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
uniform sampler2D tD; uniform vec2 uPx; uniform float uBlur; varying vec2 vUv;
void main(){
  vec2 c = vUv - vec2(0.5, 0.5);
  float d = length(vec2(c.x*0.55, c.y));
  float r = uBlur * smoothstep(0.13, 0.52, d);
  vec3 col;
  if (r < 0.6) col = texture2D(tD, vUv).rgb;
  else {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 20; i++) {
      float fi = float(i) + 0.5; float rr = sqrt(fi/20.0) * r; float a = fi * 2.39996323;
      acc += texture2D(tD, vUv + vec2(cos(a), sin(a)) * rr * uPx).rgb;
    }
    col = acc / 20.0;
  }
  col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, 1.14);
  col = pow(max(col, 0.0), vec3(0.94));
  float vig = smoothstep(1.05, 0.35, length(c * vec2(1.0, 1.15)));
  col *= mix(0.70, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}`
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const pw = Math.max(2, Math.floor(w * pixelRatio)), ph = Math.max(2, Math.floor(h * pixelRatio));
  if (rt) rt.dispose();
  rt = new THREE.WebGLRenderTarget(pw, ph, { samples: 4, depthBuffer: true });
  rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter;
  postMat.uniforms.tD.value = rt.texture; postMat.uniforms.uPx.value.set(1 / pw, 1 / ph);
  U.uPx.value = ph * camera.projectionMatrix.elements[5] / 2;
}
window.addEventListener('resize', resize);

/* ---------------- Spielzustand ---------------- */
const TOOLS = [
  { id: 'walk', name: 'Walk' },
  { id: 'dig', name: 'Shovel', pack: 50, price: 10 },
  { id: 'axe', name: 'Axe', pack: 30, price: 6 },
  { id: 'fill', name: 'Fill' },
  { id: 'beton', name: 'Concrete', pack: 10, price: 30 },
  { id: 'build', name: 'Build' },
  { id: 'paint', name: 'Paint', pack: 20, price: 15 },
  { id: 'seed', name: 'Seeds', pack: 10, price: 5 },
  { id: 'boat', name: 'Boat' },
  { id: 'balloon', name: 'Balloon' },
  { id: 'home', name: 'Field' }
];
const FIELDPRICE = 60;
const TIERNEED = [null, { holz: 4 }, { holz: 8 }, { holz: 16 }, { stein: 20 }, { stein: 12, beton: 10 }, { stein: 30, beton: 20 }];
const BOATNEED = { holz: 6 }, BOATPRICE = 100, BALLOONNEED = { holz: 10, paint: 10 }, BALLOONPRICE = 600;
// Bauplaene fuer Etagen: erst kaufbar und nutzbar, wenn das eigene Lager die Stufe erreicht hat
const BPLANS = [{ key: 'b_timber', name: 'Timber building', price: 120, tier: 2, mat: 1 }, { key: 'b_stone', name: 'Stone building', price: 300, tier: 4, mat: 2 }, { key: 'b_concrete', name: 'Concrete building', price: 500, tier: 5, mat: 3 }];
const BREQ = [null, { plan: 'b_timber', tier: 2 }, { plan: 'b_stone', tier: 4 }, { plan: 'b_concrete', tier: 5 }];
const NEEDNAME = { holz: 'wood', stein: 'stone', beton: 'concrete', paint: 'paint' };
const needText = n => Object.keys(n).map(k => n[k] + ' ' + NEEDNAME[k]).join(', ');
const have = k => (k === 'beton' || k === 'paint') ? state.uses[k] : state.inv[k];
function payNeed(n, what) {
  for (const k of Object.keys(n)) if (have(k) < n[k]) { toast(what + ' needs ' + needText(n) + '. You have ' + have(k) + ' ' + NEEDNAME[k] + '.'); return false; }
  for (const k of Object.keys(n)) { if (k === 'beton' || k === 'paint') state.uses[k] -= n[k]; else state.inv[k] -= n[k]; }
  return true;
}
let state;
const sk = k => (state && state.avatar && state.avatar.skills && state.avatar.skills[k]) || 0;
function freshState() { return { credit: 100, lastTx: null, protDay: null, boxCool: 0, boatWear: 0, traders: null, econ: null, bots: null, lastDay: null, avatar: null, plans: {}, boat: false, balloon: false, clock: 0, sea: 0, pot: 0, box: null, activity: 0, lastHour: 0, tokens: 100, uses: { dig: 50, axe: 10, beton: 0, paint: 0, seed: 0, gas: 0 }, inv: { erde: 0, stein: 0, holz: 0 }, home: -1, camp: -1, tier: 0, cell: 0, paint: 0, bmat: 1 }; }
let tool = 'walk';
const SAVEKEY = 'hexplanet-v5-' + N;
const edited = new Set();
let saveTimer = 0, saveDirty = false;
function save() {
  if (LEAGUE_MODE) return;          // die Liga-Ansicht schreibt nie in den Spielstand des Zuschauers
  const e = []; for (const c of edited) e.push(c, H[c], MAT[c], PAINT[c]);
  state.sea = seaLevel;
  const bl = []; for (const c of builtCells) { bl.push(c, BN[c]); for (let i = 0; i < BN[c]; i++) bl.push(BLD[c * MAXF + i]); }
  const dm = []; for (const c of builtCells) if (DMG[c]) dm.push(c, DMG[c]);
  try { localStorage.setItem(SAVEKEY, JSON.stringify({ e, b: bl, d: dm, state })); } catch (err) { /* ohne Speicher laeuft es trotzdem */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVEKEY) || 'null');
    if (!s || !s.e || !s.state) return false;
    genWorld(); edited.clear(); BN.fill(0); DMG.fill(0); builtCells.clear();
    if (s.d) for (let i = 0; i + 1 < s.d.length; i += 2) if (s.d[i] >= 0 && s.d[i] < NC) DMG[s.d[i]] = s.d[i + 1];
    if (s.b) for (let i = 0; i < s.b.length;) { const c = s.b[i++], n = s.b[i++]; if (c >= 0 && c < NC && n <= MAXF) { BN[c] = n; for (let q = 0; q < n; q++) BLD[c * MAXF + q] = s.b[i + q]; builtCells.add(c); } i += n; }
    for (let i = 0; i + 3 < s.e.length; i += 4) { const c = s.e[i]; if (c >= 0 && c < NC) { H[c] = s.e[i + 1]; MAT[c] = s.e[i + 2]; PAINT[c] = s.e[i + 3]; edited.add(c); } }
    state = Object.assign(freshState(), s.state); state.uses = Object.assign(freshState().uses, state.uses);
    if (state.home >= 0 && !(state.camp >= 0) && state.tier > 0) state.camp = fieldCenter[state.home];
    return true;
  } catch (e) { return false; }
}

function findStart() {
  if (npcs.length) {       // neben dem Haendler der groessten Landflaeche
    const n = npcs[0].cell;
    for (let k = 0; k < ncnt[n]; k++) { const o = cellNb[n * 6 + k]; if (H[o] >= 0 && W[o] < 0.05 && Math.abs(H[o] - H[n]) <= 2 && npcAt[o] < 0) return o; }
  }
  let best = 0, bd = -2;
  for (let f = 0; f < NF; f++) {
    const c = fieldCenter[f]; if (H[c] < 1 || H[c] > 4 * HS || MAT[c] === PLAZA || W[c] > 0.05) continue;
    const d = cdir[c * 3] * CONTC[0][0] + cdir[c * 3 + 1] * CONTC[0][1] + cdir[c * 3 + 2] * CONTC[0][2];
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

function initWorld(fromSave) {
  if (!fromSave) { genWorld(); state = freshState(); edited.clear(); BN.fill(0); DMG.fill(0); builtCells.clear(); }
  bldDirty = true; fxDirty = true;
  seaLevel = (fromSave && state.sea) || 0; simLive = false; natural = 0;
  W.fill(0); floodOcean();
  computeShore(SH);
  for (let i = 0; i < (N > 100 ? 110 : N > 60 ? 260 : 520); i++) simStep();
  simLive = true;
  if (!fromSave) state.cell = findStart();
  while (loadedFields.length) unloadField(loadedFields.pop(), false);
  if (ALLNEAR) for (let f = 0; f < NF; f++) loadField(f, false);
  for (const a of [posAttr, colAttr, nrmAttr, wtAttr, matAttr, borderAttr, idxAttr, wposAttr, wdAttr, wsAttr]) { a.clearUpdateRanges(); a.needsUpdate = true; }
  flushFar(true);
  homeOf.clear(); homeKey = '';
  initNature();
  rebuildTrees(); window.__placeBeacons(); placeHouse(); rebuildHomeLine(); buildNpcObjs(); closeShop(); initEconomy(fromSave); if (!LEAGUE_MODE) spawnBots(fromSave); else state.bots = [];
  fig.cell = state.cell; fig.path = null; fig.pending = null; fig.fly = false; fig.alt = 0;
  wand.on = false; if (wand.obj) wand.obj.visible = false;
  if (state.box && MAT[state.box.cell] !== DIRT) markBox();
}

/* ---------------- Aenderungen an der Welt ---------------- */
const dirtyCells = new Set(); let treesDirty = false, homeDirty = false;
function touch(c) {
  dirtyCells.add(c); edited.add(c);
  for (let k = 0; k < ncnt[c]; k++) dirtyCells.add(cellNb[c * 6 + k]);
  if (state.home >= 0 && (fieldOf[c] === state.home)) homeDirty = true;
  saveDirty = true;
}
function markRanges(attr, cells, stride) {
  // nur geaenderte Zellen zur Grafikkarte schicken, benachbarte Nummern zusammenfassen
  if (!cells.length) return;
  if (cells.length > 3000) { attr.clearUpdateRanges(); attr.needsUpdate = true; return; }
  let a = cells[0], b = a;
  for (let i = 1; i < cells.length; i++) { const c = cells[i]; if (c === b + 1) b = c; else { attr.addUpdateRange(a * stride, (b - a + 1) * stride); a = b = c; } }
  attr.addUpdateRange(a * stride, (b - a + 1) * stride); attr.needsUpdate = true;
}
function markWater(list) { markRanges(wposAttr, list, 21); markRanges(wdAttr, list, 7); markRanges(wsAttr, list, 7); }
const toSlots = cells => { const out = []; for (const c of cells) if (slotOf[c] >= 0) out.push(slotOf[c]); return out.sort((x, y) => x - y); };
function flushDirty() {
  if (dirtyCells.size) {
    let coast = false;
    for (const c of dirtyCells) if (OCEAN[c]) { coast = true; break; }
    if (coast) {
      computeShore(SH2);
      for (let c = 0; c < NC; c++) if (SH2[c] !== SH[c]) { SH[c] = SH2[c]; dirtyCells.add(c); for (let k = 0; k < ncnt[c]; k++) dirtyCells.add(cellNb[c * 6 + k]); }
    }
    for (const c of dirtyCells) { writeCell(c); writeWater(c); farDirty.add(fieldOf[c]); }
    const list = toSlots(dirtyCells);
    dirtyCells.clear();
    markRanges(posAttr, list, VPC * 3); markRanges(colAttr, list, VPC * 3); markRanges(nrmAttr, list, VPC * 3); markRanges(wtAttr, list, VPC * 4); markRanges(matAttr, list, VPC); markRanges(borderAttr, list, 36); markRanges(idxAttr, list, 54);
    markWater(list);
  }
  flushFar(false);
  // teure Neuaufbauten gebuendelt, damit viele Mitspieler die Bildrate nicht druecken
  const tnow = performance.now() / 1000;
  if (bldDirty && tnow - lastBld > 0.3) { rebuildBuildings(); bldDirty = false; lastBld = tnow; }
  if (treesDirty && tnow - lastTrees > 0.6) { rebuildTrees(); treesDirty = false; fxDirty = true; lastTrees = tnow; }
  if (homeDirty) { rebuildHomeLine(); placeHouse(); homeDirty = false; fxDirty = true; }
  if (fxDirty && tnow - lastFx > 1.2) { rebuildFx(); fxDirty = false; lastFx = tnow; }
}
let lastBld = 0, lastTrees = 0, lastFx = 0;
function isHomeCenter(c) { return state.home >= 0 && campCells(state.tier).includes(c); }
const campOk = c => H[c] >= 0 && W[c] < 0.3 && MAT[c] !== PLAZA && npcAt[c] < 0;
function needUses(id) {
  if (state.uses[id] > 0) return true;
  toast('Out of ' + TOOLS.find(x => x.id === id).name.toLowerCase() + '. Traders sell more.');
  return false;
}
function buildBoat() {
  if (state.boat && (state.boatWear || 0) >= BOAT_WEAR) { if (!payNeed(BOAT_REPAIR, 'Repairing the boat')) return; state.boatWear = 0; saveDirty = true; refreshHud(); toast('Boat repaired.'); return; }
  if (state.boat) { toast('Your boat is ready. Walk into the water to use it.'); return; }
  if (!state.plans.boat) { toast('You need the boat blueprint. Traders sell it.'); return; }
  if (!payNeed(BOATNEED, 'A boat')) return;
  state.boat = true; saveDirty = true; refreshHud(); toast('Boat built. You can cross water now.');
}
function toggleBalloon() {
  if (!state.balloon) {
    if (!state.plans.balloon) { toast('You need the balloon blueprint. Traders sell it.'); return; }
    if (!payNeed(BALLOONNEED, 'A balloon')) return;
    state.balloon = true; saveDirty = true; refreshHud(); toast('Balloon built. Take off to fly over land and sea. The wind helps or hinders.'); return;
  }
  if (fig.path) { toast('Wait until you have stopped.'); return; }
  if (fig.fly) {
    if (W[fig.cell] > 0.35) { toast('You cannot land on water.'); return; }
    if (npcAt[fig.cell] >= 0 || BN[fig.cell] > 0 || isHomeCenter(fig.cell) || MAT[fig.cell] === FOREST) { toast('Something is in the way. Land next to it.'); return; }
    fig.fly = false;
  } else {
    if ((state.uses.gas || 0) < 1) { toast('Out of burner gas. Traders sell it, 5 flights for 15 tokens.'); return; }
    state.uses.gas--; fig.fly = true; closeShop();
  }
  refreshHud();
}
function act(id, c) {
  if (fig.fly) { toast('Land first.'); return; }
  if (c !== fig.cell) faceCell(c);
  if (id === 'shop') { const ti = traderIndexAt(c); if (ti >= 0 && traderNear(ti, fig.cell)) openShop(ti); else { const tj = npcs.findIndex((n, j) => traderNear(j, fig.cell)); if (tj >= 0) openShop(tj); else toast('The trader walked off. Click the trader again.'); } return; }
  if (MAT[c] === PLAZA) { toast('Nobody can change a refuge.'); return; }
  if (MAT[c] === LAVA && id !== 'none' && id !== 'shop') { toast('Too hot. Wait until the lava has cooled to rock.'); return; }
  if (id === 'none') return;
  if (market[c] && (id === 'dig' || id === 'fill' || id === 'beton' || id === 'build')) { toast('The market square stays as it is.'); return; }
  { const own = fieldOwner[fieldOf[c]]; if (own > 0 && isProtected(own) && id !== 'shop') { toast('This field belongs to ' + state.bots[own - 1].name + '. Their land is protected.'); return; } }
  if (BN[c] > 0 && id !== 'paint' && id !== 'build' && id !== 'dig' && !(id === 'home' && isHomeCenter(c))) { toast('A building stands here. The shovel takes down its top floor.'); return; }
  if (isHomeCenter(c) && id !== 'paint' && id !== 'home') {
    // unter einem Zelt darf man graben und aufschuetten, unter einem Haus nicht
    if (state.tier > 0 || id === 'seed' || id === 'axe' || id === 'build') { toast(state.tier > 0 ? 'Your house stands here.' : 'Your tent stands here.'); return; }
    homeDirty = true;
  }
  if (id === 'dig') {
    if (H[c] <= -6 * HS - 2) { toast('You cannot dig any deeper.'); return; }
    if (MAT[c] === FOREST) { toast('Trees need an axe.'); return; }
    if (!needUses('dig')) return;
    if (BN[c] > 0) { state.uses.dig--; demolishFloor(c); fig.work = 1.1; state.activity = (state.activity || 0) + 1; refreshHud(); return; }
    if (state.box && state.box.cell === c) { if ((state.boxCool || 0) > state.econ.boxSeq) { toast('You found a box only recently. Leave this one for someone else.'); return; } openBox(); state.boxCool = state.econ.boxSeq + BOXCOOL; }
    if (Math.random() >= 0.1 * sk('digger')) state.uses.dig--;
    const m = MAT[c];
    if (isSea(c)) seaLevel -= 1 / oceanCount;
    if (m === ROCK || m === SNOW) state.inv.stein++; else if (m !== CONCRETE) state.inv.erde++;
    H[c]--; PAINT[c] = -1;
    MAT[c] = (ORIG[c] - H[c] >= 3 || m === ROCK) ? ROCK : (m === SAND || m === SEABED) ? SAND : DIRT;
    touch(c);
  } else if (id === 'fill') {
    if (state.inv.erde < 1) { toast('No dirt in your inventory. Dig some up first.'); return; }
    if (MAT[c] === FOREST) { toast('Cut the trees down first.'); return; }
    if (H[c] >= 16 * HS + 4) return;
    if (isSea(c)) seaLevel += 1 / oceanCount;
    state.inv.erde--; H[c]++; MAT[c] = DIRT; PAINT[c] = -1; W[c] = Math.max(0, W[c] - 1); touch(c);
  } else if (id === 'beton') {
    if (MAT[c] === FOREST) { toast('Cut the trees down first.'); return; }
    if (H[c] >= 16 * HS + 4 || !needUses('beton')) return;
    if (isSea(c)) seaLevel += 1 / oceanCount;
    state.uses.beton--; H[c]++; MAT[c] = CONCRETE; PAINT[c] = -1; W[c] = Math.max(0, W[c] - 1); touch(c);
  } else if (id === 'paint') {
    if (!needUses('paint')) return;
    state.uses.paint--; PAINT[c] = state.paint; touch(c); if (BN[c] > 0) bldDirty = true;
  } else if (id === 'seed') {
    if (!(MAT[c] === GRASS || MAT[c] === DIRT) || W[c] > 0.2) { toast('Seeds only grow on dry dirt or grass.'); return; }
    if (!needUses('seed')) return;
    if (Math.random() >= 0.15 * sk('gardener')) state.uses.seed--;
    MAT[c] = FOREST; state.nature.sap[c] = state.clock; treesDirty = true; touch(c);
  } else if (id === 'build') {
    if (!buildFloor(c)) return;
  } else if (id === 'axe') {
    if (MAT[c] !== FOREST) { toast('No trees here.'); return; }
    if (state.uses.axe <= 0) { state.inv.holz += 1; fig.work = 2.6; toast('No axe left, so you gather a fallen branch: 1 wood. Traders sell axes.'); }
    else { state.uses.axe--; MAT[c] = GRASS; state.inv.holz += 2; treesDirty = true; touch(c); }
  } else if (id === 'home') {
    const f = fieldOf[c];
    if (state.home < 0) {
      // Schritt 1: das Feld kaufen. Der Platz fuer das Zelt wird danach gewaehlt.
      if (fieldOwner[f] !== -1) { toast('Someone already owns this field.'); return; }
      const fp = fieldPrice(f); if (state.tokens < fp) { toast('This field costs ' + fp + ' tokens. Fields near traders and in busy areas cost more.'); return; }
      playerPay(nearestTrader(c), fp); state.home = f; fieldOwner[f] = 0; state.tier = 0; state.camp = -1;
      homeDirty = true; saveDirty = true;
      toast('Field bought: ' + (fieldStart[f + 1] - fieldStart[f]) + ' building plots. Now click the plot inside it where your tent should stand.');
    } else if (state.camp >= 0 && isHomeCenter(c)) { if (!repairHome()) upgradeHouse(); return; }
    else if (f !== state.home) { toast('That plot is not on your field.'); return; }
    else if (state.tier > 0) { toast('Only a tent can be moved. Click your house to upgrade it.'); return; }
    else if (!campOk(c) || MAT[c] === FOREST || BN[c] > 0 || market[c]) { toast('The tent needs a dry plot without trees or buildings, away from the market square.'); return; }
    else {
      // Schritt 2: Platz fuer das Zelt waehlen, solange es ein Zelt ist auch umsetzen
      const first = state.camp < 0; state.camp = c; placeHouse(); homeDirty = true; saveDirty = true; touch(c);
      toast(first ? 'Your tent stands. Click it to upgrade it. Later houses follow the shape of this plot, and you can build onto them.' : 'Tent moved.');
    }
  }
  fig.work = Math.max(fig.work || 0, 1.1); lastBld = lastTrees = 0;
  state.activity = (state.activity || 0) + 1;
  refreshHud();
}
function upgradeHouse() {
  if (state.home < 0) return;
  if (state.camp < 0) { toast('Pick a plot for your tent first.'); return; }
  if (state.tier >= 6) { toast('This is the highest level.'); return; }
  const nt = state.tier + 1, nm = TIERNAMES[nt].toLowerCase();
  if (!state.plans['t' + nt]) { toast('You need the blueprint for the ' + nm + '. Traders sell it.'); return; }
  if (nt >= BIGTIER && state.tier < BIGTIER) {
    const c = state.camp; let ok = ncnt[c] === 6;
    for (let k = 0; k < ncnt[c] && ok; k++) { const o = cellNb[c * 6 + k]; if (fieldOf[o] !== state.home || H[o] !== H[c] || W[o] > 0.1 || MAT[o] === FOREST || MAT[o] === PLAZA || npcAt[o] >= 0) ok = false; }
    if (!ok) { toast('The ' + nm + ' covers seven plots. Level the six plots around your camp to its height, keep them dry, clear the trees, and stay inside your field.'); return; }
  }
  if (!payNeed(TIERNEED[nt], 'The ' + nm)) return;
  state.tier = nt; placeHouse(); homeDirty = true; saveDirty = true; lastBld = 0; addEur('tiers', EURO.tierFee[nt]);
  toast('Upgraded to a ' + nm + '. NFT update fee: ' + EURO.tierFee[nt] + ' \u20ac (simulated, no real payment).'); refreshHud();
}
function sellAll() {
  const i = shopNpc >= 0 ? shopNpc : nearestTrader(fig.cell), w = state.inv.holz, st = state.inv.stein;
  if (!w && !st) { toast('Nothing to sell. Stone and wood earn tokens.'); return; }
  const r = sellGoods(i, w, st, 1 + 0.1 * sk('trader'));
  state.tokens += r.pay; state.inv.holz -= Math.min(w, Math.round(w * r.frac)); state.inv.stein -= Math.min(st, Math.round(st * r.frac));
  toast(r.frac < 0.999 ? 'The trader ran out of cash and bought only part of it, for ' + fmtT(r.pay) + ' tokens.' : 'Sold for ' + fmtT(r.pay) + ' tokens.');
  saveDirty = true; refreshHud(); if (shopNpc >= 0) renderShop();
}
// Erde wird zu Wiese, wenn Wasser oder Gruen in der Naehe ist
function growTick() {
  for (let i = 0, gn = Math.round(80 * NC / 17642); i < gn; i++) {
    const c = Math.floor(Math.random() * NC);
    if (MAT[c] !== DIRT || H[c] < 0 || W[c] > 0.1 || PAINT[c] >= 0 || (state.box && state.box.cell === c)) continue;
    for (let k = 0; k < ncnt[c]; k++) {
      const o = cellNb[c * 6 + k];
      if (W[o] > 0.1 || MAT[o] === GRASS || MAT[o] === FOREST) { MAT[c] = GRASS; touch(c); break; }
    }
  }
}

/* ---------------- Figur: Weg suchen und laufen ---------------- */
const fig = { cell: 0, path: null, seg: 0, t: 0, pending: null, fly: false, alt: 0 };
const prev = new Int32Array(NC), stamp = new Int32Array(NC); let stampId = 0; const bq = new Int32Array(NC);
function findPath(a, b) {
  if (a === b) return [a];
  stampId++; let qh = 0, qt = 0; bq[qt++] = a; stamp[a] = stampId; prev[a] = -1;
  const swim0 = W[a] > 0.35;
  while (qh < qt) {
    const v = bq[qh++];
    if (v === b) break;
    const hv = surfH(v);
    for (let k = 0; k < ncnt[v]; k++) {
      const o = cellNb[v * 6 + k];
      if (stamp[o] === stampId) continue;
      if (!fig.fly) {
        if (Math.abs(surfH(o) - hv) > 2.2) continue;      // nicht hochklettern und nicht in tiefe Loecher springen
        if (W[o] > 0.35 && !state.boat && !swim0) continue;      // tiefes Wasser nur mit Boot
        if ((npcAt[o] >= 0 || BN[o] > 0) && o !== b) continue;
      }
      stamp[o] = stampId; prev[o] = v; bq[qt++] = o;
    }
  }
  if (stamp[b] !== stampId) return null;
  const p = []; for (let v = b; v >= 0; v = prev[v]) p.push(v);
  return p.reverse();
}
function isNear(a, b) { if (a === b) return true; for (let k = 0; k < ncnt[a]; k++) if (cellNb[a * 6 + k] === b) return true; return false; }
function walkTo(c, pending) {
  const p = findPath(fig.cell, c);
  if (!p) { toast(state.boat ? 'No path leads there. Too steep.' : W[c] > 0.35 ? 'You need a boat to cross water. Traders sell the blueprint.' : 'No way there on foot. Too steep, or water is in the way.'); return; }
  closeShop();
  if (pending && p.length > 1) p.pop();
  fig.path = p; fig.seg = 0; fig.t = 0; fig.pending = pending || null; follow = true;
}
function clickCell(c) {
  if (fig.fly) { walkTo(c, null); return; }
  if (BN[c] > 0 && tool === 'walk') { walkTo(c, { tool: 'none', cell: c }); return; }
  { const ti = traderIndexAt(c); if (ti >= 0) { if (traderNear(ti, fig.cell) && !fig.path) openShop(ti); else walkTo(c, { tool: 'shop', cell: c }); return; } }
  if (tool === 'walk') { walkTo(c, null); return; }
  if (isNear(fig.cell, c) && !fig.path) act(tool, c);
  else walkTo(c, { tool, cell: c });
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
const figFwd = new THREE.Vector3(1, 0, 0);
function faceCell(c) { cellPos(c, 0, _b); cellPos(fig.cell, 0, _a); figFwd.copy(_b).sub(_a); }
function updateFigure(dt, time) {
  let bob = 0;
  // Tempo in Zellen je Sekunde, bemessen am Koerper des Wichts und nicht an der Spielzeit
  let wm = 1, sp = 0.6 * (1 + 0.08 * sk('strider'));
  if (fig.path && fig.seg < fig.path.length - 1) {
    const c0 = fig.path[fig.seg], c1 = fig.path[fig.seg + 1];
    if (fig.fly || (state.boat && W[c1] > 0.35)) {     // Rueckenwind schiebt, Gegenwind bremst
      _a.set(cdir[c0 * 3], cdir[c0 * 3 + 1], cdir[c0 * 3 + 2]); _b.set(cdir[c1 * 3], cdir[c1 * 3 + 1], cdir[c1 * 3 + 2]).sub(_a).normalize();
      wm = clamp(1 + (fig.fly ? 0.75 : 0.5) * windAt(_a, _wv).dot(_b), 0.45, 1.75);
      sp = (fig.fly ? 2.0 : 1.2) * wm * (!fig.fly && (state.boatWear || 0) >= BOAT_WEAR ? 0.5 : 1);
    }
  }
  if (fig.path && fig.path.length > 1) {
    fig.t += dt * sp;
    while (fig.t >= 1 && fig.path) {
      fig.t -= 1; fig.seg++; fig.cell = fig.path[fig.seg]; state.cell = fig.cell; saveDirty = true;
      if (!fig.fly && state.boat && W[fig.cell] > 0.35) { state.boatWear = (state.boatWear || 0) + 1; if (state.boatWear === BOAT_WEAR) { toast('Your boat leaks. It sails at half speed until you repair it with 3 wood.'); refreshHud(); } }
      if (fig.seg >= fig.path.length - 1) { fig.path = null; fig.t = 0; }
    }
  } else if (fig.path) fig.path = null;
  if (fig.path) {
    cellPos(fig.path[fig.seg], 0, _a); cellPos(fig.path[fig.seg + 1], 0, _b);
    _fw.copy(_b).sub(_a);
    const la = _a.length(), lb = _b.length(), tt = fig.t;
    figure.position.copy(_a).lerp(_b, tt).normalize().multiplyScalar(la + (lb - la) * tt);
    bob = 1;
  } else {
    cellPos(fig.cell, 0, figure.position);
    if (fig.pending) { const p = fig.pending; fig.pending = null; if (isNear(fig.cell, p.cell)) act(p.tool, p.cell); }
    _fw.copy(figFwd);
  }
  fig.alt += ((fig.fly ? 3.4 * CELLW : 0) - fig.alt) * (1 - Math.exp(-dt * 1.4));
  if (fig.alt > 0.001) { const l0 = figure.position.length(); figure.position.multiplyScalar((l0 + fig.alt) / l0); }
  _up.copy(figure.position).normalize();
  _fw.addScaledVector(_up, -_fw.dot(_up));
  if (_fw.lengthSq() < 1e-6) { _fw.crossVectors(_up, YAX); if (_fw.lengthSq() < 1e-6) _fw.set(1, 0, 0); }
  _fw.normalize(); figFwd.copy(_fw);
  _rt.crossVectors(_up, _fw).normalize();
  _m.makeBasis(_rt, _up, _fw); figure.quaternion.setFromRotationMatrix(_m);
  const mk = figure.userData.marker, ms = clamp(cam.s * 0.022, 0.12 * KS, 9);
  mk.scale.set(ms, ms, ms); mk.position.set(0, (fig.alt > 0.05 ? GS * 10 : GS * 3.2) + ms * 1.2 + Math.sin(time * 2.4) * ms * 0.12, 0); mk.rotation.y = time * 1.2;
  const airborne = fig.fly || fig.alt > 0.03;
  const cellNow = fig.path ? fig.path[fig.t < 0.5 ? fig.seg : fig.seg + 1] : fig.cell, afloat = !airborne && W[cellNow] > 0.35 && state.boat;
  figure.userData.boat.visible = afloat; figure.userData.balloon.visible = airborne;
  figure.userData.boat.position.y = afloat ? Math.sin(time * 1.6) * 0.03 * KS : 0;
  figure.userData.balloon.position.y = Math.sin(time * 0.9) * 0.05 * KS;
  figure.userData.body.position.y = airborne ? Math.sin(time * 0.9) * 0.05 * KS : afloat ? GS * 0.3 : 0;
  fig.work = Math.max(0, (fig.work || 0) - dt);
  animateGnome(figure.userData.body, afloat ? 'sit' : airborne ? 'idle' : fig.path ? 'walk' : fig.work > 0 ? 'work' : 'idle', dt);
  if (afloat) {      // Wimpel zeigt nach Lee, das Segel dreht halb mit
    windAt(_up, _wv); const psi = Math.atan2(-_wv.dot(_rt), -_wv.dot(_fw));
    figure.userData.pennant.rotation.y = psi; figure.userData.sail.rotation.y = clamp(psi * 0.5, -1.1, 1.1);
  }
  for (const o of npcObjs) { const m = o.userData.marker; m.scale.set(ms, ms, ms); m.position.set(0, GS * 3.4 + ms * 1.2 + Math.sin(time * 2.0 + o.userData.i) * ms * 0.12, 0); m.rotation.y = -time; }
}

/* ---------------- Wind und Tageszeit ---------------- */
const windAxis = new THREE.Vector3(0, 1, 0), _wv = new THREE.Vector3(); let windS = 0.6;
function updateWind(t) { windAxis.set(Math.sin(t * 0.004 + 1) * 0.6, 1, Math.cos(t * 0.0031) * 0.6).normalize(); windS = 0.55 + 0.25 * Math.sin(t * 0.013) + 0.12 * Math.sin(t * 0.041 + 2); }
function windAt(p, out) { out.crossVectors(windAxis, p); const l = out.length(); return l < 1e-4 ? out.set(0, 0, 0) : out.multiplyScalar(windS * Math.min(1, l * 3) / l); }
const sunAxis = new THREE.Vector3(0.2, 1, 0.1).normalize(), sunBase = new THREE.Vector3(1, 0, 0);
let timeSpeed = 1;
const HOURSEC = 750;      // eine Spielstunde dauert 12,5 Minuten
function setSunBase() {     // am Startort ist es zu Beginn Vormittag
  const c = npcs.length ? npcs[0].cell : state.cell;
  _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); _qq.setFromAxisAngle(sunAxis, 0.86);
  sunBase.copy(_v).applyQuaternion(_qq); sunBase.addScaledVector(sunAxis, -0.6 * sunBase.dot(sunAxis)).normalize();
}
function localHour(p) {
  const sn = U.uSun.value;
  _a.copy(sn).addScaledVector(sunAxis, -sn.dot(sunAxis)); _b.copy(p).addScaledVector(sunAxis, -p.dot(sunAxis));
  const ang = Math.atan2(sunAxis.dot(_v2.crossVectors(_a, _b)), _a.dot(_b));
  return ((12 + ang / TAU * 24) % 24 + 24) % 24;
}

/* ---------------- Kamera ---------------- */
const cam = { u: new THREE.Vector3(), f: new THREE.Vector3(), z: 0, zT: 0, s: 330, fh: 0 };
let follow = false, interacted = false;
const SFAR = 335, SNEAR = 2.6 * CELLW;
function camInit(c) {
  cam.u.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]);
  cam.f.set(0, 1, 0).addScaledVector(cam.u, -cam.u.y).normalize();
}
const _ax = new THREE.Vector3(), _qq = new THREE.Quaternion(), _F = new THREE.Vector3(), _r = new THREE.Vector3();
function panBy(dRight, dFwd) {       // Winkel in rad
  _r.crossVectors(cam.f, cam.u);
  _v.copy(_r).multiplyScalar(dRight).addScaledVector(cam.f, dFwd);
  const a = _v.length(); if (a < 1e-7) return;
  _v.multiplyScalar(1 / a);
  _ax.crossVectors(cam.u, _v).normalize(); _qq.setFromAxisAngle(_ax, a);
  cam.u.applyQuaternion(_qq).normalize(); cam.f.applyQuaternion(_qq);
  cam.f.addScaledVector(cam.u, -cam.f.dot(cam.u)).normalize();
}
function rotBy(a) { _qq.setFromAxisAngle(cam.u, a); cam.f.applyQuaternion(_qq).normalize(); }
let focusCell = 0;
function updateCamera(dt) {
  cam.z += (cam.zT - cam.z) * (1 - Math.exp(-dt * 7));
  if (follow && cam.z > 0.5) {
    _v.copy(figure.position).normalize();
    const k = 1 - Math.exp(-dt * 4);
    cam.u.lerp(_v, k).normalize(); cam.f.addScaledVector(cam.u, -cam.f.dot(cam.u)).normalize();
  }
  cam.s = SFAR * Math.pow(SNEAR / SFAR, cam.z);
  const tau = smooth(0.30, 0.96, cam.z) * 1.02 + smooth(0.80, 1.0, cam.z) * 0.40;
  focusCell = nearestCell(cam.u.x, cam.u.y, cam.u.z, focusCell);
  const target = surfH(focusCell) * smooth(0.25, 0.7, cam.z);
  cam.fh += (target - cam.fh) * (1 - Math.exp(-dt * 5));
  _F.copy(cam.u).multiplyScalar(R + cam.fh * LAYER);
  camera.position.copy(_F).addScaledVector(cam.u, cam.s * Math.cos(tau)).addScaledVector(cam.f, -cam.s * Math.sin(tau));
  camera.up.copy(cam.f).multiplyScalar(Math.cos(tau)).addScaledVector(cam.u, Math.sin(tau));
  { // nicht in Berge oder Haeuser tauchen
    const cc = nearestCell(camera.position.x / camera.position.length(), camera.position.y / camera.position.length(), camera.position.z / camera.position.length(), focusCell);
    const minR = R + (Math.max(surfH(cc), H[cc] + (BN[cc] || 0) * 2.2) + 2.5) * LAYER;
    if (camera.position.length() < minR) camera.position.setLength(minR);
  }
  camera.lookAt(_F); U.uFocus.value.copy(_F);
  { const cr = camera.position.length(), alt = cr - R;
    sky.position.copy(camera.position);
    U.uSkyA.value = 1 - smooth(R * 0.05, R * 0.55, alt);
    U.uDip.value = Math.sqrt(Math.max(0, 1 - (R / cr) * (R / cr)));
    U.uStarA.value = Math.max(0, 1 - U.uSkyA.value * 1.6 * smooth(-0.25, 0.3, _F.clone().normalize().dot(U.uSun.value)));
    _qq.setFromAxisAngle(windAxis, Math.min(dt, 0.1) * 0.0012 * windS); clouds.quaternion.premultiply(_qq); }
  camera.near = Math.max(0.04, cam.s * 0.06); camera.far = 2600; camera.updateProjectionMatrix();
  const zt = smooth(0.45, 0.95, cam.z);
  U.uFog.value = 0.13 / (5 * CELLW) * zt;
  postMat.uniforms.uBlur.value = zt * 13 * pixelRatio * (1 - 0.65 * smooth(0.82, 1.0, cam.z));
  trees.visible = cam.z > 0.5; trees2.visible = trees.visible;
  if (trees.visible) {
    const rad = Math.min(0.5, 0.05 + cam.s / R * 0.9);
    if (treeRad < 0 || cam.u.angleTo(treeC) > treeRad * 0.3 || Math.abs(rad - treeRad) > treeRad * 0.25) treesDirty = true;
  }
  borderMat.uniforms.uC.value.w = 0.06 + 0.36 * smooth(0.2, 0.7, cam.z);
}

/* ---------------- Zelle unter dem Zeiger ---------------- */
function nearestCell(x, y, z, start) {
  let best = start, bd = cdir[best * 3] * x + cdir[best * 3 + 1] * y + cdir[best * 3 + 2] * z;
  for (; ;) {
    let moved = false;
    for (let k = 0; k < ncnt[best]; k++) {
      const o = cellNb[best * 6 + k], d = cdir[o * 3] * x + cdir[o * 3 + 1] * y + cdir[o * 3 + 2] * z;
      if (d > bd) { bd = d; best = o; moved = true; }
    }
    if (!moved) return best;
  }
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let pickStart = 0;
function pick(px, py) {
  const rect = canvas.getBoundingClientRect();
  ndc.set((px - rect.left) / rect.width * 2 - 1, -((py - rect.top) / rect.height * 2 - 1));
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  const Ro = R + (16 * HS + 6) * LAYER, Ri = R - (6 * HS + 4) * LAYER;
  const b = o.dot(d), cc = o.lengthSq() - Ro * Ro, disc = b * b - cc;
  if (disc < 0) return -1;
  let t = Math.max(0, -b - Math.sqrt(disc)); const tEnd = -b + Math.sqrt(disc);
  let cell = pickStart;
  for (; t < tEnd; t += LAYER * 0.4) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, r = Math.hypot(x, y, z);
    if (r < Ri) break;
    cell = nearestCell(x / r, y / r, z / r, cell);
    const top = W[cell] > 0.1 ? H[cell] + W[cell] - 0.07 : H[cell];
    if (r <= R + top * LAYER) { pickStart = cell; return cell; }
  }
  return -1;
}

/* ---------------- Eingabe ---------------- */
const pointers = new Map(); let dragDist = 0, pinch0 = 0, pinchA0 = 0, hoverXY = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button });
  dragDist = 0; interacted = true;
  if (pointers.size === 2) { const [p, q] = [...pointers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); pinchA0 = Math.atan2(q.y - p.y, q.x - p.x); }
});
canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) { hoverXY = [e.clientX, e.clientY]; return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    dragDist += Math.abs(dx) + Math.abs(dy);
    if (dragDist < 5) return;
    if (p.b === 2 || e.shiftKey) rotBy(-dx * 0.006);
    else {
      const perPx = 2 * cam.s * Math.tan(camera.fov * Math.PI / 360) / canvas.clientHeight / R;
      panBy(-dx * perPx, dy * perPx); follow = false;
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dd = Math.hypot(a.x - b.x, a.y - b.y), aa = Math.atan2(b.y - a.y, b.x - a.x);
    if (pinch0 > 0) { cam.zT = clamp(cam.zT + Math.log(dd / pinch0) * 0.35, 0, 1); let da = aa - pinchA0; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU; rotBy(da); }
    pinch0 = dd; pinchA0 = aa; dragDist = 99;
  }
});
function endPointer(e) {
  const p = pointers.get(e.pointerId); if (!p) return;
  pointers.delete(e.pointerId);
  if (dragDist < 5 && p.b === 0 && pointers.size === 0) { const c = pick(e.clientX, e.clientY); if (c >= 0) clickCell(c); }
}
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', e => pointers.delete(e.pointerId));
canvas.addEventListener('pointerleave', () => { hoverXY = null; setHover(-1); });
canvas.addEventListener('wheel', e => { e.preventDefault(); if (gateOpen) return; interacted = true; cam.zT = clamp(cam.zT - e.deltaY * 0.0011, 0, 1); }, { passive: false });
const keys = new Set();
window.addEventListener('keydown', e => {
  if (gateOpen || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
  keys.add(e.key.toLowerCase());
  const n = parseInt(e.key, 10); if (n >= 1 && n <= TOOLS.length) setTool(TOOLS[n - 1].id);
  if (e.key === ' ') { e.preventDefault(); toFigure(); }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
function keyMove(dt) {
  const sp = dt * 0.9 * cam.s / R; let r = 0, f = 0;
  if (keys.has('a') || keys.has('arrowleft')) r -= sp; if (keys.has('d') || keys.has('arrowright')) r += sp;
  if (keys.has('w') || keys.has('arrowup')) f += sp; if (keys.has('s') || keys.has('arrowdown')) f -= sp;
  if (r || f) { panBy(r, f); follow = false; interacted = true; }
  if (keys.has('q')) rotBy(dt * 1.4); if (keys.has('e')) rotBy(-dt * 1.4);
  if (keys.has('+') || keys.has('=')) cam.zT = clamp(cam.zT + dt * 0.6, 0, 1);
  if (keys.has('-')) cam.zT = clamp(cam.zT - dt * 0.6, 0, 1);
}
function toFigure() { follow = true; interacted = true; cam.zT = 0.84; if (cam.z < 0.5) { cam.u.copy(figure.position).normalize(); cam.f.addScaledVector(cam.u, -cam.f.dot(cam.u)).normalize(); } }

/* ---------------- Oberflaeche ---------------- */
const $ = id => document.getElementById(id);
const ICON = {
  walk: '<circle cx="12" cy="6" r="2.6"/><path d="M12 9v6M12 15l-3 5M12 15l3 5M8 12h8"/>',
  build: '<path d="M4 20V11l8-7 8 7v9z"/><path d="M4 15h16M9 20v-5M15 15v-4"/>',
  axe: '<path d="M5 20L15 8"/><path d="M13 5c3-1 6 0 7 3-2 1-4 3-4 5l-5-5c1-1 2-2 2-3z" fill="currentColor"/>',
  dig: '<path d="M14 4l6 6M17 7L8 16"/><path d="M8 16l-3 1-1 3 3-1 1-3z" fill="currentColor"/>',
  fill: '<path d="M3 19l5-8 4 5 3-4 6 7z" fill="currentColor"/>',
  beton: '<rect x="4" y="9" width="16" height="10" rx="1"/><path d="M4 14h16M12 9v10"/>',
  paint: '<path d="M5 19c2 0 3-1 3-3l9-9 3 3-9 9c-2 0-3 0-6 0z"/>',
  seed: '<path d="M12 20v-8M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z"/>',
  boat: '<path d="M3 15h18l-3 5H6z"/><path d="M12 13V4l6 7h-6"/>',
  balloon: '<path d="M12 3c4 0 6.5 3 6.5 6.2 0 3.6-4 5.8-5 8.3h-3c-1-2.5-5-4.7-5-8.3C5.500 6 8 3 12 3z"/><path d="M10 19.500h4v2.500h-4z"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>'
};
function buildToolbar() {
  $('tools').innerHTML = TOOLS.map((t, i) => `<button class="tool" id="tool-${t.id}" type="button" aria-pressed="false" title="Key ${i + 1}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t.id]}</svg><span class="tname">${t.name}</span><span class="tcount" id="cnt-${t.id}"></span></button>`).join('');
  TOOLS.forEach(t => $('tool-' + t.id).addEventListener('click', () => { if (t.id === 'boat') buildBoat(); else if (t.id === 'balloon') toggleBalloon(); else setTool(t.id); }));
  $('swatches').innerHTML = PALETTE.map((p, i) => `<button class="swatch" type="button" id="sw-${i}" aria-label="${PALNAMES[i]}" style="background:rgb(${p.map(v => Math.round(v * 255)).join(',')})"></button>`).join('');
  PALETTE.forEach((p, i) => $('sw-' + i).addEventListener('click', () => { state.paint = i; refreshHud(); }));
  $('bmats').innerHTML = [1, 2, 3].map(m => `<button class="chip" type="button" id="bm-${m}" aria-pressed="false">${BNAME[m]} · ${needText(BCOST[m])}</button>`).join('');
  [1, 2, 3].forEach(m => $('bm-' + m).addEventListener('click', () => { state.bmat = m; refreshHud(); }));
}
function setTool(id) { tool = id; refreshHud(); }
function refreshHud() {
  $('tok').textContent = fmtT(state.tokens); $('erde').textContent = state.inv.erde; $('stein').textContent = state.inv.stein; $('holz').textContent = state.inv.holz;
  TOOLS.forEach(t => { const b = $('tool-' + t.id); b.setAttribute('aria-pressed', tool === t.id ? 'true' : 'false'); });
  $('cnt-dig').textContent = state.uses.dig; $('cnt-axe').textContent = state.uses.axe; $('cnt-beton').textContent = state.uses.beton; $('cnt-paint').textContent = state.uses.paint; $('cnt-seed').textContent = state.uses.seed;
  $('cnt-fill').textContent = state.inv.erde; $('cnt-walk').textContent = '';
  const hb = $('tool-home');
  if (state.home < 0) { hb.querySelector('.tname').textContent = 'Buy field'; $('cnt-home').textContent = 'from ' + FIELDPRICE + ' T'; }
  else if (state.camp < 0) { hb.querySelector('.tname').textContent = 'Place tent'; $('cnt-home').textContent = 'pick a plot'; }
  else if (homeNeed(state.camp, state.tier)) { const nd = homeNeed(state.camp, state.tier); hb.querySelector('.tname').textContent = 'Repair'; $('cnt-home').textContent = needText(nd.cost) + ' · ' + nd.left + ' left'; }
  else if (state.tier < 6) { hb.querySelector('.tname').textContent = 'Camp'; $('cnt-home').textContent = state.plans['t' + (state.tier + 1)] ? needText(TIERNEED[state.tier + 1]) : 'needs blueprint'; }
  else { hb.querySelector('.tname').textContent = TIERNAMES[6]; $('cnt-home').textContent = ''; }
  $('tool-boat').querySelector('.tname').textContent = state.boat ? ((state.boatWear || 0) >= BOAT_WEAR ? 'Repair boat' : 'Boat') : 'Build boat';
  $('cnt-boat').textContent = state.boat ? ((state.boatWear || 0) >= BOAT_WEAR ? 'repair: 3 wood' : 'ready') : state.plans.boat ? needText(BOATNEED) : 'needs blueprint';
  $('tool-balloon').querySelector('.tname').textContent = state.balloon ? (fig.fly ? 'Land' : 'Take off') : 'Build balloon';
  $('cnt-balloon').textContent = state.balloon ? (fig.fly ? 'flying' : (state.uses.gas || 0) + ' gas') : state.plans.balloon ? needText(BALLOONNEED) : 'needs blueprint';
  $('swatches').hidden = tool !== 'paint';
  $('bmats').hidden = tool !== 'build'; [1, 2, 3].forEach(m => $('bm-' + m).setAttribute('aria-pressed', (state.bmat || 1) === m ? 'true' : 'false'));
  $('cnt-build').textContent = BNAME[state.bmat || 1];
  PALETTE.forEach((p, i) => $('sw-' + i).classList.toggle('on', i === state.paint));
  $('house').textContent = state.home < 0 ? 'No field' : state.camp < 0 ? 'No tent yet' : TIERNAMES[state.tier];
}
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }
$('btn-fig').addEventListener('click', toFigure);
$('btn-npc').addEventListener('click', findTrader);
$('btn-speed').addEventListener('click', () => { timeSpeed = timeSpeed === 1 ? 10 : timeSpeed === 10 ? 60 : 1; $('btn-speed').textContent = 'Speed ×' + timeSpeed; if (!$('econ').hidden) renderEcon(); });
$('btn-econ').addEventListener('click', () => { $('econ').hidden = !$('econ').hidden; if (!$('econ').hidden) renderEcon(); });
$('econ-close').addEventListener('click', () => { $('econ').hidden = true; });
$('btn-help').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
$('help-close').addEventListener('click', () => { $('help').hidden = true; });
$('btn-reset').addEventListener('click', () => {
  if ($('btn-reset').dataset.arm !== '1') { $('btn-reset').dataset.arm = '1'; $('btn-reset').textContent = 'Really reset?'; setTimeout(() => { $('btn-reset').dataset.arm = ''; $('btn-reset').textContent = 'New world'; }, 3000); return; }
  try { localStorage.removeItem(SAVEKEY); } catch (e) { /* egal */ }
  $('btn-reset').dataset.arm = ''; $('btn-reset').textContent = 'New world';
  const av = state.avatar; initWorld(false); state.avatar = av; setSunBase(); saveDirty = true; camInit(state.cell); cam.zT = 0; refreshHud(); toast('New world created.');
});

/* ---------------- Bauen: Etagen auf Zellen, die sich seitlich verbinden ---------------- */
// Jede Zelle traegt einen Stapel Etagen aus Fachwerk, Stein oder Beton. Der Grundriss folgt der krummen Zelle.
// Stehen Nachbarn auf gleicher Hoehe, faellt die Wand dazwischen weg und es entsteht ein gemeinsames Haus.
const MAXF = 10, BN = new Uint8Array(NC), BLD = new Uint8Array(NC * MAXF), DMG = new Uint8Array(NC);     // DMG: Schaden 0 bis 100 je bebauter Zelle
const builtCells = new Set(); let bldDirty = false;
const bldEmit = [];
const FH = CELLW * 0.31, LU = CELLW * 0.62;
// 1 bis 3 baut jeder frei. 4 Blockbau, 5 Stahl und Glas, 6 Stelzen mit Stamm gibt es nur im Lager.
const BCAP = [0, 2, 4, 7, 3, 9, 3], BCOST = [null, { holz: 4 }, { stein: 5 }, { beton: 2 }, { holz: 4 }, { beton: 2 }, { holz: 2 }], BNAME = ['', 'Timber', 'Stone', 'Concrete', 'Log', 'Steel', 'Stilt'], BINS = [0, 0.14, 0.22, 0.19, 0.15, 0.20, 0.30];
// Das Lager ist ab dem Baumhaus ein Etagenstapel wie jedes frei gebaute Haus: er folgt der Zelle und verwaechst mit Anbauten.
const HOMEC = [null, [6, 1], [1, 1], [4, 4, 1], [2, 2, 2, 2, 1], [3, 3, 3, 3, 3, 3, 3], [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]];
const HOMER = [null, null, null, null,
  [[2, 2, 1], [2, 2], [2, 2, 2, 1], [2, 1, 1], [2, 2, 1], [2]],
  [[3, 3, 3], [3, 3, 3, 3, 3], [3, 3], [3, 3, 3, 3], [3, 3, 3, 3, 3, 3], [3, 3, 3]],
  [[5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5, 5], [3, 3, 5, 5, 5], [5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5], [3, 3, 3, 5, 5, 5]]];
const homeOf = new Map();            // Zelle -> Lagerzelle, zu der sie gehoert
let homeKey = '';
function homeCellsOf(camp, tier) { const out = [camp]; if (tier >= BIGTIER) for (let k = 0; k < ncnt[camp]; k++) out.push(cellNb[camp * 6 + k]); return out; }
function releaseHome(camp, tier) { if (camp >= 0 && tier > 0) for (const c of homeCellsOf(camp, tier)) if (homeOf.get(c) === camp) homeOf.delete(c); bldDirty = true; }
function homeSpec(camp, tier, i) { return i === 0 ? HOMEC[tier] : HOMER[tier][(i - 1 + Math.floor(hashI(camp, 610) * 6)) % 6]; }
function stampHome(camp, tier, keep) {
  if (camp < 0 || tier < 1) return;
  const cells = homeCellsOf(camp, tier);
  if (keep && BN[camp] > 0) { for (const c of cells) homeOf.set(c, camp); bldDirty = true; return; }      // aus dem Spielstand: Schaeden bleiben
  cells.forEach((c, i) => {
    const st = homeSpec(camp, tier, i);
    DMG[c] = 0; BN[c] = st.length; for (let q = 0; q < st.length; q++) BLD[c * MAXF + q] = st[q];
    builtCells.add(c); homeOf.set(c, camp);
    if (MAT[c] === FOREST) { MAT[c] = GRASS; treesDirty = true; dirtyCells.add(c); }
  });
  // niemand bleibt im Haus stecken
  const out = c0 => { const seen = new Set([c0]); let fr = [c0]; for (let d = 0; d < 6; d++) { const nx = []; for (const v of fr) for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (seen.has(o)) continue; seen.add(o); if (BN[o] === 0 && W[o] < 0.3 && H[o] >= 0 && npcAt[o] < 0) return o; nx.push(o); } fr = nx; } return c0; };
  if (cells.includes(fig.cell) && !fig.fly) { fig.cell = out(fig.cell); state.cell = fig.cell; fig.path = null; fig.pending = null; }
  (state.bots || []).forEach((b, i) => { if (cells.includes(b.cell)) { b.cell = out(b.cell); if (botRt[i]) { botRt[i].path = null; botRt[i].pending = null; } } });
  bldDirty = true; lastBld = 0; saveDirty = true;
}
const PLASTER = [[0.95, 0.92, 0.84], [0.96, 0.86, 0.68], [0.84, 0.90, 0.78], [0.94, 0.78, 0.74], [0.80, 0.87, 0.94], [0.97, 0.92, 0.66], [0.90, 0.62, 0.48], [0.80, 0.76, 0.90], [0.70, 0.84, 0.82], [0.98, 0.80, 0.60],
  [0.98, 0.55, 0.45], [0.45, 0.72, 0.86], [0.99, 0.80, 0.25], [0.60, 0.80, 0.52], [0.86, 0.52, 0.72], [0.38, 0.62, 0.66], [0.95, 0.66, 0.30], [0.72, 0.60, 0.88], [0.90, 0.36, 0.34], [0.34, 0.50, 0.78], [0.96, 0.72, 0.80], [0.55, 0.86, 0.80],
  [0.22, 0.58, 0.78], [1.0, 0.86, 0.30], [0.86, 0.26, 0.30], [0.46, 0.74, 0.36], [1.0, 0.62, 0.70], [0.56, 0.42, 0.82], [1.0, 0.60, 0.18], [0.26, 0.70, 0.62], [0.96, 0.46, 0.60], [0.70, 0.86, 0.30], [0.40, 0.36, 0.70], [0.98, 0.94, 0.55]];
const ROOFC = [[0.72, 0.30, 0.20], [0.55, 0.24, 0.18], [0.30, 0.33, 0.42], [0.26, 0.44, 0.36], [0.44, 0.30, 0.52], [0.80, 0.46, 0.20], [0.36, 0.26, 0.20], [0.22, 0.42, 0.56], [0.86, 0.30, 0.30], [0.20, 0.55, 0.50], [0.90, 0.62, 0.18], [0.50, 0.20, 0.40], [0.30, 0.52, 0.24], [0.16, 0.30, 0.55],
  [0.18, 0.62, 0.66], [0.92, 0.72, 0.20], [0.94, 0.42, 0.36], [0.62, 0.28, 0.70], [0.42, 0.62, 0.22], [0.12, 0.42, 0.72], [0.96, 0.52, 0.62], [0.24, 0.24, 0.30]];
const SHUTC = [[0.20, 0.42, 0.34], [0.62, 0.22, 0.20], [0.22, 0.34, 0.58], [0.50, 0.36, 0.20], [0.85, 0.70, 0.25], [0.40, 0.62, 0.60], [0.85, 0.35, 0.55], [0.95, 0.95, 0.92], [0.30, 0.20, 0.50], [0.95, 0.50, 0.20]];
const STAIN = [[0.60, 0.42, 0.26], [0.62, 0.22, 0.17], [0.36, 0.44, 0.52], [0.78, 0.60, 0.28], [0.34, 0.24, 0.17], [0.30, 0.46, 0.34]];
const BEAMC = [[0.33, 0.22, 0.14], [0.22, 0.17, 0.14], [0.46, 0.31, 0.19], [0.24, 0.28, 0.32]];
// gestrichene Balken: jedes Haus darf seine eigene Farbe zeigen
const BEAMP = [[0.14, 0.28, 0.48], [0.18, 0.40, 0.30], [0.58, 0.16, 0.16], [0.36, 0.20, 0.44], [0.12, 0.42, 0.46], [0.92, 0.90, 0.84], [0.70, 0.46, 0.12]];
const BLOOM = [[0.95, 0.35, 0.42], [1.0, 0.80, 0.28], [0.98, 0.96, 0.92], [0.62, 0.50, 0.92], [1.0, 0.55, 0.25], [0.95, 0.55, 0.75]];
const bldMat = propMaterial(false, true); bldMat.side = THREE.DoubleSide;
const bldMesh = new THREE.Mesh(new THREE.BufferGeometry(), bldMat); bldMesh.frustumCulled = false; bldMesh.visible = false; scene.add(bldMesh);
const prevBuilt = new Set();
// Haeuser wachsen aus den Zellen: jede Etage folgt den krummen Ecken ihrer Zelle, Nachbarn auf gleicher Hoehe teilen sich Ecken,
// Dachfirste und Farben und werden so ein Haus. Obere Etagen kragen aus, alles neigt und verzieht sich ein wenig.
function rebuildBuildings() {
  { // Gebaeude machen ihre Zelle zur festen Kante: geaenderte Zellen neu zeichnen
    const mark = c => { dirtyCells.add(c); for (let k = 0; k < ncnt[c]; k++) dirtyCells.add(cellNb[c * 6 + k]); };
    for (const c of builtCells) if (!prevBuilt.has(c)) { prevBuilt.add(c); mark(c); }
    for (const c of prevBuilt) if (!builtCells.has(c)) { prevBuilt.delete(c); mark(c); }
  }
  const P = [], Nn = [], Cc = [], Mm = [], Ll = [], Ix = []; let soot = 1;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nv = new THREE.Vector3();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const quad = (a, b, c, d, col, m, u0, u1, v0, v1, flag = 0) => {
    e1.subVectors(b, a); e2.subVectors(d, a); nv.crossVectors(e1, e2); if (nv.lengthSq() < 1e-14) { e2.subVectors(c, a); nv.crossVectors(e1, e2); } nv.normalize();
    const o = P.length / 3, pts = [a, b, c, d], us = [u0, u1, u1, u0], vs = [v0, v0, v1, v1];
    for (let i = 0; i < 4; i++) { P.push(pts[i].x, pts[i].y, pts[i].z); Nn.push(nv.x, nv.y, nv.z); Cc.push(col[0] * soot, col[1] * soot * 0.96, col[2] * soot * 0.92); Mm.push(m); Ll.push(us[i], vs[i], flag); }
    Ix.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const tri = (a, b, c, col, m, ua, va, ub, vb, uc, vc) => {
    e1.subVectors(b, a); e2.subVectors(c, a); nv.crossVectors(e1, e2).normalize();
    const o = P.length / 3, pts = [a, b, c], us = [ua, ub, uc], vs = [va, vb, vc];
    for (let i = 0; i < 3; i++) { P.push(pts[i].x, pts[i].y, pts[i].z); Nn.push(nv.x, nv.y, nv.z); Cc.push(col[0] * soot, col[1] * soot * 0.96, col[2] * soot * 0.92); Mm.push(m); Ll.push(us[i], vs[i], 0); }
    Ix.push(o, o + 1, o + 2);
  };
  const boxAt = (base, up, t1, t2, sx, sy, sz, col, m) => {      // kleiner Quader, base ist die Mitte der Unterseite
    const c = (dx, dy, dz) => base.clone().addScaledVector(t1, dx * sx / 2).addScaledVector(up, dy * sy).addScaledVector(t2, dz * sz / 2);
    quad(c(-1, 0, 1), c(1, 0, 1), c(1, 1, 1), c(-1, 1, 1), col, m, 0, sx / LU, 0, sy / LU); quad(c(1, 0, -1), c(-1, 0, -1), c(-1, 1, -1), c(1, 1, -1), col, m, 0, sx / LU, 0, sy / LU);
    quad(c(1, 0, 1), c(1, 0, -1), c(1, 1, -1), c(1, 1, 1), col, m, 0, sz / LU, 0, sy / LU); quad(c(-1, 0, -1), c(-1, 0, 1), c(-1, 1, 1), c(-1, 1, -1), col, m, 0, sz / LU, 0, sy / LU);
    quad(c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), c(-1, 1, -1), col, m, 0, 0.1, 0, 0.1);
  };
  const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  // Haeuser: zusammenhaengende bebaute Zellen auf gleicher Hoehe
  const clu = new Map();
  for (const c of builtCells) {
    if (clu.has(c)) continue;
    const st = [c], mem = [c]; let id = c; clu.set(c, -1);
    while (st.length) { const v = st.pop(); for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (BN[o] > 0 && H[o] === H[v] && !clu.has(o)) { clu.set(o, -1); st.push(o); mem.push(o); if (o < id) id = o; } } }
    { let hid = -1; for (const m of mem) { const q = homeOf.get(m); if (q !== undefined && (hid < 0 || q < hid)) hid = q; } if (hid >= 0) id = hid; }   // ein Lager gibt dem Haus Farbe und Neigung, Anbauten aendern sie nicht
    for (const m of mem) clu.set(m, id);
  }
  const a1 = new THREE.Vector3(), a2 = new THREE.Vector3(), axX = new THREE.Vector3(1, 0, 0), axY = new THREE.Vector3(0, 1, 0);
  // Ecke t der Etage L auf Hoehe der Geschossgrenze j. Haengt nur von Ecke, Hoehe und Haus ab, darum passen Nachbarn nahtlos.
  const cpos = (t, L, j, h, cid) => {
    cornerDir(t); const tx = tmp[0], ty = tmp[1], tz = tmp[2];
    let gx = 0, gy = 0, gz = 0, cnt = 0, first = -1, low = -1;
    for (let q = 0; q < 3; q++) {
      const o = triCells[t * 3 + q]; if (H[o] !== h) continue;
      if (BN[o] > L) { gx += cdir[o * 3]; gy += cdir[o * 3 + 1]; gz += cdir[o * 3 + 2]; cnt++; if (first < 0 || o < first) first = o; }
      if (j > 0 && BN[o] > j - 1 && (low < 0 || o < low)) low = o;
    }
    let ins = 0;
    if (cnt < 3 && first >= 0) { const bm = BLD[first * MAXF + L]; ins = Math.max(-0.2, BINS[bm] - (bm === 1 ? 0.075 : bm === 4 ? 0.05 : bm === 2 ? 0.03 : 0) * L * (0.2 + 1.1 * hashI(t, 330))); }
    const gl = Math.hypot(gx, gy, gz) || 1;
    const d = V(tx * (1 - ins) + gx / gl * ins, ty * (1 - ins) + gy / gl * ins, tz * (1 - ins) + gz / gl * ins).normalize();
    let r = R + h * LAYER + j * FH;
    if (j > 0) {
      const wm = low >= 0 ? BLD[low * MAXF + j - 1] : 1, wf = wm === 3 ? 0.12 : wm === 5 ? 0.07 : wm === 2 ? 0.55 : 1;
      a1.crossVectors(d, Math.abs(d.x) < 0.8 ? axX : axY).normalize(); a2.crossVectors(d, a1);
      const jj = Math.pow(j, 1.25), an = hashI(t, 331) * TAU, am = CELLW * 0.050 * jj * (0.3 + hashI(t, 332)) * wf;
      const ac = hashI(cid, 333) * TAU + j * (hashI(cid, 335) - 0.5) * 0.9, amc = CELLW * 0.068 * jj * (0.35 + 0.65 * hashI(cid, 334)) * wf;
      r += (hashI(t, 340 + j) - 0.5) * FH * 0.24 * wf;
      d.multiplyScalar(r).addScaledVector(a1, Math.cos(an) * am + Math.cos(ac) * amc).addScaledVector(a2, Math.sin(an) * am + Math.sin(ac) * amc);
    } else d.multiplyScalar(r);
    return d;
  };
  const glass = [0.2, 0.28, 0.38], lamp = [1.0, 0.80, 0.36], terra = [0.72, 0.42, 0.28];
  bldEmit.length = 0;
  for (const c of builtCells) {
    const n = BN[c], h = H[c], m6 = ncnt[c], up = V(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]), cid = clu.get(c);
    const hc = Math.floor(hashI(c, 201) * 1e6), hcl = Math.floor(hashI(cid, 202) * 1e6);
    const pl = PLASTER[hc % PLASTER.length];        // jede Zelle eines Hauses hat ihre eigene Farbe
    const pcol = PAINT[c] >= 0 ? PALETTE[PAINT[c]].map(x => x * 0.6 + 0.4) : shade(pl, 0.95 + 0.08 * hashI(c, 203));
    const beam = hashI(c, 231) < 0.45 ? BEAMP[(hc >> 8) % BEAMP.length] : BEAMC[(hc >> 8) % BEAMC.length], rc = ROOFC[(hc >> 5) % ROOFC.length], shut = SHUTC[(hc >> 9) % SHUTC.length];
    const trim = (hc >> 12) % 3 !== 0 ? shade(SHUTC[(hc >> 14) % SHUTC.length], 1.1) : [0.94, 0.91, 0.84], bloom = BLOOM[(hc >> 7) % BLOOM.length];
    const tcs = []; for (let k = 0; k < m6; k++) tcs.push(cellCorner[c * 6 + k]);
    let pu = 0, doorSide = -1, Tl = null, plL = pl, pcolL = pcol;
    soot = 1 - 0.62 * DMG[c] / 100;        // Schaden: verrusst, und es qualmt aus der Ruine
    if (DMG[c] >= 50) bldEmit.push(V(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]).multiplyScalar(R + h * LAYER + n * FH * 0.8));
    const isHome = homeOf.get(c) === c, steelC = [0.22, 0.25, 0.31];
    const doorL = BLD[c * MAXF] === 6 && n > 1 ? 1 : 0;
    { const os = []; for (let k = 0; k < m6; k++) { const nb = cellNb[c * 6 + k]; if (!(BN[nb] > doorL && H[nb] === h)) os.push(k); } if (os.length) doorSide = os[hc % os.length]; }
    const strut = (a, b, w, col, m = 15) => {
      const d = V(0, 0, 0).subVectors(b, a), len = d.length(); d.normalize();
      const p1 = V(0, 0, 0).crossVectors(d, Math.abs(d.dot(up)) > 0.95 ? (Math.abs(d.x) < 0.8 ? axX : axY) : up).normalize().multiplyScalar(w / 2), p2 = V(0, 0, 0).crossVectors(d, p1).normalize().multiplyScalar(w / 2);
      const c4 = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(q => V(0, 0, 0).addScaledVector(p1, q[0]).addScaledVector(p2, q[1]));
      for (let i = 0; i < 4; i++) { const u = c4[i], v = c4[(i + 1) % 4]; quad(a.clone().add(u), a.clone().add(v), b.clone().add(v), b.clone().add(u), col, m, 0, 0.1, 0, len / LU); }
    };
    for (let L = 0; L < n; L++) {
      const mt = BLD[c * MAXF + L], Bq = tcs.map(t => cpos(t, L, L, h, cid)), Tq = tcs.map(t => cpos(t, L, L + 1, h, cid)); Tl = Tq;
      // jede Etage kann neu gestrichen sein: Haeuser werden bunt gestapelt
      if (L > 0 && PAINT[c] < 0 && hashI(c, 232 + L) < 0.5) { plL = PLASTER[Math.floor(hashI(c, 240 + L) * PLASTER.length)]; pcolL = shade(plL, 0.95 + 0.08 * hashI(c, 250 + L)); }
      const open = []; let anyOpen = false; for (let k = 0; k < m6; k++) { const nb = cellNb[c * 6 + k]; const o = !(BN[nb] > L && H[nb] === h); open.push(o); if (o) anyOpen = true; }
      if (mt === 6) {        // Stelzen: ein krummer Stamm traegt die Huette, Streben und eine Leiter fuehren hinauf
        const cB = V(0, 0, 0), cT = V(0, 0, 0); for (const q of Bq) cB.add(q); cB.multiplyScalar(1 / m6); for (const q of Tq) cT.add(q); cT.multiplyScalar(1 / m6);
        const bark = [0.44, 0.31, 0.20], Nq = L + 1 < n ? tcs.map(t => cpos(t, L + 1, L + 1, h, cid)) : Tq;
        for (let k = 0; k < m6; k++) { const k1 = (k + 1) % m6;
          const r0 = 0.50 + 0.22 * hashI(tcs[k], 602), r1 = 0.50 + 0.22 * hashI(tcs[k1], 602);
          quad(cB.clone().lerp(Bq[k], r0), cB.clone().lerp(Bq[k1], r1), cT.clone().lerp(Tq[k1], 0.36), cT.clone().lerp(Tq[k], 0.36), shade(bark, 0.85 + 0.3 * hashI(c * 7 + k, 601)), 15, k * 0.2, k * 0.2 + 0.2, 0, 0.5); }
        for (let k = 0; k < m6; k++) { if (k % 2 !== hc % 2) continue; strut(cB.clone().lerp(Bq[k], 0.9).addScaledVector(up, FH * 0.25), Nq[k].clone().lerp(cT, 0.10), CELLW * 0.04, beam); }
        if (doorSide >= 0) { const k = doorSide, k1 = (k + 1) % m6, top = Nq[k].clone().lerp(Nq[k1], 0.5), o = top.clone().sub(cT); o.addScaledVector(up, -o.dot(up)).normalize();
          const wr = Nq[k1].clone().sub(Nq[k]).normalize(), foot = Bq[k].clone().lerp(Bq[k1], 0.5).addScaledVector(o, CELLW * 0.30), tp = top.clone().addScaledVector(o, CELLW * 0.07).addScaledVector(up, FH * 0.1);
          for (const sg of [-1, 1]) strut(foot.clone().addScaledVector(wr, sg * CELLW * 0.055), tp.clone().addScaledVector(wr, sg * CELLW * 0.055), CELLW * 0.018, beam);
          for (let i = 1; i < 7; i++) { const p = foot.clone().lerp(tp, i / 7); strut(p.clone().addScaledVector(wr, -CELLW * 0.055), p.clone().addScaledVector(wr, CELLW * 0.055), CELLW * 0.014, shade(beam, 1.2)); } }
        continue;
      }
      if (L > 0 && anyOpen) {          // Unterseite der Auskragung
        const ctr = V(0, 0, 0); for (const b of Bq) ctr.add(b); ctr.multiplyScalar(1 / m6);
        for (let k = 0; k < m6; k++) { const k1 = (k + 1) % m6; tri(Bq[k1], Bq[k], ctr, shade(beam, 0.8), 15, 0, 0, 0.3, 0, 0.15, 0.3); }
      }
      for (let k = 0; k < m6; k++) {
        if (!open[k]) continue;
        const k1 = (k + 1) % m6, A0 = Bq[k], B0 = Bq[k1], B1 = Tq[k1], A1 = Tq[k];
        const wl = A0.distanceTo(B0), ul = wl / LU, v0 = L * 0.5, v1 = v0 + 0.5, hk = c * 7 + k, hw = hashI(hk, 300 + L), hw2 = hashI(hk, 320 + L);
        const wn = V(0, 0, 0).crossVectors(e1.subVectors(B0, A0), e2.subVectors(A1, A0)).normalize(), wr = V(0, 0, 0).subVectors(B0, A0).normalize();
        const at = (sx, ty, dp) => V(0, 0, 0).copy(A0).lerp(B0, sx).lerp(V(0, 0, 0).copy(A1).lerp(B1, sx), ty).addScaledVector(wn, dp * CELLW);
        const part = (s0, s1, t0, t1, dp, col, m) => quad(at(s0, t0, dp), at(s1, t0, dp), at(s1, t1, dp), at(s0, t1, dp), col, m, pu + s0 * ul, pu + s1 * ul, v0 + t0 * 0.5, v0 + t1 * 0.5);
        const partF = (s0, s1, t0, t1, dp, col, m, flag, vmax = 1) => quad(at(s0, t0, dp), at(s1, t0, dp), at(s1, t1, dp), at(s0, t1, dp), col, m, 0, 1, 0, vmax, flag);
        const shelf = (s0, s1, t, d0, d1, th, col, m) => { quad(at(s0, t, d1), at(s1, t, d1), at(s1, t, d0), at(s0, t, d0), col, m, 0, (s1 - s0) * ul, 0, 0.2); quad(at(s0, t - th, d1), at(s1, t - th, d1), at(s1, t, d1), at(s0, t, d1), shade(col, 0.85), m, 0, (s1 - s0) * ul, 0, 0.1); quad(at(s0, t - th, d0), at(s1, t - th, d0), at(s1, t - th, d1), at(s0, t - th, d1), shade(col, 0.6), m, 0, (s1 - s0) * ul, 0, 0.2); };
        const pot = (s, t, d, sc, seed) => { const b = at(s, t, d); boxAt(b, up, wr, wn, CELLW * 0.05 * sc, FH * 0.10 * sc, CELLW * 0.05 * sc, shade(terra, 0.85 + 0.3 * hashI(seed, 1)), 0); boxAt(b.clone().addScaledVector(up, FH * 0.09 * sc), up, wr, wn, CELLW * 0.085 * sc, FH * (0.12 + 0.12 * hashI(seed, 2)) * sc, CELLW * 0.085 * sc, BLOOM[Math.floor(hashI(seed, 3) * BLOOM.length)], 18); };
        const lantern = (s, t) => { boxAt(at(s, t + 0.10, 0.03), up, wr, wn, CELLW * 0.012, FH * 0.02, CELLW * 0.07, [0.2, 0.2, 0.22], 10); boxAt(at(s, t, 0.055), up, wr, wn, CELLW * 0.035, FH * 0.11, CELLW * 0.035, lamp, 13); boxAt(at(s, t + 0.11, 0.055), up, wr, wn, CELLW * 0.05, FH * 0.025, CELLW * 0.05, [0.2, 0.2, 0.22], 10); };
        const modern = mt === 3 || mt === 5;
        const hv = hashI(c, 209 + L), mixc = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        // Stein ist mal roh, mal getuencht, Beton oft pastellfarben gestrichen, Blockbau in verschiedenen Lasuren, Glas in mehreren Toenungen
        const wcol = mt === 1 ? pcolL : mt === 2 ? (hv < 0.55 ? mixc([0.78, 0.74, 0.68], pcolL, 0.7) : shade([0.76, 0.72, 0.66], 0.90 + 0.2 * hv)) : mt === 4 ? shade(STAIN[Math.floor(hashI(c, 208) * STAIN.length)], 0.9 + 0.2 * hv) : mt === 5 ? [[0.5, 0.7, 0.85], [0.45, 0.78, 0.72], [0.80, 0.66, 0.50], [0.62, 0.60, 0.86]][hc % 4] : (hashI(c, 206 + L) < 0.75 ? mixc([0.87, 0.87, 0.85], plL, 0.8) : shade([0.87, 0.87, 0.85], 0.94 + 0.1 * hv));
        quad(A0, B0, B1, A1, wcol, mt === 1 ? 16 : mt === 2 ? 3 : mt === 4 ? 2 : mt === 5 ? 9 : 8, pu, pu + ul, v0, v1);
        const isDoor = L === doorL && k === doorSide, wide = wl > CELLW * 0.28 && mt !== 5;
        if (mt === 1) {      // Fachwerk, jedes Feld etwas anders
          part(0, 0.08, 0, 1, 0.012, beam, 15); part(0.92, 1, 0, 1, 0.012, beam, 15); part(0, 1, 0.9, 1, 0.016, beam, 15); part(0, 1, 0, 0.07, 0.014, beam, 15);
          const style = Math.floor(hw2 * 4);
          if (style === 0) quad(at(0.08, 0.07, 0.011), at(0.15, 0.07, 0.011), at(0.31, 0.9, 0.011), at(0.24, 0.9, 0.011), beam, 15, 0, 0.1, 0, 0.8);
          else if (style === 1) quad(at(0.85, 0.07, 0.011), at(0.92, 0.07, 0.011), at(0.76, 0.9, 0.011), at(0.69, 0.9, 0.011), beam, 15, 0, 0.1, 0, 0.8);
          else if (style === 2) { quad(at(0.08, 0.07, 0.011), at(0.14, 0.07, 0.011), at(0.28, 0.5, 0.011), at(0.22, 0.5, 0.011), beam, 15, 0, 0.1, 0, 0.5); quad(at(0.86, 0.07, 0.011), at(0.92, 0.07, 0.011), at(0.78, 0.5, 0.011), at(0.72, 0.5, 0.011), beam, 15, 0, 0.1, 0, 0.5); part(0.08, 0.92, 0.47, 0.53, 0.011, beam, 15); }
          else part(0.08, 0.92, 0.24, 0.29, 0.011, beam, 15);
        } else if (mt === 2) { const q = shade([0.86, 0.83, 0.78], 0.9 + 0.15 * hashI(hk, 9)); part(0, 0.09, 0, 1, 0.012, q, 3); part(0.91, 1, 0, 1, 0.012, q, 3); part(0, 1, 0.93, 1, 0.016, q, 0); }
        else if (mt === 4) { const lg = shade([0.40, 0.27, 0.17], 0.9 + 0.2 * hashI(hk, 9)); part(0, 0.075, 0, 1, 0.022, lg, 15); part(0.925, 1, 0, 1, 0.022, lg, 15); part(0, 1, 0.92, 1, 0.02, lg, 15); }
        else if (mt === 5) { part(0, 0.035, 0, 1, 0.016, steelC, 10); part(0.965, 1, 0, 1, 0.016, steelC, 10); part(0, 1, 0.93, 1, 0.022, steelC, 10); if (L % 3 === 0) part(0, 1, 0, 0.05, 0.03, steelC, 10); }
        else { part(0, 1, 0.94, 1, 0.016, [0.72, 0.72, 0.70], 8); }
        let balcony = false;
        if (isDoor) {
          partF(0.30, 0.70, 0, 0.80, 0.014, trim, 17, 2); partF(0.34, 0.66, 0, 0.76, 0.022, modern ? [0.26, 0.28, 0.32] : (hcl >> 3) % 2 ? shade(shut, 0.9) : [0.42, 0.26, 0.16], 17, 1);
          shelf(0.26, 0.74, 0.0, 0, 0.07, 0.06, [0.62, 0.60, 0.57], 3);
          lantern(0.80, 0.52); if (hw2 > 0.4) pot(0.16, 0, 0.05, 1.2, hk + 11);
          if (!modern && hw > 0.45) { quad(at(0.22, 0.80, 0.14), at(0.78, 0.80, 0.14), at(0.72, 0.93, 0.0), at(0.28, 0.93, 0.0), rc, 4, 0, 0.5, 0, 0.3); }
        } else if (wide) {
          const kind = L === 0 ? (hw < 0.28 ? 3 : hw < 0.45 ? 1 : 0) : (hw < 0.24 ? 2 : hw < 0.40 ? 1 : hw < 0.5 ? 4 : 0);
          if (kind === 1) {              // rundes Fenster
            partF(0.32, 0.68, 0.30, 0.82, 0.02, trim, 7, 1);
          } else if (kind === 2 && !modern) {   // Balkon mit Fenstertuer, Gelaender und Toepfen
            balcony = true;
            partF(0.34, 0.66, 0.04, 0.84, 0.014, trim, 17, 2); partF(0.37, 0.63, 0.04, 0.80, 0.02, glass, 7, 3);
            shelf(0.12, 0.88, 0.04, 0, 0.17, 0.05, mt === 2 ? [0.66, 0.63, 0.60] : shade(beam, 1.25), mt === 2 ? 3 : 1);
            for (let i = 0; i <= 6; i++) { const s = 0.13 + i * 0.123; part(s - 0.012, s + 0.012, 0.04, 0.40, 0.165, mt === 2 ? [0.24, 0.26, 0.30] : beam, mt === 2 ? 10 : 15); }
            part(0.11, 0.89, 0.39, 0.44, 0.17, mt === 2 ? [0.24, 0.26, 0.30] : beam, mt === 2 ? 10 : 15);
            for (const s of [0.12, 0.88]) quad(at(s, 0.04, 0), at(s, 0.04, 0.17), at(s, 0.42, 0.17), at(s, 0.42, 0), mt === 2 ? [0.24, 0.26, 0.30] : beam, mt === 2 ? 10 : 15, 0, 0.2, 0, 0.3);
            const np = 1 + Math.floor(hw2 * 4); for (let i = 0; i < np; i++) pot(0.2 + 0.6 * hashI(hk + i, 31), 0.05, 0.05 + 0.09 * hashI(hk + i, 32), 0.8 + 0.5 * hashI(hk + i, 33), hk * 5 + i);
            if (hw2 > 0.5) for (let i = 0; i < 6; i++) boxAt(at(0.15 + i * 0.14, 0.0 - 0.06 - 0.04 * Math.sin(i / 5 * Math.PI), 0.165), up, wr, wn, CELLW * 0.022, CELLW * 0.022, CELLW * 0.022, i % 2 ? lamp : BLOOM[(i + hc) % BLOOM.length], 13);
          } else if (kind === 3 && !modern) {   // Ladenfenster mit gestreifter Markise
            part(0.14, 0.86, 0.22, 0.74, 0.014, trim, 0); part(0.17, 0.83, 0.25, 0.71, 0.022, glass, 7);
            for (const s of [0.39, 0.61]) part(s - 0.01, s + 0.01, 0.25, 0.71, 0.026, trim, 0);
            quad(at(0.08, 0.60, 0.20), at(0.92, 0.60, 0.20), at(0.90, 0.84, 0.01), at(0.10, 0.84, 0.01), bloom, 20, 0, 7, 0, 1);
            shelf(0.16, 0.84, 0.22, 0, 0.05, 0.04, shade(beam, 1.2), 1); pot(0.3, 0.22, 0.025, 0.7, hk + 3); pot(0.7, 0.22, 0.025, 0.7, hk + 4);
          } else if (kind === 4) {       // zwei schmale Fenster
            for (const s of [0.30, 0.70]) { part(s - 0.10, s + 0.10, 0.28, 0.82, 0.014, trim, 0); part(s - 0.075, s + 0.075, 0.31, 0.79, 0.022, glass, 7); part(s - 0.075, s + 0.075, 0.54, 0.56, 0.026, trim, 0); }
          } else {
            const w0 = modern ? 0.14 : mt === 2 ? 0.38 : 0.34, w1 = 1 - w0, t0 = modern ? 0.26 : 0.34, t1 = modern ? 0.80 : 0.76;
            part(w0 - 0.035, w1 + 0.035, t0 - 0.05, t1 + 0.05, 0.014, trim, 0); part(w0, w1, t0, t1, 0.022, glass, 7);
            part((w0 + w1) / 2 - 0.012, (w0 + w1) / 2 + 0.012, t0, t1, 0.026, trim, 0); if (!modern) part(w0, w1, (t0 + t1) / 2 - 0.01, (t0 + t1) / 2 + 0.01, 0.026, trim, 0);
            if (!modern && hw2 > 0.25) { const ang = (hashI(hk, 44) - 0.5) * 0.04; quad(at(w0 - 0.13, t0 + ang, 0.018), at(w0 - 0.03, t0, 0.018), at(w0 - 0.03, t1, 0.018), at(w0 - 0.13, t1 + ang, 0.018), shut, 1, 0, 0.1, 0, 0.3); quad(at(w1 + 0.03, t0, 0.018), at(w1 + 0.13, t0 - ang, 0.018), at(w1 + 0.13, t1 - ang, 0.018), at(w1 + 0.03, t1, 0.018), shut, 1, 0, 0.1, 0, 0.3); }
            if (!modern && hw2 > 0.45) { shelf(w0 - 0.04, w1 + 0.04, t0 - 0.05, 0, 0.055, 0.09, [0.42, 0.28, 0.17], 1); part(w0 - 0.03, w1 + 0.03, t0 - 0.05, t0 + 0.06, 0.05, BLOOM[Math.floor(hashI(hk, 45) * BLOOM.length)], 18); }
            if (modern && hw > 0.6) { shelf(0.1, 0.9, 0.2, 0, 0.08, 0.04, [0.70, 0.70, 0.68], 8); part(0.1, 0.9, 0.2, 0.42, 0.08, [0.30, 0.32, 0.36], 10); if (hw2 > 0.5) pot(0.3, 0.2, 0.04, 0.8, hk + 5); }
          }
          if (L === 0 && hw2 > 0.72) lantern(0.12, 0.55);
        }
        // Efeu klettert an manchen Waenden vom Boden hoch
        { const iv = hashI(hk, 400); if (iv < 0.34 && mt !== 5) { const top = 1 + Math.floor(hashI(hk, 401) * n * 1.3); if (L < top) { const s = 0.05 + 0.5 * hashI(hk, 402), wdt = 0.3 + 0.3 * hashI(hk, 403), last = L === top - 1 || L === n - 1;
          partF(s - 0.06, s + wdt, L === 0 ? -0.02 : 0, last ? 0.45 + 0.5 * hashI(hk, 404) : 1.0, balcony ? 0.012 : 0.034, shade([0.22, 0.46, 0.20], 0.85 + 0.4 * hashI(hk, 405)), 19, 0.3 + L + hashI(hk, 406) * 0.6, last ? 1 : 0.5); } } }
        // Kisten, Faesser und Toepfe am Sockel
        if (L === 0 && !isDoor && hw2 < 0.22) { const b = at(0.2 + 0.6 * hw, 0, 0.07); boxAt(b, up, wr, wn, CELLW * 0.10, FH * 0.26, CELLW * 0.10, [0.50, 0.36, 0.22], 1); if (hw > 0.5) boxAt(b.clone().addScaledVector(wr, CELLW * 0.11), up, wr, wn, CELLW * 0.08, FH * 0.18, CELLW * 0.08, [0.56, 0.42, 0.26], 1); }
        pu += ul;
      }
    }
    // ---------- Dach ----------
    const topm = BLD[c * MAXF + n - 1], rN = R + h * LAYER + n * FH;
    const ctrT = V(0, 0, 0); for (const b of Tl) ctrT.add(b); ctrT.multiplyScalar(1 / m6);
    const t1v = Tl[0].clone().sub(ctrT); t1v.addScaledVector(up, -t1v.dot(up)).normalize(); const t2v = V(0, 0, 0).crossVectors(up, t1v);
    const sameTop = o => BN[o] === n && H[o] === h, taller = o => BN[o] > n && H[o] === h;
    const openT = []; for (let k = 0; k < m6; k++) { const nb = cellNb[c * 6 + k]; openT.push(!(BN[nb] >= n && H[nb] === h)); }
    if (topm === 3 || topm === 5) {      // Flachdach mit Bruestung, Dachgarten oder Technik
      for (let k = 0; k < m6; k++) { const k1 = (k + 1) % m6; tri(Tl[k], Tl[k1], ctrT, [0.60, 0.60, 0.58], 8, 0, 0, 0.5, 0, 0.25, 0.5); }
      for (let k = 0; k < m6; k++) { if (!openT[k]) continue; const k1 = (k + 1) % m6, a = Tl[k], b = Tl[k1], a2x = a.clone().addScaledVector(up, FH * 0.18), b2x = b.clone().addScaledVector(up, FH * 0.18); quad(a, b, b2x, a2x, topm === 5 ? steelC : [0.80, 0.80, 0.78], topm === 5 ? 10 : 8, 0, 0.5, 0, 0.1); }
      const kind = topm === 5 ? (isHome ? 4 : 0) : hc % 4;
      if (kind === 4) {      // Mast mit rotem Licht auf dem Turm
        boxAt(ctrT.clone(), up, t1v, t2v, CELLW * 0.2, FH * 0.5, CELLW * 0.2, [0.42, 0.45, 0.50], 10); boxAt(ctrT.clone().addScaledVector(up, FH * 0.5), up, t1v, t2v, CELLW * 0.02, FH * 2.6, CELLW * 0.02, steelC, 10);
        boxAt(ctrT.clone().addScaledVector(up, FH * 3.1), up, t1v, t2v, CELLW * 0.05, CELLW * 0.05, CELLW * 0.05, [1.0, 0.25, 0.2], 13); }
      if (kind === 0) { boxAt(ctrT.clone().addScaledVector(t1v, CELLW * 0.1), up, t1v, t2v, CELLW * 0.14, FH * 0.4, CELLW * 0.14, [0.50, 0.53, 0.58], 10); boxAt(ctrT.clone().addScaledVector(t1v, -CELLW * 0.12), up, t1v, t2v, CELLW * 0.012, FH * 0.9, CELLW * 0.012, [0.25, 0.25, 0.28], 10); }
      else if (kind === 1) { boxAt(ctrT.clone(), up, t1v, t2v, CELLW * 0.34, FH * 0.08, CELLW * 0.3, [0.42, 0.30, 0.20], 1); boxAt(ctrT.clone().addScaledVector(up, FH * 0.07), up, t1v, t2v, CELLW * 0.30, FH * 0.14, CELLW * 0.26, bloom, 18); }
      else if (kind === 2) { for (let i = 0; i < 3; i++) { const b = ctrT.clone().addScaledVector(t1v, (hashI(c, 220 + i) - 0.5) * CELLW * 0.4).addScaledVector(t2v, (hashI(c, 224 + i) - 0.5) * CELLW * 0.4); boxAt(b, up, t1v, t2v, CELLW * 0.07, FH * 0.12, CELLW * 0.07, terra, 0); boxAt(b.clone().addScaledVector(up, FH * 0.1), up, t1v, t2v, CELLW * 0.12, FH * (0.2 + 0.3 * hashI(c, 228 + i)), CELLW * 0.12, [0.26, 0.5, 0.24], 18); } }
      continue;
    }
    const hcl2 = Math.floor(hashI(cid, 207) * 1e6);
    let lone = true; for (let k = 0; k < m6; k++) if (sameTop(cellNb[c * 6 + k])) lone = false;
    const ahC = FH * [1.0, 1.35, 1.8, 2.4][hcl2 % 4] * (topm === 2 ? 1.1 : 1), ah = ahC * (0.9 + 0.4 * hashI(c, 210)) * (lone ? 1.35 : 1);
    const apex = ctrT.clone(); apex.setLength(apex.length() + ah).addScaledVector(t1v, (hashI(c, 211) - 0.5) * CELLW * (lone ? 0.5 : 0.22)).addScaledVector(t2v, (hashI(c, 212) - 0.5) * CELLW * (lone ? 0.5 : 0.22));
    const E = [], expo = [];
    for (let k = 0; k < m6; k++) {
      const t = tcs[k], base = Tl[k].clone(); let s = 0, tl = 0, gx = 0, gy = 0, gz = 0;
      for (let q = 0; q < 3; q++) { const o = triCells[t * 3 + q]; if (sameTop(o)) s++; else if (taller(o)) tl++; else continue; gx += cdir[o * 3]; gy += cdir[o * 3 + 1]; gz += cdir[o * 3 + 2]; }
      if (s + tl >= 3) { base.setLength(base.length() + (tl ? ahC * 0.22 : ahC * 0.60 * (0.8 + 0.4 * hashI(t, 350)))); expo.push(false); }
      else { const g = V(gx, gy, gz).normalize(), out = base.clone().normalize().sub(g); out.addScaledVector(g, -out.dot(g)); if (out.lengthSq() > 1e-12) out.normalize(); base.addScaledVector(out, CELLW * (0.13 + 0.05 * hashI(t, 352))).addScaledVector(g, -FH * (0.08 + 0.10 * hashI(t, 353))); expo.push(true); }
      E.push(base);
    }
    const sl = E[0].distanceTo(apex) / LU;
    for (let k = 0; k < m6; k++) {
      const k1 = (k + 1) % m6, nb = cellNb[c * 6 + k], el = E[k].distanceTo(E[k1]) / LU, col = shade(rc, 0.88 + 0.2 * hashI(c * 7 + k, 360));
      if (sameTop(nb) || taller(nb)) {      // First zum Nachbarn: beide Zellen rechnen denselben Punkt
        const Mm2 = Tl[k].clone().add(Tl[k1]).multiplyScalar(0.5); Mm2.setLength(Mm2.length() + (taller(nb) ? ahC * 0.28 : ahC * 0.80 * (0.85 + 0.3 * hashI(tcs[k] + tcs[k1], 351))));
        const vm = (Mm2.length() - rN) * 1.3 / LU;
        tri(E[k], Mm2, apex, col, 4, 0, 0, el / 2, vm, el / 2, sl); tri(Mm2, E[k1], apex, col, 4, el / 2, vm, el, 0, el / 2, sl);
      } else {
        tri(E[k], E[k1], apex, col, 4, 0, 0, el, 0, el / 2, sl);
        tri(E[k1], E[k], ctrT, shade(beam, 0.75), 15, 0, 0, 0.2, 0, 0.1, 0.2);
        // Lichterkette unter der Traufe
        if (hashI(c * 7 + k, 365) < 0.22) for (let i = 1; i < 6; i++) { const b = E[k].clone().lerp(E[k1], i / 6).addScaledVector(up, -FH * (0.10 + 0.10 * Math.sin(i / 6 * Math.PI))); boxAt(b, up, t1v, t2v, CELLW * 0.024, CELLW * 0.024, CELLW * 0.024, i % 2 ? lamp : BLOOM[(i + hc) % BLOOM.length], 13); }
        // Gaube
        if (ah > FH * 1.3 && hashI(c * 7 + k, 366) < 0.3) {
          const mid = E[k].clone().lerp(E[k1], 0.5), base = mid.clone().lerp(apex, 0.30), wr = E[k1].clone().sub(E[k]).normalize(), fw = V(0, 0, 0).crossVectors(wr, up).normalize();
          if (fw.dot(mid.clone().sub(ctrT)) < 0) fw.negate();
          const dw = CELLW * 0.16, dh = FH * 0.34, b0 = base.clone().addScaledVector(fw, CELLW * 0.05);
          const p = (x, y) => b0.clone().addScaledVector(wr, x * dw / 2).addScaledVector(up, y * dh);
          quad(p(-1, 0), p(1, 0), p(1, 1), p(-1, 1), pcol, 16, 0, 0.3, 0, 0.3); quad(p(-0.6, 0.2), p(0.6, 0.2), p(0.6, 0.85), p(-0.6, 0.85), glass, 7, 0, 1, 0, 1, 3);
          const back = base.clone().lerp(apex, 0.35).addScaledVector(up, dh * 1.5), pk = p(0, 1.6);
          tri(p(-1.25, 0.95), pk, back, shade(rc, 0.9), 4, 0, 0, 0.2, 0.3, 0.1, 0.5); tri(pk, p(1.25, 0.95), back, shade(rc, 1.0), 4, 0, 0, 0.2, 0.3, 0.1, 0.5); tri(p(-1, 1), p(1, 1), pk, pcol, 16, 0, 0, 0.3, 0, 0.15, 0.2);
        }
      }
    }
    if (isHome || hashI(c, 213) < 0.5) { const j = hc % m6, cb = ctrT.clone().lerp(Tl[j], 0.5), chh2 = ah * 0.55 + FH * 0.5, ct = t1v.clone().addScaledVector(up, (hashI(c, 215) - 0.5) * 0.25).normalize(), cu = up.clone().addScaledVector(t1v, (hashI(c, 216) - 0.5) * 0.16).normalize();
      boxAt(cb, cu, ct, t2v, CELLW * 0.10, chh2, CELLW * 0.10, [0.62, 0.52, 0.46], 3); boxAt(cb.clone().addScaledVector(cu, chh2), cu, ct, t2v, CELLW * 0.13, FH * 0.07, CELLW * 0.13, [0.28, 0.26, 0.26], 0); bldEmit.push(cb.clone().addScaledVector(cu, chh2 + FH * 0.1)); }
    const fin = isHome ? 9 : hashI(c, 214);
    if (isHome) {      // Wimpel auf dem eigenen Haus
      const own = fieldOwner[fieldOf[c]], fc = own === 0 ? [0.98, 0.76, 0.2] : BLOOM[Math.floor(hashI(c, 217) * BLOOM.length)], pb = apex.clone().addScaledVector(up, -FH * 0.05), ph = FH * 0.9;
      boxAt(pb, up, t1v, t2v, CELLW * 0.016, ph, CELLW * 0.016, [0.25, 0.25, 0.28], 10);
      tri(pb.clone().addScaledVector(up, ph), pb.clone().addScaledVector(up, ph * 0.66), pb.clone().addScaledVector(up, ph * 0.83).addScaledVector(t1v, CELLW * 0.2), fc, 5, 0, 0, 0, 0.2, 0.3, 0.1);
    }
    if (BLD[c * MAXF] === 6) {      // Baumhaus: die Krone waechst hinter und ueber der Huette
      const blob = (p, r, col) => { const S = 7, Rn = 4, pt = (i, j) => { const th = j / Rn * Math.PI * 0.82, ph = i / S * TAU, wob = j === 0 ? 1 : 0.82 + 0.36 * hashI((i % S) * 13 + j * 7 + c, 620);
        return p.clone().addScaledVector(up, Math.cos(th) * r * 0.85).addScaledVector(t1v, Math.sin(th) * Math.cos(ph) * r * wob).addScaledVector(t2v, Math.sin(th) * Math.sin(ph) * r * wob); };
        for (let j = 0; j < Rn; j++) for (let i = 0; i < S; i++) quad(pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j), pt(i, j), shade(col, 0.9 + 0.2 * hashI(i + j * 9 + c, 621)), 12, 0, 0.2, 0, 0.2); };
      const dv = doorSide >= 0 ? Tl[doorSide].clone().lerp(Tl[(doorSide + 1) % m6], 0.5).sub(ctrT) : t1v.clone(); dv.addScaledVector(up, -dv.dot(up)).normalize();
      const sd = V(0, 0, 0).crossVectors(up, dv);
      blob(ctrT.clone().addScaledVector(up, ah + FH * 0.5).addScaledVector(dv, -CELLW * 0.30), CELLW * 0.46, [0.26, 0.52, 0.27]);
      blob(ctrT.clone().addScaledVector(up, FH * 0.9).addScaledVector(dv, -CELLW * 0.52).addScaledVector(sd, CELLW * 0.34), CELLW * 0.32, [0.22, 0.47, 0.24]);
      blob(ctrT.clone().addScaledVector(up, FH * 1.0).addScaledVector(dv, -CELLW * 0.48).addScaledVector(sd, -CELLW * 0.38), CELLW * 0.34, [0.30, 0.57, 0.28]);
      strut(ctrT.clone().addScaledVector(dv, -CELLW * 0.12), ctrT.clone().addScaledVector(up, ah + FH * 0.3).addScaledVector(dv, -CELLW * 0.3), CELLW * 0.09, [0.44, 0.31, 0.20]);
    }
    if (fin < 0.3) { boxAt(apex.clone().addScaledVector(up, -FH * 0.04), up, t1v, t2v, CELLW * 0.014, FH * 0.42, CELLW * 0.014, [0.25, 0.25, 0.28], 10); boxAt(apex.clone().addScaledVector(up, FH * 0.38), up, t1v, t2v, CELLW * 0.045, CELLW * 0.045, CELLW * 0.045, [0.96, 0.78, 0.26], 10); }
    else if (fin < 0.48) {      // Antenne
      const ab = apex.clone().lerp(E[hc % m6], 0.35).addScaledVector(up, -FH * 0.1), pole = FH * 1.1; boxAt(ab, up, t1v, t2v, CELLW * 0.012, pole, CELLW * 0.012, [0.3, 0.3, 0.33], 10);
      for (let i = 0; i < 4; i++) boxAt(ab.clone().addScaledVector(up, pole * (0.55 + i * 0.13)), up, t1v, t2v, CELLW * (0.22 - i * 0.035), CELLW * 0.008, CELLW * 0.008, [0.3, 0.3, 0.33], 10);
      boxAt(ab.clone().addScaledVector(up, pole * 0.5), up, t1v, t2v, CELLW * 0.008, CELLW * 0.008, CELLW * 0.2, [0.3, 0.3, 0.33], 10);
    } else if (fin < 0.6 && lone) { for (let i = 0; i < 5; i++) { const a = apex.clone().addScaledVector(up, FH * 0.1), b = E[(hc + 2) % m6].clone().addScaledVector(up, FH * 0.1), f = (i + 0.5) / 5, p = a.clone().lerp(b, f).addScaledVector(up, -Math.sin(f * Math.PI) * FH * 0.25), d = b.clone().sub(a).normalize();
      tri(p.clone().addScaledVector(d, -CELLW * 0.03), p.clone().addScaledVector(d, CELLW * 0.03), p.clone().addScaledVector(up, -CELLW * 0.07), BLOOM[(i + hc) % BLOOM.length], 5, 0, 0, 0.1, 0, 0.05, 0.1); } }
  }
  const g = bldMesh.geometry; g.dispose();
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); ng.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nn), 3));
  ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Cc), 3)); ng.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(Mm), 1)); ng.setAttribute('aLoc', new THREE.BufferAttribute(new Float32Array(Ll), 3));
  ng.setIndex(Ix); bldMesh.geometry = ng; bldMesh.visible = Ix.length > 0; fxDirty = true;
}
function buildFloor(c) {
  if (BN[c] > 0 && DMG[c] > 0) {        // beschaedigte Gebaeude zuerst flicken: halbe Materialkosten der obersten Etage
    const tm = BLD[c * MAXF + BN[c] - 1], full = BCOST[tm], cost = {}; for (const k of Object.keys(full)) cost[k] = Math.ceil(full[k] / 2);
    if (!payNeed(cost, 'The repair')) return false;
    DMG[c] = 0; bldDirty = true; saveDirty = true; toast('Repaired.'); return true;
  }
  const m = state.bmat || 1, n = BN[c], rq = BREQ[m];
  if (state.home < 0 || state.camp < 0) { toast('Buy a field, place your tent and upgrade it first. Building starts with a wooden hut.'); return false; }
  if (state.tier < rq.tier) { toast(BNAME[m] + ' floors need your camp to be at least a ' + TIERNAMES[rq.tier].toLowerCase() + '.'); return false; }
  if (!state.plans[rq.plan]) { toast('You need the ' + BNAME[m].toLowerCase() + ' building blueprint. Traders sell it.'); return false; }
  if (H[c] < 0 || W[c] > 0.2) { toast('Buildings need dry land.'); return false; }
  if (MAT[c] === FOREST) { toast('Clear the trees first.'); return false; }
  if (n >= MAXF) { toast('This is as high as it goes.'); return false; }
  for (let j = 0; j < n; j++) if (n - j > BCAP[BLD[c * MAXF + j]]) { toast(BNAME[BLD[c * MAXF + j]] + ' on floor ' + (j + 1) + ' cannot carry another floor. Timber carries 2, stone 4, concrete 7.'); return false; }
  if (!payNeed(BCOST[m], 'A ' + BNAME[m].toLowerCase() + ' floor')) return false;
  BLD[c * MAXF + n] = m; BN[c] = n + 1; builtCells.add(c); bldDirty = true; saveDirty = true; return true;
}
function demolishFloor(c) {
  const n = BN[c] - 1, m = BLD[c * MAXF + n], cost = BCOST[m] || {};
  for (const k of Object.keys(cost)) { const back = Math.floor(cost[k] / 2); if (k === 'beton') state.uses.beton += back; else state.inv[k] += back; }
  BN[c] = n; DMG[c] = 0; if (!n) builtCells.delete(c); bldDirty = true; saveDirty = true;
  toast('Top floor taken down. Half the material came back.');
}

/* ---------------- Teilchen: Feuer, Rauch, Gischt ---------------- */
// Jedes Teilchen kennt nur seinen Ursprung und eine Zufallszahl. Die Bewegung rechnet die Grafikkarte aus der Zeit, es gibt keinen Zustand je Teilchen.
const FX_VS = `
attribute vec3 aP; uniform float uTime; uniform vec3 uWind; uniform float uPx; uniform vec3 uSun;
varying float vAge; varying float vType; varying float vFade; varying float vDay; varying float vSpark;
void main(){
  vSpark = 0.0;
  vec3 o = (modelMatrix * vec4(position,1.0)).xyz, up = normalize(o);
  float seed = aP.x, type = aP.y, sc = aP.z;
  float age = fract(uTime * (type < 0.5 ? 1.15 : type < 1.5 ? 0.20 : 0.30) + seed);
  vec3 r = vec3(fract(seed*17.13), fract(seed*39.7), fract(seed*71.9)) - 0.5;
  vec3 t1 = normalize(cross(up, vec3(0.31,0.74,0.59))), t2 = cross(up, t1);
  vec3 p = o; float size;
  if (type < 0.5) {
    // Flammen zuengeln: jede Zunge hat ihr eigenes Tempo, schwankt seitlich und neigt sich in den Wind. Ein Teil der Teilchen fliegt als Funken davon.
    age = fract(uTime*1.15*(0.75 + 0.9*fract(seed*53.3)) + seed);
    float fl = sin(uTime*11.0 + seed*40.0)*0.5 + sin(uTime*23.0 + seed*17.0)*0.5;
    if (fract(seed*91.7) > 0.84) {
      vSpark = 1.0;
      p += up*(age*3.4*sc) + uWind*(age*3.0*sc) + (t1*r.x + t2*r.y)*sc*(0.3 + age*1.8) + t1*sin(age*9.0 + seed*30.0)*sc*0.3;
      size = sc*0.11*(1.0 - age*0.6);
    } else {
      p += up*(age*(0.85 + 0.8*(r.z + 0.5))*sc) + (t1*r.x + t2*r.y)*sc*0.5*(1.0 - age)*(1.0 - age) + (t1*fl + t2*cos(uTime*9.0 + seed*31.0))*sc*0.09*age + uWind*(age*age*0.7*sc);
      size = sc*(0.44 + 0.40*fract(seed*7.7))*(1.0 - age*0.75)*(0.88 + 0.18*fl);
    }
  } else if (type < 1.5) {
    p += up*(age*5.0*sc) + uWind*(age*age*4.5*sc) + (t1*r.x + t2*r.y)*sc*(0.2 + age*1.4) + t1*sin(age*6.0 + seed*30.0)*sc*0.35;
    size = sc*(0.9 + age*2.6);
  } else {
    float a2 = min(age*2.4, 1.0);
    p += up*(sin(a2*3.14159)*sc*(0.5 + r.z)) + (t1*r.x + t2*r.y)*sc*(0.5 + a2*0.9);
    size = age*2.4 > 1.0 ? 0.0 : sc*0.42; age = a2;
  }
  vAge = age; vType = type;
  vec4 mv = viewMatrix * vec4(p,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPx / gl_Position.w;
  vFade = 1.0 - smoothstep(${(50 * CELLW).toFixed(1)}, ${(110 * CELLW).toFixed(1)}, -mv.z);
  vDay = smoothstep(-0.25, 0.30, dot(up,uSun));
}`;
const FX_FS = `
varying float vAge; varying float vType; varying float vFade; varying float vDay; varying float vSpark;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  if (vType < 0.5 && vSpark < 0.5) q.x *= 1.5;          // Flammen sind schlank
  float d = length(q); if (d > 0.5) discard;
  float soft = smoothstep(0.5, 0.08, d);
  vec3 col; float a;
  if (vType < 0.5) {
    col = mix(mix(vec3(1.0,0.96,0.72), vec3(1.0,0.60,0.12), smoothstep(0.0, 0.35, vAge)), vec3(0.85,0.14,0.02), smoothstep(0.35, 1.0, vAge));
    a = vSpark > 0.5 ? (1.0 - vAge)*1.4 : soft*(1.0 - vAge)*0.95; col *= a; }
  else if (vType < 1.5) { col = mix(vec3(0.34), vec3(0.78), vAge)*(0.32 + 0.68*vDay); a = soft*0.42*sin(vAge*3.14159); }
  else { col = vec3(1.0)*(0.45 + 0.55*vDay); a = soft*0.75*sin(vAge*3.14159); }
  gl_FragColor = vec4(col, a*vFade);
}`;
const fxMat = add => new THREE.ShaderMaterial({ uniforms: U, vertexShader: FX_VS, fragmentShader: FX_FS, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
const fxFire = new THREE.Points(new THREE.BufferGeometry(), fxMat(true)), fxSoft = new THREE.Points(new THREE.BufferGeometry(), fxMat(false));
fxFire.frustumCulled = false; fxSoft.frustumCulled = false; fxFire.renderOrder = 9; fxSoft.renderOrder = 8; fxFire.visible = false; fxSoft.visible = false; scene.add(fxFire); scene.add(fxSoft);
let fxDirty = true;
{ // Brenner des Ballons, fliegt mit
  const n = 12, pp = new Float32Array(n * 3), aa = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pp[i * 3 + 1] = 2.55; aa[i * 3] = Math.random(); aa[i * 3 + 2] = GS * 0.9; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pp, 3)); g.setAttribute('aP', new THREE.BufferAttribute(aa, 3));
  const pts = new THREE.Points(g, fxFire.material); pts.frustumCulled = false; pts.renderOrder = 9; figure.userData.balloon.add(pts);
}
function rebuildFx() {
  const FP = [], FA = [], SP = [], SA = [];
  const put = (P, A, v, type, sc, n) => { for (let i = 0; i < n; i++) { P.push(v.x, v.y, v.z); A.push(Math.random(), type, sc); } };
  for (const c of refuges) { _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]).multiplyScalar(R + H[c] * LAYER + 2.62 * CELLW / 3); put(FP, FA, _v, 0, CELLW * 0.16, 10); }
  if (state.home >= 0 && houseMesh) {
    houseMesh.updateMatrixWorld(true); const hs = CELLW * HOUSESC[state.tier], at = (x, y, z) => _v2.set(x, y, z).applyMatrix4(houseMesh.matrixWorld);
    if (state.tier === 0 && !rainAt(state.camp)) { put(FP, FA, at(1.15, 0.1, 0), 0, hs * 0.34, 16); put(SP, SA, at(1.15, 0.5, 0), 1, hs * 0.34, 16); }
  }
  (state.bots || []).forEach((b, i) => { const r = botRt[i]; if (!r || !r.house || b.tier !== 0 || rainAt(b.camp)) return;       // Lagerfeuer vor jedem Zelt
    r.house.updateMatrixWorld(true); const hs = CELLW * HOUSESC[0]; _v2.set(1.15, 0.1, 0).applyMatrix4(r.house.matrixWorld); put(FP, FA, _v2, 0, hs * 0.34, 10); _v2.set(1.15, 0.5, 0).applyMatrix4(r.house.matrixWorld); put(SP, SA, _v2, 1, hs * 0.34, 10); });
  for (const e of bldEmit) put(SP, SA, e, 1, CELLW * 0.10, 14);
  { const fr = state.nature && state.nature.fire; let q = 0;      // Waldbrand: Flammen und dichter Rauch
    if (fr) for (const k in fr) { const c = +k; if (cellDist(c, focusCell) > 42) continue; if (q++ > 150) break; _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]).multiplyScalar(R + H[c] * LAYER + CELLW * 0.5); put(FP, FA, _v, 0, CELLW * 0.55, 7); _v.multiplyScalar(1 + CELLW * 0.5 / R); put(SP, SA, _v, 1, CELLW * 0.7, 3); } }
  { const nt = state.nature, nv = nt && nt.v;      // Vulkan: Rauch ueber dem Kegel, Feuer im Krater, Qualm ueber der Lava
    if (nv) { const c = nv.c; _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]).multiplyScalar(R + (H[c] + 1) * LAYER);
      put(SP, SA, _v, 1, CELLW * (nv.ph === 1 ? 1.2 : 0.6), nv.ph === 1 ? 60 : 18); if (nv.ph === 1) put(FP, FA, _v, 0, CELLW * 0.42, 70); }
    if (nt) { let q = 0; for (const k in nt.lava) { if (q++ % 4 || q > 240) continue; const c = +k; _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]).multiplyScalar(R + (H[c] + 0.4) * LAYER); put(SP, SA, _v, 1, CELLW * 0.3, 3); put(FP, FA, _v, 0, CELLW * 0.22, 3); } } }
  if (cam.z > 0.5) {     // Gischt, wo das Meer auf Land trifft
    const cl = Math.cos(Math.min(0.5, 0.05 + cam.s / R * 0.9)); let n = 0;
    for (let c = 0; c < NC && n < 6000; c++) {
      if (SH[c] !== 1 || slotOf[c] < 0 || cdir[c * 3] * cam.u.x + cdir[c * 3 + 1] * cam.u.y + cdir[c * 3 + 2] * cam.u.z < cl) continue;
      const rs = R + (H[c] + W[c]) * LAYER, m = ncnt[c];
      for (let k = 0; k < m; k++) {
        const nb = cellNb[c * 6 + k]; if (isSea(nb) || W[nb] > 0.3) continue;
        cornerDir(cellCorner[c * 6 + k]); const x = tmp[0], y = tmp[1], z = tmp[2]; cornerDir(cellCorner[c * 6 + (k + 1) % m]);
        for (let q = 0; q < 2; q++) { const f = 0.25 + 0.5 * Math.random(); _v.set(x + (tmp[0] - x) * f, y + (tmp[1] - y) * f, z + (tmp[2] - z) * f).normalize().multiplyScalar(rs); put(SP, SA, _v, 2, CELLW * 0.16, 1); n++; }
      }
    }
  }
  const mk = (pts, P, A) => { pts.geometry.dispose(); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.length ? P : [0, 0, 0]), 3)); g.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(A.length ? A : [0, 0, 0]), 3)); pts.geometry = g; pts.visible = P.length > 0; };
  mk(fxFire, FP, FA); mk(fxSoft, SP, SA);
}

/* ---------------- Der Wanderer: versteckt jede Spielstunde eine Kiste ---------------- */
// Ein Viertel der Haendlereinnahmen fliesst in einen Topf. Ist die alte Kiste gefunden und war genug los,
// vergraebt der Wanderer eine neue. Die Stelle erkennt man an frisch aufgeworfener Erde.
const POTSHARE = 0.25, BOXMINPOT = 5, BOXMINACT = 8;
const wand = { on: false, path: null, seg: 0, t: 0, wait: 0, boxIdx: 0, marked: false, obj: null };
function pathOnFoot(a, b) { const f = fig.fly, bt = state.boat; fig.fly = false; state.boat = false; const p = findPath(a, b); fig.fly = f; state.boat = bt; return p; }
function markBox() {
  if (!state.box) return; const c = state.box.cell;
  if (MAT[c] === FOREST) treesDirty = true;
  MAT[c] = DIRT; PAINT[c] = -1; touch(c);
}
function anyGnomeCell() {
  const pool = (state.bots || []).map(b => b.cell); if (state.avatar) pool.push(fig.cell, fig.cell, fig.cell);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : fig.cell;
}
function spawnWanderer(center) {
  if (center === undefined) center = anyGnomeCell();
  stampId++; let qh = 0, qt = 0; bq[qt++] = center; stamp[center] = stampId; prev[center] = 0;
  const cands = [];
  while (qh < qt) {
    const v = bq[qh++], d = prev[v];
    if (d >= 15 && MAT[v] === GRASS && W[v] < 0.05 && npcAt[v] < 0 && BN[v] === 0 && fieldOwner[fieldOf[v]] === -1) cands.push(v);
    if (d >= 45) continue;
    for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (stamp[o] !== stampId && H[o] >= 0 && W[o] < 0.35) { stamp[o] = stampId; prev[o] = d + 1; bq[qt++] = o; } }
  }
  if (cands.length < 3) return false;
  const pick = () => cands[Math.floor(Math.random() * cands.length)];
  const box = pick(), a = pick(), b = pick();
  const p1 = pathOnFoot(a, box), p2 = pathOnFoot(box, b);
  wand.path = p1 && p2 ? p1.concat(p2.slice(1)) : [box]; wand.boxIdx = p1 && p2 ? p1.length - 1 : 0;
  wand.seg = 0; wand.t = 0; wand.wait = wand.boxIdx === 0 ? 3.5 : 0; wand.marked = false; wand.on = true;
  const tokens = Math.min(200, Math.floor(state.pot * 0.6));
  state.pot -= tokens;
  state.econ.boxSeq = (state.econ.boxSeq || 0) + 1;
  state.box = { cell: box, hour: state.clock, tokens, holz: 2 + Math.floor(Math.random() * 5), stein: 2 + Math.floor(Math.random() * 5), seed: 5 };
  if (!wand.obj) {
    const g = new THREE.Group(), sc = GS;
    const gn = makeGnome({ body: 0, hat: 2, outfit: 2, hair: 1, cHat: 7, cOutfit: 7, cAccent: 0, cHair: 1, cSkin: 1 }); g.add(gn); wand.gn = gn;
    const b2 = geoBuilder();
    b2.mat(5).box(0, 0.5, -0.36, 0.42, 0.5, 0.24, [0.50, 0.36, 0.22]); b2.mat(5).lathe([[0.1, 0], [0.1, 0.46]], 8, [0.72, 0.30, 0.26], { z: 0 });
    b2.mat(15).box(0.42, 0, 0.12, 0.035, 1.5, 0.035, [0.40, 0.28, 0.17]); b2.mat(13).ball(0.42, 1.56, 0.12, 0.06, [1.0, 0.82, 0.4], 1, 6, 3);
    const bp = new THREE.Mesh(b2.build(), propMat); bp.frustumCulled = false; bp.scale.set(sc, sc, sc); g.add(bp);
    wand.obj = g; scene.add(g);
  }
  wand.obj.visible = true; saveDirty = true;
  toast('A wanderer is passing through. He buries a box where the earth is freshly turned. Dig it up.');
  return true;
}
function openBox() {
  const b = state.box; state.box = null;
  state.econ.boxYou++; state.tokens += b.tokens; state.inv.holz += b.holz; state.inv.stein += b.stein; state.uses.seed += b.seed; saveDirty = true;
  toast("You found the wanderer's box: " + b.tokens + ' tokens, ' + b.holz + ' wood, ' + b.stein + ' stone, ' + b.seed + ' seeds.');
}
const _wa = new THREE.Vector3(), _wb = new THREE.Vector3(), _wu = new THREE.Vector3(), _wf = new THREE.Vector3(1, 0, 0), _wr = new THREE.Vector3();
function updateWanderer(dt, time) {
  const hr = Math.floor(state.clock);
  if (hr > (state.lastHour || 0)) {       // einmal je Spielstunde
    state.lastHour = hr;
    econHour();
    if (state.box && !wand.on && state.clock - (state.box.hour || 0) > 3) {     // niemand hat gegraben: der Wanderer holt die Kiste und versteckt sie anderswo
      const old = state.box; state.box = null; state.pot += old.tokens;
      if (spawnWanderer()) { /* neue Stelle */ } else state.box = old;
    }
    if (state.avatar && !state.box && !wand.on && state.pot >= BOXMINPOT && (state.activity || 0) >= BOXMINACT) spawnWanderer();
    state.activity = 0;
  }
  if (!wand.on) return;
  const o = wand.obj, last = wand.path.length - 1;
  if (wand.wait > 0) { wand.wait -= dt * timeSpeed; if (wand.wait <= 0 && !wand.marked) { wand.marked = true; markBox(); if (last === 0) { wand.on = false; o.visible = false; return; } } }
  else {
    wand.t += dt * 0.5 * timeSpeed;
    while (wand.t >= 1 && wand.on) {
      wand.t -= 1; wand.seg++;
      if (wand.seg === wand.boxIdx && !wand.marked) { wand.wait = 3.5; wand.t = 0; break; }
      if (wand.seg >= last) { wand.on = false; o.visible = false; if (!wand.marked) { wand.marked = true; markBox(); } return; }
    }
  }
  const c0 = wand.path[Math.min(wand.seg, last)], c1 = wand.path[Math.min(wand.seg + 1, last)];
  cellPos(c0, 0, _wa); cellPos(c1, 0, _wb);
  if (c0 !== c1) _wf.copy(_wb).sub(_wa);
  const la = _wa.length(), lb = _wb.length(), tt = wand.wait > 0 ? 0 : wand.t;
  o.position.copy(_wa).lerp(_wb, tt).normalize().multiplyScalar(la + (lb - la) * tt + (wand.wait > 0 ? 0 : Math.abs(Math.sin(time * 9)) * 0.02 * KS));
  _wu.copy(o.position).normalize(); _wf.addScaledVector(_wu, -_wf.dot(_wu));
  if (_wf.lengthSq() < 1e-8) _wf.crossVectors(_wu, YAX); _wf.normalize();
  _wr.crossVectors(_wu, _wf).normalize(); _m.makeBasis(_wr, _wu, _wf); o.quaternion.setFromRotationMatrix(_m);
  if (wand.gn) animateGnome(wand.gn, wand.wait > 0 ? 'work' : 'walk', dt, Math.min(timeSpeed, 3) * 0.8);
}

/* ---------------- Haendler: Stand, Wicht, Laden ---------------- */
const npcObjs = [];
const NPCAV = [
  { body: 0, hat: 3, outfit: 2, hair: 0, cHat: 3, cOutfit: 7, cAccent: 0, cHair: 0, cSkin: 1 },
  { body: 1, hat: 0, outfit: 3, hair: 0, cHat: 4, cOutfit: 1, cAccent: 1, cHair: 3, cSkin: 0 },
  { body: 0, hat: 2, outfit: 1, hair: 1, cHat: 7, cOutfit: 0, cAccent: 5, cHair: 4, cSkin: 2 },
  { body: 1, hat: 3, outfit: 0, hair: 1, cHat: 6, cOutfit: 5, cAccent: 2, cHair: 5, cSkin: 3 }
];
const npcMarkMat = new THREE.ShaderMaterial({
  vertexColors: true, side: THREE.DoubleSide,
  vertexShader: 'varying vec3 vC; void main(){ vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor=vec4(vC,1.0);}'
});
function buildNpcObjs() {
  for (const o of npcObjs) { scene.remove(o); if (o.userData.trader) { scene.remove(o.userData.trader); disposeGnome(o.userData.trader); } o.traverse(m => { if (m.geometry) m.geometry.dispose(); }); }
  npcObjs.length = 0; traderRt.length = 0;
  npcs.forEach((n, i) => {
    const g = new THREE.Group(), sc = GS;
    const tg = makeGnome(NPCAV[i % NPCAV.length]);
    const b = geoBuilder(), wood = [0.55, 0.38, 0.22], stripeA = [0.90, 0.30, 0.26], stripeB = [0.96, 0.93, 0.84];
    b.mat(1).box(0, 0, 0.62, 1.7, 0.5, 0.5, wood); b.box(0, 0.5, 0.62, 1.85, 0.07, 0.62, [0.42, 0.28, 0.16]);
    b.mat(15);
    for (const sx of [-1, 1]) b.box(sx * 0.85, 0, 0.62, 0.08, 2.05, 0.08, wood);
    b.mat(5); for (let q = 0; q < 6; q++) { b.box(-0.8 + q * 0.32, 2.0, 0.62, 0.32, 0.07, 0.95, q % 2 ? stripeA : stripeB); b.box(-0.8 + q * 0.32, 1.86, 1.08, 0.32, 0.16, 0.03, q % 2 ? stripeA : stripeB); }
    b.mat(13).ball(0.85, 1.78, 1.0, 0.07, [1.0, 0.80, 0.36], 1, 6, 3); b.mat(3);
    b.box(-0.45, 0.57, 0.62, 0.3, 0.2, 0.3, [0.60, 0.60, 0.62]); b.box(0.05, 0.57, 0.68, 0.22, 0.14, 0.22, [0.56, 0.38, 0.22]); b.ball(0.5, 0.7, 0.62, 0.13, [0.95, 0.78, 0.26], 1, 6, 4);
    const st = new THREE.Mesh(b.build(), propMat); st.frustumCulled = false; st.scale.set(sc * 1.5, sc * 1.5, sc * 1.5); g.add(st);
    const mk = geoBuilder(); mk.cone(0, 0, 0, 0.5, -0.9, 4, [0.30, 0.82, 0.78]); mk.cone(0, 0, 0, 0.5, 0.45, 4, [0.62, 0.95, 0.90]);
    const mm = new THREE.Mesh(mk.build(), npcMarkMat); mm.frustumCulled = false; tg.add(mm); g.userData.marker = mm; g.userData.i = i; g.userData.trader = tg;
    const c = n.cell; _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]);
    g.quaternion.setFromUnitVectors(YAX, _v); g.position.copy(_v).multiplyScalar(R + H[c] * LAYER);
    scene.add(g); scene.add(tg); npcObjs.push(g);
    let spot = n.cell; for (let k = 0; k < ncnt[n.cell]; k++) { const o = cellNb[n.cell * 6 + k]; if (W[o] < 0.05 && H[o] >= 0 && BN[o] === 0 && npcAt[o] < 0) { spot = o; break; } }
    traderRt.push({ at: spot, homeSpot: spot, path: null, seg: 0, t: 0, wait: 5 + Math.random() * 10, obj: tg, fwd: new THREE.Vector3(1, 0, 0) });
  });
}
let shopNpc = -1;
const BCOSTS = [null, { holz: 4 }, { stein: 5 }, { beton: 2 }];
const PLANS = BPLANS.map(p => ({ key: p.key, name: p.name, price: p.price, note: 'Needs a ' + TIERNAMES[p.tier].toLowerCase() + ' camp. Each floor: ' + needText(BCOSTS[p.mat]) })).concat([{ key: 'boat', name: 'Boat', price: BOATPRICE, need: BOATNEED }, { key: 'balloon', name: 'Hot-air balloon', price: BALLOONPRICE, need: BALLOONNEED }].concat([1, 2, 3, 4, 5, 6].map(i => ({ key: 't' + i, name: TIERNAMES[i], price: TIERCOST[i], need: TIERNEED[i] }))));
function renderShop() {
  const n = npcs[shopNpc]; if (!n) return;
  const row = (label, sub, price, attr, owned) => `<div class="shoprow"><div><strong>${label}</strong><span class="sdesc">${sub}</span></div>${owned ? '<span class="owned">Owned</span>' :
    `<button type="button" class="chip" ${attr} ${state.tokens < price ? 'disabled' : ''}>${price} T</button>`}</div>`;
  const bon = (1 + 0.1 * sk('trader')) * priceF(shopNpc), sv = (ECON.stone * bon).toFixed(2), wv = (ECON.wood * bon).toFixed(2);
  $('shop-body').innerHTML = `<h2>${n.name}, trader</h2><p class="note">You have ${fmtT(state.tokens)} tokens. ${n.name} has ${fmtT(state.traders[shopNpc])} tokens in the till and pays ${Math.round(priceF(shopNpc) * 100)}% of the usual price. A quarter of what you spend goes to the wanderer's pot, now ${fmtT(state.pot)}.</p>
    <h3>Tools</h3>${TOOLS.filter(t => t.pack).map(t => row(t.name, t.pack + ' uses', t.price, `data-tool="${t.id}"`, false)).join('')}
    <h3>Blueprints</h3>${PLANS.map(p => row(p.name, p.note || ('Building it needs ' + needText(p.need)), p.price, `data-plan="${p.key}"`, !!state.plans[p.key])).join('')}
    ${row('Burner gas', GAS.pack + ' balloon flights', GAS.price, 'data-gas="1"', false)}
    <h3>Sell</h3><div class="shoprow"><div><strong>Stone and wood</strong><span class="sdesc">${state.inv.stein} stone at ${sv} T, ${state.inv.holz} wood at ${wv} T each</span></div>
    <button type="button" class="chip" data-sell="1" ${state.inv.stein + state.inv.holz ? '' : 'disabled'}>Sell all</button></div>`;
}
function openShop(i) { shopNpc = i; renderShop(); $('shop').hidden = false; $('help').hidden = true; }
function closeShop() { shopNpc = -1; $('shop').hidden = true; }
$('shop-close').addEventListener('click', closeShop);
$('shop-body').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t || t.disabled) return;
  if (t.dataset.tool) { const tl = TOOLS.find(x => x.id === t.dataset.tool); if (state.tokens < tl.price) return; playerPay(shopNpc, tl.price); state.uses[tl.id] += tl.pack; toast('Bought ' + tl.name.toLowerCase() + ': ' + tl.pack + ' uses.'); }
  else if (t.dataset.plan) { const pl = PLANS.find(x => x.key === t.dataset.plan); if (state.tokens < pl.price) return; playerPay(shopNpc, pl.price); state.plans[pl.key] = true; toast('Bought the blueprint for the ' + pl.name.toLowerCase() + '.'); }
  else if (t.dataset.gas) { if (state.tokens < GAS.price) return; playerPay(shopNpc, GAS.price); state.uses.gas = (state.uses.gas || 0) + GAS.pack; toast('Bought burner gas for ' + GAS.pack + ' flights.'); }
  else if (t.dataset.sell) { sellAll(); return; }
  saveDirty = true; refreshHud(); renderShop();
});
function findTrader() {
  if (!npcs.length) { toast('No trader on this world.'); return; }
  let best = 0, bd = -9; _v.copy(figure.position).normalize();
  npcs.forEach((n, i) => { const d = cdir[n.cell * 3] * _v.x + cdir[n.cell * 3 + 1] * _v.y + cdir[n.cell * 3 + 2] * _v.z; if (d > bd) { bd = d; best = i; } });
  const c = npcs[best].cell; follow = false; interacted = true;
  cam.u.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); cam.f.addScaledVector(cam.u, -cam.f.dot(cam.u)).normalize(); cam.zT = 0.8;
  toast(npcs[best].name + ' trades here. Click the stall to walk over.');
}

/* ---------------- Wege fuer alle Wichte ---------------- */
const lbDist = new Int16Array(NC);
const footOk = o => W[o] <= 0.35 && npcAt[o] < 0 && BN[o] === 0 && MAT[o] !== LAVA;
function bfsLocal(start, maxD, ok, step = 2.2) {
  stampId++; let qh = 0, qt = 0; bq[qt++] = start; stamp[start] = stampId; prev[start] = -1; lbDist[start] = 0;
  while (qh < qt) {
    const v = bq[qh++], d = lbDist[v]; if (d >= maxD) continue; const hv = surfH(v);
    for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (stamp[o] === stampId || Math.abs(surfH(o) - hv) > step || !ok(o)) continue; stamp[o] = stampId; prev[o] = v; lbDist[o] = d + 1; bq[qt++] = o; }
  }
  return qt;
}
function pathTo(b) { const p = []; for (let v = b; v >= 0; v = prev[v]) p.push(v); return p.reverse(); }
// naechste begehbare Zelle, neben der etwas liegt, das cond erfuellt
function seekBeside(start, maxD, cond, step) {
  const n = bfsLocal(start, maxD, footOk, step);
  for (let q = 0; q < n; q++) { const c = bq[q]; for (let k = 0; k < ncnt[c]; k++) { const o = cellNb[c * 6 + k]; if (cond(o)) return { stand: c, target: o, path: pathTo(c) }; } }
  return null;
}
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pu = new THREE.Vector3(), _pr = new THREE.Vector3();
function poseOn(obj, path, seg, t, cell, fwd, faceC) {
  if (path && seg < path.length - 1) {
    cellPos(path[seg], 0, _pa); cellPos(path[seg + 1], 0, _pb); fwd.copy(_pb).sub(_pa);
    const la = _pa.length(), lb = _pb.length(); obj.position.copy(_pa).lerp(_pb, t).normalize().multiplyScalar(la + (lb - la) * t);
  } else { cellPos(cell, 0, obj.position); if (faceC >= 0 && faceC !== cell) { cellPos(faceC, 0, _pb); fwd.copy(_pb).sub(obj.position); } }
  _pu.copy(obj.position).normalize(); fwd.addScaledVector(_pu, -fwd.dot(_pu));
  if (fwd.lengthSq() < 1e-12) fwd.crossVectors(_pu, YAX); fwd.normalize();
  _pr.crossVectors(_pu, fwd).normalize(); _m.makeBasis(_pr, _pu, fwd); obj.quaternion.setFromRotationMatrix(_m);
}

/* ---------------- Haendler gehen umher ---------------- */
// Ein Haendler steht neben seinem Stand, schlendert ab und zu ein paar Zellen weit und kehrt zurueck.
// Kommt Wasser, sucht er sich die naechste trockene Zelle. Er oeffnet den Laden fuer jeden, der neben ihm oder dem Stand steht.
const traderRt = [];
const dryFree = o => W[o] < 0.05 && H[o] >= 0 && BN[o] === 0 && npcAt[o] < 0 && MAT[o] !== LAVA;
function traderIndexAt(c) { for (let i = 0; i < npcs.length; i++) if (npcs[i].cell === c || (traderRt[i] && traderRt[i].at === c)) return i; return -1; }
function traderNear(i, c) { return isNear(c, npcs[i].cell) || (traderRt[i] && isNear(c, traderRt[i].at)); }
function updateTraders(dt) {
  const ds = dt * timeSpeed;
  for (let i = 0; i < traderRt.length; i++) {
    const r = traderRt[i], n = npcs[i];
    if (r.path) {
      r.t += ds * 0.45;
      while (r.t >= 1 && r.path) { r.t -= 1; r.seg++; r.at = r.path[r.seg]; if (r.seg >= r.path.length - 1) { r.path = null; r.t = 0; } }
    } else {
      const wet = W[r.at] > 0.3 || BN[r.at] > 0;
      r.wait -= ds;
      if (wet || r.wait <= 0) {
        r.wait = 8 + Math.random() * 16;
        if (!dryFree(r.homeSpot)) { r.homeSpot = -1; for (let k = 0; k < ncnt[n.cell]; k++) { const o = cellNb[n.cell * 6 + k]; if (dryFree(o)) { r.homeSpot = o; break; } } }
        let target = -1;
        if (wet || r.homeSpot < 0) {           // naechste trockene Zelle
          const m = bfsLocal(r.at, 14, o => W[o] <= 0.35 || true);
          for (let q = 1; q < m; q++) if (dryFree(bq[q])) { target = bq[q]; break; }
          if (target >= 0 && r.homeSpot < 0) r.homeSpot = target;
        } else if (r.at !== r.homeSpot) {
          const m = bfsLocal(r.at, 10, dryFree); for (let q = 0; q < m; q++) if (bq[q] === r.homeSpot) { target = r.homeSpot; break; }
        } else {
          const m = bfsLocal(r.at, 3, dryFree); if (m > 1) target = bq[1 + Math.floor(Math.random() * (m - 1))];
          r.wait = 4 + Math.random() * 6;
        }
        if (target >= 0 && target !== r.at) { r.path = pathTo(target); r.seg = 0; r.t = 0; }
      }
    }
    poseOn(r.obj, r.path, r.seg, r.t, r.at, r.fwd, r.path ? -1 : (r.at === r.homeSpot ? n.cell : -1));
    animateGnome(r.obj, r.path ? 'walk' : 'idle', dt, Math.min(timeSpeed, 3) * 0.8);
  }
}

/* ---------------- Wirtschaft: Haendlerkasse, Topf, Schatzamt, Unterhalt ---------------- */
// Geld kreist: Wer kauft, zahlt 75 % in die Kasse des Haendlers und 25 % in den Topf des Wanderers.
// Haendler kaufen Holz und Stein nur aus ihrer Kasse; je leerer die Kasse, desto weniger zahlen sie.
// Das Schatzamt fuellt leere Kassen stuendlich auf, aus einem Budget, das mit den Feldbesitzern waechst.
// Was ueber die Kasse hinausgeht, faellt in den Topf. Haeuser kosten Unterhalt je Spieltag.
const ECON = { wood: 0.25, stone: 0.6, perPlayer: 60, topUp: 0.8, overflow: 1.5, upkeep: 1 };
// Euro-Seite, nur simuliert: Mint, Feldschutz und Ausbaugebuehren. Jeder Euro gibt dem Schatzamt 5 Token Budget.
const EURO = { mint: 15, protect: 8, tierFee: [0, 2, 4, 6, 12, 25, 50], tokensPerEur: 5 };
const PROTECT_H = 30 * 24, RECLAIM_H = 365 * 24, BOXCOOL = 3, BOAT_WEAR = 400, BOAT_REPAIR = { holz: 3 }, GAS = { pack: 5, price: 15 };
function addEur(k, v) { const e = state.econ; e.eur[k] = (e.eur[k] || 0) + v; e.budget += v * EURO.tokensPerEur; }
// Schutz haelt 30 Spieltage nach der letzten zaehlenden Transaktion (Kauf beim Haendler, Unterhalt, Feldschutz)
function isProtected(o) {
  if (o < 0) return false;
  const last = o === 0 ? state.lastTx : (state.bots[o - 1] || {}).lastTx;
  return state.clock - (last || 0) < PROTECT_H;
}
function playerPay(i, amt) { state.credit = Math.max(0, (state.credit || 0) - amt); state.tokens -= amt; state.lastTx = state.clock; payTrader(i, amt); }
// Felder kosten mehr, je naeher am Haendler und je voller die Gegend
function fieldPrice(f) {
  const c = fieldCenter[f], x = cdir[c * 3], y = cdir[c * 3 + 1], z = cdir[c * 3 + 2];
  let bd = -2; for (const n of npcs) bd = Math.max(bd, x * cdir[n.cell * 3] + y * cdir[n.cell * 3 + 1] + z * cdir[n.cell * 3 + 2]);
  const cells = Math.acos(clamp(bd, -1, 1)) * R / CELLW, near = Math.max(0, 1 - cells / 40);
  const lim = Math.cos(12 * CELLW / R); let tot = 0, own = 0;
  for (let g = 0; g < NF; g++) { const o = fieldCenter[g]; if (x * cdir[o * 3] + y * cdir[o * 3 + 1] + z * cdir[o * 3 + 2] > lim) { tot++; if (fieldOwner[g] !== -1) own++; } }
  return Math.round(FIELDPRICE * (1 + 1.5 * near) * (1 + (tot ? own / tot : 0)));
}
const fmtT = v => (v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10).toLocaleString('en-US');
function initEconomy(fromSave) {
  if (!fromSave || !Array.isArray(state.traders) || state.traders.length !== npcs.length) state.traders = npcs.map(() => traderTarget());
  state.econ = Object.assign({ treasury: 0, budget: 0, upkeep: 0, boxYou: 0, boxBots: 0, sold: 0, spent: 0, boxSeq: 0, eur: { mint: 0, protect: 0, tiers: 0 } }, fromSave && state.econ ? state.econ : {});
  if (!state.econ.eur) state.econ.eur = { mint: 0, protect: 0, tiers: 0 };
  if (state.lastTx === undefined || state.lastTx === null) state.lastTx = state.clock;
}
function traderTarget() { return ECON.perPlayer * Math.max(4, (1 + (state.bots ? state.bots.length : BOTN)) / Math.max(1, npcs.length)); }
function priceF(i) { return i < 0 || !state.traders ? 1 : clamp(state.traders[i] / traderTarget(), 0.05, 1.25); }
function payTrader(i, amt) { state.econ.spent += amt; if (i < 0) { state.pot += amt; return; } state.traders[i] += amt * (1 - POTSHARE); state.pot += amt * POTSHARE; }
function sellGoods(i, wood, stone, bonus) {
  const f = priceF(i) * (bonus || 1), want = (wood * ECON.wood + stone * ECON.stone) * f, pay = Math.max(0, Math.min(want, state.traders[i]));
  state.traders[i] -= pay; state.econ.sold += pay; return { pay, frac: want > 0 ? pay / want : 1 };
}
function nearestTrader(c) { let best = -1, bd = -2; npcs.forEach((n, i) => { const d = cdir[c * 3] * cdir[n.cell * 3] + cdir[c * 3 + 1] * cdir[n.cell * 3 + 1] + cdir[c * 3 + 2] * cdir[n.cell * 3 + 2]; if (d > bd) { bd = d; best = i; } }); return best; }
/* ---------------- Wetter, Feuer und Schaden ---------------- */
// Gewitter ziehen auf: erst trockene Blitze, die Wald anzuenden, dann Regen, der Feuer loescht.
// Feuer, Lava, Blitz und Hochwasser beschaedigen Gebaeude. Ein Lager bleibt Eigentum, auch als Ruine, und wird Schritt fuer Schritt repariert.
const FIRERES = [0, 1, 0.25, 0, 1, 0, 1], LAVARES = [0, 1, 0.8, 0.4, 1, 0.5, 1], FLOODRES = [0, 1, 0.5, 0.2, 1, 0.2, 0.6];
let dmgToastAt = -9, stormSet = null, stormKey = '';
function cellDist(a, b) { const d = cdir[a * 3] * cdir[b * 3] + cdir[a * 3 + 1] * cdir[b * 3 + 1] + cdir[a * 3 + 2] * cdir[b * 3 + 2]; return Math.acos(Math.min(1, d)) * R / CELLW; }
function damage(c, amt, why) {
  if (BN[c] === 0 || amt <= 0) return;
  const home = homeOf.has(c);
  DMG[c] = Math.min(100, DMG[c] + amt);
  if (DMG[c] >= 100) {
    if (BN[c] > 1 || !home) { BN[c]--; if (!BN[c]) { builtCells.delete(c); DMG[c] = 0; } else DMG[c] = 45; }     // die oberste Etage stuerzt ein
    else DMG[c] = 100;                                                                                          // vom Lager bleibt eine Ruine stehen
  }
  bldDirty = true; saveDirty = true;
  if (home && homeOf.get(c) === state.camp && fieldOwner[fieldOf[c]] === 0) { refreshHud(); if (state.clock - dmgToastAt > 0.25) { dmgToastAt = state.clock; toast('Your house is being damaged by ' + why + '. It stays yours: click it with Camp to repair it step by step.'); } }
}
// naechster Reparaturschritt eines Lagers: erst Schaeden beheben, dann fehlende Etagen wieder aufsetzen
function homeNeed(camp, tier) {
  if (camp < 0 || tier < 1) return null;
  const cells = homeCellsOf(camp, tier); let left = 0, first = null;
  cells.forEach((c, i) => {
    const st = homeSpec(camp, tier, i);
    if (BN[c] > 0 && DMG[c] > 0) { left++; if (!first || first.floor) { const m = BLD[c * MAXF + BN[c] - 1], full = BCOST[m], cost = {}; for (const k of Object.keys(full)) cost[k] = Math.ceil(full[k] / 2); first = { c, floor: false, m, cost }; } }
    const miss = st.length - BN[c]; if (miss > 0) { left += miss; if (!first) first = { c, floor: true, m: st[BN[c]], cost: BCOST[st[BN[c]]] }; }
  });
  if (first) first.left = left;
  return first;
}
function applyRepair(nd) {
  if (nd.floor) { BLD[nd.c * MAXF + BN[nd.c]] = nd.m; BN[nd.c]++; builtCells.add(nd.c); } else DMG[nd.c] = 0;
  bldDirty = true; lastBld = 0; saveDirty = true;
}
function repairHome() {
  const nd = homeNeed(state.camp, state.tier); if (!nd) return false;
  if (!payNeed(nd.cost, 'The repair')) return true;
  applyRepair(nd); state.lastTx = state.clock;
  toast(nd.left > 1 ? 'Repaired. ' + (nd.left - 1) + ' more step' + (nd.left > 2 ? 's' : '') + ' until your house is whole again.' : 'Your house is whole again.');
  refreshHud(); return true;
}
function botRepair(b) {
  const nd = homeNeed(b.camp, b.tier); if (!nd) return;
  for (const k of Object.keys(nd.cost)) if ((k === 'beton' ? b.uses.beton : b.inv[k]) < nd.cost[k]) return;
  for (const k of Object.keys(nd.cost)) { if (k === 'beton') b.uses.beton -= nd.cost[k]; else b.inv[k] -= nd.cost[k]; }
  applyRepair(nd);
}
function stormCells(st) {
  const key = st.c + ':' + st.r; if (stormKey === key && stormSet) return stormSet;
  const seen = new Set([st.c]); let fr = [st.c];
  for (let d = 0; d < st.r; d++) { const nx = []; for (const v of fr) for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (!seen.has(o)) { seen.add(o); nx.push(o); } } fr = nx; }
  stormSet = seen; stormKey = key; return seen;
}
const raining = st => st && state.clock > st.t0 + st.dur * 0.35;
function rainAt(c) { const st = state.nature && state.nature.storm; return !!(st && c >= 0 && raining(st) && stormCells(st).has(c)); }
function ignite(c, gen) {
  const nt = state.nature; if (MAT[c] !== FOREST || nt.fire[c] || market[c] || W[c] > 0.1) return;
  let n = 0; for (const k in nt.fire) if (++n > 500) return;
  nt.fire[c] = [state.clock, gen]; fxDirty = true;
}
function weatherTick() {
  const nt = state.nature; if (!nt) return;
  nt.fire = nt.fire || {}; if (nt.stormNext === undefined) nt.stormNext = state.clock + 1.6;
  // Gewitter beginnt ueber Wald; das erste einer Welt in Sichtweite des Spielers
  if (!nt.storm && state.clock >= nt.stormNext) {
    let pick = -1, bd = -1e9;
    for (let n = 0; n < 600; n++) { const c = Math.floor(Math.random() * NC); if (MAT[c] !== FOREST) continue; if (nt.sn) { pick = c; break; } const d = cellDist(c, fig.cell); if (d > 18 && -d > bd) { bd = -d; pick = c; } }
    if (pick >= 0) { nt.storm = { c: pick, r: 13 + Math.floor(Math.random() * 7), t0: state.clock, dur: 0.55 + Math.random() * 0.5 }; nt.sn = (nt.sn || 0) + 1; stormSet = null;
      if (cellDist(pick, fig.cell) < 90) toast('Thunder. A storm is gathering: lightning can set the forest on fire, the rain that follows puts fires out.'); }
    else nt.stormNext = state.clock + 2;
  }
  const st = nt.storm;
  if (st) {
    const cells = stormCells(st);
    if (Math.random() < (raining(st) ? 0.2 : 0.3)) {
      let i = Math.floor(Math.random() * cells.size), c = st.c; for (const v of cells) { if (i-- <= 0) { c = v; break; } }
      strikeFx(c);
      if (BN[c] > 0) damage(c, 35, 'lightning'); else if (Math.random() < (raining(st) ? 0.2 : 0.85)) ignite(c, 0);
    }
    if (state.clock > st.t0 + st.dur) { nt.storm = null; stormSet = null; nt.stormNext = state.clock + 18 + Math.random() * 26; fxDirty = true; }
  }
  // Waldbrand: springt auf Nachbarwald ueber, wird mit jeder Generation schwaecher, Regen loescht
  const rainSet = st && raining(st) ? stormCells(st) : null;
  for (const key in nt.fire) {
    const c = +key, f = nt.fire[key];
    if (MAT[c] !== FOREST) { delete nt.fire[key]; fxDirty = true; continue; }
    if (rainSet && rainSet.has(c) && Math.random() < 0.3) { delete nt.fire[key]; fxDirty = true; continue; }
    const p = 0.046 * Math.pow(0.92, f[1]);
    for (let k = 0; k < ncnt[c]; k++) { const o = cellNb[c * 6 + k];
      if (BN[o] > 0) damage(o, 4 * FIRERES[BLD[o * MAXF + BN[o] - 1]], 'fire');
      else if (MAT[o] === FOREST && !nt.fire[o] && Math.random() < p * (denseAt(o) ? 1.35 : 1)) ignite(o, f[1] + 1); }
    if (state.clock - f[0] > 0.12 + 0.2 * hashI(c, 811)) {       // abgebrannt: Asche, spaeter wieder Wiese
      MAT[c] = DIRT; delete nt.sap[c]; treesDirty = true; touch(c); delete nt.fire[key]; fxDirty = true;
      nt.cool.push(c, state.clock + 8 + Math.random() * 20, 1);
    }
  }
}
// Regen, Dunkelheit und Blitz
const rainObj = (() => {
  const n = 1100, pos = new Float32Array(n * 6), ar = new Float32Array(n * 6), ae = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, r = Math.sqrt(Math.random()), x = Math.cos(a) * r, y = Math.sin(a) * r, ph = Math.random(); for (let q = 0; q < 2; q++) { ar[i * 6 + q * 3] = x; ar[i * 6 + q * 3 + 1] = y; ar[i * 6 + q * 3 + 2] = ph; ae[i * 2 + q] = q; } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(ar, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(ae, 1));
  U.uRc = { value: new THREE.Vector3() }; U.uRa = { value: new THREE.Vector3() }; U.uRb = { value: new THREE.Vector3() }; U.uRu = { value: new THREE.Vector3() }; U.uRain = { value: 0 };
  const m = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 aR; attribute float aEnd; uniform vec3 uRc, uRa, uRb, uRu, uWind; uniform float uTime;
void main(){ float ph = fract(aR.z + uTime*(1.5 + fract(aR.z*7.0)*0.6)); float hgt = (1.0 - ph)*${(CELLW * 9).toFixed(3)} - aEnd*${(CELLW * 0.55).toFixed(3)};
  vec3 p = uRc + (uRa*aR.x + uRb*aR.y)*${(CELLW * 11).toFixed(3)} + uRu*hgt + uRa*hgt*0.12; gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.0); }`,
    fragmentShader: 'uniform float uRain; void main(){ gl_FragColor = vec4(0.78, 0.84, 0.96, 0.42*uRain); }' }));
  m.frustumCulled = false; m.renderOrder = 8; m.visible = false; scene.add(m); return m;
})();
const bolt = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(36), 3)), new THREE.LineBasicMaterial({ color: 0xffffff }));
bolt.frustumCulled = false; bolt.visible = false; bolt.renderOrder = 9; scene.add(bolt);
let boltT = 0, stormS = 0, rainS = 0;
function strikeFx(c) {
  if (cellDist(c, focusCell) > 70) return;
  const a = bolt.geometry.attributes.position.array, ux = cdir[c * 3], uy = cdir[c * 3 + 1], uz = cdir[c * 3 + 2];
  _v.set(ux, uy, uz); _v2.set(0.3, 1, 0.5).cross(_v).normalize(); let ox = 0;
  for (let i = 0; i < 12; i++) { const rr = R + surfH(c) * LAYER + i / 11 * CELLW * 16; if (i > 0) ox += (Math.random() - 0.5) * CELLW * 1.3; a[i * 3] = ux * rr + _v2.x * ox; a[i * 3 + 1] = uy * rr + _v2.y * ox; a[i * 3 + 2] = uz * rr + _v2.z * ox; }
  bolt.geometry.attributes.position.needsUpdate = true; bolt.visible = true; boltT = 0.2; U.uFlash.value = 1;
}
function weatherFrame(dt) {
  const st = state.nature && state.nature.storm; let s = 0, rn = 0;
  if (st) { const d = cellDist(st.c, focusCell); s = 1 - smooth(st.r * 0.75, st.r * 1.25, d); rn = raining(st) ? s : 0; }
  const k = Math.min(1, dt * 1.2); stormS += (s - stormS) * k; rainS += (rn - rainS) * k;
  U.uStorm.value = stormS; U.uRain.value = rainS; U.uFlash.value *= Math.exp(-dt * 9);
  if (boltT > 0) { boltT -= dt; if (boltT <= 0) bolt.visible = false; }
  rainObj.visible = rainS > 0.02 && cam.z > 0.45;
  if (rainObj.visible) { const u = cam.u; U.uRu.value.copy(u); U.uRa.value.set(0.3, 1, 0.5).cross(u).normalize(); U.uRb.value.crossVectors(u, U.uRa.value); U.uRc.value.copy(u).multiplyScalar(R + surfH(focusCell) * LAYER); }
}

/* ---------------- Natur: Vulkane, Lava, Verwitterung, Wald saet sich selbst ---------------- */
// Kreislauf: der Boden hebt sich zu einem Kegel, Lava laeuft aus und fliesst bergab, erkaltet zu Fels, verwittert zu Erde und wird wieder Wiese.
// Danach wandert der Wald von selbst ein. Geschuetzte Felder, Marktplaetze und Gebaeude bleiben verschont.
const NAT = { tick: 6, riseH: 0.5, eruptH: 0.8, lavaMax: 150, growH: 36, gapH: [48, 96] };
let natAcc = 0, natTicks = 0;
function initNature() {
  state.nature = Object.assign({ next: state.clock + 0.35, v: null, lava: {}, cool: [], sap: {}, fire: {}, storm: null, n: 0 }, state.nature || {});
  stormSet = null;
  $('btn-volc').hidden = !state.nature.v;
}
const natFree = o => fieldOwner[fieldOf[o]] === -1 && !market[o] && BN[o] === 0 && MAT[o] !== PLAZA && MAT[o] !== CONCRETE && npcAt[o] < 0 && PAINT[o] < 0;
// Lava macht vor Eigentum nicht halt. Sie fliesst nur bergab: ein Graben faengt sie, Beton haelt sie auf, ein hoeher gebautes Lager bleibt trocken.
const lavaOk = o => !market[o] && BN[o] === 0 && MAT[o] !== PLAZA && MAT[o] !== CONCRETE && npcAt[o] < 0;
function pickVolcano() {
  const cand = [], VR = 7;
  for (let n = 0; n < 3000 && cand.length < 24; n++) {
    const c = Math.floor(Math.random() * NC);
    if (H[c] < 3 || H[c] > 6 * HS || W[c] > 0.05 || ncnt[c] !== 6 || !natFree(c)) continue;
    const cells = [c], dist = [0], seen = new Set([c]); let ok = true;
    for (let i = 0; i < cells.length && ok; i++) {
      if (dist[i] >= VR + 3) continue;
      const v = cells[i];
      for (let k = 0; k < ncnt[v]; k++) { const o = cellNb[v * 6 + k]; if (seen.has(o)) continue; seen.add(o);
        if (!natFree(o) || (dist[i] < VR && H[o] < 0)) { ok = false; break; } cells.push(o); dist.push(dist[i] + 1); }
    }
    if (ok) cand.push({ c, cells, dist });
  }
  if (!cand.length) return null;
  let pick = cand[Math.floor(Math.random() * cand.length)];
  if (!state.nature.n) {        // der erste Vulkan einer Welt entsteht in Sichtweite des Spielers, aber nicht unter seinen Fuessen
    const f = fig.cell, far = CELLW / R * 26; let bd = -9;
    for (const q of cand) { const d = cdir[q.c * 3] * cdir[f * 3] + cdir[q.c * 3 + 1] * cdir[f * 3 + 1] + cdir[q.c * 3 + 2] * cdir[f * 3 + 2]; if (d < Math.cos(far) && d > bd) { bd = d; pick = q; } }
  }
  const peak = Math.round(HS * (3.0 + 1.3 * Math.random())), cells = [], add = [], h0 = [];
  for (let i = 0; i < pick.cells.length; i++) {
    const d = pick.dist[i]; if (d > VR) continue;
    let a = Math.round(peak * Math.pow(1 - d / (VR + 1), 1.35) + (hashI(pick.cells[i], 801) - 0.5) * 1.6);
    if (d === 0) a = Math.round(peak * Math.pow(1 - 1 / (VR + 1), 1.35)) - 3;       // Krater
    if (a > 0) { cells.push(pick.cells[i]); add.push(a); h0.push(H[pick.cells[i]]); }
  }
  return { c: pick.c, ph: 0, t0: state.clock, cells, add, h0 };
}
function lookAtCell(c, z) { follow = false; interacted = true; cam.u.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); cam.f.addScaledVector(cam.u, -cam.f.dot(cam.u)).normalize(); cam.zT = z; }
function natureStep(simSec) {
  natAcc += simSec; let guard = 0;
  while (natAcc >= NAT.tick && guard++ < 40) { natAcc -= NAT.tick; natureTick(); }
  if (natAcc > NAT.tick * 40) natAcc = 0;
}
function natureTick() {
  const nt = state.nature; if (!nt) return;
  natTicks++; weatherTick();
  if (!nt.v && state.clock >= nt.next) {
    nt.v = pickVolcano();
    if (nt.v) { nt.n++; $('btn-volc').hidden = false; fxDirty = true; saveDirty = true; toast('The ground trembles. Somewhere a volcano is rising. The Volcano button shows you where.'); }
    else nt.next = state.clock + 2;
  }
  const v = nt.v;
  if (v && v.ph === 0) {           // der Kegel waechst
    const p = Math.min(1, (state.clock - v.t0) / NAT.riseH);
    for (let i = 0; i < v.cells.length; i++) {
      const c = v.cells[i], want = v.h0[i] + Math.round(v.add[i] * p);
      if (H[c] >= want || !natFree(c)) continue;
      H[c]++;
      if (H[c] - v.h0[i] >= 3 && MAT[c] !== ROCK) { if (MAT[c] === FOREST) treesDirty = true; MAT[c] = ROCK; delete nt.sap[c]; }
      touch(c);
    }
    if (p >= 1) {
      v.ph = 1; v.t0 = state.clock; fxDirty = true;
      for (let i = 0; i < v.cells.length; i++) if (MAT[v.cells[i]] === ROCK) nt.cool.push(v.cells[i], state.clock + 30 + v.add[i] * 3 + Math.random() * 20, 0);
      toast('The volcano erupts. Lava runs downhill, cools to rock and, days later, turns back into meadow.');
    }
  } else if (v && v.ph === 1) {    // Ausbruch: Lava quillt aus dem Krater und sucht den Weg nach unten
    const occ = new Set((state.bots || []).map(b => b.cell)); occ.add(fig.cell); for (const b of state.bots || []) if (b.tier === 0 && b.camp >= 0) occ.add(b.camp); if (state.tier === 0 && state.camp >= 0) occ.add(state.camp);
    const flow = o => {
      if (W[o] > 0.1) { H[o]++; if (MAT[o] !== ROCK) MAT[o] = ROCK; touch(o); nt.cool.push(o, state.clock + 40 + Math.random() * 30, 0); return; }     // im Wasser erstarrt sie sofort und baut Land
      if (MAT[o] === FOREST) treesDirty = true;
      MAT[o] = LAVA; PAINT[o] = -1; delete nt.sap[o]; if (Math.random() < 0.35) H[o]++; nt.lava[o] = state.clock; touch(o);
    };
    const c0 = v.c;
    if (MAT[c0] !== LAVA) { MAT[c0] = LAVA; touch(c0); }
    nt.lava[c0] = state.clock;
    { let low = 1e9; for (let k = 0; k < 6; k++) low = Math.min(low, H[cellNb[c0 * 6 + k]]); if (H[c0] < low) { H[c0]++; touch(c0); } }     // der Krater laeuft voll
    // Stroeme statt Decke: jede Lavazelle schickt nur einen Arm weiter, selten zwei, der Krater bis zu fuenf
    const keys = Object.keys(nt.lava); let cnt = keys.length; nt.arm = nt.arm || {};
    for (const key of keys) {
      if (cnt >= NAT.lavaMax) break;
      if (Math.random() > 0.3) continue;
      const c = +key, cap = c === c0 ? 5 : hashI(c, 805) < 0.14 ? 2 : 1; if ((nt.arm[key] || 0) >= cap) continue;
      let best = -1, bh = 1e9;
      for (let k = 0; k < ncnt[c]; k++) { const o = cellNb[c * 6 + k]; if (BN[o] > 0) { damage(o, 7 * LAVARES[BLD[o * MAXF + BN[o] - 1]], 'lava'); continue; } if (MAT[o] === FOREST && Math.random() < 0.08) ignite(o, 0); if (MAT[o] === LAVA || !lavaOk(o) || occ.has(o)) continue; const hh = H[o] + (W[o] > 0.1 ? W[o] : 0) + Math.random() * 0.9; if (H[o] <= H[c] && hh < bh) { bh = hh; best = o; } }
      if (best >= 0) { flow(best); cnt++; nt.arm[key] = (nt.arm[key] || 0) + 1; }
    }
    if (natTicks % 8 === 0) fxDirty = true;
    if (state.clock - v.t0 > NAT.eruptH) { v.ph = 2; fxDirty = true; }
  }
  // Lava erkaltet zu Fels
  for (const key in nt.lava) {
    const c = +key;
    if (MAT[c] !== LAVA) { delete nt.lava[key]; continue; }
    if (state.clock - nt.lava[key] > 0.45 + 0.9 * hashI(c, 800)) { MAT[c] = ROCK; touch(c); delete nt.lava[key]; nt.cool.push(c, state.clock + 24 + Math.random() * 30, 0); fxDirty = true; }
  }
  if (v && v.ph === 2) { let any = false; for (const k in nt.lava) { any = true; break; } if (!any) { nt.v = null; nt.arm = {}; nt.next = state.clock + NAT.gapH[0] + Math.random() * (NAT.gapH[1] - NAT.gapH[0]); $('btn-volc').hidden = true; fxDirty = true; saveDirty = true; } }
}
const denseAt = c => vnoise(cdir[c * 3] * 4.5 + 31, cdir[c * 3 + 1] * 4.5, cdir[c * 3 + 2] * 4.5, 130) > 0.22;
function natureHour() {
  const nt = state.nature; if (!nt) return;
  // Verwitterung: Fels wird Erde, Erde wird Wiese
  const cl = nt.cool, keep = [];
  for (let i = 0; i < cl.length; i += 3) {
    const c = cl[i];
    if (state.clock < cl[i + 1]) { keep.push(c, cl[i + 1], cl[i + 2]); continue; }
    if (BN[c] > 0 || PAINT[c] >= 0 || W[c] > 0.1 || H[c] < 0) continue;
    if (cl[i + 2] === 0 && MAT[c] === ROCK) { MAT[c] = DIRT; touch(c); keep.push(c, state.clock + 18 + Math.random() * 30, 1); }
    else if (cl[i + 2] === 1 && MAT[c] === DIRT) { MAT[c] = GRASS; touch(c); }
  }
  nt.cool = keep;
  // Hochwasser: was im Wasser steht, leidet
  for (const c of Array.from(builtCells)) {
    let wet = W[c] > 0.25; for (let k = 0; k < ncnt[c] && !wet; k++) { const o = cellNb[c * 6 + k]; if (W[o] > 0.3 && H[o] + W[o] > H[c] + 0.4) wet = true; }
    if (wet) damage(c, 12 * FLOODRES[BLD[c * MAXF + BN[c] - 1]], 'flood water');
  }
  // Wald saet sich aus: dicht am Wald schnell, einzelne Samen traegt der Wind weit
  const sap = nt.sap, camps = new Set((state.bots || []).map(b => b.camp)); camps.add(state.camp);
  for (let n = 0, tries = Math.round(NC / 120); n < tries; n++) {
    const c = Math.floor(Math.random() * NC), m = MAT[c];
    if ((m !== GRASS && m !== DIRT) || W[c] > 0.05 || BN[c] > 0 || PAINT[c] >= 0 || H[c] < 1 || market[c] || npcAt[c] >= 0 || camps.has(c)) continue;
    const own = fieldOwner[fieldOf[c]]; if (own !== -1 && isProtected(own)) continue;
    let f = 0; for (let k = 0; k < ncnt[c]; k++) if (MAT[cellNb[c * 6 + k]] === FOREST) f++;
    const p = (f >= 2 ? 0.5 : f === 1 ? 0.14 : 0.004) * (m === DIRT ? 0.5 : 1) * (denseAt(c) ? 2 : 1);
    if (Math.random() < p) { MAT[c] = FOREST; sap[c] = Math.round(state.clock * 10) / 10; treesDirty = true; touch(c); }
  }
  let young = false;
  for (const k in sap) { if (state.clock - sap[k] > NAT.growH || MAT[+k] !== FOREST) delete sap[k]; else young = true; }
  if (young) treesDirty = true;        // junge Baeume wachsen
}
$('btn-volc').addEventListener('click', () => { const v = state.nature && state.nature.v; if (!v) return; lookAtCell(v.c, 0.74); toast(v.ph === 0 ? 'The ground is rising here.' : v.ph === 1 ? 'The volcano is erupting.' : 'The lava is cooling.'); });

function econHour() {
  natureHour();
  seaLevel -= seaLevel * 0.02;          // Verdunstung und Regen ziehen den Meeresspiegel langsam zum Ausgangswert zurueck
  const T = traderTarget();
  state.traders.forEach((v, i) => {
    if (v < ECON.topUp * T) { const d = Math.min(state.econ.budget, ECON.topUp * T - v); state.traders[i] += d; state.econ.budget -= d; state.econ.treasury += d; }
    else if (v > ECON.overflow * T) { state.pot += v - ECON.overflow * T; state.traders[i] = ECON.overflow * T; }
  });
}
function econDay() {
  const day = Math.floor((state.clock + 8.7) / 24);
  if (state.home >= 0) {
    if (state.tier > 0) {
      const u = Math.min(state.tokens, state.tier * ECON.upkeep);
      state.tokens -= u; state.credit = Math.max(0, (state.credit || 0) - u); state.traders[nearestTrader(state.camp)] += u; state.econ.upkeep += u;
      if (u) { state.lastTx = state.clock; toast('A new day. Upkeep for your ' + TIERNAMES[state.tier].toLowerCase() + ': ' + fmtT(u) + ' tokens.'); }
    }
    if (day - (state.protDay ?? -99) >= 30) { addEur('protect', EURO.protect); state.protDay = day; state.lastTx = state.clock; toast('Field protection renewed for 30 days: 8 \u20ac (simulated, no real payment).'); }
    if (state.clock - (state.lastTx || 0) > RECLAIM_H) { fieldOwner[state.home] = -1; state.home = -1; state.tier = 0; state.camp = -1; homeDirty = true; toast('A year without any trade: your field has gone back to the world.'); }
  }
  // Spielermarkt: Arbeiter verkaufen Token an Bauherren, die mit Euro zukaufen; das Studio nimmt 5 % Gebuehr
  { const bots = state.bots || [], sellers = bots.filter(b => !b.payer && b.tok > 150), buyers = bots.filter(b => b.payer && b.home >= 0 && b.tier < 6);
    if (sellers.length && buyers.length) {
      const offer = sellers.reduce((a, b) => a + (b.tok - 150) * 0.5, 0), demand = buyers.length * 0.25, price = clamp(demand / Math.max(1, offer), 0.002, 0.05), vol = Math.min(offer, demand / price);
      sellers.forEach(b => { b.tok -= (b.tok - 150) * 0.5 * vol / offer; });
      buyers.forEach(b => { b.tok += vol / buyers.length; b.lastTx = state.clock; });
      addEur('market', vol * price * 0.05); state.econ.mktVol = (state.econ.mktVol || 0) + vol; state.econ.mktPrice = price;
    } }
  (state.bots || []).forEach((b, i) => {
    if (b.home < 0) return;
    if (b.tier > 0) botRepair(b);
    if (b.tier > 0) { const u = Math.min(b.tok, b.tier * ECON.upkeep); b.tok -= u; state.traders[b.trader] += u; state.econ.upkeep += u; if (u) b.lastTx = state.clock; }
    if (b.payer && day - (b.protDay ?? -99) >= 30) { addEur('protect', EURO.protect); b.protDay = day; b.lastTx = state.clock; }
    if (state.clock - (b.lastTx || 0) > RECLAIM_H) { fieldOwner[b.home] = -1; b.home = -1; b.camp = -1; b.tier = 0; placeBotHouse(i); }
  });
  refreshHud();
}

/* ---------------- Mitspieler: 20 Wichte nach denselben Regeln ---------------- */
const BOTN = 20;
const BOTNAMES = ['Ansel', 'Birdie', 'Cobble', 'Dorrit', 'Elm', 'Fable', 'Gus', 'Hilde', 'Ivo', 'Jolly', 'Kip', 'Lotte', 'Mungo', 'Nell', 'Olaf', 'Posy', 'Quill', 'Rufus', 'Sorrel', 'Tibbs'];
const BOTFLOORS = [0, 3, 3, 4];
const fieldOwner = new Int16Array(NF).fill(-1);       // -1 frei, 0 du, i+1 Mitspieler i
const botRt = [];
const TOOLP = id => TOOLS.find(t => t.id === id);
const mayTouch = (i, c) => { const o = fieldOwner[fieldOf[c]]; return (o === -1 || o === i + 1 || !isProtected(o)) && npcAt[c] < 0 && MAT[c] !== PLAZA && MAT[c] !== LAVA; };
function botRing(b) { const out = [b.camp]; if (b.camp >= 0) for (let k = 0; k < ncnt[b.camp]; k++) out.push(cellNb[b.camp * 6 + k]); return out; }
function botRingOk(b) {
  const c = b.camp; if (ncnt[c] !== 6) return false;
  for (let k = 0; k < 6; k++) { const o = cellNb[c * 6 + k]; if (fieldOf[o] !== b.home || H[o] !== H[c] || W[o] > 0.1 || MAT[o] === FOREST || MAT[o] === PLAZA || BN[o] > 0) return false; }
  return true;
}
function spawnBots(fromSave) {
  for (const r of botRt) { scene.remove(r.obj); disposeGnome(r.obj); if (r.house) { scene.remove(r.house); r.house.geometry.dispose(); } }
  botRt.length = 0; fieldOwner.fill(-1);
  if (!fromSave || !Array.isArray(state.bots)) {
    state.bots = [];
    if (npcs.length) for (let i = 0; i < BOTN; i++) {
      const tr = i % npcs.length, m = bfsLocal(npcs[tr].cell, 9, dryFree), cells = Array.from(bq.subarray(1, Math.max(1, m)));
      const av = randomAvatar();
      state.bots.push({ name: BOTNAMES[i], av, cell: cells.length ? cells[Math.floor(Math.random() * cells.length)] : npcs[tr].cell, trader: tr, home: -1, camp: -1, tier: 0, plans: {}, tok: 100, payer: Math.random() < 0.65, lastTx: state.clock, protDay: null, coolUntil: 0,
        inv: { holz: 0, stein: 0, erde: 0 }, uses: { dig: 50, axe: 10, beton: 0 }, fl: {}, quarry: -1 });
    }
  }
  if (!fromSave || !state.econ.eur.mint) for (let i = 0; i < state.bots.length; i++) addEur('mint', EURO.mint);
  if (state.home >= 0) fieldOwner[state.home] = 0;
  state.bots.forEach((b, i) => {
    if (b.payer === undefined) b.payer = true; if (b.lastTx === undefined) b.lastTx = state.clock;
    if (b.home >= 0) fieldOwner[b.home] = i + 1;
    const obj = makeGnome(b.av); scene.add(obj);
    botRt.push({ obj, path: null, seg: 0, t: 0, busy: 0, working: false, face: -1, fwd: new THREE.Vector3(1, 0, 0), pending: null, house: null, houseTier: -1, houseCamp: -1, think: Math.random() * 2 });
    placeBotHouse(i);
  });
}
function placeBotHouse(i) {
  const b = state.bots[i], r = botRt[i];
  if (r.houseTier === b.tier && r.houseCamp === b.camp) return;
  if (r.house) { scene.remove(r.house); r.house.geometry.dispose(); r.house = null; }
  if (b.home < 0 && r.houseCamp >= 0) releaseHome(r.houseCamp, r.houseTier);
  const fresh = r.houseTier === -1;
  r.houseTier = b.tier; r.houseCamp = b.camp;
  if (b.home < 0 || b.camp < 0) return;
  if (b.tier > 0) { stampHome(b.camp, b.tier, fresh); return; }
  const c = b.camp, h = buildHouse(0), sc = CELLW * HOUSESC[0];
  h.frustumCulled = false; h.scale.set(sc, sc, sc);
  _v.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); h.quaternion.setFromUnitVectors(YAX, _v); h.position.copy(_v).multiplyScalar(R + H[c] * LAYER);
  scene.add(h); r.house = h;
}
function botGoal(b) {
  if (b.home < 0) return { key: 'field', tok: b.fieldNeed || FIELDPRICE };
  if (!b.payer) return { key: 'work' };          // wer keine Gebuehren zahlt, bleibt im Zelt, arbeitet und verkauft
  for (const p of BPLANS) if (!b.plans[p.key] && b.tier >= p.tier) return { key: p.key, tok: p.price };
  for (const m of [3, 2, 1]) if (b.plans[BREQ[m].plan] && (b.fl[m] || 0) < BOTFLOORS[m]) return { key: 'floor', mat: m, need: BCOST[m] };
  const n = b.tier + 1;
  if (n <= 6) { if (!b.plans['t' + n]) return { key: 't' + n, tok: TIERCOST[n] }; return { key: 'up', need: TIERNEED[n] }; }
  return null;
}
function botGo(i, plan, kind, extra) {
  if (!plan) return false;
  const r = botRt[i];
  if (plan.path.length > 1) { r.path = plan.path; r.seg = 0; r.t = 0; r.pending = { kind, cell: plan.target, extra }; }
  else botAct(i, kind, plan.target, extra);
  return true;
}
function botWander(i, rad = 4) {
  const b = state.bots[i], m = bfsLocal(b.cell, rad, footOk);
  if (m > 1) { const c = bq[1 + Math.floor(Math.random() * (m - 1))]; botGo(i, { path: pathTo(c), target: c }, 'rest'); return; }
  // eingeschlossen, etwa in einer Grube: auf die hoechste trockene Nachbarzelle klettern
  let best = -1; for (let k = 0; k < ncnt[b.cell]; k++) { const o = cellNb[b.cell * 6 + k]; if (footOk(o) && (best < 0 || surfH(o) > surfH(best))) best = o; }
  if (best >= 0) b.cell = best; botRt[i].busy = 2;
}
function botThink(i) {
  const b = state.bots[i], g = botGoal(b); botRt[i].goal = g ? g.key : 'done';
  if (state.box && (b.coolUntil || 0) <= state.econ.boxSeq && Math.random() < 0.3) { const p = seekBeside(b.cell, 26, c => state.box && c === state.box.cell); if (p && b.uses.dig > 0) return botGo(i, p, 'dig'); }
  const need = g && g.need ? g.need : {};
  const have = k => k === 'beton' ? b.uses.beton : b.inv[k];
  const missing = Object.keys(need).find(k => have(k) < need[k]);
  if (g && g.need && !missing) return g.key === 'up' ? botUpgradeStep(i) : botFloorStep(i, g.mat);
  if (g && g.key === 'field' && b.tok >= g.tok && botClaim(i)) return;
  if ((b.uses.axe <= 0 && b.tok >= TOOLP('axe').price) || (missing === 'stein' && b.uses.dig <= 0 && b.tok >= TOOLP('dig').price)) return botToTrader(i);
  let tokNeed = g && g.tok ? g.tok : 0;
  if (missing === 'beton') tokNeed += TOOLP('beton').price;
  if (b.uses.axe <= 0) tokNeed += TOOLP('axe').price;
  if (missing === 'stein' && b.uses.dig <= 0) tokNeed += TOOLP('dig').price;
  if (tokNeed > 0 && b.tok >= tokNeed) return botToTrader(i);
  const surW = Math.max(0, b.inv.holz - (need.holz || 0)), surS = Math.max(0, b.inv.stein - (need.stein || 0));
  const val = (surW * ECON.wood + surS * ECON.stone) * priceF(b.trader);
  if ((tokNeed > 0 && b.tok + val >= tokNeed && val > 0) || surW + surS >= 60) return botToTrader(i);
  if (missing === 'holz') return botGather(i, 'holz');
  if (missing === 'stein' && b.uses.dig > 0) return botGather(i, 'stein');
  if (!g) return botWander(i, 5);          // fertig: bummeln statt Token zu farmen
  return botGather(i, b.uses.dig > 0 && Math.random() < 0.35 ? 'stein' : 'holz');
}
function botGather(i, kind) {
  const b = state.bots[i];
  if (kind === 'holz') {
    const tree = c => MAT[c] === FOREST && W[c] < 0.3 && mayTouch(i, c);
    const p = seekBeside(b.cell, 28, tree) || seekBeside(b.cell, 70, tree);
    return p ? botGo(i, p, b.uses.axe > 0 ? 'chop' : 'branch') : botWander(i, 12);
  }
  const ring = b.camp >= 0 ? botRing(b) : [];
  const okQ = c => c >= 0 && !market[c] && mayTouch(i, c) && BN[c] === 0 && W[c] < 0.3 && H[c] > ORIG[c] - 5 && H[c] > -2 && MAT[c] !== FOREST && !ring.includes(c) && !(state.box && state.box.cell === c);
  if (!okQ(b.quarry)) {
    const p = seekBeside(b.cell, 25, c => okQ(c) && (MAT[c] === ROCK || MAT[c] === SNOW || fieldOf[c] === b.home)) || seekBeside(b.cell, 40, c => okQ(c) && fieldOwner[fieldOf[c]] === -1 && MAT[c] !== SAND);
    if (!p) return botGather(i, 'holz');
    b.quarry = p.target; return botGo(i, p, 'dig');
  }
  const q = b.quarry, p = seekBeside(b.cell, 40, c => c === q);
  if (!p) { b.quarry = -1; return botWander(i, 6); }
  return botGo(i, p, 'dig');
}
function botToTrader(i) {
  const b = state.bots[i], n = npcs[b.trader]; if (!n) return botWander(i);
  const tc = c => c === n.cell || c === traderRt[b.trader].at;
  const p = seekBeside(b.cell, 90, tc) || seekBeside(b.cell, 90, tc, 99);
  if (!p) { const nt = nearestTrader(b.cell); if (nt === b.trader) return botWander(i, 1); b.trader = nt; return botWander(i, 6); }
  return botGo(i, p, 'trade');
}
function botClaim(i) {
  const b = state.bots[i];
  const flat = c => {
    if (ncnt[c] !== 6 || !campOk(c) || BN[c] > 0) return false;
    const f = fieldOf[c]; if (fieldOwner[f] !== -1) return false;
    for (let k = 0; k < 6; k++) { const o = cellNb[c * 6 + k]; if (fieldOf[o] !== f || H[o] !== H[c] || W[o] > 0.05 || BN[o] > 0 || MAT[o] === PLAZA || npcAt[o] >= 0) return false; }
    return true;
  };
  const m = bfsLocal(b.cell, 45, footOk), cands = [];
  for (let q = 0; q < m && cands.length < 30; q++) { const c = bq[q]; if (lbDist[c] >= 6 && flat(c)) cands.push(c); }
  { if (!cands.length) return false; const path0 = new Map(cands.map(c => [c, pathTo(c)])); const pr = new Map(cands.map(c => [c, fieldPrice(fieldOf[c])])); const aff = cands.filter(c => pr.get(c) <= b.tok);
    if (!aff.length) { b.fieldNeed = Math.min(...pr.values()); return false; }
    const c = aff[Math.floor(Math.random() * aff.length)]; return botGo(i, { path: path0.get(c), target: c }, 'claim'); }
  if (!cands.length) return botWander(i, 14);
  const c = cands[Math.floor(Math.random() * cands.length)];
  return botGo(i, { path: pathTo(c), target: c }, 'claim');
}
function botUpgradeStep(i) {
  const b = state.bots[i];
  if (b.tier + 1 >= BIGTIER) {
    for (const o of botRing(b).slice(1)) if (MAT[o] === FOREST) { const p = seekBeside(b.cell, 30, c => c === o); if (p) return botGo(i, p, b.uses.axe > 0 ? 'chop' : 'branch'); }
    if (!botRingOk(b)) return botWander(i, 5);
  }
  const p = seekBeside(b.cell, 40, c => c === b.camp) || seekBeside(b.cell, 40, c => c === b.camp, 99);
  return p ? botGo(i, p, 'upgrade') : botWander(i, 6);
}
function botCanStack(c, m) { const n = BN[c]; if (n >= 3) return false; for (let j = 0; j < n; j++) if (n - j > BCAP[BLD[c * MAXF + j]]) return false; return true; }
function botFloorStep(i, m) {
  const b = state.bots[i], ring = botRing(b), hc = H[b.camp];
  const ok = c => !market[c] && fieldOf[c] === b.home && !ring.includes(c) && H[c] === hc && W[c] < 0.05 && MAT[c] !== FOREST && MAT[c] !== PLAZA && npcAt[c] < 0 && c !== b.quarry && !(state.box && state.box.cell === c) && botCanStack(c, m);
  const ringOpen = c => { for (const r0 of ring.slice(1)) { let free = 0; for (let k = 0; k < ncnt[r0]; k++) { const o = cellNb[r0 * 6 + k]; if (o !== c && !ring.includes(o) && BN[o] === 0 && W[o] < 0.35) free++; } if (free) return true; } return false; };
  const touches = c => { for (let k = 0; k < ncnt[c]; k++) { const o = cellNb[c * 6 + k]; if ((BN[o] > 0 && fieldOf[o] === b.home) || ring.includes(o)) return true; } return false; };
  const want = c => ok(c) && (BN[c] > 0 || (touches(c) && ringOpen(c)));
  const p = seekBeside(b.cell, 30, want) || seekBeside(b.cell, 30, want, 99);
  if (!p) { b.fl[m] = BOTFLOORS[m]; return botWander(i, 4); }
  return botGo(i, p, 'floor', m);
}
function botAct(i, kind, c, extra) {
  const b = state.bots[i], r = botRt[i];
  r.cnt = r.cnt || {}; r.cnt[kind] = (r.cnt[kind] || 0) + 1;
  r.face = c; r.busy = 2; r.working = true;
  if (kind === 'chop') {
    if (MAT[c] !== FOREST || !mayTouch(i, c)) return;
    if (b.uses.axe <= 0) return botAct(i, 'branch', c);
    b.uses.axe--; MAT[c] = GRASS; b.inv.holz += 2; treesDirty = true; touch(c); r.busy = 5;
  } else if (kind === 'branch') { if (MAT[c] !== FOREST) return; b.inv.holz += 1; r.busy = 7; }
  else if (kind === 'dig') {
    if (market[c] || !mayTouch(i, c) || BN[c] > 0 || W[c] > 0.3 || MAT[c] === FOREST || b.uses.dig <= 0) { b.quarry = -1; return; }
    b.uses.dig--;
    if (state.box && state.box.cell === c) { if ((b.coolUntil || 0) > state.econ.boxSeq) { b.quarry = -1; return; } botFindBox(i); }
    const mt = MAT[c]; if (mt === ROCK || mt === SNOW) b.inv.stein++; else b.inv.erde++;
    H[c]--; PAINT[c] = -1; MAT[c] = (ORIG[c] - H[c] >= 3 || mt === ROCK) ? ROCK : (mt === SAND || mt === SEABED) ? SAND : DIRT; touch(c); r.busy = 4;
  } else if (kind === 'trade') { botTrade(i); r.working = false; }
  else if (kind === 'claim') {
    const f = fieldOf[c], pr = fieldPrice(f); if (fieldOwner[f] !== -1 || b.tok < pr) return;
    b.tok -= pr; payTrader(b.trader, pr); b.lastTx = state.clock; b.home = f; b.camp = c; fieldOwner[f] = i + 1;
    if (MAT[c] === FOREST) { MAT[c] = GRASS; treesDirty = true; touch(c); }
    placeBotHouse(i); r.busy = 3;
  } else if (kind === 'upgrade') {
    const nt = b.tier + 1, nd = TIERNEED[nt]; if (!nd || !b.plans['t' + nt]) return;
    for (const k of Object.keys(nd)) if ((k === 'beton' ? b.uses.beton : b.inv[k]) < nd[k]) return;
    if (nt >= BIGTIER && !botRingOk(b)) return;
    for (const k of Object.keys(nd)) { if (k === 'beton') b.uses.beton -= nd[k]; else b.inv[k] -= nd[k]; }
    b.tier = nt; placeBotHouse(i); addEur('tiers', EURO.tierFee[nt]); r.busy = 4;
  } else if (kind === 'floor') {
    const m = extra, nd = BCOST[m];
    if (BN[c] >= MAXF || !botCanStack(c, m) || W[c] > 0.1) return;
    for (const k of Object.keys(nd)) if ((k === 'beton' ? b.uses.beton : b.inv[k]) < nd[k]) return;
    for (const k of Object.keys(nd)) { if (k === 'beton') b.uses.beton -= nd[k]; else b.inv[k] -= nd[k]; }
    BLD[c * MAXF + BN[c]] = m; BN[c]++; builtCells.add(c); bldDirty = true; saveDirty = true;
    b.fl[m] = (b.fl[m] || 0) + 1; r.busy = 4;
  } else if (kind === 'rest') { r.busy = 2 + Math.random() * 4; r.working = false; return; }
  state.activity = (state.activity || 0) + 1;
}
function botTrade(i) {
  const b = state.bots[i], g = botGoal(b), need = g && g.need ? g.need : {}, t = b.trader;
  const sw = Math.max(0, b.inv.holz - (need.holz || 0)), ss = Math.max(0, b.inv.stein - (need.stein || 0));
  if (sw + ss) { const s = sellGoods(t, sw, ss); b.tok += s.pay; b.inv.holz -= Math.min(sw, Math.round(sw * s.frac)); b.inv.stein -= Math.min(ss, Math.round(ss * s.frac)); }
  const buy = price => { if (b.tok < price) return false; b.tok -= price; payTrader(t, price); b.lastTx = state.clock; return true; };
  if (g && g.tok && g.key !== 'field' && buy(g.tok)) b.plans[g.key] = true;
  if (need.beton) while (b.uses.beton < need.beton && buy(TOOLP('beton').price)) b.uses.beton += TOOLP('beton').pack;
  if (b.uses.axe <= 2 && buy(TOOLP('axe').price)) b.uses.axe += TOOLP('axe').pack;
  if (b.uses.dig <= 2 && buy(TOOLP('dig').price)) b.uses.dig += TOOLP('dig').pack;
  botRt[i].busy = 3; saveDirty = true;
}
function botFindBox(i) {
  const b = state.bots[i], bx = state.box; if (!bx) return;
  state.box = null; b.tok += bx.tokens; b.inv.holz += bx.holz; b.inv.stein += bx.stein; state.econ.boxBots++; b.coolUntil = state.econ.boxSeq + BOXCOOL;
  toast(b.name + " dug up the wanderer's box: " + bx.tokens + ' tokens.');
}
function updateBots(dt) {
  const ds = dt * timeSpeed;
  for (let i = 0; i < botRt.length; i++) {
    const b = state.bots[i], r = botRt[i];
    if (r.path) {
      r.t += ds * 0.6;
      while (r.t >= 1 && r.path) {
        r.t -= 1; r.seg++; b.cell = r.path[r.seg];
        if (r.seg >= r.path.length - 1) { r.path = null; r.t = 0; const p = r.pending; r.pending = null; if (p) botAct(i, p.kind, p.cell, p.extra); }
      }
    } else if (r.busy > 0) r.busy -= ds;
    else if ((r.think -= ds) <= 0) { r.think = 0.4 + Math.random() * 0.8; r.working = false; botThink(i); }
    poseOn(r.obj, r.path, r.seg, r.t, b.cell, r.fwd, r.path ? -1 : r.face);
    animateGnome(r.obj, r.path ? 'walk' : r.busy > 0 && r.working ? 'work' : 'idle', dt, Math.min(timeSpeed, 3));
  }
}
function renderEcon() {
  const bots = state.bots || [], tiers = [0, 0, 0, 0, 0, 0, 0]; let nofield = 0, tokB = 0, floors = 0;
  for (const b of bots) { if (b.home < 0) nofield++; else if (b.payer) tiers[b.tier]++; tokB += b.tok; floors += Object.values(b.fl || {}).reduce((a, x) => a + Math.min(x, 9), 0); }
  const tr = state.traders || [], trSum = tr.reduce((a, x) => a + x, 0), e = state.econ || {};
  const row = (k, v, note) => `<div class="erow"><span>${k}</span><strong>${v}</strong>${note ? `<span class="sdesc">${note}</span>` : ''}</div>`;
  $('econ-body').innerHTML = `<h2>Economy</h2><p class="note">You and ${bots.length} other gnomes play by the same rules. Speed ×${timeSpeed} applies to them, the traders and the clock, not to you.</p>
    <h3>Where the tokens are</h3>
    ${row('Your wallet', fmtT(state.tokens), (state.credit > 0 ? fmtT(Math.min(state.credit, state.tokens)) + ' of it is starter credit: spendable at traders, not tradeable, lost if you quit. ' : '') + (state.home >= 0 ? 'Field protected for ' + Math.max(0, Math.ceil((PROTECT_H - (state.clock - (state.lastTx || 0))) / 24)) + ' more game days.' : ''))}
    ${row('Other gnomes', fmtT(tokB), 'about ' + fmtT(tokB / Math.max(1, bots.length)) + ' each')}
    ${row('Traders’ cash', fmtT(trSum), npcs.map((n, i) => n.name + ' pays ' + Math.round(priceF(i) * 100) + '%').join(', '))}
    ${row('Wanderer’s pot', fmtT(state.pot), (e.boxYou || 0) + ' boxes found by you, ' + (e.boxBots || 0) + ' by others')}
    <h3>Flows so far</h3>
    ${row('Spent at traders', fmtT(e.spent || 0))}
    ${row('Paid out for wood and stone', fmtT(e.sold || 0))}
    ${row('Treasury top-ups', fmtT(e.treasury || 0), 'budget left ' + fmtT(e.budget || 0))}
    ${row('Upkeep paid', fmtT(e.upkeep || 0))}
    <h3>Studio revenue, simulated</h3>
    ${row('Mint, 15 \u20ac per gnome', (e.eur.mint || 0) + ' \u20ac')}
    ${row('Field protection, 8 \u20ac per 30 game days', (e.eur.protect || 0) + ' \u20ac')}
    ${row('NFT upgrade fees', (e.eur.tiers || 0) + ' \u20ac')}
    ${row('Market fee, 5 % of token trades', (e.eur.market || 0).toFixed(2) + ' \u20ac', fmtT(e.mktVol || 0) + ' tokens traded so far, last price ' + ((e.mktPrice || 0) * 100).toFixed(2) + ' cents per token')}
    ${row('Total', Math.round((e.eur.mint || 0) + (e.eur.protect || 0) + (e.eur.tiers || 0) + (e.eur.market || 0)) + ' \u20ac', 'every euro adds 5 tokens to the treasury budget')}
    <h3>Other gnomes</h3>
    ${row('No field yet', nofield)}
    ${row('Workers (pay no fees, stay in their tent)', bots.filter(b => !b.payer && b.home >= 0).length)}
    ${TIERNAMES.map((n, t) => tiers[t] ? row(n, tiers[t]) : '').join('')}
    ${row('Floors built', floors)}`;
}

/* ---------------- Beitreten, Wicht gestalten, Welt betreten ---------------- */
const OPTS = [
  { key: 'body', label: () => 'Body', names: () => ['Him', 'Her'] },
  { key: 'size', label: () => 'Height', names: () => ['Small', 'Medium', 'Tall'] },
  { key: 'build', label: () => 'Build', names: () => ['Slim', 'Normal', 'Sturdy'] },
  { key: 'hat', label: () => 'Hat', names: () => ['Pointed', 'Floppy', 'Hood', 'Straw hat', 'None'] }
];
const COLS = [{ key: 'cHat', label: 'Hat color', pal: HATC }, { key: 'cOutfit', label: 'Clothes', pal: OUTC }, { key: 'cAccent', label: 'Vest and shirt', pal: ACCC }, { key: 'cHair', label: 'Hair color', pal: HAIRC }, { key: 'cSkin', label: 'Skin', pal: SKINC }];
let draft = null, gateOpen = false;
const pvw = { r: null, scene: null, cam: null, mesh: null, fig: null, drag: false, lx: 0 };
function pvInit() {
  const cv = $('gnome-view');
  pvw.r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
  pvw.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  pvw.scene = new THREE.Scene(); pvw.cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  pvw.cam.position.set(0, 1.3, 5.6); pvw.cam.lookAt(0, 1.06, 0);
  pvw.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
    vertexColors: true,
    vertexShader: 'varying vec3 vC; varying vec3 vP; void main(){ vC = color; vec4 w = modelMatrix*vec4(position,1.0); vP = mat3(modelMatrix)*normal; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `varying vec3 vC; varying vec3 vP;
void main(){ vec3 n = normalize(vP);
  float d = max(dot(n, normalize(vec3(0.45,0.75,0.6))), 0.0), bk = max(dot(n, normalize(vec3(-0.6,0.2,-0.7))), 0.0);
  vec3 col = vC*(0.50 + 0.55*d + 0.10*(0.5+0.5*n.y)) + vec3(0.25,0.35,0.6)*bk*0.25;
  gl_FragColor = vec4(col, 1.0); }`
  }));
  pvw.mesh.rotation.y = 0.5; pvw.scene.add(pvw.mesh);
  cv.addEventListener('pointerdown', e => { pvw.drag = true; pvw.lx = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (pvw.drag) { pvw.mesh.rotation.y += (e.clientX - pvw.lx) * 0.012; pvw.lx = e.clientX; } });
  cv.addEventListener('pointerup', () => { pvw.drag = false; }); cv.addEventListener('pointercancel', () => { pvw.drag = false; });
}
function pvRender(dt, time) {
  const cv = $('gnome-view'), w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.floor(w * pvw.r.getPixelRatio())) { pvw.r.setSize(w, h, false); pvw.cam.aspect = w / h; pvw.cam.updateProjectionMatrix(); }
  if (!pvw.drag && !reduceMotion) pvw.mesh.rotation.y += dt * 0.5;
  if (pvw.fig) { pvw.fig.rotation.y = pvw.mesh.rotation.y; animateGnome(pvw.fig, 'idle', Math.min(dt, 0.05)); }
  pvw.mesh.position.y = reduceMotion ? 0 : Math.abs(Math.sin(time * 2.2)) * 0.04;
  pvw.r.render(pvw.scene, pvw.cam);
}
function drawDraft() {
  pvw.mesh.geometry.dispose(); pvw.mesh.geometry = buildGnome(draft);
  if (pvw.fig) { pvw.scene.remove(pvw.fig); disposeGnome(pvw.fig); pvw.fig = null; }
  const fg = makeAvatar(draft);
  if (fg) {                // Vorschau mit dem echten Modell und eigenem, festem Licht
    pvw.mesh.visible = false; fg.scale.setScalar(1.55 / (CELLW * 0.31 * 0.62)); fg.position.y = 0.02;
    fg.traverse(o => { if (o.isSkinnedMesh) { const u = o.material.uniforms; o.material.dispose(); o.material = new THREE.ShaderMaterial({ uniforms: { uTint: u.uTint, uRef: u.uRef }, vertexShader: AV_VS, fragmentShader: AV_PV_FS, vertexColors: true, side: THREE.DoubleSide }); }
      else if (o.isMesh && o.material === propMat) o.material = pvw.mesh.material; });
    pvw.scene.add(fg); pvw.fig = fg;
  }
  $('opts').innerHTML = OPTS.map(o => `<div class="orow"><span class="olabel">${o.label(draft)}</span><div class="chips">${o.names(draft).map((n, i) =>
    `<button type="button" class="chip" data-k="${o.key}" data-v="${i}" aria-pressed="${draft[o.key] === i}">${n}</button>`).join('')}</div></div>`).join('') +
    COLS.map(o => `<div class="orow"><span class="olabel">${o.label}</span><div class="chips">${o.pal.map((p, i) =>
      `<button type="button" class="swatch${draft[o.key] === i ? ' on' : ''}" data-k="${o.key}" data-v="${i}" aria-label="${o.label} ${i + 1}" style="background:rgb(${p.map(v => Math.round(v * 255)).join(',')})"></button>`).join('')}</div></div>`).join('');
  const used = SKILLS.reduce((a, k) => a + draft.skills[k.key], 0);
  $('pts').textContent = (SKILLPTS - used) + ' of ' + SKILLPTS + ' points left';
  $('skills').innerHTML = SKILLS.map(k => `<div class="srow"><div><strong>${k.name}</strong><span class="sdesc">${k.desc}</span></div>
    <div class="sctl"><button type="button" class="chip" data-s="${k.key}" data-d="-1" aria-label="Less ${k.name}">−</button>
    <span class="dots" aria-label="${draft.skills[k.key]} of ${SKILLMAX}">${'●'.repeat(draft.skills[k.key])}${'○'.repeat(SKILLMAX - draft.skills[k.key])}</span>
    <button type="button" class="chip" data-s="${k.key}" data-d="1" aria-label="More ${k.name}">+</button></div></div>`).join('');
}
function openGate(step) {
  gateOpen = true; document.body.classList.add('gated'); $('gate').hidden = false;
  $('join').hidden = step !== 'join'; $('maker').hidden = step !== 'maker';
  if (step === 'maker') {
    if (!pvw.r) pvInit();
    draft = state.avatar ? JSON.parse(JSON.stringify(state.avatar)) : randomAvatar();
    if (!draft.skills) draft.skills = { strider: 0, digger: 0, trader: 0, gardener: 0 };
    $('gnome-name').value = draft.name || ''; drawDraft();
  }
}
function applyAvatar() {
  const old = figure.userData.body; figure.remove(old); disposeGnome(old); const body = makeGnome(state.avatar); figure.add(body); figure.userData.body = body; figure.visible = true;
  $('who').textContent = state.avatar.name || 'Gnome';
}
function enterWorld() {
  draft.name = ($('gnome-name').value || '').trim().slice(0, 16) || 'Gnome';
  const first = !state.avatar; state.avatar = draft; saveDirty = true; applyAvatar();
  if (first) { addEur('mint', EURO.mint); state.lastTx = state.clock; }
  gateOpen = false; document.body.classList.remove('gated'); $('gate').hidden = true;
  if (first) { $('help').hidden = false; toFigure(); toast('Welcome, ' + draft.name + '. You start with 100 tokens, a shovel and an axe. A trader stands next to you.'); }
}
$('btn-join').addEventListener('click', () => openGate('maker'));
$('btn-enter').addEventListener('click', enterWorld);
$('btn-random').addEventListener('click', () => { const s0 = draft.skills; draft = randomAvatar(); draft.skills = s0; $('gnome-name').value = draft.name; drawDraft(); });
$('btn-char').addEventListener('click', () => openGate('maker'));
$('opts').addEventListener('click', e => {
  const t = e.target.closest('[data-k]'); if (!t) return;
  draft[t.dataset.k] = parseInt(t.dataset.v, 10); drawDraft();
});
$('skills').addEventListener('click', e => {
  const t = e.target.closest('[data-s]'); if (!t) return;
  const k = t.dataset.s, d = parseInt(t.dataset.d, 10), used = SKILLS.reduce((a, q) => a + draft.skills[q.key], 0);
  if (d > 0 && (used >= SKILLPTS || draft.skills[k] >= SKILLMAX)) return;
  if (d < 0 && draft.skills[k] <= 0) return;
  draft.skills[k] += d; drawDraft();
});

/* ---------------- Start und Schleife ---------------- */
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
buildToolbar();
const loaded = LEAGUE_MODE ? false : load();
initWorld(loaded);
camInit(state.cell);
panBy(0.25, -0.12);
resize(); refreshHud();
$('help').hidden = true;
if (LEAGUE_MODE) { $('gate').hidden = true; figure.visible = false; document.body.classList.add('spectator', 'leaguemode'); timeSpeed = 1; }
else if (state.avatar) { applyAvatar(); $('gate').hidden = true; } else openGate('join');
$('stat-cells').textContent = NC.toLocaleString('en-US') + ' cells · ' + NF.toLocaleString('en-US') + ' fields';

let last = performance.now(), simAcc = 0, growAcc = 0, fpsAcc = 0, fpsN = 0, slowFrames = 0, time = 0;
setSunBase();
let envAcc = 1, envTick = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  U.uTime.value = time;
  state.clock += dt / HOURSEC * timeSpeed;
  { const dayN = Math.floor((state.clock + 8.7) / 24); if (state.lastDay === null || state.lastDay === undefined) state.lastDay = dayN; if (dayN > state.lastDay) { state.lastDay = dayN; econDay(); } }
  _qq.setFromAxisAngle(sunAxis, -state.clock / 24 * TAU); U.uSun.value.copy(sunBase).applyQuaternion(_qq);
  updateWind(time); windAt(cam.u, U.uWind.value);
  envAcc += dt;
  if (envAcc > 0.25) {
    envAcc = 0;
    _v.copy(figure.position).normalize(); if (!state.avatar) _v.copy(cam.u);
    const lh = localHour(_v), hh = Math.floor(lh), mi = Math.floor((lh - hh) * 60);
    $('clock').textContent = 'Day ' + (Math.floor((state.clock + 8.7) / 24) + 1) + ' · ' + String(hh).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + (lh < 5.5 || lh > 19.5 ? ' night' : '');
    const wv = U.uWind.value; _r.crossVectors(cam.f, cam.u);
    $('wind-arrow').style.transform = 'rotate(' + Math.atan2(wv.dot(_r), wv.dot(cam.f)).toFixed(2) + 'rad)';
    $('wind').textContent = windS < 0.45 ? 'Light air' : windS < 0.72 ? 'Light breeze' : 'Gentle breeze';
    $('boxinfo').textContent = state.box ? ' · A box is buried nearby' : '';
    if (!$('econ').hidden && (envTick = (envTick || 0) + 1) % 2 === 0) renderEcon();
    $('sea').textContent = 'Sea level ' + (seaLevel >= 0 ? '+' : '−') + Math.abs(seaLevel).toFixed(4);
  }
  if ((!interacted || (gateOpen && !state.avatar)) && !reduceMotion) panBy(dt * 0.035, 0);
  if (gateOpen && pvw.r && !$('maker').hidden) pvRender(dt, time);
  keyMove(dt);
  simAcc += dt; let steps = 0;
  while (!LEAGUE_MODE && simAcc > 1 / 12 && steps < 2) { simStep(); simAcc -= 1 / 12; steps++; }
  if (LEAGUE_MODE) simAcc = 0;
  if (steps) {
    let any = false;
    for (let c = 0; c < NC; c++) {
      if (slotOf[c] < 0) continue;
      const w = W[c], lw = LASTW[c];
      if (Math.abs(w - lw) > 0.03 || ((w > 0.1) !== (lw > 0.1))) { dirtyW.add(c); for (let k = 0; k < ncnt[c]; k++) dirtyW.add(cellNb[c * 6 + k]); any = true; }
    }
    if (any) { for (const c of dirtyW) writeWater(c); const list = toSlots(dirtyW); dirtyW.clear(); markWater(list); }
  }
  growAcc += dt; if (growAcc > 0.3) { growAcc = 0; growTick(); }
  updateStream();
  flushDirty();
  updateFigure(dt, time);
  updateWanderer(dt, time); if (!LEAGUE_MODE) natureStep(Math.min(dt, 0.1) * timeSpeed); weatherFrame(Math.min(dt, 0.1)); leagueFrame(Math.min(dt, 0.1));
  updateTraders(dt);
  updateBots(dt);
  updateCamera(dt);
  if (hoverXY && pointers.size === 0) { const hc = pick(hoverXY[0], hoverXY[1]); setHover(hc); setPreviewField(tool === 'home' && state.home < 0 && hc >= 0 ? fieldOf[hc] : -1); } else setPreviewField(-1);
  if (LEAGUE_MODE !== 'run') { renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam); }
  // Anzeige und automatische Aufloesung
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.6) {
    const fps = fpsN / fpsAcc; $('stat-fps').textContent = Math.round(fps) + ' fps';
    if (fps < 38 && time > 4) slowFrames++; else slowFrames = 0;
    if (slowFrames >= 3 && pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.25); slowFrames = 0; resize(); }
    fpsAcc = 0; fpsN = 0;
  }
  saveTimer += dt; if (saveDirty && saveTimer > 2.5) { save(); saveDirty = false; saveTimer = 0; }
  requestAnimationFrame(frame);
}
const dirtyW = new Set();
requestAnimationFrame(frame);
$('loading').hidden = true;
window.__ready = true;
window.__dbg = { fastForward(hours) {     // Spiellogik ohne Bild vorspulen, zum Pruefen der Wirtschaft
    const sp0 = timeSpeed; timeSpeed = 60; const dt = 0.05, steps = Math.round(hours * HOURSEC / (dt * 60)); let tt = 0;
    for (let k = 0; k < steps; k++) {
      state.clock += dt / HOURSEC * timeSpeed; tt += dt;
      const dayN = Math.floor((state.clock + 8.7) / 24); if (dayN > state.lastDay) { state.lastDay = dayN; econDay(); }
      updateTraders(dt); updateBots(dt); updateWanderer(dt, tt); natureStep(dt * timeSpeed);
      if (k % 200 === 0) { dirtyCells.clear(); }
    }
    timeSpeed = sp0; treesDirty = true; bldDirty = true; return steps;
  }, renderer, scene, camera, rt: () => rt, updateBots, updateTraders, flushDirty, rebuildTrees, rebuildFx, rebuildBuildings, bots: () => state.bots, botRt, traderRt, renderEcon, setSpeed(v) { timeSpeed = v; }, BN, BLD, builtCells, MAXF, cellNb, act, state: () => state, lineup(c0, list) {
    // Testreihe: Figuren mit Haltungen nebeneinander, laufen jede Bildschirmaufnahme weiter
    const out = []; let c = c0; window.__lu = window.__lu || []; for (const o of window.__lu) scene.remove(o); window.__lu = [];
    const up = new THREE.Vector3(cdir[c0 * 3], cdir[c0 * 3 + 1], cdir[c0 * 3 + 2]), side = new THREE.Vector3(0.3, 1, 0.5).cross(up).normalize(), fwd = new THREE.Vector3().crossVectors(side, up);
    list.forEach((e, i) => { const g = makeGnome(e.av); const p = up.clone().multiplyScalar(R + surfH(c0) * LAYER).addScaledVector(side, (i - (list.length - 1) / 2) * CELLW * 0.3);
      g.position.copy(p); g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, fwd)); scene.add(g); window.__lu.push(g); g.userData.mode = e.mode; });
    if (!window.__luT) { window.__luT = setInterval(() => { for (const g of window.__lu) animateGnome(g, g.userData.mode, 0.12, 1); }, 500); }
    return fwd.toArray(); }, cam, natureTick, natureHour, weatherTick, damage, DMG, homeNeed, strikeFx, denseAt, treeCount: () => [trees.count, trees2.count], market, npcAt, homeOf, fieldOf, fieldOwner, toastText: () => document.getElementById('toast').textContent, poke() { bldDirty = true; lastBld = 0; }, dirty(c) { dirtyCells.add(c); }, spawnWanderer, wand, H, MAT, OCEAN, fieldCenter, NF, cam, toFigure, cdir, SH, NC, W, fig, clickCell, buildBoat, toggleBalloon, fieldOf, setHome(f, t) { state.home = f; state.camp = fieldCenter[f]; state.tier = t; homeDirty = true; }, getNpcs: () => npcs, getState: () => state, look(c, z) { follow = false; interacted = true; cam.u.set(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); cam.f.addScaledVector(cam.u, -cam.f.dot(cam.u)).normalize(); cam.zT = z; cam.z = z; cam.fh = surfH(c); },
  dayAt(c, h) { const p = new THREE.Vector3(cdir[c * 3], cdir[c * 3 + 1], cdir[c * 3 + 2]); const sun = () => { _qq.setFromAxisAngle(sunAxis, -state.clock / 24 * TAU); U.uSun.value.copy(sunBase).applyQuaternion(_qq); };
    for (let i = 0; i < 4; i++) { sun(); const d = ((h - localHour(p)) % 24 + 36) % 24 - 12; state.clock += d; sun(); const d2 = ((h - localHour(p)) % 24 + 36) % 24 - 12; if (Math.abs(d2) > Math.abs(d)) state.clock -= 2 * d; }
    sun(); return localHour(p); } };
