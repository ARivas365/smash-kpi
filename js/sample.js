// Genera ~10 semanas de datos de ejemplo (marcados con sample: true para poder borrarlos).
import { ymd } from './stats.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSample() {
  const r = rng(20261101);
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const normal = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // probabilidad base de ganar con Cloud y ajuste si uso Steve
  const MU = {
    'Pikachu': [0.40, +0.12], 'Steve': [0.50, 0], 'Sonic': [0.52, -0.05], 'Joker': [0.45, +0.02],
    'Palutena': [0.60, -0.08], 'Pyra/Mythra': [0.47, +0.05], 'Snake': [0.36, +0.15], 'Wolf': [0.62, -0.1],
    'Lucina': [0.58, -0.06], 'Mario': [0.60, -0.05], 'Kazuya': [0.52, +0.04], 'Min Min': [0.32, +0.18],
  };
  const rivals = [
    ['Tomi', 'Pikachu', 'Snake'], ['Facu', 'Sonic', 'Wolf'], ['Rulo', 'Joker', 'Palutena'],
    ['Nico', 'Pyra/Mythra', 'Lucina'], ['Mati', 'Steve', 'Mario'], ['Juanchi', 'Min Min', 'Kazuya'],
    ['Lauti', 'Palutena', 'Joker'], ['Gonza', 'Mario', 'Pikachu'],
  ];
  const starters = ['Battlefield', 'Hollow Bastion', 'Small Battlefield', 'Town & City', 'Pokémon Stadium 2'];
  const allStages = [...starters, 'Smashville', 'Final Destination', 'Kalos'];
  const notes = ['', '', '', '', 'Me castigaron el recovery bajo', 'Buen neutral con nair', 'Doble salto quemado, recovery predecible', 'Cargar limit en ledge funcionó', 'Me agarró mucho en escudo', 'Bien el edgeguard con bair'];

  const games = [];
  const now = new Date();
  for (let s = 0; s < 46; s++) {
    const daysAgo = Math.floor(r() * 70);
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(19 + Math.floor(r() * 4), Math.floor(r() * 60), 0, 0);
    const trend = (70 - daysAgo) / 70 * 0.1; // mejora con el tiempo
    const [rival, mainOpp, secOpp] = pick(rivals);
    const tr = r();
    const type = tr < 0.4 ? 'torneo' : tr < 0.75 ? 'casual' : 'practica';
    const bo = type === 'torneo' && r() < 0.3 ? 5 : 3;
    const need = Math.ceil(bo / 2);
    const setId = 'sample-' + s + '-' + Math.floor(r() * 1e9).toString(36);
    let w = 0, l = 0, num = 0;
    let oppChar = r() < 0.8 ? mainOpp : secOpp;
    while (w < need && l < need) {
      num++;
      const [base, steveMod] = MU[oppChar] || [0.5, 0];
      const myChar = (steveMod > 0.1 && r() < 0.55) || r() < 0.12 ? 'Steve' : 'Cloud';
      const p = clamp(base + trend + (myChar === 'Steve' ? steveMod : 0), 0.1, 0.9);
      const win = r() < p;
      const left = 1 + (r() < 0.5 ? 0 : r() < 0.7 ? 1 : 2);
      const myLeft = win ? left : 0, oppLeft = win ? 0 : left;
      const kills = 3 - oppLeft, deaths = 3 - myLeft;
      const killMu = myChar === 'Cloud' ? 112 : 124;
      const recChance = myChar === 'Cloud' ? 0.3 : 0.15;
      let recovery = 0;
      for (let i = 0; i < deaths; i++) if (r() < recChance) recovery++;
      const g = {
        id: setId + '-g' + num, setId, gameNum: num, sample: true,
        date: ymd(day), ts: day.getTime() + num * 7 * 60000,
        type, rival, myChar, oppChar,
        stage: num === 1 ? pick(starters) : pick(allStages),
        result: win ? 'W' : 'L', stocks: 3, myStocksLeft: myLeft, oppStocksLeft: oppLeft,
        myOpenings: Math.max(1, Math.round(normal(win ? 10 : 7, 2.2))),
        oppOpenings: Math.max(1, Math.round(normal(win ? 7 : 10, 2.2))),
        killPercents: Array.from({ length: kills }, () => Math.round(clamp(normal(killMu, 24), 45, 190))),
        deathPercents: Array.from({ length: deaths }, () => Math.round(clamp(normal(win ? 125 : 105, 28), 30, 190))),
        recoveryDeaths: recovery,
        limitsCharged: 0, limitsUsed: 0, limitsConverted: 0,
        notes: pick(notes), updatedAt: Date.now(),
      };
      if (myChar === 'Cloud') {
        g.limitsUsed = Math.floor(r() * 4);
        for (let i = 0; i < g.limitsUsed; i++) if (r() < 0.4 + trend) g.limitsConverted++;
      }
      games.push(g);
      if (win) w++; else l++;
      if (win && r() < 0.3) oppChar = oppChar === mainOpp ? secOpp : mainOpp; // counterpick ocasional
    }
  }
  return games;
}
