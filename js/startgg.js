// Sincronización con la API de start.gg desde el teléfono.
// El token se guarda solo en este dispositivo (IndexedDB) y nunca va en los respaldos.

const API = 'https://api.start.gg/gql/alpha';
const ULTIMATE = 1386;
const STAGES = { 'Town and City': 'Town & City', 'Kalos Pokémon League': 'Kalos' };
const CHARS = {
  'Banjo-Kazooie': 'Banjo & Kazooie', 'Pokemon Trainer': 'Pokémon Trainer', 'Pyra & Mythra': 'Pyra/Mythra',
  'Rosalina': 'Rosalina & Luma', 'Random Character': '', 'Random': '', 'Bowser Jr': 'Bowser Jr.',
};
const fixChar = c => CHARS[c] ?? (c || '');
const tag = name => (name || '?').split(' | ').pop().trim();
const norm = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// fechas en hora de Paraguay/Argentina (UTC-3)
const ymd = sec => new Date((sec - 3 * 3600) * 1000).toISOString().slice(0, 10);

const SETS_QUERY = `query($id: ID!, $page: Int!, $per: Int!) { player(id: $id) { sets(page: $page, perPage: $per) {
  pageInfo { totalPages }
  nodes {
    id displayScore fullRoundText completedAt winnerId
    event { id name isOnline numEntrants videogame { id } tournament { name startAt } }
    slots { entrant { id name participants { player { id } } } }
    games { orderNum winnerId entrant1Score entrant2Score stage { name } selections { entrant { id } character { name } } }
  } } } }`;

async function gql(token, query, variables = {}, tries = 3) {
  const res = await fetch(API, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429 && tries > 1) { await sleep(15000); return gql(token, query, variables, tries - 1); }
  if (!res.ok) {
    // un token borrado o vencido vuelve como 400 "Invalid authentication token"
    const msg = await res.json().then(j => j.message || '').catch(() => '');
    if (res.status === 401 || res.status === 403 || /auth|token/i.test(msg)) throw new Error('el token no es válido o venció (creá uno nuevo en start.gg)');
    throw new Error(`start.gg respondió ${res.status}${msg ? ': ' + msg : ''}`);
  }
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// El dueño del token: así no hace falta buscar el ID de jugador a mano.
export async function whoAmI(token) {
  const d = await gql(token, 'query { currentUser { id player { id gamerTag prefix } } }');
  const p = d.currentUser?.player;
  if (!p) throw new Error('esa cuenta de start.gg no tiene un perfil de jugador');
  return { id: p.id, gamerTag: p.gamerTag };
}

// Baja los sets nuevos (los más recientes primero) hasta llegar a una página donde todos ya son conocidos.
// start.gg no los ordena exactamente por fecha, así que una página mezclada no alcanza para frenar.
// Devuelve los eventos, sets y games nuevos (formato 'smash-kpi-torneos', se guarda en meta 'sggExt').
export async function fetchNew({ token, playerId, ext, onProgress }) {
  const known = new Set((ext?.sets || []).map(s => s.id));
  const raw = [];
  for (let page = 1; ; page++) {
    const d = (await gql(token, SETS_QUERY, { id: playerId, page, per: 20 })).player;
    if (!d) throw new Error('no existe ese jugador');
    const nodes = d.sets.nodes.filter(s => s.event?.videogame?.id === ULTIMATE && s.completedAt);
    raw.push(...nodes.filter(s => !known.has(`sgg-${s.id}`)));
    onProgress?.(page, d.sets.pageInfo.totalPages);
    const allKnown = nodes.length > 0 && nodes.every(s => known.has(`sgg-${s.id}`));
    if (allKnown || page >= d.sets.pageInfo.totalPages) break;
    await sleep(800);
  }
  raw.sort((a, b) => a.completedAt - b.completedAt);

  const mySlot = s => s.slots.findIndex(sl => sl.entrant?.participants.some(p => p.player?.id === Number(playerId)));
  const events = new Map(), sets = [], games = [];
  const order = new Map((ext?.sets || []).reduce((m, s) => m.set(s.event, Math.max(m.get(s.event) || 0, s.order)), new Map()));
  const myEntrants = new Map();

  for (const s of raw) {
    const i = mySlot(s);
    if (i < 0) continue;
    const me = s.slots[i].entrant, opp = s.slots[1 - i]?.entrant;
    const ev = s.event, eid = String(ev.id);
    myEntrants.set(eid, me.id);
    if (!events.has(eid)) {
      events.set(eid, {
        id: eid, name: ev.tournament.name, sub: ev.name, date: ymd(ev.tournament.startAt),
        online: !!ev.isOnline, placement: null, entrants: ev.numEntrants,
      });
    }
    const oppTag = tag(opp?.name);
    let dq = s.displayScore === 'DQ', my = null, their = null;
    if (!dq) {
      const m = (s.displayScore || '').match(/^(.*) (\d+|W|L) - (.*) (\d+|W|L)$/);
      if (m) {
        const [a, b] = norm(m[1]) === norm(me.name) ? [m[2], m[4]] : [m[4], m[2]];
        if (/^\d+$/.test(a) && /^\d+$/.test(b)) { my = +a; their = +b; } else dq = true;
      }
    }
    const setId = `sgg-${s.id}`;
    const gs = [...(s.games || [])].sort((a, b) => a.orderNum - b.orderNum);
    const count = (arr) => Object.entries(arr.reduce((m, c) => (c ? ((m[c] = (m[c] || 0) + 1), m) : m), {})).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const mineChars = [], oppChars = [];
    for (const g of gs) {
      const sel = Object.fromEntries((g.selections || []).filter(x => x.entrant).map(x => [x.entrant.id, fixChar(x.character?.name)]));
      const mc = sel[me.id] || '', oc = opp ? sel[opp.id] || '' : '';
      mineChars.push(mc); oppChars.push(oc);
      const won = g.winnerId === me.id;
      const winScore = s.slots[0].entrant?.id === g.winnerId ? g.entrant1Score : g.entrant2Score;
      const known = Number.isInteger(winScore) && winScore >= 1 && winScore <= 3;
      const stage = g.stage?.name || '';
      games.push({
        id: `${setId}-g${g.orderNum}`, setId, gameNum: g.orderNum,
        date: ymd(s.completedAt), ts: (s.completedAt - (gs.length - g.orderNum) * 420) * 1000,
        rival: oppTag, myChar: mc, oppChar: oc, stage: STAGES[stage] ?? stage,
        result: won ? 'W' : 'L',
        myStocksLeft: known ? (won ? winScore : 0) : (won ? null : 0),
        oppStocksLeft: known ? (won ? 0 : winScore) : (won ? 0 : null),
        event: events.get(eid).name, eventId: eid, online: events.get(eid).online, round: s.fullRoundText,
      });
    }
    order.set(eid, (order.get(eid) || 0) + 1);
    sets.push({
      id: setId, event: eid, order: order.get(eid), round: s.fullRoundText,
      myChar: count(mineChars), oppChar: count(oppChars), opp: oppTag,
      my, their, won: s.winnerId === me.id, dq, hasGames: gs.length > 0,
    });
  }

  // puesto final en cada torneo con sets nuevos (consultas agrupadas)
  const ids = [...myEntrants.entries()];
  for (let k = 0; k < ids.length; k += 20) {
    const chunk = ids.slice(k, k + 20);
    const q = '{' + chunk.map(([, eid], n) => `e${n}: entrant(id: ${eid}) { standing { placement } event { numEntrants } }`).join(' ') + '}';
    const d = await gql(token, q);
    chunk.forEach(([ev], n) => {
      const e = d[`e${n}`];
      if (!e) return;
      const target = events.get(ev) || ext?.events.find(x => x.id === ev);
      if (target) { target.placement = e.standing?.placement ?? target.placement; target.entrants = e.event?.numEntrants ?? target.entrants; }
    });
  }
  return { events: [...events.values()], sets, games };
}

// Une lo nuevo con el historial que ya había (los eventos repetidos se actualizan).
export function mergeExt(ext, add, today, playerId) {
  const base = ext ? structuredClone(ext) : { format: 'smash-kpi-torneos', version: 1, source: 'start.gg', events: [], sets: [], games: [] };
  base.playerId = playerId;
  const byId = new Map(base.events.map(e => [e.id, e]));
  for (const e of add.events) byId.set(e.id, { ...byId.get(e.id), ...e, placement: e.placement ?? byId.get(e.id)?.placement ?? null });
  base.events = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
  base.sets.push(...add.sets);
  base.games.push(...add.games);
  base.fetchedAt = today;
  return base;
}
