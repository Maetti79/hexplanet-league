// Agent-based tokenomics simulation for Hex Planet.
// Tokens circulate in a closed loop: players -> traders (75 %) and the wanderer pot (25 %) -> players.
// New tokens enter only as the 100-token welcome. Euro revenue comes from fees, not from token sales.
export const RULES = {
  welcome: 100, trip: 240,                                   // seconds for a round trip to the trader
  chop: { s: 10, wood: 2 }, bare: { s: 30, wood: 1 }, dig: { s: 12, stone: 1 },
  tools: { axe: { uses: 30, price: 6 }, shovel: { uses: 50, price: 10 }, beton: { uses: 10, price: 30 } },
  sell: { wood: 0.25, stone: 0.6 },
  field: 60,
  tierPlan: [0, 40, 80, 160, 400, 900, 2000],
  tierNeed: [null, { wood: 4 }, { wood: 8 }, { wood: 16 }, { stone: 20 }, { stone: 12, beton: 10 }, { stone: 30, beton: 20 }],
  bplan: { timber: { price: 150, tier: 2 }, stone: { price: 500, tier: 4 }, concrete: { price: 1200, tier: 5 } },
  floor: { timber: { wood: 4 }, stone: { stone: 5 }, concrete: { beton: 2 } },
  floorsWanted: { timber: 6, stone: 8, concrete: 10 },
  potShare: 0.25, boxMax: 200, boxShare: 0.6, hourS: 750,
  traderTargetPerPlayer: 60, priceMin: 0.05, priceMax: 1.25,
  upkeepPerTierDay: 0, injectPerEur: 0,      // variant: tokens the treasury releases into trader cash per euro of revenue                                        // variant: tokens per tier and day paid to the trader
  eur: { mint: 15, protect: 8, tierFee: [0, 2, 4, 6, 12, 25, 50], cosmetic: 3, cosmeticPerYear: 3 * 0.4, marketFee: 0.05 },
  types: {
    casual:  { share: 0.50, hours: 0.5, playP: 0.70, churn: 0.012, protectP: 0.35, budget: 0 },
    regular: { share: 0.33, hours: 1.5, playP: 0.85, churn: 0.005, protectP: 0.80, budget: 0 },
    heavy:   { share: 0.13, hours: 3.5, playP: 0.95, churn: 0.002, protectP: 0.95, budget: 0 },
    whale:   { share: 0.04, hours: 2.0, playP: 0.90, churn: 0.004, protectP: 1.00, budget: 50 }   // euro per month for tokens
  }
};
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function simulate(cap, days, seed = 1, over = {}) {
  const R = Object.assign({}, RULES, over), rnd = rng(seed);
  const types = Object.keys(R.types);
  const players = [];
  let trader = 0, pot = 0, eur = { mint: 0, protect: 0, tiers: 0, cosmetic: 0, market: 0 }, marketVol = 0, injected = 0;
  let treasury = 0;
  const addEur = (k, v) => { eur[k] += v; if (R.stabilize) treasury += v * R.injectPerEur; else { const t = v * R.injectPerEur; trader += t; injected += t; } };
  const series = [];
  function join(day) {
    let r = rnd(), type = types[types.length - 1]; for (const t of types) { if (r < R.types[t].share) { type = t; break; } r -= R.types[t].share; }
    const p = { type, T: R.types[type], tok: R.welcome, wood: 0, stone: 0, beton: 0, axe: 10, shovel: 50, field: false, tier: 0, plans: {}, floors: { timber: 0, stone: 0, concrete: 0 },
      active: true, payer: !R.payerSplit || rnd() < R.types[type].protectP, joined: day, lastProtect: -99, reached: {}, boat: false, eurSpent: 0, monthBudget: 0 };
    players.push(p); addEur('mint', R.eur.mint); return p;
  }
  const activeCount = () => players.reduce((a, p) => a + (p.active ? 1 : 0), 0);
  const target = () => R.traderTargetPerPlayer * Math.max(1, activeCount());
  const priceF = () => Math.min(R.priceMax, Math.max(R.priceMin, trader / target()));
  // next thing a player works toward: tokens and materials
  function goal(p) {
    if (!p.field) return { key: 'field', tok: R.field };
    const n = p.tier + 1;
    const bp = Object.entries(R.bplan).find(([k, b]) => !p.plans['b_' + k] && p.tier >= b.tier);
    if (bp) return { key: 'b_' + bp[0], tok: bp[1].price };
    for (const k of ['timber', 'stone', 'concrete']) if (p.plans['b_' + k] && p.floors[k] < R.floorsWanted[k]) return { key: 'f_' + k, tok: 0, need: R.floor[k] };
    if (!p.payer) return p.boat ? null : { key: 'boat', tok: R.boat || 120 };   // non-paying players stay in their tent and work
    if (n <= 6) { if (!p.plans['t' + n]) return { key: 't' + n, tok: R.tierPlan[n] }; return { key: 'up', tok: 0, need: R.tierNeed[n] }; }
    if (!p.boat) return { key: 'boat', tok: R.boat || 120 };
    return null;
  }
  function trip(p) {         // sell surplus, buy tools and the goal
    const g = goal(p), keep = Object.assign({ wood: 0, stone: 0 }, g && g.need ? g.need : {});
    const f = priceF();
    for (const m of ['wood', 'stone']) {
      const surplus = Math.max(0, p[m] - (keep[m] || 0)); if (!surplus) continue;
      const want = surplus * R.sell[m] * f, pay = Math.min(want, trader);
      p.tok += pay; trader -= pay; p[m] -= pay >= want ? surplus : Math.floor(surplus * pay / want);
    }
    const spend = (x) => { p.tok -= x; trader += x * (1 - R.potShare); pot += x * R.potShare; };
    if (g && g.tok && p.tok >= g.tok) {
      spend(g.tok);
      if (g.key === 'field') p.field = true; else if (g.key === 'boat') p.boat = true; else p.plans[g.key] = true;
    }
    const needB = g && g.need && g.need.beton ? g.need.beton : 0;
    while (p.beton < needB && p.tok >= R.tools.beton.price) { spend(R.tools.beton.price); p.beton += R.tools.beton.uses; }
    if (p.axe < 3 && p.tok >= R.tools.axe.price) { spend(R.tools.axe.price); p.axe += R.tools.axe.uses; }
    if (p.shovel < 3 && p.tok >= R.tools.shovel.price) { spend(R.tools.shovel.price); p.shovel += R.tools.shovel.uses; }
  }
  function session(p, T, day) {
    let t = 0, carried = 0, guard = 0;
    while (t < T && guard++ < 5000) {
      const g = goal(p);
      if (!g && !R.endgameEarns && p.payer) break;     // finished players spend their time building and decorating, which earns nothing
      if (!g && t > T * 0.4) break;
      const need = g && g.need ? g.need : {};
      // finish a build step if materials are there
      if (g && g.need && Object.keys(need).every(m => p[m] >= need[m])) {
        for (const m of Object.keys(need)) p[m] -= need[m];
        if (g.key === 'up') { p.tier++; p.reached['t' + p.tier] = day; addEur('tiers', R.eur.tierFee[p.tier]); }
        else p.floors[g.key.slice(2)]++;
        t += 30; continue;
      }
      if (need.beton && p.beton < need.beton) { // concrete comes from the trader
        if (p.tok >= R.tools.beton.price) { t += R.trip; trip(p); carried = 0; continue; }
      } else if (need.wood && p.wood < need.wood) { gather(p, 'wood'); t += lastS; continue; }
      else if (need.stone && p.stone < need.stone) {
        if (p.shovel > 0) { gather(p, 'stone'); t += lastS; continue; }
        if (p.tok >= R.tools.shovel.price) { t += R.trip; trip(p); continue; }
      }
      // earn tokens: gather the better-paying good, then go to the trader
      const tokNeed = (g ? g.tok : 0) + (need.beton ? R.tools.beton.price : 0) + (p.axe < 3 ? R.tools.axe.price : 0);
      const f = priceF();
      const value = (p.wood * R.sell.wood + p.stone * R.sell.stone) * f;
      if ((p.tok + value >= tokNeed && p.tok < tokNeed) || carried >= 150 || (tokNeed <= p.tok && g && g.tok)) { t += R.trip; trip(p); carried = 0; continue; }
      const sW = (R.chop.wood * R.sell.wood * f - (p.axe > 0 ? R.tools.axe.price / R.tools.axe.uses : 0)) / (p.axe > 0 ? R.chop.s : R.bare.s * 2);
      const sS = p.shovel > 0 ? (R.sell.stone * f - R.tools.shovel.price / R.tools.shovel.uses) / R.dig.s : -1;
      const m = sS > sW ? 'stone' : 'wood';
      gather(p, m); t += lastS; carried++;
    }
    p.played = (p.played || 0) + Math.min(t, T);
  }
  let lastS = 0;
  function gather(p, m) {
    if (m === 'wood') { if (p.axe > 0) { p.axe--; p.wood += R.chop.wood; lastS = R.chop.s; } else { p.wood += R.bare.wood; lastS = R.bare.s; } }
    else { p.shovel--; p.stone += R.dig.stone; lastS = R.dig.s; }
  }
  // launch: half the places on day one, the rest fill up over time
  for (let i = 0; i < Math.ceil(cap * 0.5); i++) join(0);
  trader = target();             // traders start with some cash from the treasury
  const startTrader = trader;
  for (let day = 0; day < days; day++) {
    // joins and churn
    const act = activeCount(); const free = cap - act;
    if (day > 0 && free > 0) { const n = Math.min(free, Math.max(1, Math.round(cap * 0.02))); for (let i = 0; i < n; i++) join(day); }
    let activeSec = 0;
    for (const p of players) {
      if (!p.active) continue;
      if (day > p.joined && rnd() < p.T.churn) { p.active = false; continue; }
      if (rnd() > p.T.playP) continue;
      const T = p.T.hours * 3600 * (0.6 + 0.8 * rnd());
      session(p, T, day); activeSec += T;
      if (p.field && p.payer && day - p.lastProtect >= 30) { addEur('protect', R.eur.protect); p.lastProtect = day; }
      if (rnd() < R.eur.cosmeticPerYear / 365 * 2) addEur('cosmetic', R.eur.cosmetic);
      if (R.upkeepPerTierDay && p.tier) { const u = Math.min(p.tok, R.upkeepPerTierDay * p.tier); p.tok -= u; trader += u; }
    }
    if (R.overflow && trader > R.overflow * target()) { pot += trader - R.overflow * target(); trader = R.overflow * target(); }
    if (R.stabilize) { const want = R.stabilize * target() - trader; if (want > 0) { const t = Math.min(treasury, want); trader += t; treasury -= t; injected += t; } }
    // wanderer: one box per game hour while someone is online and the pot is big enough
    const hoursOnline = Math.min(24 * 3600, activeSec) / R.hourS;
    const actives = players.filter(p => p.active && p.played);
    let boxes = Math.floor(hoursOnline); let boxPaid = 0;
    for (let b = 0; b < boxes && pot >= 5 && actives.length; b++) {
      const amt = Math.min(R.boxMax, Math.floor(pot * R.boxShare)); pot -= amt; boxPaid += amt;
      const w = actives[Math.floor(rnd() * actives.length)]; w.tok += amt;
    }
    // player market: whales buy tokens with euros from players holding more than they need
    let demandEur = 0; const buyers = [];
    for (const p of players) if (p.active && p.T.budget) { const g = goal(p); const short = g ? Math.max(0, g.tok + 100 - p.tok) : 0; if (short > 0) { const b = p.T.budget / 30; buyers.push([p, b, short]); demandEur += b; } }
    let offered = 0; const sellers = [];
    for (const p of players) if (p.active && !p.T.budget) { const g = goal(p); const keep = (g ? g.tok : 0) + 150; const s = Math.max(0, p.tok - keep) * (g ? 0.15 : 0.5); if (s > 1) { sellers.push([p, s]); offered += s; } }
    let mprice = 0;
    if (demandEur > 0 && offered > 0) {
      mprice = Math.min(0.05, Math.max(0.0005, demandEur / offered));
      const volT = Math.min(offered, demandEur / mprice), fr = volT / offered;
      for (const [p, s] of sellers) p.tok -= s * fr;
      const totShort = buyers.reduce((a, b) => a + b[2], 0);
      for (const [p] of buyers) p.tok += volT / buyers.length;
      const vEur = volT * mprice; marketVol += vEur; eur.market += vEur * R.eur.marketFee;
    }
    const sum = (f) => players.reduce((a, p) => a + f(p), 0);
    const tierOf = (ty) => { const a = players.filter(p => p.active && p.type === ty).map(p => p.tier).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    series.push({ day, injected, active: activeCount(), tokActive: sum(p => p.active ? p.tok : 0), tokGone: sum(p => p.active ? 0 : p.tok), trader, pot, priceF: priceF(), mprice, boxPaid,
      eurTotal: Object.values(eur).reduce((a, b) => a + b, 0), eur: Object.assign({}, eur),
      tier: { casual: tierOf('casual'), regular: tierOf('regular'), heavy: tierOf('heavy'), whale: tierOf('whale') } });
  }
  // time to reach tiers, median days after joining, among players who stayed long enough
  const reach = {};
  for (const ty of types) { reach[ty] = {}; for (let n = 1; n <= 6; n++) { const d = players.filter(p => p.type === ty && p.reached['t' + n] !== undefined).map(p => p.reached['t' + n] - p.joined).sort((a, b) => a - b); const base = players.filter(p => p.type === ty && (days - p.joined) > 60).length; reach[ty]['t' + n] = d.length ? { median: d[Math.floor(d.length / 2)], share: d.length / Math.max(1, players.filter(p => p.type === ty).length) } : null; } }
  return { series, reach, eur, marketVol, joined: players.length, startTrader, injected, supply: players.length * R.welcome + startTrader + injected };
}
