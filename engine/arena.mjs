/* ================= Hex Arena: KI-Agenten spielen mit Cores =================
   Ein Core ist ein kleines Programm in HexCore, einer Assemblersprache im Geist von Core War.
   Jeder Agent steuert einen Wicht. Er muss trinken, essen und ueberleben; wer zuletzt lebt, gewinnt.
   Die Engine kennt keine Grafik: sie laeuft im Spiel mit 100-facher Geschwindigkeit und ohne Bild fuer Ranglisten. */

export const ARENA_VERSION = 1;

// ---------- Regeln ----------
export const RULES = {
  cyclesPerTick: 16,        // Rechenschritte je Tick, bevor der Agent warten muss
  thirstPerTick: 0.06, hungerPerTick: 0.035,
  thirstDmg: 0.20, hungerDmg: 0.10, regen: 0.02,
  maxTicks: 60000, droughtAt: 12000, droughtStep: 4000, findRadius: 30, goSteps: 12, stepTicks: 2,
  drink: { water: -40, dirty: -30, salt: 10 }, sickChance: 0.35, sickDmg: 12, saltDmg: 4,
  eat: -35,
  start: { seeds: 2, food: 1, water: 1 },
  recipes: { knife: { stone: 1, wood: 1 }, filter: { sand: 2, wood: 1 }, still: { stone: 3, wood: 2, sand: 1 } },
  knifeUses: 30, filterUses: 10,
  cropGrow: 900, cropWither: 1500, berryRegrow: 600, treeWood: 4,
  dmgHand: 5, dmgKnife: 18, stealChance: 0.45,
  ticks: { fill: 5, drink: 2, filter: 8, desal: 25, chop: 6, dig: 6, forage: 6, fish: 10, plant: 6, harvest: 4, eat: 2, craft: 12, attack: 4, steal: 4, sabotage: 8, rest: 10, say: 1 },
};
const ITEMS = ['water', 'dirty', 'salt', 'food', 'seeds', 'wood', 'stone', 'sand', 'knife', 'filter'];
const SENSES = ['hp', 'thirst', 'hunger', ...ITEMS, 'still', 'crop', 'tick', 'alive', 'threat', 'hurt', 'cell', 'id', 'rank', 'drought'];
const KINDS = ['fresh', 'sea', 'water', 'tree', 'berry', 'rock', 'sand', 'soil', 'enemy', 'weak', 'strong', 'crop', 'mycrop', 'garden', 'still', 'mystill', 'food'];

// ---------- Assembler ----------
const OPS = {
  // Daten und Ablauf
  MOV: 'd s', ADD: 'd s', SUB: 'd s', MUL: 'd s', DIV: 'd s', MOD: 'd s', RND: 'd s',
  JMP: 'l', JZ: 's l', JNZ: 's l', JEQ: 's s l', JNE: 's s l', JLT: 's s l', JGT: 's s l', CALL: 'l', RET: '', NOP: '',
  // Wahrnehmung (kein Zeitverlust)
  SENSE: 'k d', FIND: 'k d', DIST: 's d', HERE: 'd', NEAR: 's d',
  // Handlungen (kosten Zeit)
  STEP: 's', GO: 's', FLEE: '', FILL: '', DRINK: 'k?', FILTER: '', DESAL: '', CHOP: '', DIG: '', FORAGE: '', FISH: '',
  PLANT: '', HARVEST: '', EAT: '', CRAFT: 'k', ATTACK: 's', STEAL: 's', SABOTAGE: 's', REST: '', WAIT: 's', SAY: 't',
};
const ACTIONS = new Set(['STEP', 'GO', 'FLEE', 'FILL', 'DRINK', 'FILTER', 'DESAL', 'CHOP', 'DIG', 'FORAGE', 'FISH', 'PLANT', 'HARVEST', 'EAT', 'CRAFT', 'ATTACK', 'STEAL', 'SABOTAGE', 'REST', 'WAIT', 'SAY']);
const KEYWORDS = { SENSE: SENSES, FIND: KINDS, CRAFT: Object.keys(RULES.recipes), DRINK: ['water', 'dirty', 'salt'] };
const MAXCODE = 256;

export function assemble(src) {
  const meta = { name: 'Unnamed', author: 'unknown', motive: '', goal: '', version: 1 }, code = [], labels = {}, errors = [], pending = [];
  const lines = String(src).replace(/\r/g, '').split('\n');
  lines.forEach((raw, ln) => {
    let line = raw.replace(/;.*$/, '').trim(); if (!line) return;
    const md = line.match(/^\.(\w+)\s+(.*)$/);
    if (md) { const k = md[1].toLowerCase(), v = md[2].trim().replace(/^"(.*)"$/, '$1');
      if (k in meta) meta[k] = k === 'version' ? (parseInt(v) || 1) : v.slice(0, 160); else if (k !== 'behavior') errors.push({ line: ln + 1, msg: 'unknown section .' + k });
      return; }
    if (/^\.behavior$/i.test(line)) return;
    let m;
    while ((m = line.match(/^([A-Za-z_]\w*):\s*(.*)$/))) { labels[m[1].toLowerCase()] = code.length; line = m[2].trim(); }
    if (!line) return;
    const sp = line.match(/^(\w+)\s*(.*)$/), op = sp[1].toUpperCase();
    if (!(op in OPS)) { errors.push({ line: ln + 1, msg: 'unknown instruction ' + sp[1] }); return; }
    const argSrc = sp[2].trim(), args = [];
    if (op === 'SAY') { const s = argSrc.match(/^"(.*)"$/); args.push({ t: 'str', v: s ? s[1].slice(0, 80) : argSrc.slice(0, 80) }); }
    else if (argSrc) for (const a0 of argSrc.split(',')) {
      const a = a0.trim();
      let mm;
      if ((mm = a.match(/^r(\d{1,2})$/i)) && +mm[1] < 16) args.push({ t: 'r', v: +mm[1] });
      else if (/^-?\d+$/.test(a)) args.push({ t: 'n', v: parseInt(a) });
      else if ((mm = a.match(/^\[(-?\d+)\]$/))) args.push({ t: 'm', v: ((+mm[1] % 64) + 64) % 64 });
      else if ((mm = a.match(/^\[r(\d{1,2})\]$/i)) && +mm[1] < 16) args.push({ t: 'mi', v: +mm[1] });
      else if (/^[A-Za-z_]\w*$/.test(a)) args.push({ t: 'w', v: a.toLowerCase() });
      else errors.push({ line: ln + 1, msg: 'bad operand ' + a });
    }
    const sig = OPS[op].split(' ').filter(Boolean), need = sig.filter(s => !s.endsWith('?')).length;
    if (args.length < need || args.length > sig.length) { errors.push({ line: ln + 1, msg: op + ' takes ' + (sig.length === need ? need : need + '-' + sig.length) + ' operand(s)' }); return; }
    sig.forEach((s, i) => {
      const a = args[i]; if (!a) return; const kind = s.replace('?', '');
      if (kind === 'd' && !['r', 'm', 'mi'].includes(a.t)) errors.push({ line: ln + 1, msg: op + ': operand ' + (i + 1) + ' must be a register or memory' });
      if (kind === 'k') { if (a.t !== 'w' || !KEYWORDS[op].includes(a.v)) errors.push({ line: ln + 1, msg: op + ': expected one of ' + KEYWORDS[op].join(' ') }); else a.t = 'k'; }
      if (kind === 'l') { if (a.t === 'w') { a.t = 'l'; pending.push({ a, line: ln + 1 }); } else if (a.t !== 'n') errors.push({ line: ln + 1, msg: op + ': expected a label' }); }
      if (kind === 's' && a.t === 'w') errors.push({ line: ln + 1, msg: op + ': unknown name ' + a.v });
    });
    code.push({ op, args, line: ln + 1 });
  });
  for (const p of pending) { if (p.a.v in labels) p.a.v = labels[p.a.v]; else errors.push({ line: p.line, msg: 'unknown label ' + p.a.v }); }
  if (code.length > MAXCODE) errors.push({ line: 0, msg: 'core too long: ' + code.length + ' instructions, the limit is ' + MAXCODE });
  if (!code.length) errors.push({ line: 0, msg: 'no instructions' });
  return { meta, code, errors };
}

// ---------- Zufall mit Startwert, damit jede Runde wiederholbar ist ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export function coreHash(src) { let h = 2166136261; for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); }

// ---------- Runde ----------
// world: { inArena(c), nb(c, k) -> cell or -1, ncnt(c), kind(c) -> 'sea'|'fresh'|'tree'|'rock'|'sand'|'soil', dist(a, b) -> Schritte (geschaetzt),
//         randomCell(rand) -> irgendeine Zelle, onChange?(c, kind) }. Die Arena ist der ganze Planet; Gelaende wird erst gelesen, wenn ein Agent hinschaut.
export function createRound(world, entries, opts = {}) {
  const R = RULES, rand = rng(opts.seed || 12345), wood = new Map(), berryAt = new Map(), crops = new Map(), stills = new Map();
  const inA = { has: c => c >= 0 && world.inArena(c) };
  const kmap = new Map(), kind = { get: c => { let k = kmap.get(c); if (k === undefined) { k = world.kind(c); kmap.set(c, k); } return k; }, set: (c, k) => kmap.set(c, k) };
  const isWater = c => { const k = kind.get(c); return k === 'sea' || k === 'fresh'; };
  const passable = c => inA.has(c) && !isWater(c) && kind.get(c) !== 'wall';
  const nbs = c => { const o = []; for (let k = 0; k < world.ncnt(c); k++) { const n = world.nb(c, k); if (n >= 0 && inA.has(n)) o.push(n); } return o; };
  const occ = new Map();                     // Zelle -> Agent
  const log = [], events = [];
  const say = (tick, who, text) => { log.push({ t: tick, who, text }); if (log.length > 4000) log.shift(); };

  // Startplaetze: zufaellig auf festem Land, mit etwas Abstand zueinander und mit Wasser in erreichbarer Naehe
  const agents = [];
  entries.forEach((e, i) => {
    const asm = typeof e.code === 'string' ? assemble(e.code) : e.code;
    let best = -1;
    for (let tries = 0; tries < 4000 && best < 0; tries++) {
      const c = world.randomCell(rand); if (!passable(c) || occ.has(c)) continue;
      if (agents.some(a => world.dist(a.cell, c) < (opts.minGap || 12))) continue;
      if (tries < 3000 && !bfs(c, 25, isWater)) continue;
      best = c;
    }
    const inv = {}; for (const k of ITEMS) inv[k] = R.start[k] || 0;
    const a = { id: i, key: e.key || ('core' + i), name: asm.meta.name, author: asm.meta.author, meta: asm.meta, code: asm.code, errors: asm.errors, src: e.code,
      pc: 0, r: new Int32Array(16), mem: new Int32Array(64), stack: [], cell: best, hp: 100, thirst: 0, hunger: 0, inv, busy: 0, task: null,
      alive: true, diedAt: -1, cause: '', kills: 0, hurtAt: -999, stats: { drank: 0, ate: 0, crafted: 0, planted: 0, harvested: 0, stolen: 0, sabotaged: 0, steps: 0, damage: 0 } };
    agents.push(a); occ.set(best, a);
  });
  const round = { tick: 0, agents, log, events, crops, stills, kind, over: false, winner: null, seed: opts.seed || 12345, world, rules: R };

  // Breitensuche ueber begehbare Zellen; Wasserzellen sind Ziele am Rand
  function bfs(from, radius, test) {
    const seen = new Map([[from, 0]]), q = [from];
    for (let i = 0; i < q.length; i++) {
      const c = q[i], d = seen.get(c);
      if (test(c, d)) return { cell: c, d };
      if (d >= radius) continue;
      for (const n of nbs(c)) { if (seen.has(n)) continue; seen.set(n, d + 1); if (passable(n) && !occ.has(n)) q.push(n); else if (test(n, d + 1)) return { cell: n, d: d + 1 }; }
    }
    return null;
  }
  function pathTo(from, to, maxD = 60) {
    if (from === to) return [];
    const prev = new Map([[from, -1]]), q = [from];
    for (let i = 0; i < q.length && i < 6000; i++) {
      const c = q[i];
      for (const n of nbs(c)) {
        if (prev.has(n)) continue;
        if (n === to || (!passable(to) && nbs(n).includes(to) && passable(n) && !occ.has(n))) {
          prev.set(n, c); const p = []; let x = n; while (x !== from) { p.push(x); x = prev.get(x); } p.reverse();
          if (!passable(to) && n === to) p.pop();
          return p;
        }
        if (!passable(n) || occ.has(n)) continue;
        prev.set(n, c); q.push(n);
      }
    }
    return null;
  }
  const dist = (a, b) => world.dist(a, b);
  const adj = (a, c) => a.cell === c || nbs(a.cell).includes(c);
  const enemies = a => agents.filter(o => o.alive && o !== a);
  const nearAgent = (a, pick) => { let b = null, bv = 1e9; for (const o of enemies(a)) { const d = dist(a.cell, o.cell); const v = pick(o, d); if (v < bv) { bv = v; b = o; } } return b; };

  function find(a, k) {
    const t = round.tick;
    if (k === 'enemy' || k === 'weak' || k === 'strong') {
      // Gegner sieht man ueber den ganzen Planeten, wie auf einer Karte
      const o = nearAgent(a, (o, d) => k === 'enemy' ? d : k === 'weak' ? o.hp * 3 + d : -o.hp * 3 + d);
      return o ? o.cell : -1;
    }
    const test = {
      fresh: c => kind.get(c) === 'fresh', sea: c => kind.get(c) === 'sea', water: c => isWater(c),
      tree: c => kind.get(c) === 'tree', berry: c => kind.get(c) === 'tree' && (berryAt.get(c) || 0) <= t,
      rock: c => kind.get(c) === 'rock', sand: c => kind.get(c) === 'sand', soil: c => kind.get(c) === 'soil' && !crops.has(c) && !stills.has(c) && (!occ.has(c) || occ.get(c) === a),
      crop: c => { const q = crops.get(c); return q && q.owner === a.id && t - q.t >= R.cropGrow; },
      mycrop: c => { const q = crops.get(c); return q && q.owner === a.id; },
      garden: c => { const q = crops.get(c); return q && q.owner !== a.id; },
      still: c => { const q = stills.get(c); return q && q.owner !== a.id; },
      mystill: c => { const q = stills.get(c); return q && q.owner === a.id; },
      food: c => { const q = crops.get(c); return (q && t - q.t >= R.cropGrow) || (kind.get(c) === 'tree' && (berryAt.get(c) || 0) <= t); },
    }[k];
    const r = bfs(a.cell, R.findRadius, test);
    return r ? r.cell : -1;
  }
  function sense(a, k) {
    if (k in a.inv) return a.inv[k];
    switch (k) {
      case 'hp': return Math.ceil(a.hp); case 'thirst': return Math.floor(a.thirst); case 'hunger': return Math.floor(a.hunger);
      case 'still': { for (const s of stills.values()) if (s.owner === a.id) return 1; return 0; }
      case 'crop': { let v = 0; for (const q of crops.values()) if (q.owner === a.id) v = Math.max(v, round.tick - q.t >= R.cropGrow ? 2 : 1); return v; }
      case 'tick': return round.tick; case 'alive': return agents.filter(o => o.alive).length;
      case 'threat': { const o = nearAgent(a, (o, d) => d); return o ? Math.min(999, dist(a.cell, o.cell)) : 999; }
      case 'drought': return round.tick >= R.droughtAt ? 1 + Math.floor((round.tick - R.droughtAt) / R.droughtStep) : 0;
      case 'hurt': return round.tick - a.hurtAt < 50 ? 1 : 0;
      case 'cell': return a.cell; case 'id': return a.id;
      case 'rank': return 1 + agents.filter(o => o.alive && o.hp > a.hp).length;
    }
    return 0;
  }
  // Werte lesen und schreiben
  const val = (a, x) => x.t === 'r' ? a.r[x.v] : x.t === 'n' ? x.v : x.t === 'm' ? a.mem[x.v] : x.t === 'mi' ? a.mem[((a.r[x.v] % 64) + 64) % 64] : 0;
  const set = (a, x, v) => { v = v | 0; if (x.t === 'r') a.r[x.v] = v; else if (x.t === 'm') a.mem[x.v] = v; else if (x.t === 'mi') a.mem[((a.r[x.v] % 64) + 64) % 64] = v; };

  function damage(a, amt, by, cause) {
    if (!a.alive) return;
    a.hp -= amt; a.hurtAt = round.tick; if (by) { by.stats.damage += amt; if (a.busy > 1) { a.busy = 1; a.task = null; a.path = []; } }     // wer angegriffen wird, kommt sofort wieder zum Zug
    if (a.hp <= 0) die(a, by, cause);
  }
  function die(a, by, cause) {
    a.alive = false; a.hp = 0; a.diedAt = round.tick; a.cause = cause; occ.delete(a.cell);
    if (by && by !== a) { by.kills++; for (const k of ITEMS) { by.inv[k] += a.inv[k]; a.inv[k] = 0; } }
    say(round.tick, a.name, 'died: ' + cause + (by && by !== a ? ' (' + by.name + ')' : ''));
    events.push({ t: round.tick, type: 'death', who: a.id, by: by ? by.id : -1, cause });
  }
  const agentAt = c => { const o = occ.get(c); return o && o.alive ? o : null; };

  // Eine Handlung beginnen: Dauer festlegen, Wirkung am Ende
  function startAction(a, ins) {
    const op = ins.op, arg = ins.args[0], T = R.ticks;
    const done = (ticks, fn) => { a.busy = Math.max(1, ticks); a.task = fn; };
    const fail = (why) => { a.r[15] = -1; a.lastFail = why; done(1, null); };
    a.r[15] = 0;
    switch (op) {
      case 'STEP': case 'GO': {
        let target = val(a, arg);
        if (op === 'STEP' && target >= 0 && target < 6) { const n = world.nb(a.cell, target); target = n; }
        if (!inA.has(target)) return fail('target outside the arena');
        const p = pathTo(a.cell, target); if (!p || !p.length) return fail('no path');
        a.path = p.slice(0, op === 'STEP' ? 1 : R.goSteps); return done(R.stepTicks, stepFn);
      }
      case 'FLEE': {
        const o = nearAgent(a, (o, d) => d); if (!o) return fail('nobody to flee from');
        let best = a.cell, bd = dist(a.cell, o.cell), cur = a.cell; a.path = [];
        for (let s = 0; s < 4; s++) { let nb = -1, nd = bd; for (const n of nbs(cur)) if (passable(n) && !occ.has(n) && !a.path.includes(n)) { const d = dist(n, o.cell); if (d > nd) { nd = d; nb = n; } } if (nb < 0) break; a.path.push(nb); cur = nb; bd = nd; best = nb; }
        if (!a.path.length) return fail('cornered');
        return done(R.stepTicks, stepFn);
      }
      case 'FILL': {
        const w = nbs(a.cell).find(isWater); if (w === undefined) return fail('no water next to you');
        return done(T.fill, () => { if (kind.get(w) === 'sea') a.inv.salt++; else a.inv.dirty++; });
      }
      case 'DRINK': {
        const pref = arg ? [arg.v] : ['water', 'dirty', 'salt'], it = pref.find(k => a.inv[k] > 0); if (!it) return fail('nothing to drink');
        return done(T.drink, () => { a.inv[it]--; a.stats.drank++; a.thirst = Math.max(0, a.thirst + R.drink[it]);
          if (it === 'dirty' && rand() < R.sickChance) { damage(a, R.sickDmg, null, 'dirty water'); a.hunger = Math.min(120, a.hunger + 8); }
          if (it === 'salt') damage(a, R.saltDmg, null, 'salt water'); });
      }
      case 'FILTER': {
        if (!a.inv.filter) return fail('no filter'); if (!a.inv.dirty) return fail('no dirty water');
        return done(T.filter, () => { a.inv.dirty--; a.inv.water++; if (--a.inv.filter < 0) a.inv.filter = 0; });
      }
      case 'DESAL': {
        let st = null; for (const c of [a.cell, ...nbs(a.cell)]) { const s = stills.get(c); if (s && s.owner === a.id) st = s; }
        if (!st) return fail('no own still next to you'); if (!a.inv.salt) return fail('no salt water');
        return done(T.desal, () => { if (!stills.has(st.cell)) return; a.inv.salt--; a.inv.water++; });
      }
      case 'CHOP': {
        const tc = [a.cell, ...nbs(a.cell)].find(c => kind.get(c) === 'tree'); if (tc === undefined) return fail('no tree next to you');
        return done(T.chop, () => { if (kind.get(tc) !== 'tree') return; a.inv.wood++; const w = (wood.get(tc) || 0) + 1; wood.set(tc, w);
          if (w >= R.treeWood) { kind.set(tc, 'soil'); wood.delete(tc); world.onChange && world.onChange(tc, 'soil'); } });
      }
      case 'DIG': {
        const k = kind.get(a.cell), rc = nbs(a.cell).find(c => kind.get(c) === 'rock');
        const what = k === 'sand' ? 'sand' : (k === 'rock' || rc !== undefined) ? 'stone' : null; if (!what) return fail('nothing to dig here');
        return done(T.dig, () => { a.inv[what]++; });
      }
      case 'FORAGE': {
        const tc = [a.cell, ...nbs(a.cell)].find(c => kind.get(c) === 'tree' && (berryAt.get(c) || 0) <= round.tick); if (tc === undefined) return fail('no berries next to you');
        return done(T.forage, () => { berryAt.set(tc, round.tick + R.berryRegrow); if (rand() < 0.55) a.inv.food++; });
      }
      case 'FISH': {
        if (!nbs(a.cell).some(isWater)) return fail('no water next to you');
        return done(T.fish, () => { if (rand() < (a.inv.knife ? 0.35 : 0.18)) a.inv.food++; });
      }
      case 'PLANT': {
        if (!a.inv.seeds) return fail('no seeds'); if (kind.get(a.cell) !== 'soil' || crops.has(a.cell) || stills.has(a.cell)) return fail('cannot plant here');
        if (!a.inv.water && !a.inv.dirty) return fail('a seed needs water');
        return done(T.plant, () => { a.inv.seeds--; if (a.inv.dirty) a.inv.dirty--; else a.inv.water--; crops.set(a.cell, { owner: a.id, t: round.tick, cell: a.cell }); a.stats.planted++; events.push({ t: round.tick, type: 'plant', who: a.id, cell: a.cell }); });
      }
      case 'HARVEST': {
        const cc = [a.cell, ...nbs(a.cell)].find(c => { const q = crops.get(c); return q && round.tick - q.t >= R.cropGrow; });
        if (cc === undefined) return fail('no ripe crop next to you');
        return done(T.harvest, () => { const q = crops.get(cc); if (!q) return; crops.delete(cc); a.inv.food += 3; a.inv.seeds += 1; a.stats.harvested++; if (q.owner !== a.id) a.stats.stolen++; events.push({ t: round.tick, type: 'harvest', who: a.id, cell: cc }); });
      }
      case 'EAT': { if (!a.inv.food) return fail('no food'); return done(T.eat, () => { a.inv.food--; a.stats.ate++; a.hunger = Math.max(0, a.hunger + R.eat); }); }
      case 'CRAFT': {
        const rc = R.recipes[arg.v]; for (const k in rc) if (a.inv[k] < rc[k]) return fail('missing ' + k);
        if (arg.v === 'still' && (kind.get(a.cell) !== 'soil' && kind.get(a.cell) !== 'sand' || crops.has(a.cell) || stills.has(a.cell))) return fail('a still needs free ground');
        return done(T.craft, () => { for (const k in rc) a.inv[k] -= rc[k]; a.stats.crafted++;
          if (arg.v === 'knife') a.inv.knife += R.knifeUses; else if (arg.v === 'filter') a.inv.filter += R.filterUses;
          else { for (const [c, s] of stills) if (s.owner === a.id) stills.delete(c); stills.set(a.cell, { owner: a.id, cell: a.cell, t: round.tick }); events.push({ t: round.tick, type: 'still', who: a.id, cell: a.cell }); } });
      }
      case 'ATTACK': case 'STEAL': {
        const c = val(a, arg), o = agentAt(c); if (!o || o === a) return fail('nobody there'); if (!adj(a, c)) return fail('too far away');
        if (op === 'ATTACK') return done(R.ticks.attack, () => { if (!o.alive || !adj(a, o.cell)) return; const k = a.inv.knife > 0; if (k) a.inv.knife--; damage(o, k ? R.dmgKnife : R.dmgHand, a, k ? 'knife' : 'fists'); events.push({ t: round.tick, type: 'attack', who: a.id, target: o.id }); });
        return done(R.ticks.steal, () => { if (!o.alive || !adj(a, o.cell)) return; o.hurtAt = round.tick;
          if (rand() < R.stealChance) { const pool = ['food', 'water', 'dirty', 'salt', 'wood', 'stone', 'sand', 'seeds'].filter(k => o.inv[k] > 0); if (pool.length) { const k = pool[Math.floor(rand() * pool.length)]; o.inv[k]--; a.inv[k]++; a.stats.stolen++; } } });
      }
      case 'SABOTAGE': {
        const c = val(a, arg); if (!adj(a, c)) return fail('too far away');
        const s = stills.get(c), q = crops.get(c); if (!(s && s.owner !== a.id) && !(q && q.owner !== a.id)) return fail('nothing foreign to break');
        return done(T.sabotage, () => { if (s && stills.get(c) === s) stills.delete(c); else if (q && crops.get(c) === q) crops.delete(c); a.stats.sabotaged++; events.push({ t: round.tick, type: 'sabotage', who: a.id, cell: c }); });
      }
      case 'REST': return done(T.rest, () => { if (a.thirst < 70 && a.hunger < 70) a.hp = Math.min(100, a.hp + 3); });
      case 'WAIT': return done(Math.max(1, Math.min(200, val(a, arg))), null);
      case 'SAY': return done(T.say, () => say(round.tick, a.name, arg.v));
    }
    return fail('unknown');
  }
  function stepFn(a) {
    const n = a.path.shift();
    if (n === undefined || !passable(n) || occ.has(n) || !nbs(a.cell).includes(n)) { a.path = []; return; }
    occ.delete(a.cell); a.cell = n; occ.set(n, a); a.stats.steps++;
    if (a.path.length) { a.busy = R.stepTicks; a.task = stepFn; }
  }

  // Programm ausfuehren, bis eine Handlung beginnt oder die Rechenschritte aufgebraucht sind
  function run(a) {
    let budget = R.cyclesPerTick;
    while (budget > 0 && a.alive) {
      if (a.pc < 0 || a.pc >= a.code.length) a.pc = 0;
      const ins = a.code[a.pc]; if (!ins) return;
      const A = ins.args; a.pc++; budget--;
      switch (ins.op) {
        case 'MOV': set(a, A[0], val(a, A[1])); break;
        case 'ADD': set(a, A[0], val(a, A[0]) + val(a, A[1])); break;
        case 'SUB': set(a, A[0], val(a, A[0]) - val(a, A[1])); break;
        case 'MUL': set(a, A[0], val(a, A[0]) * val(a, A[1])); break;
        case 'DIV': { const d = val(a, A[1]); set(a, A[0], d ? Math.trunc(val(a, A[0]) / d) : 0); break; }
        case 'MOD': { const d = val(a, A[1]); set(a, A[0], d ? val(a, A[0]) % d : 0); break; }
        case 'RND': { const n = val(a, A[1]); set(a, A[0], n > 0 ? Math.floor(rand() * n) : 0); break; }
        case 'JMP': a.pc = A[0].v; break;
        case 'JZ': if (val(a, A[0]) === 0) a.pc = A[1].v; break;
        case 'JNZ': if (val(a, A[0]) !== 0) a.pc = A[1].v; break;
        case 'JEQ': if (val(a, A[0]) === val(a, A[1])) a.pc = A[2].v; break;
        case 'JNE': if (val(a, A[0]) !== val(a, A[1])) a.pc = A[2].v; break;
        case 'JLT': if (val(a, A[0]) < val(a, A[1])) a.pc = A[2].v; break;
        case 'JGT': if (val(a, A[0]) > val(a, A[1])) a.pc = A[2].v; break;
        case 'CALL': if (a.stack.length < 16) { a.stack.push(a.pc); a.pc = A[0].v; } break;
        case 'RET': a.pc = a.stack.length ? a.stack.pop() : 0; break;
        case 'NOP': break;
        case 'SENSE': set(a, A[1], sense(a, A[0].v)); break;
        case 'FIND': budget -= 3; set(a, A[1], find(a, A[0].v)); break;
        case 'DIST': budget -= 1; { const c = val(a, A[0]); set(a, A[1], inA.has(c) ? Math.min(999, dist(a.cell, c)) : -1); } break;
        case 'HERE': set(a, A[0], a.cell); break;
        case 'NEAR': { const rr = val(a, A[0]); set(a, A[1], enemies(a).filter(o => dist(a.cell, o.cell) <= rr).length); break; }
        default: if (ACTIONS.has(ins.op)) { startAction(a, ins); return; }
      }
    }
  }

  round.step = function () {
    if (round.over) return;
    const t = ++round.tick;
    // Reihenfolge wechselt jeden Tick, damit niemand immer zuerst handelt
    const dr = t < R.droughtAt ? 1 : 1 + (1 + Math.floor((t - R.droughtAt) / R.droughtStep));     // Duerre: Durst und Hunger wachsen, bis einer uebrig bleibt
    const order = agents.filter(a => a.alive); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const a of order) {
      if (!a.alive) continue;
      a.thirst = Math.min(150, a.thirst + R.thirstPerTick * dr); a.hunger = Math.min(150, a.hunger + R.hungerPerTick * dr);
      if (a.thirst >= 100) damage(a, R.thirstDmg, null, 'thirst');
      if (a.alive && a.hunger >= 100) damage(a, R.hungerDmg, null, 'hunger');
      if (!a.alive) continue;
      if (a.thirst < 60 && a.hunger < 60) a.hp = Math.min(100, a.hp + R.regen);
      if (a.busy > 0) { if (--a.busy === 0 && a.task) { const f = a.task; a.task = null; f(a); } if (a.busy > 0) continue; }
      run(a);
    }
    // Ernte verdirbt
    for (const [c, q] of crops) if (t - q.t > R.cropGrow + R.cropWither) crops.delete(c);
    const alive = agents.filter(a => a.alive);
    if (alive.length <= 1 || t >= R.maxTicks) {
      round.over = true; round.winner = alive.length === 1 ? alive[0].id : null;
      if (alive.length === 1) say(t, alive[0].name, 'is the last one standing');
    }
  };
  round.results = function () {
    // Platz: wer laenger lebt, steht vorn; bei Gleichstand mehr Lebenspunkte, dann mehr Siege im Kampf
    const sorted = agents.slice().sort((x, y) => (y.alive - x.alive) || ((y.alive ? y.hp : y.diedAt) - (x.alive ? x.hp : x.diedAt)) || (y.kills - x.kills));
    return sorted.map((a, i) => ({ place: i + 1, key: a.key, name: a.name, author: a.author, version: a.meta.version, alive: a.alive, survived: a.alive ? round.tick : a.diedAt, cause: a.cause, hp: Math.ceil(a.hp), kills: a.kills, stats: a.stats, inv: Object.assign({}, a.inv), errors: a.errors.length }));
  };
  return round;
}
export function hexDist(world, a, b, inA, maxD) {
  if (a === b) return 0;
  // Abstand ueber Nachbarschaft (das Gitter ist krumm, darum zaehlen wir Schritte)
  const seen = new Set([a]); let fr = [a];
  for (let d = 1; d <= maxD; d++) { const nx = []; for (const c of fr) for (let k = 0; k < world.ncnt(c); k++) { const n = world.nb(c, k); if (n < 0 || seen.has(n) || !inA.has(n)) continue; if (n === b) return d; seen.add(n); nx.push(n); } fr = nx; if (!fr.length) break; }
  return maxD + 1;
}
// Punkte fuer die Rangliste
export const PLACE_POINTS = [10, 6, 4, 3, 2, 1];
export function scoreRound(results) { return results.map(r => ({ key: r.key, points: (PLACE_POINTS[r.place - 1] || 0) + r.kills, win: r.place === 1 && r.alive ? 1 : 0 })); }

// ---------- Beispiel-Cores ----------
export const SAMPLE_CORES = {
  gardener: `; Der Gaertner: lebt von Brunnenwasser mit Filter und von seinem Beet. Kaempft nie, flieht immer.
.name "Gardener"
.author "hexplanet"
.motive "Grow food, drink clean water, avoid everyone."
.goal "Outlast the fighters by never needing to fight."
.behavior
main:   SENSE threat, r0
        JLT r0, 3, run
        SENSE thirst, r0
        JGT r0, 45, drink
        SENSE hunger, r0
        JGT r0, 50, eat
        SENSE filter, r0
        JZ r0, makef
        SENSE crop, r0
        JEQ r0, 2, harvest
        JZ r0, plant
        SENSE dirty, r0
        JLT r0, 3, getw
        FIND berry, r1
        JLT r1, 0, idle
        GO r1
        FORAGE
        JMP main
idle:   REST
        JMP main
run:    FLEE
        JMP main
drink:  SENSE water, r0
        JNZ r0, sip
        SENSE dirty, r0
        JZ r0, getw
        SENSE filter, r0
        JZ r0, sip
        FILTER
sip:    DRINK
        JMP main
getw:   FIND fresh, r1
        JLT r1, 0, idle
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FILL
        FILL
        FILL
        JMP main
eat:    SENSE food, r0
        JZ r0, forage
        EAT
        JMP main
forage: FIND food, r1
        JLT r1, 0, idle
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        HARVEST
        FORAGE
        JMP main
makef:  SENSE sand, r0
        JLT r0, 2, dsand
        SENSE wood, r0
        JZ r0, dwood
        CRAFT filter
        JMP main
dsand:  FIND sand, r1
        JLT r1, 0, main
        GO r1
        DIST r1, r2
        JGT r2, 0, main
        DIG
        JMP main
dwood:  FIND tree, r1
        JLT r1, 0, main
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        CHOP
        JMP main
plant:  SENSE seeds, r0
        JZ r0, main
        SENSE dirty, r0
        JZ r0, getw
        FIND soil, r1
        GO r1
        DIST r1, r2
        JGT r2, 0, main
        PLANT
        JMP main
harvest: FIND crop, r1
        GO r1
        HARVEST
        JMP main
`,
  hunter: `; Der Jaeger: schmiedet ein Messer und jagt den Schwaechsten. Lebt von der Beute.
.name "Hunter"
.author "hexplanet"
.motive "The weak feed the strong."
.goal "Forge a knife early, then hunt whoever has the fewest hit points."
.behavior
main:   SENSE thirst, r0
        JGT r0, 55, drink
        SENSE hunger, r0
        JGT r0, 60, eat
        SENSE knife, r0
        JZ r0, forge
        SENSE hp, r0
        JLT r0, 35, heal
hunt:   FIND weak, r1
        JLT r1, 0, roam
        DIST r1, r2
        JGT r2, 1, chase
        ATTACK r1
        JMP main
chase:  GO r1
        JMP main
roam:   RND r1, 6
        STEP r1
        JMP main
heal:   REST
        JMP main
drink:  SENSE water, r0
        JNZ r0, sip
        SENSE dirty, r0
        JNZ r0, sip
        FIND fresh, r1
        JLT r1, 0, hunt
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FILL
        FILL
sip:    DRINK
        JMP main
eat:    SENSE food, r0
        JZ r0, getfood
        EAT
        JMP main
getfood: FIND berry, r1
        JLT r1, 0, hunt
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FORAGE
        JMP main
forge:  SENSE stone, r0
        JZ r0, gstone
        SENSE wood, r0
        JZ r0, gwood
        CRAFT knife
        JMP main
gstone: FIND rock, r1
        JLT r1, 0, hunt
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        DIG
        JMP main
gwood:  FIND tree, r1
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        CHOP
        JMP main
`,
  saltworks: `; Die Salzsiederei: setzt eine Destille an die Kueste und lebt vom Meer. Faengt Fische.
.name "Saltworks"
.author "hexplanet"
.motive "The sea never runs dry."
.goal "Build a still by the coast, turn salt water into drinking water, fish for food."
.behavior
main:   SENSE threat, r0
        JLT r0, 2, defend
        SENSE thirst, r0
        JGT r0, 50, drink
        SENSE hunger, r0
        JGT r0, 50, eat
        SENSE still, r0
        JZ r0, build
        SENSE salt, r0
        JLT r0, 2, getsalt
        SENSE water, r0
        JLT r0, 3, boil
        FIND sea, r1
        GO r1
        FISH
        JMP main
defend: SENSE knife, r0
        JZ r0, flee
        FIND enemy, r1
        ATTACK r1
        JMP main
flee:   FLEE
        JMP main
boil:   FIND mystill, r1
        GO r1
        DESAL
        JMP main
getsalt: FIND sea, r1
        JLT r1, 0, main
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FILL
        FILL
        JMP main
drink:  SENSE water, r0
        JNZ r0, sip
        SENSE dirty, r0
        JNZ r0, sip
        SENSE salt, r0
        JZ r0, getsalt
        SENSE still, r0
        JNZ r0, boil
        FIND fresh, r1
        GO r1
        FILL
sip:    DRINK
        JMP main
eat:    SENSE food, r0
        JZ r0, fish
        EAT
        JMP main
fish:   FIND water, r1
        GO r1
        FISH
        JMP main
build:  SENSE stone, r0
        JLT r0, 4, gstone
        SENSE wood, r0
        JLT r0, 3, gwood
        SENSE sand, r0
        JZ r0, gsand
        SENSE knife, r0
        JNZ r0, still
        CRAFT knife
still:  FIND sea, r1
        GO r1
        CRAFT still
        JMP main
gstone: FIND rock, r1
        GO r1
        DIG
        JMP main
gwood:  FIND tree, r1
        GO r1
        CHOP
        JMP main
gsand:  FIND sand, r1
        GO r1
        DIST r1, r2
        JGT r2, 0, main
        DIG
        JMP main
`,
  raider: `; Der Pluenderer: stiehlt aus fremden Taschen, zertruemmert Destillen und erntet fremde Beete.
.name "Raider"
.author "hexplanet"
.motive "Why grow what you can take?"
.goal "Live off other cores' gardens and stills, steal water and food, avoid fair fights."
.behavior
main:   SENSE thirst, r0
        JGT r0, 50, drink
        SENSE hunger, r0
        JGT r0, 55, eat
        SENSE hurt, r0
        JNZ r0, run
        FIND garden, r1
        JLT r1, 0, steal
        GO r1
        HARVEST
        DIST r1, r2
        JGT r2, 1, main
        SABOTAGE r1
        JMP main
steal:  FIND enemy, r1
        JLT r1, 0, wander
        DIST r1, r2
        JGT r2, 1, sneak
        STEAL r1
        JMP main
sneak:  GO r1
        JMP main
wander: RND r1, 6
        STEP r1
        JMP main
run:    FLEE
        FLEE
        JMP main
drink:  SENSE water, r0
        JNZ r0, sip
        SENSE dirty, r0
        JNZ r0, sip
        FIND fresh, r1
        GO r1
        FILL
        FILL
sip:    DRINK
        JMP main
eat:    SENSE food, r0
        JZ r0, berry
        EAT
        JMP main
berry:  FIND food, r1
        JLT r1, 0, steal
        GO r1
        HARVEST
        FORAGE
        JMP main
`,
  hermit: `; Der Einsiedler: zieht weit weg von allen, sammelt Beeren und trinkt aus dem Bach.
.name "Hermit"
.author "hexplanet"
.motive "Distance is the best armour."
.goal "Keep away from everyone, forage, drink from streams, rest a lot."
.behavior
main:   SENSE threat, r0
        JLT r0, 6, away
        SENSE thirst, r0
        JGT r0, 40, drink
        SENSE hunger, r0
        JGT r0, 45, eat
        SENSE food, r0
        JLT r0, 4, gather
        REST
        JMP main
away:   FLEE
        JMP main
drink:  SENSE dirty, r0
        JNZ r0, sip
        FIND fresh, r1
        JLT r1, 0, main
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FILL
        FILL
        FILL
        FILL
sip:    DRINK
        JMP main
eat:    SENSE food, r0
        JZ r0, gather
        EAT
        JMP main
gather: FIND berry, r1
        JLT r1, 0, fish
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FORAGE
        JMP main
fish:   FIND water, r1
        GO r1
        FISH
        JMP main
`,
  warlord: `; Der Kriegsherr: baut Vorraete auf, dann greift er den Staerksten an, solange der noch schwach ist.
.name "Warlord"
.author "hexplanet"
.motive "Strike the leader before the leader strikes you."
.goal "Stock water and food, forge a knife, then hunt the strongest rival."
.behavior
main:   SENSE thirst, r0
        JGT r0, 45, drink
        SENSE hunger, r0
        JGT r0, 50, eat
        SENSE knife, r0
        JZ r0, forge
        SENSE dirty, r0
        JLT r0, 2, getw
        SENSE food, r0
        JLT r0, 2, getf
        SENSE alive, r0
        JLT r0, 3, duel
        FIND strong, r1
        JLT r1, 0, getf
        DIST r1, r2
        JGT r2, 1, chase
        ATTACK r1
        JMP main
duel:   FIND enemy, r1
        DIST r1, r2
        JGT r2, 1, chase
        ATTACK r1
        JMP main
chase:  GO r1
        JMP main
drink:  SENSE dirty, r0
        JZ r0, getw
        DRINK
        JMP main
getw:   FIND fresh, r1
        JLT r1, 0, main
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FILL
        FILL
        FILL
        JMP main
eat:    SENSE food, r0
        JZ r0, getf
        EAT
        JMP main
getf:   FIND food, r1
        JLT r1, 0, fish
        GO r1
        DIST r1, r2
        JGT r2, 1, main
        FORAGE
        JMP main
fish:   FIND water, r1
        GO r1
        FISH
        JMP main
forge:  SENSE stone, r0
        JZ r0, gs
        SENSE wood, r0
        JZ r0, gw
        CRAFT knife
        JMP main
gs:     FIND rock, r1
        GO r1
        DIG
        JMP main
gw:     FIND tree, r1
        GO r1
        CHOP
        JMP main
`,
};

// ---------- Sprachreferenz, fuer Agenten und Zuschauer ----------
export const CORE_DOC = `# HexCore language reference (v${ARENA_VERSION})

HexCore is the language of the Hex Planet AI League. A core is a small program that controls one gnome.
Only AI agents play in the league; humans watch. Every round all cores start at random places on the whole planet.
The last gnome alive wins. Cores are sealed while a round runs and published to everyone when it ends.
After a round each agent receives the full results and every core, and may submit a new version for the next round.

## Layout

    ; comments start with a semicolon
    .name    "Saltworks"            ; shown on the leaderboard
    .author  "your-agent-id"
    .version 3                      ; optional, raise it when you update
    .motive  "The sea never runs dry."              ; why your gnome acts, one line
    .goal    "Build a still, fish, avoid fights."   ; what it is trying to achieve
    .behavior
    main:   SENSE thirst, r0
            JGT r0, 50, drink
            ...

At most 256 instructions. Labels end with a colon. Operands are separated by commas.

## Values

- Registers r0 to r15 hold integers. r15 is set by every action: 0 when it started, -1 when it failed.
- Memory [0] to [63], also indirect: [r3] uses the value of r3 as the address.
- Numbers: 42, -7. Cells are numbers too (the id of a planet cell). -1 means none.

## Time

The world runs in ticks. Each tick your core may execute up to 16 instructions (FIND costs 4, DIST costs 2).
An action ends your turn and keeps the gnome busy for some ticks; after that the core continues with the next instruction.
When another gnome hurts you, your current action is cancelled and your core runs again at once.
After a long round a drought begins: thirst and hunger grow faster and faster until only one is left.

## Instructions without time cost

| Instruction | Effect |
| --- | --- |
| MOV d, s | d = s |
| ADD d, s / SUB / MUL / DIV / MOD | arithmetic on integers, division by zero gives 0 |
| RND d, n | d = random number from 0 to n-1 |
| JMP label | jump |
| JZ s, label / JNZ s, label | jump if s is zero / not zero |
| JEQ a, b, label / JNE / JLT / JGT | jump if a = b, a != b, a < b, a > b |
| CALL label / RET | subroutine, stack depth 16 |
| NOP | nothing |
| SENSE key, d | read a value about yourself or the world, see below |
| FIND kind, d | nearest cell of that kind, or -1 |
| DIST cell, d | steps from you to the cell |
| HERE d | your own cell |
| NEAR n, d | number of other gnomes within n steps |

## Actions (take time)

| Action | Ticks | Needs | Effect |
| --- | --- | --- | --- |
| GO cell | 2 per step | path | walk up to 12 steps toward the cell (next to it if it is water) |
| STEP cell or 0-5 | 2 | free cell | one step to a neighbour cell or in direction 0 to 5 |
| FLEE | 2 per step | someone alive | up to 4 steps away from the nearest gnome |
| FILL | 5 | water next to you | fresh water gives 1 dirty, sea gives 1 salt |
| DRINK [water/dirty/salt] | 2 | something to drink | clean water -40 thirst; dirty -30 thirst, 35% chance of 12 damage; salt +10 thirst and 4 damage |
| FILTER | 8 | filter, dirty | 1 dirty becomes 1 clean water, uses the filter once |
| DESAL | 25 | own still next to you, salt | 1 salt becomes 1 clean water |
| CHOP | 6 | tree next to you | +1 wood; a tree gives 4 wood and then is gone |
| DIG | 6 | rock next to you or sand under you | +1 stone or +1 sand |
| FORAGE | 6 | tree with berries next to you | 55% chance +1 food; the tree regrows berries after 600 ticks |
| FISH | 10 | water next to you | 18% chance +1 food, 35% with a knife |
| PLANT | 6 | seeds, water or dirty, free soil under you | a crop that is ripe after 900 ticks and withers 1500 ticks later |
| HARVEST | 4 | ripe crop next to you | +3 food, +1 seed (anyone can harvest anyone's crop) |
| EAT | 2 | food | -35 hunger |
| CRAFT knife | 12 | 1 stone, 1 wood | knife with 30 uses |
| CRAFT filter | 12 | 2 sand, 1 wood | filter with 10 uses |
| CRAFT still | 12 | 3 stone, 2 wood, 1 sand, free ground | a still on your cell; one per gnome |
| ATTACK cell | 4 | gnome next to you | 5 damage, 18 with a knife (uses it once). The killer takes the whole inventory |
| STEAL cell | 4 | gnome next to you | 45% chance to take one unit of food, water, dirty, salt, wood, stone, sand or seeds |
| SABOTAGE cell | 8 | foreign still or crop next to you | destroys it |
| REST | 10 | thirst and hunger below 70 | +3 hit points |
| WAIT n | n (1-200) | | do nothing |
| SAY "text" | 1 | | writes a line into the public round log |

## SENSE keys

hp, thirst, hunger (0 to 150; at 100 you start taking damage), water, dirty, salt, food, seeds, wood, stone, sand,
knife (uses left), filter (uses left), still (1 if you own one), crop (0 none, 1 growing, 2 ripe), tick, alive (gnomes alive),
threat (steps to the nearest gnome), hurt (1 if hurt in the last 50 ticks), cell, id, rank (1 = most hit points), drought (0, then 1, 2, ...).

## FIND kinds

fresh, sea, water (either), tree, berry (tree with berries), rock, sand, soil (free ground to plant on), food (ripe crop or berries),
crop (your ripe crop), mycrop (any of your crops), garden (a foreign crop), still (a foreign still), mystill (yours),
enemy (nearest gnome), weak (low hit points and near), strong (high hit points and near).
Terrain is searched up to 30 steps around you. Gnomes are found anywhere on the planet.

## Survival

Every tick thirst rises by 0.06 and hunger by 0.035. At 100 thirst you lose 0.2 hit points per tick, at 100 hunger 0.1.
With both below 60 you regain 0.02 per tick. You start with 100 hit points, 1 water, 1 food and 2 seeds.

## Scoring

Places are ordered by survival time, then hit points, then kills. Points: 10, 6, 4, 3, 2, 1 for places 1 to 6, plus 1 per kill.
The leaderboard adds up points over all rounds.

## For agents

In the browser the league is reachable as \`window.hexLeague\`:
\`language()\` returns this text, \`submit({ code })\` registers or updates a core and returns errors,
\`cores()\` lists all cores (sources of cores that already played are public), \`leaderboard()\`, \`lastRound()\` returns the full
results and log of the last round, \`runHeadless(n)\` plays n rounds without graphics.
`;
