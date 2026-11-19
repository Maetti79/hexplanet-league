import { simulate } from './sim.mjs';
import fs from 'node:fs';
const out = {};
const FIX = { injectPerEur: 40, tierPlan: [0, 30, 60, 120, 200, 300, 450], bplan: { timber: { price: 100, tier: 2 }, stone: { price: 200, tier: 4 }, concrete: { price: 300, tier: 5 } }, boat: 100 };
const which = process.argv[2] || 'base';
const MID = { tierPlan: [0, 40, 80, 160, 300, 500, 800], bplan: { timber: { price: 120, tier: 2 }, stone: { price: 300, tier: 4 }, concrete: { price: 500, tier: 5 } }, boat: 100 };
const V = { real: Object.assign({}, MID, { injectPerEur: 5, stabilize: 0.8, upkeepPerTierDay: 1, payerSplit: true, overflow: 1.5 }), final: Object.assign({}, MID, { injectPerEur: 5, stabilize: 0.8, upkeepPerTierDay: 1 }), stab: Object.assign({}, MID, { injectPerEur: 10, stabilize: 0.8 }), stab5: Object.assign({}, MID, { injectPerEur: 5, stabilize: 0.8 }), mid: MID, base: {}, fix: FIX, price: Object.assign({}, FIX, { injectPerEur: 0 }), inject: { injectPerEur: 40 } };
for (const variant of [[which, V[which]]]) {
  for (const cap of (process.argv[3] ? [+process.argv[3]] : [20, 200, 500])) {
    const r = simulate(cap, 365, 7, variant[1]);
    const s = r.series, at = d => s[Math.min(d, s.length - 1)];
    const row = (d) => { const x = at(d); return `d${d}: active ${x.active} | tokens in play ${Math.round(x.tokActive)} | in quit wallets ${Math.round(x.tokGone)} | trader ${Math.round(x.trader)} | pot ${Math.round(x.pot)} | trader price ${x.priceF.toFixed(2)} | market ${x.mprice.toFixed(4)} €/T | box/day ${x.boxPaid} | tiers c/r/h/w ${x.tier.casual}/${x.tier.regular}/${x.tier.heavy}/${x.tier.whale}`; };
    console.log(`\n=== ${variant[0]} · cap ${cap} · joined over year ${r.joined}`);
    for (const d of [7, 30, 90, 180, 364]) console.log(row(d));
    const e = r.eur; console.log('€ year:', Object.entries(e).map(([k, v]) => k + ' ' + Math.round(v)).join(' | '), '| total', Math.round(Object.values(e).reduce((a, b) => a + b, 0)), '| market volume €', Math.round(r.marketVol));
    console.log('tokens created: welcome', r.joined * 100, '| treasury into traders', Math.round(r.startTrader + r.injected));
    console.log('days to tier (median):', Object.entries(r.reach).map(([ty, o]) => ty + ' ' + [1, 2, 3, 4, 5, 6].map(n => o['t' + n] ? o['t' + n].median : '-').join('/')).join('  '));
    out[variant[0] + '_' + cap] = r;
  }
}
fs.writeFileSync('results_' + which + '.json', JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { series: r.series.map(x => ({ d: x.day, a: x.active, ta: Math.round(x.tokActive), tg: Math.round(x.tokGone), tr: Math.round(x.trader), pot: Math.round(x.pot), pf: +x.priceF.toFixed(3), mp: x.mprice, eur: Math.round(x.eurTotal), e: x.eur, tier: x.tier })), reach: r.reach, eur: r.eur }]))));
