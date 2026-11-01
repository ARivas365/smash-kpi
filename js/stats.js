// Cálculo de KPIs. Todas las funciones son puras: reciben games y devuelven números.

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isNum = v => typeof v === 'number' && isFinite(v);
const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

export const EARLY = 80; // % debajo del cual una muerte cuenta como temprana

export const deathsOf =g => (g.stocks || 3) - (g.myStocksLeft || 0);
export const killsOf = g => (g.stocks || 3) - (g.oppStocksLeft || 0);

export function filterGames(games, f = {}) {
  return games.filter(g =>
    (!f.myChar || g.myChar === f.myChar) &&
    (!f.oppChar || g.oppChar === f.oppChar) &&
    (!f.rival || g.rival === f.rival) &&
    (!f.stage || g.stage === f.stage) &&
    (!f.type || g.type === f.type) &&
    (!f.from || g.date >= f.from) &&
    (!f.to || g.date <= f.to));
}

// Agrupa games por set. El resultado del set se calcula con TODOS sus games.
export function groupSets(games) {
  const map = new Map();
  for (const g of games) {
    let s = map.get(g.setId);
    if (!s) {
      s = { setId: g.setId, games: [], wins: 0, losses: 0 };
      map.set(g.setId, s);
    }
    s.games.push(g);
    if (g.result === 'W') s.wins++; else s.losses++;
  }
  for (const s of map.values()) {
    s.games.sort((a, b) => a.gameNum - b.gameNum || a.ts - b.ts);
    const first = s.games[0];
    s.rival = first.rival;
    s.type = first.type;
    s.date = first.date;
    s.lastTs = Math.max(...s.games.map(g => g.ts || 0));
    s.decided = s.wins !== s.losses;
    s.won = s.wins > s.losses;
  }
  return map;
}

export function computeKpis(games, setMap) {
  const n = games.length;
  let wins = 0, sd = 0, myO = 0, opO = 0, totDeaths = 0, totKills = 0, rec = 0;
  let lc = 0, lu = 0, lconv = 0, cloudGames = 0, openGames = 0, killGames = 0, deathGames = 0;
  const kills = [], deaths = [], setIds = new Set();
  for (const g of games) {
    if (g.result === 'W') wins++;
    sd += (g.myStocksLeft || 0) - (g.oppStocksLeft || 0);
    if ((g.myOpenings || 0) + (g.oppOpenings || 0) > 0) openGames++;
    myO += g.myOpenings || 0;
    opO += g.oppOpenings || 0;
    const kp = (g.killPercents || []).filter(isNum);
    const dp = (g.deathPercents || []).filter(isNum);
    if (kp.length) killGames++;
    if (dp.length) deathGames++;
    kills.push(...kp);
    deaths.push(...dp);
    totDeaths += deathsOf(g);
    totKills += killsOf(g);
    rec += g.recoveryDeaths || 0;
    if (g.myChar === 'Cloud') {
      cloudGames++;
      lc += g.limitsCharged || 0;
      lu += g.limitsUsed || 0;
      lconv += g.limitsConverted || 0;
    }
    setIds.add(g.setId);
  }
  let sets = 0, setWins = 0;
  if (setMap) {
    for (const id of setIds) {
      const s = setMap.get(id);
      if (s && s.decided) { sets++; if (s.won) setWins++; }
    }
  }
  return {
    n, wins, losses: n - wins,
    winGames: n ? wins / n : null,
    sets, setWins,
    winSets: sets ? setWins / sets : null,
    stockDiff: n ? sd / n : null,
    myOpenings: myO, oppOpenings: opO, openGames,
    openingRatio: opO ? myO / opO : null,
    totKills,
    openingsPerKill: totKills && openGames ? myO / totKills : null,
    oppOpeningsPerKill: totDeaths && openGames ? opO / totDeaths : null,
    earlyDeaths: deaths.length ? deaths.filter(p => p < EARLY).length / deaths.length : null,
    earlyCount: deaths.filter(p => p < EARLY).length, deathRecorded: deaths.length,
    killPct: avg(kills), killGames,
    deathPct: avg(deaths), deathGames,
    recoveryRate: totDeaths ? rec / totDeaths : null,
    recoveryDeaths: rec, totDeaths,
    limitCharged: lc, limitUsed: lu, limitConverted: lconv, cloudGames,
    limitConv: lu ? lconv / lu : null,
  };
}

// Cantidad de games que respaldan cada KPI (para el aviso de "pocos datos").
export function sampleSize(k, key) {
  switch (key) {
    case 'winSets': return k.sets;
    case 'openingRatio':
    case 'openingsPerKill': return k.openGames;
    case 'killPct': return k.killGames;
    case 'deathPct':
    case 'earlyDeaths': return k.deathGames;
    case 'limitConv': return k.cloudGames;
    default: return k.n;
  }
}

// Quién eligió el stage: lo guardado por la ayuda de baneos o, en torneo,
// lo que dicta la regla (el perdedor del game anterior elige; con un solo Steve elige el otro).
export function stagePickerOf(g, setMap) {
  if (g.stagePicker) return g.stagePicker;
  if (g.type !== 'torneo') return null;
  const meSteve = g.myChar === 'Steve', oppSteve = g.oppChar === 'Steve';
  if (meSteve !== oppSteve) return meSteve ? 'opp' : 'me';
  if (g.gameNum < 2) return null;
  const prev = setMap.get(g.setId)?.games.find(x => x.gameNum === g.gameNum - 1);
  return prev ? (prev.result === 'W' ? 'opp' : 'me') : null;
}

const rate = (gs) => ({ n: gs.length, w: gs.filter(g => g.result === 'W').length });

// Patrones que salen de los datos ya cargados, sin campos extra.
export function patterns(games, setMap, allGames) {
  // win % por número de game dentro del set
  const byGameNum = [1, 2, 3, 4, 5].map(num => ({ num, ...rate(games.filter(g => g.gameNum === num)) })).filter(r => r.n);

  // remontadas: sets donde perdí / gané el G1
  const afterLoss = { n: 0, w: 0 }, afterWin = { n: 0, w: 0 };
  for (const id of new Set(games.map(g => g.setId))) {
    const s = setMap.get(id);
    if (!s || !s.decided) continue;
    const g1 = s.games.find(g => g.gameNum === 1);
    if (!g1) continue;
    const bucket = g1.result === 'W' ? afterWin : afterLoss;
    bucket.n++;
    if (s.won) bucket.w++;
  }

  // win % según quién eligió el stage (counterpicks y regla de Steve)
  const picks = { me: [], opp: [] };
  for (const g of games) {
    const steveRule = (g.myChar === 'Steve') !== (g.oppChar === 'Steve');
    if (g.gameNum < 2 && !steveRule) continue;
    const p = stagePickerOf(g, setMap);
    if (p) picks[p].push(g);
  }

  // cansancio: posición del game dentro del día (contando todos los games de ese día)
  const dayIndex = new Map();
  for (const gs of groupBy(allGames, g => g.date).values()) {
    gs.sort((a, b) => a.ts - b.ts).forEach((g, i) => dayIndex.set(g.id, i + 1));
  }
  const buckets = [['Games 1-5', 1, 5], ['Games 6-10', 6, 10], ['Games 11-15', 11, 15], ['Game 16 en adelante', 16, Infinity]];
  const fatigue = buckets.map(([label, a, b]) => ({ label, ...rate(games.filter(g => { const i = dayIndex.get(g.id); return i >= a && i <= b; })) })).filter(r => r.n);

  return { byGameNum, afterLoss, afterWin, pickMe: rate(picks.me), pickOpp: rate(picks.opp), fatigue };
}

export function groupBy(games, keyFn) {
  const m = new Map();
  for (const g of games) {
    const k = keyFn(g);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(g);
  }
  return m;
}

export function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

// Serie semanal de `weeks` semanas que termina en la semana de `endDate`.
export function weeklySeries(games, setMap, weeks, endDate, trimLeading = true) {
  const keys = [];
  const d = new Date(weekStart(endDate) + 'T12:00:00');
  for (let i = 0; i < weeks; i++) {
    keys.unshift(ymd(d));
    d.setDate(d.getDate() - 7);
  }
  const by = groupBy(games, g => weekStart(g.date));
  let out = keys.map(k => {
    const gs = by.get(k) || [];
    const [, m, dd] = k.split('-');
    return { week: k, label: `${dd}/${m}`, n: gs.length, kpis: gs.length ? computeKpis(gs, setMap) : null };
  });
  if (trimLeading) {
    const first = out.findIndex(p => p.n > 0);
    out = first === -1 ? [] : out.slice(first);
  }
  return out;
}
