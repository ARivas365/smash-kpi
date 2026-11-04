import * as db from './db.js';
import { ROSTER, STAGE_GROUPS, STARTERS, LEGAL, TYPES, TYPE_LABEL, KPIS } from './data.js';
import * as st from './stats.js';
import { lineChart } from './charts.js';
import { stageArt } from './stages.js';
import * as sgg from './startgg.js';
import * as drive from './drive.js';

// mismo número que CACHE en sw.js: se suben juntos en cada actualización
const APP_VERSION = '18';
const DAY = 86400000;
const MIN_N = 5;

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const sheet = $('#sheet');

const S = {
  tab: 'cargar',
  games: [],
  settings: { main: 'Cloud', second: 'Steve', casualStocks: 3, defaultType: 'torneo', stageStyle: 'img' },
  lastBackup: null,
  focusKpi: 'winGames',
  persisted: false,
  ext: null,          // historial de torneos (start.gg)
  // conexión con start.gg: se guarda aparte de settings para que el token no vaya en los respaldos
  sgg: { token: '', playerId: null, gamerTag: '', auto: true, lastSync: null, lastError: null },
  syncing: false,
  syncMsg: '',
  extRange: 'all',
  extAllEvents: false,
  form: null,
  editingId: null,
  lastSaved: null,
  filters: {},
  filtersOpen: false,
  statsTab: 'resumen',
  mSort: 'worst',
  histQuery: '',
  notes: [],          // notas de matchups (kind 'mu') y de jugadores (kind 'pl')
  notesTab: 'mu',
  noteMy: null,       // mi personaje elegido en la lista de matchups
  noteOpen: null,     // nota abierta: { id, kind, myChar, oppChar, player }
  noteQuery: '',
  mre: null,          // guías de Mr.E (data/mre.json), se cargan aparte
  mreOpen: null,      // título de la guía abierta
  histOpen: new Set(),
  histLimit: 25,
  histSource: 'all',
  // respaldo en Google Drive: la cuenta y cuándo fue el último (el permiso de Google queda solo en memoria)
  drive: { email: '', lastBackup: null, remind: true },
  driveBusy: '',
  driveLater: false,
  dups: [],           // posibles duplicados para revisar: [{ m: set cargado, i: set de start.gg }]
  dupSkip: [],        // pares marcados como "son distintos" ('setCargado|setStartgg')
};

// ---------- utilidades ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => st.ymd(new Date());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}`; };
const fmtDateLong = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const hhmm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// se usa el calendario del teléfono, pero la fecha elegida se muestra siempre en día/mes/año
// (el campo del sistema queda invisible encima del texto)
const dateField = (attrs, value) => `<label class="inp date-pick"><span>📅 ${value ? fmtDateLong(value) : 'dd/mm/aaaa'}</span>
  <input type="date" ${attrs} value="${value || ''}"></label>`;
// hora en que se guardó el primer game del set (los importados de start.gg no la tienen; si se cargó otro día, tampoco)
function setStart(games, date) {
  const own = games.filter(g => !g.imported && g.ts);
  if (!own.length) return '';
  const t = Math.min(...own.map(g => g.ts));
  return st.ymd(new Date(t)) === date ? hhmm(t) : '';
}
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return st.ymd(d); };

function fmtKpi(key, v) {
  if (v == null || !isFinite(v)) return '—';
  switch (KPIS[key].fmt) {
    case 'pct': return Math.round(v * 100) + '%';
    case 'signed': return (v > 0 ? '+' : '') + v.toFixed(2);
    case 'ratio': return v.toFixed(2);
    case 'perc': return Math.round(v) + '%';
  }
  return String(v);
}

// action: { label, fn } agrega un botón (ej. "Deshacer") y deja el aviso más tiempo
function toast(msg, kind = '', action = null) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-btn';
    b.textContent = action.label;
    b.onclick = () => { clearTimeout(toast.timer); t.className = 'toast'; action.fn(); };
    t.append(b);
  }
  t.className = `toast show ${kind} ${action ? 'has-action' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, action ? 6000 : 2600);
}

function setTitle(t) { $('#title').textContent = t; }

const backupOverdue = () => S.games.length > 0 && (!S.lastBackup || Date.now() - S.lastBackup > 7 * DAY);

// ---------- hoja inferior (modal) ----------
let sheetPushed = false, ignorePop = false, sheetResolve = null, sheetOnClose = null;

// La pantalla completa sigue el alto visible (se achica cuando aparece el teclado).
const fitFull = () => {
  const panel = sheet.querySelector('.sheet-panel.full');
  if (panel && window.visualViewport) panel.style.height = `${window.visualViewport.height}px`;
};
window.visualViewport?.addEventListener('resize', fitFull);

// opts.full: ocupa toda la pantalla · opts.onClose: se llama al cerrar
function openSheet(html, opts = {}) {
  sheet.innerHTML = `<div class="sheet-backdrop" data-a="closeSheet"></div><div class="sheet-panel ${opts.full ? 'full' : ''}">${html}</div>`;
  sheet.classList.remove('hidden');
  sheetOnClose = opts.onClose || null;
  if (opts.full) fitFull();
  if (!sheetPushed) { history.pushState({ sheet: true }, ''); sheetPushed = true; }
}
function closeSheet(fromPop = false) {
  sheet.classList.add('hidden');
  sheet.innerHTML = '';
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }
  if (sheetOnClose) { const f = sheetOnClose; sheetOnClose = null; f(); }
  if (sheetPushed && !fromPop) { ignorePop = true; history.back(); }
  sheetPushed = false;
}
window.addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  if (!sheet.classList.contains('hidden')) closeSheet(true);
});

// Pregunta con botones; devuelve el valor del botón tocado (o null).
function ask(title, msg, buttons) {
  return new Promise(resolve => {
    openSheet(`<div class="sheet-head"><h2>${esc(title)}</h2></div>
      <div class="sheet-body"><p class="ask-msg">${msg}</p>
      <div class="stack">${buttons.map(b => `<button class="btn big ${b.cls || ''}" data-a="answer" data-v="${b.value}">${esc(b.label)}</button>`).join('')}
      <button class="btn big ghost" data-a="closeSheet">Cancelar</button></div></div>`);
    sheetResolve = resolve;
  });
}

// ---------- formulario ----------
// Torneo y práctica seria: siempre 3 stocks. Casual: lo que diga Ajustes.
const stocksFor = type => (type === 'casual' ? S.settings.casualStocks : 3);

function newForm() {
  return {
    id: null, setId: uid(), gameNum: 1, date: today(), ts: null,
    type: S.settings.defaultType, rival: '', myChar: S.settings.main, oppChar: '', stage: '',
    result: null, stocks: stocksFor(S.settings.defaultType), myStocksLeft: null, oppStocksLeft: null,
    myOpenings: 0, oppOpenings: 0, killPercents: [], deathPercents: [], recoveryDeaths: 0,
    limitsCharged: 0, limitsUsed: 0, limitsConverted: 0, notes: '',
    rpsWinner: null, prevWinner: null, bans: [], stagePicker: null, banFree: false,
    bo: S.settings.defaultType === 'practica' && S.settings.practiceSingles ? 1 : 3,
  };
}

function nextForm(g) {
  const inSet = S.games.filter(x => x.setId === g.setId);
  const maxNum = Math.max(...inSet.map(x => x.gameNum), g.gameNum);
  return {
    ...newForm(), setId: g.setId, gameNum: Math.min(maxGames({ type: g.type, bo: boOf(g) }), maxNum + 1), type: g.type,
    rival: g.rival, myChar: g.myChar, oppChar: g.oppChar, date: g.date, stocks: g.stocks || 3, bo: boOf(g),
  };
}

const killsKnown = f => (f.result && (f.result === 'W' || f.oppStocksLeft != null) ? f.stocks - (f.oppStocksLeft || 0) : null);
const deathsKnown = f => (f.result && (f.result === 'L' || f.myStocksLeft != null) ? f.stocks - (f.myStocksLeft || 0) : null);

function syncPercents(f) {
  const k = killsKnown(f), d = deathsKnown(f);
  f.killPercents = k == null ? f.killPercents : Array.from({ length: k }, (_, i) => f.killPercents[i] ?? null);
  f.deathPercents = d == null ? f.deathPercents : Array.from({ length: d }, (_, i) => f.deathPercents[i] ?? null);
  if (d != null && f.recoveryDeaths > d) f.recoveryDeaths = d;
}

// En torneo el detalle de % viene cerrado: se completa después mirando el VOD.
const hasPercents = g => [...(g.killPercents || []), ...(g.deathPercents || [])].some(v => typeof v === 'number' && isFinite(v));
const hasVodData = g => hasPercents(g) || (g.myOpenings || 0) + (g.oppOpenings || 0) > 0;
const vodOpen = f => f.vodOpen ?? (f.type !== 'torneo' || hasVodData(f));
// Pendiente de VOD: game de torneo o práctica sin openings ni % cargados (los games sueltos de práctica no).
const needsVod = g => g.type !== 'casual' && g.bo !== 1 && !g.vodSkip && !hasVodData(g);

function setInfo(setId, excludeId) {
  const gs = S.games.filter(g => g.setId === setId && g.id !== excludeId);
  return { n: gs.length, w: gs.filter(g => g.result === 'W').length, l: gs.filter(g => g.result === 'L').length, start: setStart(gs, gs[0]?.date) };
}

function rivalsByRecency() {
  const last = new Map();
  for (const g of S.games) last.set(g.rival, Math.max(last.get(g.rival) || 0, g.ts || 0));
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

function topChars(field, limit, exclude = []) {
  const c = new Map();
  for (const g of S.games) if (g[field] && !exclude.includes(g[field])) c.set(g[field], (c.get(g[field]) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(e => e[0]);
}

// Personajes que usa un rival (games cargados, torneos de start.gg y su scouting), los más usados primero.
function rivalChars(name) {
  const n = norm(name);
  if (n.length < 2) return [];
  const c = new Map();
  const add = ch => { if (ch) c.set(ch, (c.get(ch) || 0) + 1); };
  S.games.forEach(g => { if (norm(g.rival) === n) add(g.oppChar); });
  extSetsVs(name).forEach(s => add(s.oppChar));
  const person = scoutData?.people[n];
  (person && scoutData.reports[person.id]?.games || []).forEach(g => add(g.char));
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// Último personaje que usó un rival (en cualquier set, cargado a mano o de start.gg).
function lastOppChar(name) {
  const n = norm(name);
  if (n.length < 2) return '';
  let best = null;
  for (const g of S.games) if (g.oppChar && norm(g.rival) === n && (!best || (g.ts || 0) > (best.ts || 0))) best = g;
  return best?.oppChar || '';
}

// En un set nuevo, el personaje del rival arranca en el último que usó. Si lo elegiste a mano para este
// mismo rival, no se toca; si cambiás a otro rival, pasa al último de ese rival. Devuelve true si cambió.
function autoOppChar(f) {
  if (S.editingId || setInfo(f.setId).n) return false;
  const manual = f.oppChar && !f.oppAuto;
  const last = lastOppChar(f.rival);
  let v;
  if (last) v = manual && f.oppPickedFor === norm(f.rival) ? f.oppChar : last;
  else v = manual ? f.oppChar : ''; // rival nuevo (o a medio escribir): se quita solo lo que se puso solo
  if (v === f.oppChar) return false;
  f.oppChar = v;
  f.oppAuto = !!v;
  return true;
}

// Si ya se sabe qué usa el rival, solo se sugieren esos personajes; si no, los que más enfrentás.
function oppCharsHTML(f) {
  const known = rivalChars(f.rival);
  const quick = known.length ? known.slice(0, 6) : topChars('oppChar', 6);
  if (f.oppChar && !quick.includes(f.oppChar)) quick.unshift(f.oppChar);
  return `<span class="lbl">Personaje del rival${known.length ? ` <small class="lbl-note">· lo que usa ${esc(f.rival.trim())}</small>` : ''}</span>
    <div class="chips">
      ${quick.map(c => chip('oppChar', c, esc(c), f.oppChar === c)).join('')}
      <button type="button" class="chip ghost" data-a="pickChar" data-v="opp">${quick.length ? 'Buscar…' : 'Elegir personaje…'}</button>
    </div>`;
}

const rivalBoxHTML = () => sggTwinHTML() + rivalH2H() + rivalNoteHint() + scoutBtnHTML(S.form.rival);

const chip = (field, value, label, on, extra = '') =>
  `<button type="button" class="chip ${on ? 'on' : ''} ${extra}" data-a="set" data-f="${field}" data-v="${esc(value)}">${label}</button>`;

const counter = (field, label, cls = '') =>
  `<div class="counter ${cls}" data-f="${field}">
    <span class="c-label">${label}</span>
    <div class="c-row"><button type="button" class="c-btn" data-a="dec" data-f="${field}" aria-label="restar">−</button>
    <output>${S.form[field] || 0}</output>
    <button type="button" class="c-btn" data-a="inc" data-f="${field}" aria-label="sumar">+</button></div>
  </div>`;

function pctInputs(kind, arr) {
  return `<div class="pct-grid">${arr.map((v, i) => `
    <label class="pct-cell"><span>${i + 1}º stock</span>
    <input class="inp pct" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" enterkeyhint="next"
      data-in="${kind}" data-i="${i}" value="${v ?? ''}" placeholder="%"></label>`).join('')}</div>`;
}

function rivalSuggestions() {
  const q = norm(S.form.rival);
  let list = rivalsByRecency().filter(r => !q || norm(r).includes(q));
  // al escribir, también sugiere rivales de tus torneos (supermajor)
  if (q && S.ext) {
    const known = new Set(list.map(norm));
    for (const s of [...S.ext.sets].reverse()) {
      if (!known.has(norm(s.opp)) && norm(s.opp).includes(q)) { known.add(norm(s.opp)); list.push(s.opp); }
    }
  }
  list = list.slice(0, 10);
  if (!list.length) return '';
  return list.map(r => `<button type="button" class="chip sm ${r === S.form.rival ? 'on' : ''}" data-a="rivalPick" data-v="${esc(r)}">${esc(r)}</button>`).join('');
}

// Sets de torneo (supermajor) contra el rival escrito, sin contar DQ.
function extSetsVs(name) {
  const n = norm(name);
  return S.ext && n.length >= 2 ? S.ext.sets.filter(s => !s.dq && norm(s.opp) === n) : [];
}

function rivalH2H() {
  const sets = extSetsVs(S.form.rival);
  if (!sets.length) return '';
  const w = sets.filter(s => s.won).length;
  const chars = [...new Set(sets.map(s => s.oppChar).filter(Boolean))].slice(0, 3).join(', ');
  return `<div class="h2h">🏆 En torneos vs <b>${esc(sets[0].opp)}</b>: <b class="${w * 2 >= sets.length ? 'win' : 'loss'}">${w}-${sets.length - w}</b> en sets${chars ? ` · usa ${esc(chars)}` : ''}</div>`;
}

// ---------- ayuda de baneos (torneo) ----------
// G1: el ganador de piedra, papel o tijeras banea 1 starter, el perdedor banea 2 y el ganador elige.
// G2+: el ganador del game anterior banea 3 y el perdedor elige.
// Si exactamente un jugador usa Steve, no hay baneos: elige el stage el que no usa Steve.
const other = w => (w === 'me' ? 'opp' : 'me');
const whoName = (w, f) => (w === 'me' ? 'Vos' : esc(f.rival.trim() || 'El rival'));
const VERB = { ban: { me: 'baneás', opp: 'banea' }, pick: { me: 'elegís', opp: 'elige' }, picked: { me: 'elegiste', opp: 'eligió' } };

function prevWinnerOf(f) {
  const prev = S.games.find(g => g.setId === f.setId && g.gameNum === f.gameNum - 1 && g.id !== S.editingId);
  if (prev) return { who: prev.result === 'W' ? 'me' : 'opp', known: true };
  return { who: f.prevWinner || null, known: false };
}

function banPlan(f) {
  if (f.type !== 'torneo' || f.banFree) return null;
  const pool = f.gameNum === 1 ? STARTERS : LEGAL;
  const meSteve = f.myChar === 'Steve', oppSteve = f.oppChar === 'Steve';
  if (meSteve !== oppSteve) return { pool, steve: meSteve ? 'me' : 'opp', steps: [{ who: meSteve ? 'opp' : 'me', act: 'pick' }] };
  if (f.gameNum === 1) {
    if (!f.rpsWinner) return { pool, need: 'rpsWinner' };
    const w = f.rpsWinner;
    return { pool, steps: [{ who: w, act: 'ban', n: 1 }, { who: other(w), act: 'ban', n: 2 }, { who: w, act: 'pick' }] };
  }
  const pw = prevWinnerOf(f);
  if (!pw.who) return { pool, need: 'prevWinner' };
  return { pool, prevKnown: pw.known, steps: [{ who: pw.who, act: 'ban', n: 3 }, { who: other(pw.who), act: 'pick' }] };
}

function currentStep(plan, f) {
  // "solo el stage jugado": no se anotan los baneos, se pasa directo a quién elige
  if (S.settings.banMode === 'pick') {
    const s = plan.steps[plan.steps.length - 1];
    return { ...s, done: !!f.stage && plan.pool.includes(f.stage) };
  }
  let done = f.bans.length;
  for (const s of plan.steps) {
    if (s.act === 'ban') {
      if (done >= s.n) { done -= s.n; continue; }
      return { ...s, left: s.n - done };
    }
    return { ...s, done: !!f.stage && plan.pool.includes(f.stage) };
  }
}

// Si cambia algo que altera el orden de baneos (tipo, game, Steve, quién ganó), se reinicia.
function syncBans(f) {
  const plan = banPlan(f);
  const key = plan ? [f.gameNum, f.myChar === 'Steve', f.oppChar === 'Steve', f.rpsWinner, prevWinnerOf(f).who].join('|') : 'off';
  if (f.banKey !== undefined && f.banKey !== key) { f.bans = []; f.stagePicker = null; f.stage = ''; }
  f.banKey = key;
}

function banHeaderHTML(plan, f) {
  const winnerChips = (field, q) => `<div class="ban-q"><b>${q}</b><div class="result-row">
    ${['me', 'opp'].map(w => `<button type="button" class="chip ${f[field] === w ? 'on' : ''}" data-a="setBan" data-f="${field}" data-v="${w}">${whoName(w, f)}</button>`).join('')}</div></div>`;
  if (plan.need === 'rpsWinner') return winnerChips('rpsWinner', '¿Quién ganó piedra, papel o tijeras?');
  if (plan.need === 'prevWinner') return winnerChips('prevWinner', `¿Quién ganó el G${f.gameNum - 1}?`);

  const step = currentStep(plan, f);
  let html = '';
  if (f.gameNum === 1 && !plan.steve) html += `<div class="ban-ctx">Piedra, papel o tijeras: ganó <b>${whoName(f.rpsWinner, f)}</b> · <button type="button" class="link" data-a="setBan" data-f="rpsWinner" data-v="">cambiar</button></div>`;
  if (f.gameNum > 1 && !plan.steve) html += `<div class="ban-ctx">Ganó el G${f.gameNum - 1}: <b>${whoName(plan.steps[0].who, f)}</b>${plan.prevKnown ? '' : ` · <button type="button" class="link" data-a="setBan" data-f="prevWinner" data-v="">cambiar</button>`}</div>`;
  if (plan.steve) {
    html += `<div class="ban-ctx">${plan.steve === 'me' ? 'Usás Steve' : `${whoName('opp', f)} usa Steve`}: no hay baneos y elige el stage el que no usa Steve.</div>`;
  }
  if (step.act === 'ban') {
    html += `<div class="ban-step ${step.who}">🚫 <b>${whoName(step.who, f)}</b> ${VERB.ban[step.who]} ${step.left} stage${step.left === 1 ? '' : 's'}</div>`;
  } else if (step.done) {
    html += `<div class="ban-step done">✅ <b>${esc(f.stage)}</b> · lo ${VERB.picked[step.who]} ${step.who === 'me' ? 'vos' : whoName('opp', f)}</div>`;
  } else {
    html += `<div class="ban-step ${step.who}">👉 <b>${whoName(step.who, f)}</b> ${VERB.pick[step.who]} el stage</div>`;
  }
  return html;
}

// ---------- sugerencia de baneos y picks ----------
// Récord de cada stage con mi personaje vs el del rival. Con pocos games vs ese personaje, el puntaje
// se completa con mi récord general en ese stage (cuantos más games del matchup, menos pesa lo general).
const SUG_K = 3;
function stageRecords(f) {
  if (!f.myChar || !f.oppChar) return null;
  const rec = {};
  for (const g of S.games) {
    if (!g.stage || g.myChar !== f.myChar || g.id === S.editingId) continue;
    const r = rec[g.stage] || (rec[g.stage] = { w: 0, n: 0, aw: 0, an: 0 });
    r.an++; if (g.result === 'W') r.aw++;
    if (g.oppChar === f.oppChar) { r.n++; if (g.result === 'W') r.w++; }
  }
  if (!Object.keys(rec).length) return null;
  for (const r of Object.values(rec)) {
    const general = (r.aw + 1) / (r.an + 2);
    r.score = (r.w + SUG_K * general) / (r.n + SUG_K);
  }
  return rec;
}

const recText = (r, f) => (r.n ? `${r.w}-${r.n - r.w} vs ${esc(f.oppChar)}${r.n < MIN_N ? ' ⚠' : ''}` : `sin games vs ${esc(f.oppChar)} · general ${Math.round(r.aw / r.an * 100)}%`);

// Stages que conviene banear (los peores) o elegir (el mejor) en este paso.
function suggestion(plan, step, f, recs) {
  if (!recs || !step || step.who !== 'me' || step.done) return null;
  const free = plan.pool.filter(s => !f.bans.some(b => b.stage === s) && recs[s]);
  if (!free.length) return null;
  const sorted = free.sort((a, b) => recs[a].score - recs[b].score);
  return step.act === 'ban' ? sorted.slice(0, step.left) : sorted.slice(-1);
}

function suggestionHTML(plan, step, f, recs, sug) {
  if (plan.need || !step) return '';
  if (!f.oppChar) return '<p class="muted small">Elegí el personaje del rival para ver qué stages te conviene banear y elegir.</p>';
  if (!recs) return `<p class="muted small">Todavía no tenés games de ${esc(f.myChar)} con stage cargado: las sugerencias aparecen cuando cargues algunos.</p>`;
  if (!sug?.length) return '';
  const act = step.act === 'ban' ? '🚫 Sugerido banear' : '⭐ Sugerido elegir';
  return `<div class="sug-box"><b>${act}:</b>
    ${sug.map(s => `<div class="sug-row"><span>${esc(s)}</span><small>${recText(recs[s], f)}</small></div>`).join('')}
    <small class="muted">Según tus games de ${esc(f.myChar)} en cada stage. ⚠ = menos de ${MIN_N} games vs ese personaje: también cuenta tu récord general en el stage.</small></div>`;
}

function stageSectionHTML(f) {
  const plan = banPlan(f);
  const step = plan && !plan.need ? currentStep(plan, f) : null;
  const recs = stageRecords(f);
  const sug = plan ? suggestion(plan, step, f, recs) || [] : [];
  // sin anotar baneos: igual se sugiere qué te conviene banear cuando te toca
  const myBans = plan?.steps && S.settings.banMode === 'pick' && !f.stage
    ? plan.steps.filter(s => s.act === 'ban' && s.who === 'me').reduce((a, s) => a + s.n, 0) : 0;
  const banStep = { act: 'ban', who: 'me', left: myBans };
  const banSug = myBans ? suggestion(plan, banStep, f, recs) || [] : [];
  // récord vs el personaje rival en cada stage (verde si ganás más de la mitad, rojo si menos)
  const badge = s => {
    const r = recs?.[s];
    if (!r?.n) return '';
    const p = r.w / r.n;
    return `<i class="st-rec ${p > 0.5 ? 'good' : p < 0.5 ? 'bad' : ''}">${r.w}-${r.n - r.w}</i>`;
  };
  const groups = plan
    ? STAGE_GROUPS.map(([g, ss]) => [g, ss.filter(s => plan.pool.includes(s))]).filter(([, ss]) => ss.length)
    : STAGE_GROUPS;
  const tile = s => {
    const ban = f.bans.find(b => b.stage === s);
    const on = f.stage === s && !ban;
    const cls = `${on ? 'on' : ''} ${ban ? 'banned' : ''} ${plan?.need ? 'dim' : ''} ${sug.includes(s) ? `sug ${step.act}` : banSug.includes(s) ? 'sug ban' : ''}`;
    const tag = ban ? `<em class="ban-tag">✕ ${ban.by === 'me' ? 'Vos' : esc(f.rival.trim() || 'Rival')}</em>` : '';
    const label = esc(s === 'Pokémon Stadium 2' ? 'PS2' : s);
    const r = recs?.[s];
    return S.settings.stageStyle === 'text'
      ? `<button type="button" class="chip sm ${cls}" data-a="stageTap" data-v="${esc(s)}">${ban ? '✕ ' : ''}${esc(s)}${r?.n ? ` <small>${r.w}-${r.n - r.w}</small>` : ''}</button>`
      : `<button type="button" class="stage ${cls}" data-a="stageTap" data-v="${esc(s)}">${stageArt(s)}${ban ? '' : badge(s)}${tag}<span>${label}</span></button>`;
  };
  return `<section class="card">
    ${plan ? banHeaderHTML(plan, f) + (banSug.length ? suggestionHTML(plan, banStep, f, recs, banSug) : '') + suggestionHTML(plan, step, f, recs, sug) : ''}
    ${groups.map(([group, stages]) => `<span class="lbl">${group}</span>
      <div class="${S.settings.stageStyle === 'text' ? 'chips' : 'stage-grid'}">${stages.map(tile).join('')}</div>`).join('')}
    ${f.type === 'torneo' ? `<div class="ban-tools">
      ${plan && !plan.need && (f.bans.length || f.stage) ? '<button type="button" class="btn sm" data-a="banReset">↺ Reiniciar baneos</button>' : ''}
      <button type="button" class="btn sm ghost" data-a="banFree">${f.banFree ? 'Usar ayuda de baneos' : 'Elegir sin ayuda'}</button>
      ${plan && !plan.steve ? `<button type="button" class="btn sm ghost" data-a="banMode">${S.settings.banMode === 'pick' ? 'Anotar todos los baneos' : 'Anotar solo el stage'}</button>` : ''}</div>` : ''}
    ${step?.act === 'ban' && f.bans.length ? '<p class="muted small">Tocá el último stage baneado para deshacerlo.</p>' : ''}
  </section>`;
}

function stageTap(s) {
  const f = S.form;
  const plan = banPlan(f);
  if (!plan) { setField('stage', s); return; }
  if (plan.need) { toast(plan.need === 'rpsWinner' ? 'Primero: ¿quién ganó piedra, papel o tijeras?' : `Primero: ¿quién ganó el G${f.gameNum - 1}?`); return; }
  const i = f.bans.findIndex(b => b.stage === s);
  if (i >= 0) {
    if (i === f.bans.length - 1 && !f.stage) f.bans.pop();
    else { toast('Ese stage está baneado'); return; }
  } else {
    const step = currentStep(plan, f);
    if (step.act === 'ban') {
      f.bans.push({ stage: s, by: step.who });
      if (navigator.vibrate) navigator.vibrate(15);
    } else { f.stage = s; f.stagePicker = step.who; }
  }
  renderCargar();
}

function renderCargar() {
  setTitle(S.editingId ? 'Editar game' : 'Cargar game');
  if (!S.form) { view.innerHTML = postSaveHTML(); return; }
  const f = S.form;
  syncPercents(f);
  syncBans(f);
  const si = setInfo(f.setId, S.editingId);
  const { main, second } = S.settings;
  const otherMine = f.myChar !== main && f.myChar !== second;
  const k = killsKnown(f), d = deathsKnown(f);
  // del G2 en adelante, lo que ya se sabe del set (tipo, fecha, rival, número de game) queda en una línea
  const compact = !S.editingId && si.n > 0 && !f.showSet;
  const bestOf = f.type !== 'casual' ? ` · Bo${f.bo}` : '';

  view.innerHTML = `
  ${freshBannerHTML()}
  ${driveBannerHTML()}
  ${si.n ? `<div class="setbar"><span>Set vs <b>${esc(f.rival)}</b>${bestOf} · va <b class="win">${si.w}</b>-<b class="loss">${si.l}</b> · cargando <b>G${f.gameNum}</b>${si.start ? ` · empezó ${si.start}` : ''}</span>
    ${S.editingId ? '' : `<span class="setbar-actions">${compact ? '<button type="button" class="link" data-a="showSet">✎ Cambiar</button>' : ''}
      <button type="button" class="link" data-a="newSet">Nuevo set</button></span>`}</div>` : ''}
  ${compact ? '' : `<section class="card">
    <div class="row-between"><span class="lbl">Tipo de partida</span>
      ${dateField(`data-in="date" max="${today()}"`, f.date)}</div>
    <div class="chips">${TYPES.map(([v, l]) => chip('type', v, l, f.type === v)).join('')}</div>
    <label class="lbl" for="rival">Rival</label>
    <input id="rival" class="inp" data-in="rival" value="${esc(f.rival)}" placeholder="Nombre del rival" autocomplete="off" autocapitalize="words" enterkeyhint="done">
    <div class="chips scroll-x" id="rivalSug">${rivalSuggestions()}</div>
    <div id="rivalH2H">${rivalBoxHTML()}</div>
    <div class="row-between"><span class="lbl">${f.bo === 1 ? 'Game suelto' : 'Game del set'}</span>
      ${f.type !== 'casual' ? `<div class="chips bo">${f.type === 'practica' ? chip('bo', 1, 'Suelto', f.bo === 1, 'sm') : ''}
        ${chip('bo', 3, 'Bo3', f.bo === 3, 'sm')}${chip('bo', 5, 'Bo5', f.bo === 5, 'sm')}</div>` : ''}</div>
    ${f.bo === 1 ? '<p class="muted small">Cada game se guarda por separado: ideal para arenas o jugar en grupo contra alguien distinto cada vez.</p>'
      : `<div class="chips nums">${Array.from({ length: maxGames(f) }, (_, i) => i + 1).map(n => chip('gameNum', n, 'G' + n, f.gameNum === n)).join('')}</div>`}
  </section>`}

  <section class="card">
    <span class="lbl">Mi personaje</span>
    <div class="chips">
      ${chip('myChar', main, esc(main), f.myChar === main)}
      ${chip('myChar', second, esc(second), f.myChar === second)}
      ${otherMine ? chip('myChar', f.myChar, esc(f.myChar), true) : ''}
      <button type="button" class="chip ghost" data-a="pickChar" data-v="my">Otro…</button>
    </div>
    <div id="oppCharBox">${oppCharsHTML(f)}</div>
    <div id="muHint">${muNoteHint()}</div>
  </section>

  <div id="stageBox">${stageSectionHTML(f)}</div>

  ${resultHTML(f)}

  ${S.editingId ? `<section class="card">
    <details class="vod" data-vod ${vodOpen(f) ? 'open' : ''}>
      <summary><span class="lbl">📼 Detalle para VOD review</span><span class="muted small">Openings y % de cada stock · opcional, se puede completar después</span></summary>
      <div class="vod-body">
        <span class="lbl">Openings</span>
        <div class="counters two">${counter('myOpenings', 'Míos')}${counter('oppOpenings', 'Del rival')}</div>
        <span class="lbl">% al que maté en cada stock</span>
        ${k == null ? '<p class="muted small">Elegí resultado y stocks primero.</p>' : k === 0 ? '<p class="muted small">No tomaste stocks.</p>' : pctInputs('kill', f.killPercents)}
        <span class="lbl">% al que morí en cada stock</span>
        ${d == null ? '<p class="muted small">Elegí resultado y stocks primero.</p>' : d === 0 ? '<p class="muted small">No perdiste stocks.</p>' : pctInputs('death', f.deathPercents)}
      </div>
    </details>
  </section>` : ''}

  <section class="card ${f.myChar === 'Cloud' ? 'limit' : ''}">
    <details class="vod" data-more ${S.settings.moreOpen ? 'open' : ''}>
      <summary><span class="lbl">➕ Recovery${f.myChar === 'Cloud' ? ' y Limit' : ''}</span><span class="muted small" id="moreSum">${moreSummary(f)}</span></summary>
      <div class="vod-body">
        <div class="counters one">${counter('recoveryDeaths', 'Muertes por recovery / edgeguard')}</div>
        ${f.myChar === 'Cloud' ? `<span class="lbl">Limit</span>
          <div class="counters three">${counter('limitsCharged', 'Cargados')}${counter('limitsUsed', 'Usados')}${counter('limitsConverted', 'Dieron kill')}</div>
          <p class="muted small">Dieron kill = Limits usados que le sacaron un stock al rival.</p>` : ''}
      </div>
    </details>
  </section>

  <section class="card">
    <details ${f.notes ? 'open' : ''}><summary class="lbl">Notas (opcional)</summary>
      <textarea class="inp" rows="3" data-in="notes" placeholder="Qué funcionó, qué no…">${esc(f.notes)}</textarea>
    </details>
  </section>

  <div class="savebar">
    ${S.editingId ? '<button type="button" class="btn big" data-a="cancelEdit">Cancelar</button>' : ''}
    <button type="button" class="btn big primary grow" data-a="save">${S.editingId ? 'Guardar cambios' : saveLabel(f, si)}</button>
  </div>`;
}

// Resultado: Gané / Perdí y al lado los stocks que le quedaron al ganador (1, 2, 3).
function resultHTML(f) {
  const field = f.result === 'W' ? 'myStocksLeft' : 'oppStocksLeft';
  const hint = !f.result ? 'Primero: ¿ganaste o perdiste?'
    : f.result === 'W' ? 'Stocks que <b>te quedaron a vos</b>' : 'Stocks que <b>le quedaron al rival</b>';
  const tone = f.result === 'W' ? 'win' : f.result === 'L' ? 'loss' : '';
  const missing = f.result && f[field] == null && !f.imported;
  return `<section class="card">
    <span class="lbl">Resultado</span>
    <div class="res-line">
      <div class="res-pick">
        <button type="button" class="res-wl win ${f.result === 'W' ? 'on' : ''}" data-a="set" data-f="result" data-v="W">Gané</button>
        <button type="button" class="res-wl loss ${f.result === 'L' ? 'on' : ''}" data-a="set" data-f="result" data-v="L">Perdí</button>
      </div>
      <div class="res-stocks">
        <small class="res-hint ${missing ? 'warn-text' : ''}">${hint}</small>
        <div class="res-grid" style="--n:${f.stocks}">${Array.from({ length: f.stocks }, (_, i) => i + 1).map(k => `
          <button type="button" class="res-btn ${tone} ${f.result && f[field] === k ? 'on' : ''}" data-a="resStock" data-v="${k}"
            ${f.result ? '' : 'disabled'}>${k}</button>`).join('')}</div>
      </div>
    </div>
  </section>`;
}

const moreSummary = f => `Recovery ${f.recoveryDeaths || 0}${f.myChar === 'Cloud' ? ` · Limit ${f.limitsCharged || 0}/${f.limitsUsed || 0}/${f.limitsConverted || 0}` : ''} · opcional`;

// games posibles del set: Bo3 hasta 3, Bo5 hasta 5; casual no tiene formato (como mucho 5)
const maxGames = f => (f.bo === 1 ? 1 : f.type === 'casual' || f.bo === 5 ? 5 : 3);
// formato de un game guardado; los viejos y los de start.gg no lo tienen: si el set llegó a G4, era Bo5
const boOf = g => g.bo || (S.games.some(x => x.setId === g.setId && x.gameNum > 3) ? 5 : 3);

// ¿este game cierra el set? Bo3 se gana con 2, Bo5 con 3
function setOver(f, si) {
  const w = si.w + (f.result === 'W' ? 1 : 0), l = si.l + (f.result === 'L' ? 1 : 0);
  const need = f.type === 'casual' ? null : (f.bo === 5 ? 3 : 2);
  return { over: f.gameNum >= maxGames(f) || (!!need && (w >= need || l >= need)), w, l };
}

function saveLabel(f, si) {
  if (f.bo === 1) return 'Guardar y cargar otro';
  if (!f.result) return 'Guardar game';
  const s = setOver(f, si);
  return s.over ? `Guardar · fin del set ${s.w}-${s.l}` : `Guardar → G${f.gameNum + 1}`;
}

function postSaveHTML() {
  const g = S.lastSaved;
  const si = setInfo(g.setId);
  const next = Math.min(5, Math.max(...S.games.filter(x => x.setId === g.setId).map(x => x.gameNum)) + 1);
  return `<section class="card done">
    <div class="done-icon ${g.result === 'W' ? 'win' : 'loss'}">${g.result === 'W' ? 'W' : 'L'}</div>
    <h2>Game guardado</h2>
    <p>${esc(g.myChar)} vs ${esc(g.oppChar)} · ${esc(g.stage || 'sin stage')}</p>
    <p class="setscore">Set vs <b>${esc(g.rival)}</b>: <b class="win">${si.w}</b> - <b class="loss">${si.l}</b></p>
    <div class="stack">
      <button class="btn xl primary" data-a="nextGame">Siguiente game del set (G${next})</button>
      <button class="btn xl" data-a="newSet">Nuevo set</button>
      <button class="btn ghost" data-a="editLast">Corregir el game recién cargado</button>
    </div>
  </section>`;
}

function updateCounters() {
  view.querySelectorAll('.counter').forEach(c => { c.querySelector('output').textContent = S.form[c.dataset.f] || 0; });
  const sum = $('#moreSum');
  if (sum) sum.textContent = moreSummary(S.form);
}

function bump(field, delta) {
  const f = S.form;
  const d = deathsKnown(f);
  const max = field === 'recoveryDeaths' ? (d ?? f.stocks) : field.startsWith('limits') ? 20 : 99;
  f[field] = Math.max(0, Math.min(max, (f[field] || 0) + delta));
  // coherencia: convertidos ≤ usados ≤ cargados
  if (field === 'limitsConverted' && f.limitsConverted > f.limitsUsed) f.limitsUsed = f.limitsConverted;
  if (field !== 'limitsCharged' && f.limitsUsed > f.limitsCharged) f.limitsCharged = f.limitsUsed;
  if (field === 'limitsCharged' && f.limitsUsed > f.limitsCharged) f.limitsUsed = f.limitsCharged;
  if (f.limitsConverted > f.limitsUsed) f.limitsConverted = f.limitsUsed;
  updateCounters();
}

function setField(field, raw) {
  const f = S.form;
  const v = ['gameNum', 'myStocksLeft', 'oppStocksLeft', 'bo'].includes(field) ? Number(raw) : raw;
  f[field] = v;
  if (field === 'oppChar') { f.oppAuto = false; f.oppPickedFor = norm(f.rival); } // elegido a mano para este rival
  if (field === 'result') {
    if (v === 'W') { f.oppStocksLeft = 0; if (!f.myStocksLeft) f.myStocksLeft = null; }
    else { f.myStocksLeft = 0; if (!f.oppStocksLeft) f.oppStocksLeft = null; }
  }
  if (field === 'myChar' && v !== 'Cloud') { f.limitsCharged = f.limitsUsed = f.limitsConverted = 0; }
  // "Suelto" existe solo en práctica, y se recuerda para la próxima vez que elijas práctica
  if (field === 'type') {
    if (v === 'practica' && S.settings.practiceSingles) f.bo = 1;
    else if (f.bo === 1) f.bo = 3;
  }
  if (field === 'bo' && f.type === 'practica') {
    S.settings.practiceSingles = v === 1;
    db.put('meta', S.settings, 'settings');
  }
  // en Bo3 no existen G4 ni G5 (y un game suelto es siempre G1)
  if ((field === 'bo' || field === 'type') && f.gameNum > maxGames(f)) f.gameNum = maxGames(f);
  if (field === 'type') {
    f.stocks = stocksFor(v);
    if (f.myStocksLeft > f.stocks) f.myStocksLeft = null;
    if (f.oppStocksLeft > f.stocks) f.oppStocksLeft = null;
    S.settings.defaultType = v;
    db.put('meta', S.settings, 'settings');
  }
  renderCargar();
}

function cleanGame(f) {
  const nums = arr => arr.map(v => (typeof v === 'number' && isFinite(v) ? v : null));
  return {
    id: f.id || uid(), setId: f.setId, gameNum: f.gameNum, date: f.date || today(), ts: f.ts || Date.now(),
    type: f.type, rival: f.rival.trim(), myChar: f.myChar, oppChar: f.oppChar, stage: f.stage,
    result: f.result, stocks: f.stocks, myStocksLeft: f.myStocksLeft, oppStocksLeft: f.oppStocksLeft,
    myOpenings: f.myOpenings, oppOpenings: f.oppOpenings,
    killPercents: nums(f.killPercents), deathPercents: nums(f.deathPercents),
    recoveryDeaths: f.recoveryDeaths,
    limitsCharged: f.limitsCharged, limitsUsed: f.limitsUsed, limitsConverted: f.limitsConverted,
    notes: f.notes.trim(), sample: f.sample, updatedAt: Date.now(),
    rpsWinner: f.type === 'torneo' ? f.rpsWinner : null, prevWinner: f.type === 'torneo' ? f.prevWinner : null,
    bans: f.type === 'torneo' ? f.bans : [], stagePicker: f.stage ? f.stagePicker : null,
    vodSkip: !!f.vodSkip, bo: [1, 5].includes(f.bo) ? f.bo : 3,
    // datos de start.gg: games importados, o cargados a mano y unidos con su set de start.gg (sggSet)
    ...(f.imported ? { imported: f.imported } : {}),
    ...(f.event ? { event: f.event, eventId: f.eventId, online: f.online, round: f.round } : {}),
    ...(f.sggSet ? { sggSet: f.sggSet } : {}),
    stocksUnknown: f.myStocksLeft == null || f.oppStocksLeft == null,
  };
}

async function saveGame() {
  const f = S.form;
  const missing = [];
  if (!f.rival.trim()) missing.push('rival');
  if (!f.oppChar) missing.push('personaje del rival');
  if (!f.result) missing.push('resultado');
  else if (!f.imported && (f.result === 'W' ? f.myStocksLeft : f.oppStocksLeft) == null) missing.push('stocks restantes');
  if (missing.length) { toast('Falta: ' + missing.join(', '), 'err'); return; }
  syncPercents(f);
  const g = cleanGame(f);
  await db.put('games', g);
  const i = S.games.findIndex(x => x.id === g.id);
  if (i >= 0) S.games[i] = g; else S.games.push(g);
  requestPersist();
  if (S.editingId) {
    S.editingId = null;
    S.vodFocus = false;
    // si venía de corregir el game recién cargado, vuelve al panel de "siguiente game"
    if (S.returnTab === 'cargar') { S.lastSaved = g; S.form = null; } else S.form = newForm();
    toast('Cambios guardados', 'ok');
    go(S.returnTab || 'historial');
    return;
  }
  // carga rápida: pasa directo al siguiente game, o a un set nuevo si el set terminó (con "Deshacer" por si acaso)
  const before = structuredClone(f);
  const si = setInfo(g.setId);
  const bo = boOf(g);
  const need = g.type === 'casual' ? null : (bo === 5 ? 3 : 2);
  const over = g.gameNum >= maxGames({ type: g.type, bo }) || (!!need && (si.w >= need || si.l >= need));
  S.lastSaved = null;
  // game suelto: el siguiente arranca igual (práctica, mismo personaje y día) pero con otro rival
  const single = bo === 1;
  S.form = single ? { ...newForm(), date: g.date, type: g.type, bo: 1, myChar: g.myChar, stocks: g.stocks }
    : over ? { ...newForm(), date: g.date } : nextForm(g);
  render();
  window.scrollTo(0, 0);
  const msg = single ? `Game ${g.result === 'W' ? 'ganado' : 'perdido'} vs ${g.rival} guardado`
    : over ? `Set ${si.w > si.l ? 'ganado' : si.w < si.l ? 'perdido' : 'terminado'} ${si.w}-${si.l} vs ${g.rival}`
    : `G${g.gameNum} guardado · set ${si.w}-${si.l}`;
  toast(msg, 'ok', { label: 'Deshacer', fn: () => undoSave(g.id, before) });
}

// quita el game recién guardado y vuelve a dejarlo en el formulario para corregirlo
async function undoSave(id, form) {
  await db.del('games', id);
  S.games = S.games.filter(g => g.id !== id);
  S.form = form;
  S.editingId = null;
  S.lastSaved = null;
  go('cargar');
  window.scrollTo(0, 0);
  toast('Deshecho: corregí lo que haga falta y guardá de nuevo');
}

function editGame(id, returnTab, vodFocus = false) {
  const g = S.games.find(x => x.id === id);
  if (!g) return;
  S.form = { ...newForm(), ...structuredClone(g), bo: boOf(g), notes: g.notes || '', vodOpen: vodFocus || undefined };
  S.editingId = id;
  S.returnTab = returnTab;
  S.vodFocus = vodFocus;
  go('cargar');
  // modo VOD review: salta directo a los casilleros de %
  if (vodFocus) view.querySelector('[data-vod]')?.scrollIntoView({ block: 'start' });
}

async function skipVod(ids) {
  const gs = S.games.filter(g => ids.includes(g.id));
  gs.forEach(g => { g.vodSkip = true; });
  await db.putMany('games', gs);
  renderHist();
  toast(gs.length === 1 ? 'Quitado de pendientes' : `${gs.length} games quitados de pendientes`);
}

// selector de personaje
let pickerTarget = 'opp';
function openPicker(target) {
  pickerTarget = target;
  openSheet(`<div class="sheet-head"><input id="pq" class="inp" type="search" placeholder="Buscar personaje…" autocomplete="off">
    <button class="btn icon" data-a="closeSheet" aria-label="cerrar">✕</button></div>
    <div class="sheet-body" id="plist"></div>`);
  renderPickerList('');
  $('#pq').addEventListener('input', e => renderPickerList(e.target.value));
}
function renderPickerList(q) {
  const nq = norm(q);
  // 'note' elige el personaje rival de una nota de matchup
  const field = pickerTarget === 'my' ? 'myChar' : 'oppChar';
  const current = pickerTarget === 'note' ? null : S.form?.[field];
  const top = topChars(field, 8, pickerTarget === 'my' ? [S.settings.main, S.settings.second] : []);
  const matches = ROSTER.filter(([n, a]) => !nq || norm(n + ' ' + (a || '')).includes(nq)).map(r => r[0]).sort((a, b) => a.localeCompare(b));
  const btn = c => `<button class="pick ${c === current ? 'on' : ''}" data-a="pickDone" data-v="${esc(c)}">${esc(c)}</button>`;
  $('#plist').innerHTML = `
    ${!nq && top.length ? `<div class="lbl">${pickerTarget === 'my' ? 'Los que más uso' : 'Los que más enfrento'}</div><div class="pick-grid">${top.map(btn).join('')}</div><div class="lbl">Todo el roster</div>` : ''}
    <div class="pick-grid">${matches.map(btn).join('') || '<p class="muted">Sin resultados</p>'}</div>`;
}

// ---------- estadísticas ----------
function filterOptions(field) {
  return [...new Set(S.games.map(g => g[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function filtersHTML() {
  const F = S.filters;
  const active = Object.values(F).filter(Boolean).length;
  const sel = (key, label, opts, labels = {}) => `<label class="f-field"><span>${label}</span>
    <select class="inp" data-filter="${key}"><option value="">Todos</option>
    ${opts.map(o => `<option value="${esc(o)}" ${F[key] === o ? 'selected' : ''}>${esc(labels[o] || o)}</option>`).join('')}</select></label>`;
  const range = (n, l) => `<button class="chip sm ${F.from === daysAgo(n) && !F.to ? 'on' : ''}" data-a="range" data-v="${n}">${l}</button>`;
  const summary = [F.source && (F.source === 'startgg' ? 'start.gg' : 'Cargados'), F.online && (F.online === 'online' ? 'Online' : 'Offline'),
    F.myChar, F.oppChar && 'vs ' + F.oppChar, F.rival, F.stage, F.type && TYPE_LABEL[F.type],
    (F.from || F.to) && `${F.from ? fmtDate(F.from) : '…'} → ${F.to ? fmtDate(F.to) : 'hoy'}`].filter(Boolean).join(' · ');
  return `<div class="filterbar">
    <button class="btn filter-toggle ${active ? 'has' : ''}" data-a="toggleFilters">Filtros${active ? ` (${active})` : ''} ${S.filtersOpen ? '▴' : '▾'}</button>
    <span class="f-summary">${esc(summary || 'Todos los games')}</span></div>
    ${S.filtersOpen ? `<section class="card filters">
      <div class="chips">${range(7, '7 días')}${range(30, '30 días')}${range(90, '90 días')}
        <button class="chip sm ${!F.from && !F.to ? 'on' : ''}" data-a="range" data-v="all">Todo</button></div>
      <div class="f-grid">
        ${sel('myChar', 'Mi personaje', filterOptions('myChar'))}
        ${sel('oppChar', 'Personaje rival', filterOptions('oppChar'))}
        ${sel('rival', 'Rival', filterOptions('rival'))}
        ${sel('stage', 'Stage', filterOptions('stage'))}
        ${sel('type', 'Tipo', TYPES.map(t => t[0]), TYPE_LABEL)}
        ${sel('source', 'Origen', ['app', 'startgg'], { app: 'Cargados en la app', startgg: 'Torneos (start.gg)' })}
        ${sel('online', 'Modalidad', ['offline', 'online'], { offline: 'Offline', online: 'Online' })}
        <div class="f-field"><span>Desde</span>${dateField('data-filter="from"', F.from)}</div>
        <div class="f-field"><span>Hasta</span>${dateField('data-filter="to"', F.to)}</div>
      </div>
      <button class="btn ghost" data-a="clearFilters">Limpiar filtros</button>
    </section>` : ''}`;
}

const lowBadge = n => `<span class="lowchip" title="Pocos datos">⚠ ${n} game${n === 1 ? '' : 's'}</span>`;

function tile(key, k, sub) {
  const n = st.sampleSize(k, key);
  if (!n && key !== 'winGames') return ''; // sin ningún dato, la tarjeta no aporta
  const low = n < MIN_N;
  return `<div class="tile ${low ? 'low' : ''}">
    <div class="t-label">${KPIS[key].label}</div>
    <div class="t-val">${fmtKpi(key, k[key])}</div>
    <div class="t-sub">${sub}</div>
    ${low ? lowBadge(n) : ''}
  </div>`;
}

function chartOpts(key) {
  const fmt = v => fmtKpi(key, v);
  switch (KPIS[key].fmt) {
    case 'pct': return { fmt, min: 0, max: 1, ref: key.startsWith('win') ? 0.5 : null };
    case 'ratio': return { fmt, min: 0, ref: key === 'openingRatio' ? 1 : null };
    case 'signed': return { fmt, ref: 0 };
    default: return { fmt };
  }
}

function seriesFor(series, key) {
  return series.map(p => ({ label: p.label, n: p.kpis ? st.sampleSize(p.kpis, key) : 0, value: p.kpis ? p.kpis[key] : null }));
}

function focusHTML(setMap) {
  const key = S.focusKpi;
  const base = st.filterGames(S.games, { ...S.filters, from: null, to: null });
  const series = st.weeklySeries(base, setMap, 8, today(), false);
  const cur = series[series.length - 1], prev = series[series.length - 2];
  const cv = cur.kpis?.[key], pv = prev.kpis?.[key];
  let delta = '';
  if (cv != null && pv != null && isFinite(cv) && isFinite(pv)) {
    const diff = cv - pv;
    const good = KPIS[key].better === 'high' ? diff > 0 : diff < 0;
    const txt = KPIS[key].fmt === 'pct' ? `${diff > 0 ? '+' : ''}${Math.round(diff * 100)} pts` : `${diff > 0 ? '+' : ''}${KPIS[key].fmt === 'perc' ? Math.round(diff) + '%' : diff.toFixed(2)}`;
    delta = Math.abs(diff) < 1e-9 ? '<span class="delta">= igual que la semana pasada</span>'
      : `<span class="delta ${good ? 'up' : 'down'}">${good ? '▲' : '▼'} ${txt} vs semana pasada</span>`;
  }
  const curN = cur.kpis ? st.sampleSize(cur.kpis, key) : 0;
  return `<section class="card focus">
    <div class="row-between"><span class="lbl">🎯 Foco de la semana</span></div>
    <select class="inp" data-in="focusKpi">${Object.entries(KPIS).map(([k, d]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${d.label}</option>`).join('')}</select>
    <div class="focus-now"><div><div class="muted small">Esta semana</div><div class="big-num">${fmtKpi(key, cv)}</div></div>
      <div class="focus-side">${delta || '<span class="muted small">Sin dato de la semana pasada para comparar</span>'}
      ${curN < MIN_N ? lowBadge(curN) : ''}</div></div>
    ${lineChart({ points: seriesFor(series, key), labelAll: true, ...chartOpts(key) })}
    <p class="muted small">Últimas 8 semanas. ${KPIS[key].better === 'high' ? 'Más alto es mejor.' : 'Más bajo es mejor.'} Puntos huecos = menos de ${MIN_N} games.</p>
  </section>`;
}

function resumenHTML(fg, setMap) {
  const k = st.computeKpis(fg, setMap);
  const series = st.weeklySeries(fg, setMap, 12, S.filters.to || today());
  return `
    ${focusHTML(setMap)}
    <div class="tiles">
      ${tile('winGames', k, `${k.wins}-${k.losses} · ${k.n} games`)}
      ${tile('winSets', k, `${k.setWins}-${k.sets - k.setWins} · ${k.sets} sets`)}
      ${tile('stockDiff', k, `por game · ${k.stockGames} games con stocks`)}
      ${tile('openingRatio', k, `${k.myOpenings} / ${k.oppOpenings}`)}
      ${tile('openingsPerKill', k, `más bajo = mejor · rival: ${fmtKpi('openingsPerKill', k.oppOpeningsPerKill)}`)}
      ${tile('killPct', k, `más bajo = mejor · ${k.killGames} games con %`)}
      ${tile('deathPct', k, `más alto = mejor · ${k.deathGames} games con %`)}
      ${tile('earlyDeaths', k, `${k.earlyCount} de ${k.deathRecorded} muertes con %`)}
      ${tile('recoveryRate', k, `${k.recoveryDeaths} de ${k.recDeaths} muertes`)}
      ${k.cloudGames ? tile('limitConv', k, `${k.limitConverted} kills de ${k.limitUsed} usados · ${k.limitCharged} cargados`) : ''}
    </div>
    ${patternsHTML(fg, setMap)}
    <section class="card"><span class="lbl">% victoria por semana</span>
      ${lineChart({ points: seriesFor(series, 'winGames'), ...chartOpts('winGames') })}</section>
    <section class="card"><span class="lbl">Opening ratio por semana</span>
      ${lineChart({ points: seriesFor(series, 'openingRatio'), ...chartOpts('openingRatio') })}
      <p class="muted small">Toca un punto para ver el valor. Puntos huecos = menos de ${MIN_N} games.</p></section>`;
}

// fila con barra: etiqueta, win %, cantidad de games
function patRow(label, r, cls = '') {
  const v = r.n ? r.w / r.n : null;
  return `<div class="pat-row ${r.n < MIN_N ? 'low' : ''} ${cls}"><span>${label}</span>
    <div class="pat-bar"><i style="width:${v == null ? 0 : Math.round(v * 100)}%"></i></div>
    <b>${v == null ? '—' : Math.round(v * 100) + '%'}</b><small>${r.n}${r.n < MIN_N ? ' ⚠' : ''}</small></div>`;
}

function patternsHTML(fg, setMap) {
  const p = st.patterns(fg, setMap, S.games);
  const block = (title, rows, note = '') => (rows.length ? `<div class="pat-block"><div class="lbl sub">${title}</div>${rows.join('')}${note ? `<p class="muted small">${note}</p>` : ''}</div>` : '');
  return `<section class="card"><span class="lbl">Patrones (% de victoria)</span>
    ${block('Por game del set', p.byGameNum.map(r => patRow('G' + r.num, r)))}
    ${block('Cómo terminan tus sets', [
      p.afterLoss.n ? patRow('Perdiste el G1 → ganaste el set', p.afterLoss) : '',
      p.afterWin.n ? patRow('Ganaste el G1 → ganaste el set', p.afterWin) : '',
    ].filter(Boolean))}
    ${block('Quién eligió el stage', [
      p.pickMe.n ? patRow('Stage elegido por vos', p.pickMe) : '',
      p.pickOpp.n ? patRow('Stage elegido por el rival', p.pickOpp) : '',
    ].filter(Boolean), 'Games 2 en adelante de torneo (el perdedor elige) y games con regla de Steve.')}
    ${block('Cansancio: games jugados ese día', p.fatigue.map(r => patRow(r.label, r)))}
    <p class="muted small">El número de la derecha es la cantidad de games (o sets). ⚠ = menos de ${MIN_N}.</p>
  </section>`;
}

const MU_KEYS = ['winGames', 'winSets', 'stockDiff', 'openingRatio', 'openingsPerKill', 'killPct', 'deathPct', 'recoveryRate', 'limitConv'];

function matchupsHTML(fg, setMap) {
  return breakdownHTML(fg, setMap, {
    keyFn: g => g.oppChar, title: c => 'vs ' + esc(c), what: 'matchups',
  });
}

function stagesHTML(fg, setMap) {
  return breakdownHTML(fg.filter(g => g.stage), setMap, {
    keyFn: g => g.stage, title: s => esc(s), thumb: s => `<span class="mu-thumb">${stageArt(s)}</span>`, what: 'stages',
  });
}

// Tarjetas por grupo (personaje rival o stage) con el peor valor de cada KPI en rojo.
function breakdownHTML(fg, setMap, { keyFn, title, thumb, what }) {
  const groups = [...st.groupBy(fg, keyFn).entries()].map(([char, gs]) => ({ char, k: st.computeKpis(gs, setMap) }));
  if (!groups.length) return '<p class="empty">No hay games con estos filtros.</p>';
  // peor valor de cada KPI entre los grupos con 3+ games
  const eligible = groups.filter(m => m.k.n >= 3);
  const worst = {};
  if (eligible.length >= 2) {
    for (const key of MU_KEYS) {
      const vals = eligible.map(m => m.k[key]).filter(v => v != null && isFinite(v));
      if (vals.length >= 2) worst[key] = KPIS[key].better === 'high' ? Math.min(...vals) : Math.max(...vals);
    }
  }
  const sorters = {
    worst: (a, b) => (a.k.winGames ?? 1) - (b.k.winGames ?? 1) || b.k.n - a.k.n,
    played: (a, b) => b.k.n - a.k.n,
    az: (a, b) => a.char.localeCompare(b.char),
  };
  groups.sort(sorters[S.mSort]);
  const worst3 = eligible.slice().sort(sorters.worst).slice(0, 3).filter(m => m.k.winGames < 0.5);
  const sortChip = (v, l) => `<button class="chip sm ${S.mSort === v ? 'on' : ''}" data-a="mSort" data-v="${v}">${l}</button>`;
  return `
    ${worst3.length ? `<section class="card alert"><span class="lbl">Peores ${what} (3+ games)</span>
      <p>${worst3.map(m => `<b>${esc(m.char)}</b> ${fmtKpi('winGames', m.k.winGames)}`).join(' · ')}</p></section>` : ''}
    <div class="chips">${sortChip('worst', 'Peores primero')}${sortChip('played', 'Más jugados')}${sortChip('az', 'A-Z')}</div>
    ${groups.map(({ char, k }) => {
      const bad = k.n >= 3 && k.winGames < 0.45;
      const cell = key => {
        if (key === 'limitConv' && !k.cloudGames) return '';
        const v = k[key];
        const red = (worst[key] != null && v === worst[key] && k.n >= 3) || (key === 'winGames' && k.n >= 3 && v < 0.4);
        return `<div class="m ${red ? 'red' : ''}"><span>${KPIS[key].short}</span><b>${fmtKpi(key, v)}</b></div>`;
      };
      return `<article class="card mu ${bad ? 'bad' : ''}">
        <div class="mu-head">${thumb ? thumb(char) : ''}<div class="mu-title"><b>${title(char)}</b><span class="muted small">${k.wins}-${k.losses} · ${k.n} games · ${k.sets} sets</span></div>
        ${k.n < MIN_N ? lowBadge(k.n) : ''}</div>
        <div class="mu-grid">${MU_KEYS.map(cell).join('')}</div>
      </article>`;
    }).join('')}
    <p class="muted small">En rojo: el peor valor de cada KPI entre tus ${what} con 3+ games, y win rate menor a 40%.</p>`;
}

// Historial de torneos importado de supermajor: resultados por set (sin detalle por game).
function torneosHTML() {
  const d = S.ext;
  if (!d) {
    return `<div class="empty-state"><p>Todavía no hay torneos. Conectá tu cuenta de start.gg y la app baja tus resultados sola.</p>
      <button class="btn big primary" data-a="go" data-v="ajustes">Ir a Ajustes</button></div>`;
  }
  const months = { all: null, year: 12, half: 6 }[S.extRange];
  const cutoff = months ? (() => { const x = new Date(); x.setMonth(x.getMonth() - months); return st.ymd(x); })() : '';
  const events = d.events.filter(e => e.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
  const ev = new Map(events.map(e => [e.id, e]));
  const sets = d.sets.filter(s => ev.has(s.event));
  const played = sets.filter(s => !s.dq && s.my != null);
  const rec = arr => ({ n: arr.length, w: arr.filter(s => s.won).length });
  const wl = r => `${r.w}-${r.n - r.w}`;
  const groupRec = keyFn => [...st.groupBy(played, keyFn).entries()].map(([k, arr]) => ({ k, ...rec(arr) }));
  const all = rec(played);
  const games = played.reduce((a, s) => ({ w: a.w + s.my, n: a.n + s.my + s.their }), { w: 0, n: 0 });
  const off = rec(played.filter(s => !ev.get(s.event).online)), on = rec(played.filter(s => ev.get(s.event).online));
  const pct = r => (r.n ? Math.round((r.w / r.n) * 100) + '%' : '—');
  const bad = r => (r.n >= 3 && r.w / r.n < 0.4 ? 'bad' : '');
  const byYear = groupRec(s => ev.get(s.event).date.slice(0, 4)).sort((a, b) => b.k.localeCompare(a.k));
  const byMine = groupRec(s => s.myChar || '?').sort((a, b) => b.n - a.n);
  const byOpp = groupRec(s => s.oppChar).filter(r => r.k).sort((a, b) => b.n - a.n || a.w / a.n - b.w / b.n);
  const rivals = groupRec(s => s.opp).filter(r => r.n >= 2).sort((a, b) => b.n - a.n);
  const rangeChip = (v, l) => `<button class="chip sm ${S.extRange === v ? 'on' : ''}" data-a="extRange" data-v="${v}">${l}</button>`;
  const shownEvents = S.extAllEvents ? events : events.slice(0, 10);
  const tileHTML = (label, val, sub) => `<div class="tile"><div class="t-label">${label}</div><div class="t-val">${val}</div><div class="t-sub">${sub}</div></div>`;
  return `
    <section class="card"><span class="lbl">🏆 Tus torneos (start.gg)</span>
      <p class="muted small">${esc(d.player)} · ${events.length} torneos · actualizado ${fmtDate(d.fetchedAt)}. Resultados por set, incluidos los sets sin detalle por game. Los games con detalle (stage y personajes) también están en Resumen, Matchups y Stages: filtrá por <b>Origen</b> para separarlos.</p>
      <div class="chips">${rangeChip('all', 'Todo')}${rangeChip('year', 'Último año')}${rangeChip('half', 'Últimos 6 meses')}</div>
    </section>
    <div class="tiles">
      ${tileHTML('Sets ganados', pct(all), `${wl(all)} · sin contar ${sets.length - played.length} DQ`)}
      ${tileHTML('Games ganados', games.n ? Math.round((games.w / games.n) * 100) + '%' : '—', `${games.w}-${games.n - games.w}`)}
      ${tileHTML('Offline', pct(off), `${wl(off)} en sets`)}
      ${tileHTML('Online', pct(on), `${wl(on)} en sets`)}
    </div>
    <section class="card"><span class="lbl">Sets ganados</span>
      <div class="pat-block"><div class="lbl sub">Por año</div>${byYear.map(r => patRow(`${r.k} · ${wl(r)}`, r)).join('')}</div>
      <div class="pat-block"><div class="lbl sub">Con qué personaje jugaste</div>${byMine.map(r => patRow(`${esc(r.k)} · ${wl(r)}`, r)).join('')}</div>
    </section>
    <section class="card"><span class="lbl">Por personaje rival</span>
      ${byOpp.map(r => patRow(`${esc(r.k)} · ${wl(r)}`, r, bad(r))).join('')}
      <p class="muted small">En rojo: 3+ sets y menos de 40% ganados.</p>
    </section>
    <section class="card"><span class="lbl">Rivales frecuentes (2+ sets)</span>
      ${rivals.map(r => patRow(`${esc(r.k)} · ${wl(r)}`, r, bad(r))).join('') || '<p class="muted small">Nadie repetido en este período.</p>'}
    </section>
    <section class="card"><span class="lbl">Torneos</span>
      ${shownEvents.map(e => {
        const r = rec(sets.filter(s => s.event === e.id && !s.dq));
        return `<div class="ev-row"><div class="ev-main"><b>${esc(e.name)}</b>
          <small>${fmtDate(e.date)} · ${e.online ? '🌐 Online' : '🏟️ Offline'} · sets ${wl(r)}</small></div>
          <div class="ev-place"><b>${e.placement ? e.placement + 'º' : '—'}</b><small>de ${e.entrants}</small></div></div>`;
      }).join('')}
      ${events.length > shownEvents.length ? `<button class="btn" data-a="extAllEvents">Ver los ${events.length} torneos</button>` : ''}
    </section>`;
}

function compareHTML(setMap) {
  const { main, second } = S.settings;
  const base = st.filterGames(S.games, { ...S.filters, myChar: null });
  const A = base.filter(g => g.myChar === main), B = base.filter(g => g.myChar === second);
  const byA = st.groupBy(A, g => g.oppChar), byB = st.groupBy(B, g => g.oppChar);
  const shared = [...byA.keys()].filter(c => byB.has(c))
    .sort((x, y) => (byA.get(y).length + byB.get(y).length) - (byA.get(x).length + byB.get(x).length));
  const keys = ['winGames', 'stockDiff', 'openingRatio', 'openingsPerKill', 'killPct', 'deathPct', 'earlyDeaths', 'recoveryRate'];
  const card = (title, ga, gb) => {
    const ka = st.computeKpis(ga, setMap), kb = st.computeKpis(gb, setMap);
    const row = key => {
      const a = ka[key], b = kb[key];
      let wa = '', wb = '';
      if (a != null && b != null && isFinite(a) && isFinite(b) && a !== b) {
        const aBetter = KPIS[key].better === 'high' ? a > b : a < b;
        wa = aBetter ? 'best' : ''; wb = aBetter ? '' : 'best';
      }
      return `<div class="cmp-row"><span>${KPIS[key].short}</span><b class="${wa}">${fmtKpi(key, a)}</b><b class="${wb}">${fmtKpi(key, b)}</b></div>`;
    };
    return `<article class="card cmp">
      <div class="mu-head"><b>${title}</b></div>
      <div class="cmp-row head"><span></span><span>${esc(main)} ${ka.n < MIN_N ? '⚠' : ''}<small>${ka.n} g</small></span><span>${esc(second)} ${kb.n < MIN_N ? '⚠' : ''}<small>${kb.n} g</small></span></div>
      ${keys.map(row).join('')}
    </article>`;
  };
  if (!A.length || !B.length) return `<p class="empty">Necesitás games con ${esc(main)} y con ${esc(second)} para comparar.</p>`;
  return `${card('Global', A, B)}
    ${shared.length ? shared.map(c => card('vs ' + esc(c), byA.get(c), byB.get(c))).join('')
      : '<p class="empty">Todavía no usaste los dos personajes contra un mismo rival.</p>'}
    <p class="muted small">En verde el mejor de los dos. ⚠ = menos de ${MIN_N} games, tomalo con pinzas.</p>`;
}

function renderStats() {
  setTitle('Estadísticas');
  const emptyState = `<div class="empty-state"><p>Todavía no cargaste games.</p>
      <button class="btn big primary" data-a="go" data-v="cargar">Cargar el primero</button>
      <button class="btn big" data-a="loadSample">Probar con datos de ejemplo</button></div>`;
  if (!S.games.length && !S.ext) { view.innerHTML = emptyState; return; }
  const setMap = st.groupSets(S.games);
  const fg = st.filterGames(S.games, S.filters);
  const seg = (v, l) => `<button class="seg-btn ${S.statsTab === v ? 'on' : ''}" data-a="statsTab" data-v="${v}">${l}</button>`;
  let body;
  if (S.statsTab === 'torneos') body = torneosHTML();
  else if (!S.games.length) body = emptyState;
  else if (S.statsTab === 'resumen') body = fg.length ? resumenHTML(fg, setMap) : focusHTML(setMap) + '<p class="empty">No hay games con estos filtros.</p>';
  else if (S.statsTab === 'matchups') body = matchupsHTML(fg, setMap);
  else if (S.statsTab === 'stages') body = stagesHTML(fg, setMap);
  else body = compareHTML(setMap);
  view.innerHTML = `${S.statsTab === 'torneos' || !S.games.length ? '' : filtersHTML()}
    <div class="seg">${seg('resumen', 'Resumen')}${seg('matchups', 'Matchups')}${seg('stages', 'Stages')}${seg('compare', `${esc(S.settings.main)} vs ${esc(S.settings.second)}`)}${seg('torneos', '🏆 Torneos')}</div>
    ${body}`;
}

// ---------- historial ----------
function gameLine(g) {
  const kp = (g.killPercents || []).filter(v => v != null);
  const dp = (g.deathPercents || []).filter(v => v != null);
  const vod = needsVod(g);
  return `<div class="game ${g.result === 'W' ? 'w' : 'l'}">
    <div class="g-top"><b class="g-res">${g.result}</b><span>G${g.gameNum} · ${esc(g.stage || 'sin stage')}</span>
      ${st.stocksKnown(g) ? `<span class="muted">${g.myStocksLeft}-${g.oppStocksLeft} stocks</span>` : ''}${vod ? '<span class="vod-badge">📼 VOD pendiente</span>' : ''}</div>
    <div class="g-info">${esc(g.myChar)} vs ${esc(g.oppChar)}${(g.myOpenings || g.oppOpenings) ? ` · Openings ${g.myOpenings}/${g.oppOpenings}` : ''}      ${g.stagePicker ? `<br>Stage elegido por ${g.stagePicker === 'me' ? 'mí' : 'el rival'}` : ''}
      ${g.bans?.length ? `<br>Baneos: ${g.bans.map(b => `${esc(b.stage)} (${b.by === 'me' ? 'yo' : 'rival'})`).join(', ')}` : ''}
      ${kp.length ? `<br>Maté a: ${kp.join('%, ')}%` : ''}${dp.length ? `<br>Morí a: ${dp.join('%, ')}%` : ''}
      ${g.recoveryDeaths ? `<br>Muertes por recovery: ${g.recoveryDeaths}` : ''}
      ${g.myChar === 'Cloud' && !(g.imported && !g.limitsCharged) ? `<br>Limit: ${g.limitsCharged} cargados · ${g.limitsUsed} usados · ${g.limitsConverted} dieron kill` : ''}
      ${g.notes ? `<br><i>“${esc(g.notes)}”</i>` : ''}</div>
    ${vod ? `<div class="g-actions"><button class="btn sm primary" data-a="vodFill" data-v="${g.id}">Completar %</button>
      <button class="btn sm ghost" data-a="vodSkip" data-v="${g.id}">No lo voy a revisar</button></div>` : ''}
    <div class="g-actions"><button class="btn sm" data-a="edit" data-v="${g.id}">Editar</button>
      <button class="btn sm danger" data-a="delGame" data-v="${g.id}">Borrar</button></div>
  </div>`;
}

function setCardHTML(s, open, games = s.games) {
  const chars = [...new Set(s.games.map(g => g.oppChar))].join(' / ');
  const mine = [...new Set(s.games.map(g => g.myChar))].join(' / ');
  const ev = s.games.find(g => g.event); // torneo de start.gg (importado, o cargado a mano y unido)
  return `<article class="card set ${s.decided ? (s.won ? 'won' : 'lost') : ''}">
    <button class="set-head" data-a="toggleSet" data-v="${s.setId}">
      <span class="score"><b class="win">${s.wins}</b>-<b class="loss">${s.losses}</b></span>
      <span class="set-main"><b>vs ${esc(s.rival)}</b><small>${esc(mine)} vs ${esc(chars)}</small>
        ${ev ? `<small>🏆 ${esc(ev.event)}${ev.round ? ' · ' + esc(ev.round) : ''}</small>` : ''}</span>
      <span class="set-meta"><small>${fmtDate(s.date)}</small>${setStart(s.games, s.date) ? `<small>🕒 ${setStart(s.games, s.date)}</small>` : ''}<small class="tag">${TYPE_LABEL[s.type] || s.type}</small></span>
    </button>
    ${open ? `<div class="set-body">${games.map(gameLine).join('')}
      ${S.histMode === 'vod' ? '' : `<button class="btn" data-a="addToSet" data-v="${s.setId}">+ Agregar game a este set</button>`}</div>` : ''}
  </article>`;
}

function renderHist() {
  setTitle('Historial');
  const q = norm(S.histQuery);
  const pending = S.games.filter(needsVod);
  if (S.histMode === 'vod' && !pending.length) S.histMode = 'all';
  const modeChips = `<div class="chips">
    <button class="chip sm ${S.histMode !== 'vod' ? 'on' : ''}" data-a="histMode" data-v="all">Todos</button>
    <button class="chip sm ${S.histMode === 'vod' ? 'on' : ''}" data-a="histMode" data-v="vod">📼 Pendientes de VOD (${pending.length})</button></div>`;

  if (S.histMode === 'vod') {
    // sets con games pendientes, abiertos y mostrando solo esos games
    const ids = new Set(pending.map(g => g.setId));
    const sets = [...st.groupSets(S.games).values()].filter(s => ids.has(s.setId)).sort((a, b) => b.lastTs - a.lastTs);
    view.innerHTML = `${modeChips}
      <p class="muted small">Games de torneo y práctica sin % cargados. Abrí el VOD, tocá <b>Completar %</b> y anotá a qué % cayó cada stock.</p>
      <button class="btn ghost" data-a="vodSkipAll">Quitar todos de pendientes</button>
      ${sets.map(s => setCardHTML(s, true, s.games.filter(needsVod))).join('')}`;
    return;
  }

  // origen: cargados a mano o importados de start.gg (solo si hay de los dos)
  const nImported = S.games.filter(g => g.imported).length;
  if (!nImported || nImported === S.games.length) S.histSource = 'all';
  const src = (v, l, n) => `<button class="chip sm ${S.histSource === v ? 'on' : ''}" data-a="histSource" data-v="${v}">${l} (${n})</button>`;
  const sourceChips = nImported && nImported < S.games.length ? `<div class="chips">${src('all', 'Todos', S.games.length)}
    ${src('app', '✍️ Cargados por mí', S.games.length - nImported)}${src('startgg', '🏆 start.gg', nImported)}</div>` : '';

  const sets = [...st.groupSets(S.games).values()]
    .filter(s => S.histSource === 'all' || !!s.games[0].imported === (S.histSource === 'startgg'))
    .filter(s => !q || norm(s.rival).includes(q) || s.games.some(g => norm(g.oppChar).includes(q) || norm(g.myChar).includes(q)))
    .sort((a, b) => b.lastTs - a.lastTs);
  const shown = sets.slice(0, S.histLimit);
  view.innerHTML = `
    ${dupsCardHTML()}
    ${pending.length ? modeChips : ''}
    ${sourceChips}
    <input class="inp" type="search" data-in="histQuery" value="${esc(S.histQuery)}" placeholder="Buscar rival o personaje…">
    <p class="muted small">${sets.length} sets · ${sets.reduce((a, s) => a + s.games.length, 0)} games</p>
    ${shown.map(s => setCardHTML(s, S.histOpen.has(s.setId))).join('') || '<p class="empty">No hay games.</p>'}
    ${sets.length > shown.length ? '<button class="btn big" data-a="more">Ver más</button>' : ''}`;
}

// ---------- ajustes, respaldo e importación ----------
function backupData() {
  return { app: 'smash-kpi', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, games: S.games, notes: S.notes };
}

function csvData() {
  const cols = ['fecha', 'hora_inicio_set', 'tipo', 'set', 'game', 'rival', 'mi_personaje', 'personaje_rival', 'stage', 'resultado',
    'mis_stocks', 'stocks_rival', 'mis_openings', 'openings_rival', 'pct_kills', 'pct_muertes', 'muertes_recovery',
    'limits_cargados', 'limits_usados', 'limits_convertidos', 'eligio_stage', 'baneos', 'notas'];
  const setMap = st.groupSets(S.games);
  const sets = [...st.groupSets(S.games).values()].sort((a, b) => a.lastTs - b.lastTs);
  const setNum = new Map(sets.map((s, i) => [s.setId, i + 1]));
  const cell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = S.games.slice().sort((a, b) => a.ts - b.ts).map(g => [
    fmtDateLong(g.date), setStart(setMap.get(g.setId).games, setMap.get(g.setId).date), g.type, setNum.get(g.setId), g.gameNum, g.rival, g.myChar, g.oppChar, g.stage, g.result === 'W' ? 'ganado' : 'perdido',
    g.myStocksLeft, g.oppStocksLeft, g.myOpenings, g.oppOpenings,
    (g.killPercents || []).filter(v => v != null).join('|'), (g.deathPercents || []).filter(v => v != null).join('|'),
    g.recoveryDeaths, g.limitsCharged, g.limitsUsed, g.limitsConverted,
    { me: 'yo', opp: 'rival' }[st.stagePickerOf(g, setMap)] || '',
    (g.bans || []).map(b => `${b.stage} (${b.by === 'me' ? 'yo' : 'rival'})`).join('|'), g.notes,
  ].map(cell).join(';'));
  return '﻿' + [cols.join(';'), ...rows].join('\r\n');
}

// Comparte con el menú de Android o descarga. Sin awaits antes de share() para no perder el gesto del usuario.
async function shareOrDownload(name, mime, content, mode) {
  const blob = new Blob([content], { type: mime });
  if (mode === 'share' && navigator.canShare) {
    let file = new File([blob], name, { type: mime });
    if (!navigator.canShare({ files: [file] })) file = new File([blob], name + '.txt', { type: 'text/plain' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
    toast('Compartir no disponible: se descarga el archivo');
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

async function doExport(kind, mode) {
  if (!S.games.length) { toast('No hay games para exportar', 'err'); return; }
  const stamp = today();
  const ok = kind === 'json'
    ? await shareOrDownload(`smash-kpi-respaldo-${stamp}.json`, 'application/json', JSON.stringify(backupData(), null, 1), mode)
    : await shareOrDownload(`smash-kpi-${stamp}.csv`, 'text/csv', csvData(), mode);
  if (ok) {
    S.lastBackup = Date.now();
    await db.put('meta', S.lastBackup, 'lastBackup');
    render();
    toast('Respaldo listo', 'ok');
  }
}

function normalizeGame(g) {
  const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  return {
    ...g, id: String(g.id), setId: String(g.setId || g.id), gameNum: n(g.gameNum) || 1,
    date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : today(), ts: n(g.ts) || Date.parse(g.date) || Date.now(),
    type: TYPE_LABEL[g.type] ? g.type : 'casual', rival: String(g.rival || 'Sin nombre'),
    myChar: String(g.myChar || 'Cloud'), oppChar: String(g.oppChar || '?'), stage: String(g.stage || ''),
    result: g.result === 'W' ? 'W' : 'L', stocks: n(g.stocks) || 3,
    myStocksLeft: n(g.myStocksLeft), oppStocksLeft: n(g.oppStocksLeft),
    myOpenings: n(g.myOpenings), oppOpenings: n(g.oppOpenings),
    killPercents: Array.isArray(g.killPercents) ? g.killPercents : [],
    deathPercents: Array.isArray(g.deathPercents) ? g.deathPercents : [],
    recoveryDeaths: n(g.recoveryDeaths), limitsCharged: n(g.limitsCharged), limitsUsed: n(g.limitsUsed), limitsConverted: n(g.limitsConverted),
    notes: String(g.notes || ''),
  };
}

async function importFile(file) {
  let data;
  try { data = JSON.parse((await file.text()).replace(/^﻿/, '')); }
  catch { toast('El archivo no es un JSON válido', 'err'); return; }
  if (data.app !== 'smash-kpi' || !Array.isArray(data.games)) { toast('No es un respaldo de Smash KPI', 'err'); return; }
  const games = data.games.filter(g => g && g.id).map(normalizeGame);
  const mode = await ask('Importar respaldo', `El archivo tiene <b>${games.length}</b> games. Ahora tenés <b>${S.games.length}</b>.`, [
    { value: 'merge', label: 'Combinar con lo actual', cls: 'primary' },
    { value: 'replace', label: 'Reemplazar todo', cls: 'danger' },
  ]);
  if (!mode) return;
  if (mode === 'replace') { await db.clear('games'); await db.clear('notes'); S.games = []; }
  await db.putMany('games', games);
  if (Array.isArray(data.notes)) await db.putMany('notes', data.notes.filter(n => n && n.id && typeof n.text === 'string'));
  S.notes = await db.getAll('notes');
  if (data.settings && mode === 'replace') { Object.assign(S.settings, data.settings); await db.put('meta', S.settings, 'settings'); }
  S.games = await db.getAll('games');
  const merged = await reconcile();
  render();
  toast(`${games.length} games importados${merged ? ` · ${mergedMsg(merged)}` : ''}`, 'ok');
}

// ---------- respaldo en Google Drive ----------
const DRIVE_DAYS = 14;
let driveAuth = null; // { token, expires }: permiso de Google de 1 hora, solo en memoria
const saveDrive = () => db.put('meta', S.drive, 'drive');
const driveDue = () => !!(drive.CLIENT_ID && S.drive.email && S.drive.remind && S.games.length
  && (!S.drive.lastBackup || Date.now() - S.drive.lastBackup >= DRIVE_DAYS * DAY));
const fmtStamp = ts => `${fmtDateLong(st.ymd(new Date(ts)))} ${hhmm(ts)}`;

// Usa el permiso vigente; si no hay, va a Google a pedirlo y la acción sigue sola al volver.
async function runDrive(name) {
  if (!navigator.onLine) { toast('Sin internet: Google Drive necesita conexión', 'err'); return; }
  if (driveAuth && Date.now() < driveAuth.expires) {
    try { await DRIVE_ACTIONS[name](driveAuth.token); return; }
    catch (err) {
      S.driveBusy = '';
      if (!err.expired) { toast('Google Drive: ' + err.message, 'err'); render(); return; }
      driveAuth = null;
    }
  }
  toast('Abriendo Google…');
  drive.authorize(name, S.drive.email);
}

const DRIVE_ACTIONS = {
  async backup(token) {
    S.driveBusy = 'Subiendo respaldo a Google Drive…';
    render();
    if (!S.drive.email) S.drive.email = await drive.whoAmI(token);
    const now = Date.now();
    await drive.upload(token, `smash-kpi-respaldo-${today()}-${hhmm(now).replace(':', '')}.json`, JSON.stringify(backupData(), null, 1));
    S.drive.lastBackup = S.lastBackup = now;
    S.driveBusy = '';
    await saveDrive();
    await db.put('meta', S.lastBackup, 'lastBackup');
    render();
    toast(`Respaldo guardado en Drive (${S.drive.email})`, 'ok');
  },
  async restore(token) {
    S.driveBusy = 'Buscando tus respaldos en Drive…';
    render();
    if (!S.drive.email) { S.drive.email = await drive.whoAmI(token); await saveDrive(); }
    const files = await drive.list(token);
    S.driveBusy = '';
    render();
    if (!files.length) { toast('No hay respaldos en la carpeta "Smash KPI" de tu Drive', 'err'); return; }
    openSheet(`<div class="sheet-head"><h2>Recuperar desde Drive</h2><button class="btn icon ghost" data-a="closeSheet" aria-label="Cerrar">✕</button></div>
      <div class="sheet-body"><p class="muted small">${esc(S.drive.email)} · carpeta Smash KPI · el más nuevo primero</p>
      ${files.map(f => `<button class="btn" data-a="driveFile" data-v="${esc(f.id)}" data-n="${esc(f.name)}">
        ${fmtStamp(Date.parse(f.createdTime))} <small class="muted">· ${Math.max(1, Math.round((f.size || 0) / 1024))} KB</small></button>`).join('')}</div>`);
  },
};

async function driveFile(id, name) {
  closeSheet();
  if (!driveAuth || Date.now() >= driveAuth.expires) { runDrive('restore'); return; }
  try {
    toast('Bajando respaldo…');
    const text = await drive.download(driveAuth.token, id);
    await importFile(new File([text], name, { type: 'application/json' }));
  } catch (err) {
    if (err.expired) { driveAuth = null; runDrive('restore'); } else toast('Google Drive: ' + err.message, 'err');
  }
}

function driveBannerHTML() {
  if (!driveDue() || S.driveLater) return '';
  const days = S.drive.lastBackup ? Math.floor((Date.now() - S.drive.lastBackup) / DAY) : null;
  return `<section class="card alert">
    <b>☁️ Toca respaldar en Google Drive</b>
    <p class="small">${days == null ? 'Todavía no hiciste un respaldo en Drive.' : `El último fue hace ${days} días.`} Se guarda en <b>${esc(S.drive.email)}</b>.</p>
    <div class="btn-row"><button class="btn primary" data-a="driveBackup">Respaldar ahora</button>
      <button class="btn ghost" data-a="driveLater">Más tarde</button></div>
  </section>`;
}

function driveCardHTML() {
  if (!drive.CLIENT_ID) return '';
  const d = S.drive;
  const busy = S.driveBusy ? `<p class="small">⏳ ${esc(S.driveBusy)}</p>` : '';
  if (!d.email) {
    return `<section class="card">
      <span class="lbl">Google Drive</span>
      <p class="small">Guardá el respaldo completo (games, notas y preferencias) en <b>tu</b> Google Drive, en una carpeta "Smash KPI". Cada persona usa su propia cuenta de Google.</p>
      <p class="muted small">La app solo puede ver los archivos que ella misma crea en tu Drive: el resto de tu Drive no lo ve.</p>
      ${busy || `<button class="btn big primary" data-a="driveBackup">Conectar Google Drive y respaldar</button>
      <button class="btn" data-a="driveRestore">Recuperar un respaldo de Drive</button>`}
    </section>`;
  }
  return `<section class="card ${driveDue() ? 'alert' : ''}">
    <span class="lbl">Google Drive</span>
    <p class="small">☁️ Cuenta: <b>${esc(d.email)}</b></p>
    <p class="small">${d.lastBackup ? `Último respaldo en Drive: <b>${fmtStamp(d.lastBackup)}</b>` : 'Todavía no hiciste un respaldo en Drive.'}</p>
    ${busy || `<div class="btn-row"><button class="btn big primary" data-a="driveBackup">Respaldar ahora</button>
      <button class="btn big" data-a="driveRestore">Recuperar</button></div>`}
    <span class="lbl sub">Recordarme cada ${DRIVE_DAYS} días al abrir la app</span>
    <div class="chips nums">
      <button class="chip ${d.remind ? 'on' : ''}" data-a="driveRemind" data-v="on">Sí</button>
      <button class="chip ${!d.remind ? 'on' : ''}" data-a="driveRemind" data-v="off">No</button>
    </div>
    <p class="muted small">Quedan los últimos 10 respaldos; los más viejos van a la papelera de tu Drive.</p>
    <button class="btn ghost" data-a="driveForget">Desconectar esta cuenta</button>
  </section>`;
}

function requestPersist() {
  if (S.persisted || !navigator.storage?.persist) return;
  navigator.storage.persist().then(p => { S.persisted = p; }).catch(() => {});
}

// Aviso cuando la base arrancó vacía: si ya había datos, los borró el navegador.
function freshBannerHTML() {
  if (!S.freshDb || S.freshDismissed) return '';
  return `<div class="mini-alert"><span>📦 La app arrancó sin datos guardados.</span>
    <button type="button" class="link" data-a="freshInfo">¿Tenías datos?</button>
    <button type="button" class="btn icon ghost" data-a="freshOk" aria-label="Cerrar aviso">✕</button></div>`;
}

function storageCardHTML() {
  const manual = S.games.filter(g => !g.imported && !g.sample).length;
  const imported = S.games.filter(g => g.imported).length;
  return `<section class="card">
    <span class="lbl">Almacenamiento</span>
    <p class="small">Datos guardados en este teléfono desde el <b>${S.createdAt ? fmtDate(st.ymd(new Date(S.createdAt))) : '—'}</b>.
      Si esa fecha cambia sola a hoy, el navegador está borrando los datos.</p>
    <p class="small">${manual} games cargados por vos · ${imported} de torneos · ${S.notes.length} notas · token de start.gg: <b>${S.sgg.token ? 'guardado' : 'no guardado'}</b></p>
    <p class="small">${S.persisted ? '✅ Almacenamiento persistente activado' : '⚠ El navegador no marcó los datos como persistentes: puede borrarlos si se configura así.'}</p>
    <button class="btn" data-a="storageHelp">Cómo evitar que Brave borre los datos</button>
  </section>`;
}

const STORAGE_HELP = `
  <ol class="help-steps">
    <li>Abrí <b>arivas365.github.io/smash-kpi</b> en Brave, en una <b>pestaña normal</b> (las pestañas privadas borran todo al cerrarse).</li>
    <li>Tocá el <b>ícono del león</b> (Shields) en la barra de direcciones.</li>
    <li>Si aparece <b>"Olvidarme cuando cierre este sitio"</b> (<i>Forget me when I close this site</i>), <b>desactivalo</b>.</li>
    <li>En las opciones de cookies, no uses <b>"Bloquear todas las cookies"</b>: dejá la opción por defecto (bloquear solo las de otros sitios).</li>
    <li>Menú <b>⋮ → Configuración → Brave Shields y privacidad</b>: si está activado <b>"Borrar datos de navegación al salir"</b>, desactivalo o destildá <b>"Cookies y datos de sitios"</b>.</li>
    <li>Volvé a pegar tu token de start.gg en Ajustes y hacé un <b>respaldo</b>.</li>
  </ol>
  <p class="muted small">Actualizar la app no borra nada: los datos solo se van si el navegador los borra, con "Borrar todo" o al importar un respaldo con "Reemplazar".</p>`;

function renderAjustes() {
  setTitle('Ajustes');
  const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / DAY) : null;
  const overdue = backupOverdue();
  const sampleN = S.games.filter(g => g.sample).length;
  const charOpts = sel => ROSTER.map(r => r[0]).sort((a, b) => a.localeCompare(b)).map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  view.innerHTML = `
  ${freshBannerHTML()}
  <section class="card ${overdue ? 'alert' : ''}">
    <span class="lbl">Respaldo</span>
    <p>${S.lastBackup ? `Último respaldo: <b>${days === 0 ? 'hoy' : `hace ${days} día${days === 1 ? '' : 's'}`}</b>` : '<b>Nunca hiciste un respaldo.</b>'}</p>
    ${overdue ? '<p class="warn-text">⚠ Pasaron más de 7 días. Exportá un respaldo y mandalo a WhatsApp o Drive: si se borran los datos del navegador, se pierde todo.</p>' : ''}
    <div class="lbl sub">Respaldo completo (JSON, para volver a importar)</div>
    <div class="btn-row"><button class="btn big primary" data-a="export" data-k="json" data-m="share">Compartir</button>
      <button class="btn big" data-a="export" data-k="json" data-m="download">Descargar</button></div>
    <div class="lbl sub">Planilla (CSV, para Excel / Google Sheets)</div>
    <div class="btn-row"><button class="btn big" data-a="export" data-k="csv" data-m="share">Compartir</button>
      <button class="btn big" data-a="export" data-k="csv" data-m="download">Descargar</button></div>
  </section>

  <section class="card">
    <span class="lbl">Importar</span>
    <p class="muted small">Un respaldo JSON exportado desde esta app.</p>
    <label class="btn big file-btn">Elegir archivo JSON<input type="file" accept=".json,.txt,application/json,text/plain" data-in="importFile" hidden></label>
  </section>

  ${driveCardHTML()}

  ${sggCardHTML()}

  ${storageCardHTML()}

  <section class="card">
    <span class="lbl">Preferencias</span>
    <label class="f-field"><span>Mi main</span><select class="inp" data-in="setMain">${charOpts(S.settings.main)}</select></label>
    <label class="f-field"><span>Mi secundario</span><select class="inp" data-in="setSecond">${charOpts(S.settings.second)}</select></label>
    <span class="lbl sub">Stocks en partidas casuales</span>
    <div class="chips nums">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${S.settings.casualStocks === n ? 'on' : ''}" data-a="setStocks" data-v="${n}">${n}</button>`).join('')}</div>
    <p class="muted small">En torneo y práctica siempre son 3 stocks por jugador.</p>
    <span class="lbl sub">Stages en la pantalla de carga</span>
    <div class="chips nums">
      <button class="chip ${S.settings.stageStyle !== 'text' ? 'on' : ''}" data-a="setStageStyle" data-v="img">Imágenes</button>
      <button class="chip ${S.settings.stageStyle === 'text' ? 'on' : ''}" data-a="setStageStyle" data-v="text">Texto</button>
    </div>
    <span class="lbl sub">Baneos en torneo</span>
    <div class="chips nums">
      <button class="chip ${S.settings.banMode !== 'pick' ? 'on' : ''}" data-a="banMode" ${S.settings.banMode !== 'pick' ? 'disabled' : ''}>Anotar todos</button>
      <button class="chip ${S.settings.banMode === 'pick' ? 'on' : ''}" data-a="banMode" ${S.settings.banMode === 'pick' ? 'disabled' : ''}>Solo el stage</button>
    </div>
    <p class="muted small">Con "Solo el stage" no anotás los baneos: la app igual te dice a quién le toca y qué te conviene banear y elegir.</p>
  </section>

  <section class="card">
    <span class="lbl">Datos</span>
    <p class="muted small">${S.games.length} games guardados en este teléfono${sampleN ? ` (${sampleN} de ejemplo)` : ''}.</p>
    <div class="stack">
      ${sampleN ? '<button class="btn big" data-a="clearSample">Borrar datos de ejemplo</button>' : '<button class="btn big" data-a="loadSample">Cargar datos de ejemplo</button>'}
      <button class="btn big danger" data-a="wipe">Borrar todo</button>
    </div>
  </section>
  <p class="muted small center">Smash KPI v${APP_VERSION} · funciona sin internet · tus datos no salen del teléfono</p>`;
}

function sggCardHTML() {
  const c = S.sgg;
  const ago = c.lastSync ? Math.round((Date.now() - c.lastSync) / 3600000) : null;
  const when = ago == null ? 'nunca' : ago < 1 ? 'hace menos de 1 hora' : ago < 48 ? `hace ${ago} h` : `hace ${Math.round(ago / 24)} días`;
  const imported = S.games.filter(g => g.imported).length;
  return `<section class="card">
    <span class="lbl">Torneos de start.gg</span>
    ${S.ext ? `<p class="muted small">${imported} games importados de ${S.ext.events.length} torneos · datos del ${fmtDate(S.ext.fetchedAt)}.
      Tienen stage, personajes y ganador; los stocks solo cuando se reportaron.</p>` : ''}
    ${c.token ? `
      <p class="small">🔑 Conectado${c.gamerTag ? ` como <b>${esc(c.gamerTag)}</b>` : ''} · última actualización: <b>${when}</b></p>
      ${!S.ext && !S.syncing ? '<p class="muted small">Todavía no bajaste tus torneos: tocá Actualizar ahora (la primera vez tarda unos segundos).</p>' : ''}
      ${c.lastError ? `<p class="warn-text small">⚠ La última actualización falló: ${esc(c.lastError)}</p>` : ''}
      ${S.syncing ? `<p class="small">⏳ ${esc(S.syncMsg)}</p>` : '<button class="btn big primary" data-a="sggSync">Actualizar ahora</button>'}
      <span class="lbl sub">Actualizar solo (una vez por día, al abrir la app)</span>
      <div class="chips nums">
        <button class="chip ${c.auto ? 'on' : ''}" data-a="sggAuto" data-v="on">Sí</button>
        <button class="chip ${!c.auto ? 'on' : ''}" data-a="sggAuto" data-v="off">No</button>
      </div>
      <button class="btn ghost" data-a="sggForget">Borrar token</button>`
    : `
      <p class="small">Para traer tus torneos (stage, personajes y resultado de cada game) y que se actualicen solos, pegá un token de la API de start.gg.
        La app detecta sola tu perfil. El token se guarda <b>solo en este teléfono</b> y no va en los respaldos.</p>
      <p class="muted small">Cómo crearlo: start.gg → tu perfil → <b>Developer Settings</b> → <b>Create new token</b>.</p>
      <input class="inp" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-in="sggToken" placeholder="Pegá el token y tocá Guardar">
      <button class="btn big primary" data-a="sggSaveToken">Guardar y bajar mis torneos</button>`}
    ${imported
      ? '<button class="btn" data-a="sggRemove">Quitar los games importados</button>'
      : S.ext ? '<button class="btn" data-a="sggImport">Importar games de torneos</button>' : ''}
  </section>`;
}

async function loadSample() {
  const { makeSample } = await import('./sample.js');
  const games = makeSample();
  await db.putMany('games', games);
  S.games.push(...games.filter(g => !S.games.some(x => x.id === g.id)));
  toast(`${games.length} games de ejemplo cargados`, 'ok');
  render();
}

// ---------- notas de matchups y de jugadores ----------
const noteId = { mu: (my, opp) => `mu:${my}|${opp}`, pl: name => `pl:${norm(name)}` };
const getNote = id => S.notes.find(n => n.id === id);
const snip = (t, len) => (t.length > len ? t.slice(0, len).trimEnd() + '…' : t);
const muBase = (my, opp) => ({ id: noteId.mu(my, opp), kind: 'mu', myChar: my, oppChar: opp });
const plBase = name => ({ id: noteId.pl(name), kind: 'pl', player: name.trim() });
const NOTE_TEMPLATES = {
  mu: 'Neutral:\n\nCómo me mata:\nCómo lo mato:\n\nStages (ban / pick):\nRecovery / edgeguard:\n\nCosas a evitar:\n',
  pl: 'Personajes:\n\nHábitos en neutral:\nOpciones en ledge:\nOut of shield:\n\nCómo se adapta entre games:\nPlan para la próxima:\n',
};

async function saveNote(base, text) {
  const i = S.notes.findIndex(n => n.id === base.id);
  if (!text.trim()) {
    if (i >= 0) { S.notes.splice(i, 1); await db.del('notes', base.id); }
    return;
  }
  const n = { ...(i >= 0 ? S.notes[i] : base), text, updatedAt: Date.now() };
  if (i >= 0) S.notes[i] = n; else S.notes.push(n);
  await db.put('notes', n);
}

// rivales conocidos (games cargados + torneos), los más jugados primero
function knownPlayers() {
  const m = new Map();
  const add = name => { if (!name) return; const k = norm(name); const e = m.get(k) || { name, n: 0 }; e.n++; m.set(k, e); };
  S.games.forEach(g => add(g.rival));
  (S.ext?.sets || []).forEach(s => add(s.opp));
  return [...m.values()].sort((a, b) => b.n - a.n);
}

const gamesWithNotes = filter => S.games.filter(g => g.notes?.trim() && filter(g)).sort((a, b) => b.ts - a.ts);

function gameNoteHTML(g) {
  return `<button class="note-game" data-a="noteGame" data-v="${g.id}">
    <span class="ng-top"><b class="${g.result === 'W' ? 'win' : 'loss'}">${g.result}</b>
      ${fmtDate(g.date)} · vs ${esc(g.rival)} · G${g.gameNum}${g.stage ? ' · ' + esc(g.stage) : ''}</span>
    <small>${esc(g.myChar)} vs ${esc(g.oppChar)}${g.event ? ' · 🏆 ' + esc(g.event) : ''}</small>
    <span class="ng-text">${esc(g.notes)}</span></button>`;
}

function muStats(my, opp) {
  const gs = S.games.filter(g => g.myChar === my && g.oppChar === opp);
  const w = gs.filter(g => g.result === 'W').length;
  const sets = (S.ext?.sets || []).filter(s => !s.dq && s.my != null && s.myChar === my && s.oppChar === opp);
  const sw = sets.filter(s => s.won).length;
  const parts = [];
  if (gs.length) parts.push(`Games ${w}-${gs.length - w} (${Math.round((w / gs.length) * 100)}%)`);
  if (sets.length) parts.push(`Sets de torneo ${sw}-${sets.length - sw}`);
  return parts.join(' · ') || 'Todavía sin games';
}

function plStats(name) {
  const n = norm(name);
  const gs = S.games.filter(g => norm(g.rival) === n);
  const w = gs.filter(g => g.result === 'W').length;
  const sets = (S.ext?.sets || []).filter(s => !s.dq && s.my != null && norm(s.opp) === n);
  const sw = sets.filter(s => s.won).length;
  const chars = [...new Set([...gs.map(g => g.oppChar), ...sets.map(s => s.oppChar)].filter(Boolean))].slice(0, 4);
  const parts = [];
  if (gs.length) parts.push(`Games ${w}-${gs.length - w}`);
  if (sets.length) parts.push(`Sets de torneo ${sw}-${sets.length - sw}`);
  if (chars.length) parts.push(`usa ${chars.join(', ')}`);
  return parts.map(esc).join(' · ') || 'Todavía sin games';
}

function noteCardHTML(n, title, stats) {
  return `<button class="note-card" data-a="noteOpen" data-v="${esc(n.id)}">
    <span class="nc-top"><b>${title}</b><small>${fmtDate(st.ymd(new Date(n.updatedAt)))}</small></span>
    <small class="muted">${stats}</small>
    <span class="nc-snip">${esc(snip(n.text, 160))}</span></button>`;
}

function notesMuHTML() {
  const my = S.noteMy || S.settings.main;
  const mine = [...new Set([S.settings.main, S.settings.second, ...S.notes.filter(n => n.kind === 'mu').map(n => n.myChar)])];
  const notes = S.notes.filter(n => n.kind === 'mu' && n.myChar === my).sort((a, b) => b.updatedAt - a.updatedAt);
  const withNote = new Set(notes.map(n => n.oppChar));
  const count = new Map();
  S.games.filter(g => g.myChar === my && g.oppChar && !withNote.has(g.oppChar)).forEach(g => count.set(g.oppChar, (count.get(g.oppChar) || 0) + 1));
  const suggest = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  return `
    <div class="chips">${mine.map(c => `<button class="chip ${c === my ? 'on' : ''}" data-a="noteMy" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <button class="btn big primary" data-a="noteNewMu">＋ Nota de matchup (${esc(my)} vs …)</button>
    ${notes.map(n => noteCardHTML(n, `${esc(n.myChar)} vs ${esc(n.oppChar)}`, esc(muStats(n.myChar, n.oppChar)))).join('')
      || `<p class="empty">Todavía no tenés notas de matchups con ${esc(my)}.</p>`}
    ${suggest.length ? `<span class="lbl">Los que más enfrentás sin nota</span>
      <div class="chips">${suggest.map(c => `<button class="chip sm ghost" data-a="noteMuQuick" data-v="${esc(c)}">＋ ${esc(c)}</button>`).join('')}</div>` : ''}`;
}

function notesPlHTML() {
  const q = norm(S.noteQuery);
  const notes = S.notes.filter(n => n.kind === 'pl' && (!q || norm(n.player).includes(q) || norm(n.text).includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const withNote = new Set(S.notes.filter(n => n.kind === 'pl').map(n => n.id));
  const suggest = knownPlayers().filter(p => !withNote.has(noteId.pl(p.name))).slice(0, 8);
  return `
    <input class="inp" type="search" data-in="noteQuery" value="${esc(S.noteQuery)}" placeholder="Buscar jugador o texto…">
    <button class="btn big primary" data-a="noteNewPl">＋ Nota de jugador</button>
    ${notes.map(n => noteCardHTML(n, esc(n.player), plStats(n.player))).join('')
      || `<p class="empty">${q ? 'No hay notas que coincidan.' : 'Todavía no tenés notas de jugadores.'}</p>`}
    ${!q && suggest.length ? `<span class="lbl">Rivales frecuentes sin nota</span>
      <div class="chips">${suggest.map(p => `<button class="chip sm ghost" data-a="notePickPl" data-v="${esc(p.name)}">＋ ${esc(p.name)}</button>`).join('')}</div>` : ''}`;
}

function notesGamesHTML() {
  const q = norm(S.noteQuery);
  const gs = gamesWithNotes(g => !q || [g.rival, g.oppChar, g.myChar, g.stage, g.notes, g.event].some(v => v && norm(v).includes(q)));
  return `
    <input class="inp" type="search" data-in="noteQuery" value="${esc(S.noteQuery)}" placeholder="Buscar rival, personaje, stage o texto…">
    <p class="muted small">${gs.length} games con notas. Se escriben en "Notas" al cargar o editar un game. Tocá uno para editarlo.</p>
    ${gs.map(gameNoteHTML).join('') || '<p class="empty">No hay games con notas.</p>'}`;
}

function noteDetailHTML() {
  const base = S.noteOpen;
  const n = getNote(base.id);
  const isMu = base.kind === 'mu';
  const title = isMu ? `${esc(base.myChar)} vs ${esc(base.oppChar)}` : esc(base.player);
  const games = isMu
    ? gamesWithNotes(g => g.myChar === base.myChar && g.oppChar === base.oppChar)
    : gamesWithNotes(g => norm(g.rival) === norm(base.player));
  return `
    <div class="note-head"><button class="btn icon" data-a="noteBack" aria-label="volver">‹</button>
      <div><b>${title}</b><small class="muted">${isMu ? esc(muStats(base.myChar, base.oppChar)) : plStats(base.player)}</small></div></div>
    ${isMu ? '' : `<button class="btn" data-a="scoutOpen" data-v="${esc(base.player)}">🔎 Scouting de ${esc(base.player)} en start.gg</button>`}
    <section class="card">
      <div class="row-between"><span class="lbl">${isMu ? 'Nota del matchup' : 'Nota del jugador'}</span>
        <button class="btn sm" data-a="noteFull" aria-label="pantalla completa">⛶ Pantalla completa</button></div>
      <textarea class="inp note-text" data-in="noteText" rows="12" placeholder="${notePlaceholder(isMu)}">${esc(n?.text || '')}</textarea>
      <div class="row-between"><span class="muted small note-status">${n ? 'Guardado · ' + fmtDate(st.ymd(new Date(n.updatedAt))) : 'Se guarda solo mientras escribís'}</span>
        ${n ? '<button class="btn sm danger" data-a="noteDelete">Borrar nota</button>' : '<button class="btn sm" data-a="noteTemplate">Usar plantilla</button>'}</div>
      ${isMu && mreDocFor(base.oppChar) ? `<div class="btn-row">
        <button class="btn sm" data-a="mreUse" data-v="${esc(base.oppChar)}">📘 Usar nota de Mr.E</button>
        <button class="btn sm ghost" data-a="mreView" data-v="${esc(base.oppChar)}">Ver guía</button></div>` : ''}
    </section>
    <section class="card">
      <span class="lbl">Notas de tus games ${isMu ? 'en este matchup' : 'contra este jugador'} (${games.length})</span>
      ${games.map(gameNoteHTML).join('') || '<p class="muted small">Todavía no escribiste notas en games que correspondan.</p>'}
    </section>`;
}

// ---------- guías de Mr.E (data/mre.json) ----------
let mreLoading = null;
function loadMre() {
  if (S.mre) return Promise.resolve(S.mre);
  mreLoading ||= fetch('data/mre.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(d => {
    S.mre = d?.format === 'smash-kpi-mre' ? d : null;
    mreLoading = null;
    return S.mre;
  });
  return mreLoading;
}
const mreDocFor = char => S.mre?.docs.find(d => d.chars.includes(char));
const mreFind = title => S.mre && [...S.mre.docs, ...S.mre.general].find(d => d.title === title);

// las líneas "## Título" son secciones; el resto, párrafos
function mreTextHTML(text) {
  return text.split(/\n{2,}/).map(block => (/^## [^\n]+$/.test(block)
    ? `<h3>${esc(block.slice(3))}</h3>`
    : `<p>${block.split('\n').map(l => (l.startsWith('## ') ? `<b>${esc(l.slice(3))}</b>` : esc(l))).join('<br>')}</p>`)).join('');
}

const mreTemplate = char => `— Base: guía de Mr.E vs ${char} —\n\n` + mreDocFor(char).text.replace(/^## (.+)$/gm, '▶ $1') + '\n\n— Mis notas —\n';

function notesMreHTML() {
  if (!S.mre) {
    loadMre().then(() => { if (S.tab === 'notas' && S.notesTab === 'mre') renderNotas(); });
    return '<p class="empty">Cargando guías de Mr.E…</p>';
  }
  if (S.mreOpen && mreFind(S.mreOpen)) return mreReaderHTML(mreFind(S.mreOpen));
  const q = norm(S.noteQuery);
  const match = d => !q || norm(d.title).includes(q) || (d.chars || []).some(c => norm(c).includes(q)) || norm(d.text).includes(q);
  const btn = d => `<button class="pick" data-a="mreOpen" data-v="${esc(d.title)}">${esc(d.title)}</button>`;
  const docs = S.mre.docs.filter(match), general = S.mre.general.filter(match);
  return `
    <input class="inp" type="search" data-in="noteQuery" value="${esc(S.noteQuery)}" placeholder="Buscar personaje o palabra (ej: ledge, shield)…">
    <p class="muted small">Guías de Mr.E: ${S.mre.docs.length} de personajes y ${S.mre.general.length} de fundamentos. Son consejos generales del matchup para tener una idea; completalos con tus notas.</p>
    ${general.length ? `<span class="lbl">Fundamentos</span><div class="pick-grid">${general.map(btn).join('')}</div>` : ''}
    ${docs.length ? `<span class="lbl">Personajes</span><div class="pick-grid">${docs.map(btn).join('')}</div>` : ''}
    ${!docs.length && !general.length ? '<p class="empty">No hay guías que coincidan.</p>' : ''}`;
}

function mreReaderHTML(d) {
  const my = S.noteMy || S.settings.main;
  return `
    <div class="note-head"><button class="btn icon" data-a="mreBack" aria-label="volver">‹</button>
      <div><b>${esc(d.title)}</b><small class="muted">Guía de Mr.E${d.chars ? ' · ' + esc(d.chars.join(', ')) : ''}</small></div></div>
    ${(d.chars || []).map(c => `<button class="btn" data-a="mreToNote" data-v="${esc(c)}">📝 ${getNote(noteId.mu(my, c)) ? 'Abrir' : 'Crear'} mi nota ${esc(my)} vs ${esc(c)}</button>`).join('')}
    <button class="btn" data-a="mreFull" data-v="${esc(d.title)}">⛶ Leer en pantalla completa</button>
    <section class="card mre-text">${mreTextHTML(d.text)}</section>`;
}

const notePlaceholder = isMu => (isMu
  ? 'Qué hace en neutral, cómo te mata, a qué % lo matás, qué stages banear…'
  : 'Qué personajes usa, sus hábitos, cómo se adapta…');

// lector a pantalla completa: el título queda fijo arriba
function openReader(title, sub, bodyHTML, extra = '') {
  openSheet(`<div class="sheet-head full-head"><div class="full-title"><b>${title}</b>${sub ? `<small class="muted">${sub}</small>` : ''}</div>
    <button class="btn icon" data-a="closeSheet" aria-label="cerrar">✕</button></div>
    <div class="sheet-body full-body">${bodyHTML}${extra}</div>`, { full: true });
}

// editor a pantalla completa de la nota abierta
function openNoteFull() {
  const base = S.noteOpen;
  const isMu = base.kind === 'mu';
  const current = view.querySelector('[data-in="noteText"]')?.value ?? getNote(base.id)?.text ?? '';
  openSheet(`<div class="sheet-head full-head"><div class="full-title">
      <b>${isMu ? `${esc(base.myChar)} vs ${esc(base.oppChar)}` : esc(base.player)}</b>
      <small class="muted note-status">${isMu ? 'Nota del matchup' : 'Nota del jugador'} · se guarda sola</small></div>
    <button class="btn icon" data-a="closeSheet" aria-label="cerrar">✕</button></div>
    <div class="sheet-body full-body"><textarea class="inp note-text full-note" data-in="noteText" placeholder="${notePlaceholder(isMu)}">${esc(current)}</textarea></div>`,
  { full: true, onClose: async () => { await flushNote(); if (S.tab === 'notas' && S.noteOpen) renderNotas(); } });
}

// agrega la guía de Mr.E a la nota abierta (reemplaza si está vacía, si no la suma al final)
function applyMreTemplate(char) {
  const ta = view.querySelector('[data-in="noteText"]');
  if (!ta || !mreDocFor(char)) return;
  ta.value = ta.value.trim() ? `${ta.value.trimEnd()}\n\n${mreTemplate(char)}` : mreTemplate(char);
  queueNote(ta.value);
  toast('Guía de Mr.E agregada a tu nota', 'ok');
}

// ---------- scouting de rivales (start.gg) ----------
// En meta 'scout' quedan quién es quién (tag → jugador de start.gg) y los últimos informes, para verlos sin internet en el torneo.
const SCOUT_MAX = 25;
let scoutData = null;
async function loadScout() {
  scoutData ||= (await db.get('meta', 'scout')) || { people: {}, reports: {} };
  return scoutData;
}

const scoutBtnHTML = name => (S.sgg.token && norm(name).length >= 2
  ? `<button type="button" class="btn sm" data-a="scoutOpen" data-v="${esc(name.trim())}">🔎 Scouting de ${esc(name.trim())} en start.gg</button>` : '');

const scoutStatus = msg => {
  const b = sheet.querySelector('.scout-body');
  if (b) b.innerHTML = `<p class="muted">${msg}</p>`;
  return !!b;
};

async function openScout(name, force = false) {
  if (!S.sgg.token) { toast('Conectá tu cuenta de start.gg en Ajustes para usar el scouting', 'err'); return; }
  await loadScout();
  const person = scoutData.people[norm(name)];
  const cached = person && scoutData.reports[person.id];
  if (cached && !force) { showScout(cached); return; }
  openReader(`🔎 ${esc(name)}`, 'Scouting en start.gg', '<div class="scout-body"></div>');
  scoutStatus('Buscando…');
  try {
    const who = person || await findScoutPlayer(name);
    if (!who) {
      const b = sheet.querySelector('.scout-body');
      if (b) b.innerHTML = scoutLinkHTML(name);
      return;
    }
    await runScout(name, who);
  } catch (err) {
    scoutStatus('No se pudo: ' + esc(err.message));
  }
}

// 1) entre tus rivales de torneos; 2) entre los inscriptos de tus últimos torneos
async function findScoutPlayer(name) {
  const key = norm(name);
  if (S.ext && S.sgg.playerId && S.ext.sets.some(s => s.oppPid === undefined)) {
    scoutStatus('Preparando tu historial de start.gg (solo la primera vez)…');
    const changed = await sgg.fillOppIds({
      token: S.sgg.token, playerId: S.sgg.playerId, ext: S.ext,
      onProgress: (p, t) => scoutStatus(`Preparando tu historial de start.gg (solo la primera vez)… ${p} de ${t}`),
    });
    if (changed) await db.put('meta', S.ext, 'sggExt');
  }
  const s = S.ext?.sets.find(x => x.oppPid && norm(x.opp) === key);
  if (s) return { id: s.oppPid, gamerTag: s.opp };
  const evs = (S.ext?.events || []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(e => e.id);
  if (!evs.length) return null;
  scoutStatus('Buscándolo en tus últimos torneos…');
  return sgg.findInEvents(S.sgg.token, name.trim(), evs);
}

const scoutLinkHTML = name => `
  <p>No encontré a <b>${esc(name)}</b> entre tus rivales ni en tus últimos torneos.</p>
  <p class="muted small">Abrí su perfil en start.gg (tocá su nombre en el bracket), copiá el link (start.gg/user/…) y pegalo acá:</p>
  <input id="scoutLink" class="inp" placeholder="https://www.start.gg/user/…" autocomplete="off" autocapitalize="off">
  <button class="btn big primary" data-a="scoutLink" data-v="${esc(name)}">Buscar</button>`;

async function runScout(name, who) {
  scoutStatus(`Bajando los últimos sets de ${esc(who.gamerTag)}…`);
  const r = await sgg.scout({
    token: S.sgg.token, playerId: who.id,
    onProgress: (p, t) => scoutStatus(`Bajando los últimos sets de ${esc(who.gamerTag)}… ${p} de ${t}`),
  });
  const person = { id: r.playerId, gamerTag: r.gamerTag || who.gamerTag };
  scoutData.people[norm(name)] = person;
  scoutData.people[norm(person.gamerTag)] = person;
  scoutData.reports[r.playerId] = r;
  // quedan solo los informes más recientes
  const old = Object.values(scoutData.reports).sort((a, b) => b.fetchedAt - a.fetchedAt).slice(SCOUT_MAX);
  old.forEach(x => delete scoutData.reports[x.playerId]);
  await db.put('meta', scoutData, 'scout');
  if (sheet.querySelector('.scout-body')) showScout(r);
  // ahora se saben sus personajes: se sugieren al cargar
  if (S.tab === 'cargar' && S.form && $('#oppCharBox')) $('#oppCharBox').innerHTML = oppCharsHTML(S.form);
}

function showScout(r) {
  openReader(`🔎 ${esc(r.gamerTag)}`, `start.gg · últimos ${r.sets.length} sets · datos del ${fmtDate(st.ymd(new Date(r.fetchedAt)))}`,
    `<div class="scout-body">${scoutHTML(r)}</div>`);
}

// cuenta victorias por clave: [{ k, w, n }]
function tally(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!k) continue;
    const e = m.get(k) || { k, w: 0, n: 0 };
    e.n++; if (x.won) e.w++;
    m.set(k, e);
  }
  return [...m.values()];
}

function scoutHTML(r) {
  const sets = r.sets.filter(s => !s.dq);
  const sw = sets.filter(s => s.won).length, gw = r.games.filter(g => g.won).length;
  const pct = (w, n) => (n ? Math.round(w / n * 100) + '%' : '—');
  const wl = (w, n) => `<b class="win">${w}</b>-<b class="loss">${n - w}</b>`;
  const row = (label, e) => `<div class="sc-row ${e.n >= 2 ? (e.w / e.n >= 0.6 ? 'good' : e.w / e.n <= 0.4 ? 'bad' : '') : ''}">
    <span>${label}</span><small>${wl(e.w, e.n)} · ${pct(e.w, e.n)}</small></div>`;
  const chars = tally(r.games, g => g.char).sort((a, b) => b.n - a.n);
  const stages = tally(r.games, g => g.stage).sort((a, b) => b.w / b.n - a.w / a.n || b.n - a.n);
  const picks = tally(r.games.filter(g => g.picked), g => g.stage).sort((a, b) => b.n - a.n);
  const vsMe = (S.ext?.sets || []).filter(s => !s.dq && s.my != null && (s.oppPid === r.playerId || norm(s.opp) === norm(r.gamerTag)));
  const evName = new Map(r.events.map(e => [e.id, e.name]));
  const events = r.events.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return `
    <section class="card">
      <span class="lbl">Resumen</span>
      <div class="sc-row"><span>Sets</span><small>${wl(sw, sets.length)} · ${pct(sw, sets.length)}</small></div>
      ${r.games.length ? `<div class="sc-row"><span>Games</span><small>${wl(gw, r.games.length)} · ${pct(gw, r.games.length)}</small></div>` : ''}
      ${vsMe.length ? `<div class="sc-row"><span>Vos contra ${esc(r.gamerTag)}</span><small>${wl(vsMe.filter(s => s.won).length, vsMe.length)} en sets</small></div>` : ''}
      ${sets.length < MIN_N ? `<p class="small warn-text">⚠ Solo ${sets.length} sets en start.gg: tomalo como referencia.</p>` : ''}
    </section>
    ${r.games.length ? `
    <section class="card">
      <span class="lbl">Personajes</span>
      ${chars.map(e => row(`${esc(e.k)} <small class="muted">${e.n} game${e.n === 1 ? '' : 's'}</small>`, e)).join('')}
    </section>
    <section class="card">
      <span class="lbl">Stages (sus resultados)</span>
      ${stages.map(e => row(esc(e.k), e)).join('')}
      ${picks.length ? `<span class="lbl sub">Counterpicks: lo que eligió después de perder un game</span>
        <div class="chips">${picks.map(e => `<span class="chip sm static">${esc(e.k)} ×${e.n}</span>`).join('')}</div>` : ''}
    </section>` : '<p class="muted small">Sus torneos no tienen detalle por game (personajes y stages).</p>'}
    ${events.length ? `<section class="card">
      <span class="lbl">Torneos recientes</span>
      ${events.map(e => `<div class="sc-row"><span>${esc(e.name)}<small class="muted"> · ${fmtDate(e.date)}</small></span>
        <small>${e.placement ? `${e.placement}° de ${e.entrants}` : '—'}</small></div>`).join('')}
    </section>` : ''}
    ${sets.length ? `<section class="card">
      <span class="lbl">Últimos sets</span>
      ${sets.slice(0, 10).map(s => `<div class="sc-set ${s.won ? 'w' : 'l'}"><b>${s.won ? 'W' : 'L'} ${s.my}-${s.their}</b>
        <span>vs ${esc(s.opp)}${s.chars.length ? ` · usó ${esc(s.chars.join('/'))}` : ''}<small class="muted">${esc(evName.get(s.event) || '')} · ${esc(s.round || '')}</small></span></div>`).join('')}
    </section>` : ''}
    <div class="btn-row">
      <button class="btn" data-a="scoutRefresh" data-v="${esc(r.gamerTag)}">↻ Actualizar</button>
      <button class="btn" data-a="scoutToNote" data-v="${r.playerId}">📝 Pasar a su nota</button></div>`;
}

// resumen en texto para la nota del jugador
function scoutSummary(r) {
  const top = (arr, n) => arr.slice(0, n).map(e => `${e.k} (${e.w}-${e.n - e.w})`).join(', ');
  const chars = tally(r.games, g => g.char).sort((a, b) => b.n - a.n);
  const stages = tally(r.games, g => g.stage).filter(e => e.n >= 2);
  const best = stages.slice().sort((a, b) => b.w / b.n - a.w / a.n);
  const worst = stages.slice().sort((a, b) => a.w / a.n - b.w / b.n);
  const picks = tally(r.games.filter(g => g.picked), g => g.stage).sort((a, b) => b.n - a.n);
  const sets = r.sets.filter(s => !s.dq);
  return [`— Scouting start.gg (${fmtDateLong(st.ymd(new Date(r.fetchedAt)))}) —`,
    `Últimos sets: ${sets.filter(s => s.won).length}-${sets.filter(s => !s.won).length}`,
    chars.length && `Personajes: ${top(chars, 3)}`,
    best.length && `Gana más en: ${top(best, 2)}`,
    worst.length && `Pierde más en: ${top(worst, 2)}`,
    picks.length && `Counterpicks: ${picks.slice(0, 3).map(e => `${e.k} ×${e.n}`).join(', ')}`,
  ].filter(Boolean).join('\n');
}

function renderNotas() {
  setTitle('Notas');
  if (S.noteOpen) { view.innerHTML = noteDetailHTML(); return; }
  const seg = (v, l) => `<button class="seg-btn ${S.notesTab === v ? 'on' : ''}" data-a="notesTab" data-v="${v}">${l}</button>`;
  const body = { mu: notesMuHTML, pl: notesPlHTML, games: notesGamesHTML, mre: notesMreHTML }[S.notesTab]();
  view.innerHTML = `<div class="seg">${seg('mu', 'Matchups')}${seg('pl', 'Jugadores')}${seg('games', 'Notas de games')}${seg('mre', '📘 Mr.E')}</div>${body}`;
}

function openNote(base) {
  flushNote();
  S.noteOpen = base;
  S.tab = 'notas';
  render();
  window.scrollTo(0, 0);
}

// guardado con espera: no escribe en la base en cada tecla
let noteTimer = null, notePending = null;
function queueNote(text) {
  const base = S.noteOpen;
  notePending = () => saveNote(base, text);
  clearTimeout(noteTimer);
  // el estado se muestra en la nota y en la pantalla completa
  const setStatus = msg => document.querySelectorAll('.note-status').forEach(s => { s.textContent = msg; });
  setStatus('Guardando…');
  noteTimer = setTimeout(async () => {
    await flushNote();
    setStatus(text.trim() ? 'Guardado' : 'Nota vacía (se borra)');
  }, 600);
}
async function flushNote() {
  clearTimeout(noteTimer);
  const p = notePending;
  notePending = null;
  if (p) await p();
}

// resumen de la nota en la pantalla de carga, para leerla antes de jugar
function noteHint(n, label) {
  return n ? `<button type="button" class="note-hint" data-a="noteView" data-v="${esc(n.id)}">📝 <b>${label}</b><span>${esc(snip(n.text, 110))}</span></button>` : '';
}
const rivalNoteHint = () => (S.form.rival.trim().length >= 2 ? noteHint(getNote(noteId.pl(S.form.rival)), `Nota de ${esc(S.form.rival.trim())}`) : '');
const muNoteHint = () => (S.form.oppChar ? noteHint(getNote(noteId.mu(S.form.myChar, S.form.oppChar)), `Nota ${esc(S.form.myChar)} vs ${esc(S.form.oppChar)}`)
  + (mreDocFor(S.form.oppChar) ? `<button type="button" class="mre-hint" data-a="mreView" data-v="${esc(S.form.oppChar)}">📘 Guía de Mr.E vs ${esc(S.form.oppChar)}</button>` : '') : '');

// ---------- navegación y eventos ----------
function go(tab) {
  flushNote();
  // tocar "Notas" estando en una nota vuelve a la lista
  if (tab === 'notas' && S.tab === 'notas') { S.noteOpen = null; S.mreOpen = null; }
  S.tab = tab;
  if (tab === 'cargar' && !S.form && !S.lastSaved) S.form = newForm();
  render();
  window.scrollTo(0, 0);
}

function render() {
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  $('.tabbar [data-tab="ajustes"]').classList.toggle('dot', backupOverdue());
  ({ cargar: renderCargar, stats: renderStats, historial: renderHist, notas: renderNotas, ajustes: renderAjustes })[S.tab]();
}

const actions = {
  set: t => setField(t.dataset.f, t.dataset.v),
  inc: t => bump(t.dataset.f, 1),
  dec: t => bump(t.dataset.f, -1),
  save: () => saveGame(),
  rivalPick: t => { S.form.rival = t.dataset.v; autoOppChar(S.form); renderCargar(); },
  pickChar: t => openPicker(t.dataset.v),
  stageTap: t => stageTap(t.dataset.v),
  setBan: t => { S.form[t.dataset.f] = t.dataset.v || null; renderCargar(); },
  banReset: () => { Object.assign(S.form, { bans: [], stage: '', stagePicker: null }); renderCargar(); },
  banFree: () => { S.form.banFree = !S.form.banFree; renderCargar(); },
  pickDone: t => {
    closeSheet();
    if (pickerTarget === 'note') { openNote(muBase(S.noteMy || S.settings.main, t.dataset.v)); return; }
    setField(pickerTarget === 'opp' ? 'oppChar' : 'myChar', t.dataset.v);
  },
  notesTab: t => { S.notesTab = t.dataset.v; S.noteQuery = ''; S.mreOpen = null; renderNotas(); },
  mreOpen: t => { S.mreOpen = t.dataset.v; renderNotas(); window.scrollTo(0, 0); },
  mreBack: () => { S.mreOpen = null; renderNotas(); window.scrollTo(0, 0); },
  mreToNote: t => {
    const char = t.dataset.v;
    const base = muBase(S.noteMy || S.settings.main, char);
    const isNew = !getNote(base.id);
    openNote(base);
    if (isNew) applyMreTemplate(char);
  },
  mreUse: t => applyMreTemplate(t.dataset.v),
  mreView: t => {
    const d = mreDocFor(t.dataset.v);
    if (d) openReader(`📘 ${esc(d.title)}`, 'Guía de Mr.E', `<div class="mre-text">${mreTextHTML(d.text)}</div>`);
  },
  mreFull: t => {
    const d = mreFind(t.dataset.v);
    if (d) openReader(`📘 ${esc(d.title)}`, 'Guía de Mr.E', `<div class="mre-text">${mreTextHTML(d.text)}</div>`);
  },
  noteFull: () => openNoteFull(),
  scoutOpen: t => openScout(t.dataset.v),
  scoutRefresh: t => openScout(t.dataset.v, true),
  scoutLink: async t => {
    const link = sheet.querySelector('#scoutLink')?.value || '';
    try {
      scoutStatus('Buscando el perfil…');
      await runScout(t.dataset.v, await sgg.playerFromLink(S.sgg.token, link));
    } catch (err) {
      const b = sheet.querySelector('.scout-body');
      if (b) b.innerHTML = `<p class="small loss">No se pudo: ${esc(err.message)}</p>${scoutLinkHTML(t.dataset.v)}`;
    }
  },
  scoutToNote: async t => {
    const r = scoutData?.reports[t.dataset.v];
    if (!r) return;
    await flushNote(); // lo que se estaba escribiendo se guarda antes de sumar el resumen
    const base = plBase(r.gamerTag);
    const cur = getNote(base.id)?.text || '';
    await saveNote(base, cur.trim() ? `${cur.trimEnd()}\n\n${scoutSummary(r)}` : scoutSummary(r));
    closeSheet();
    openNote(base);
    toast('Resumen agregado a la nota', 'ok');
  },
  noteMy: t => { S.noteMy = t.dataset.v; renderNotas(); },
  noteOpen: t => { const n = getNote(t.dataset.v); if (n) openNote({ id: n.id, kind: n.kind, myChar: n.myChar, oppChar: n.oppChar, player: n.player }); },
  noteNewMu: () => openPicker('note'),
  noteMuQuick: t => openNote(muBase(S.noteMy || S.settings.main, t.dataset.v)),
  notePickPl: t => { closeSheet(); openNote(plBase(t.dataset.v)); },
  noteNewPl: () => {
    openSheet(`<div class="sheet-head"><input id="plq" class="inp" placeholder="Nombre o tag del jugador" autocomplete="off" autocapitalize="words">
      <button class="btn icon" data-a="closeSheet" aria-label="cerrar">✕</button></div>
      <div class="sheet-body"><button class="btn big primary" data-a="notePlCreate">Crear nota</button>
      <div class="lbl">Rivales conocidos</div><div class="chips" id="plsug"></div></div>`);
    const fill = q => {
      const list = knownPlayers().filter(p => !q || norm(p.name).includes(norm(q))).slice(0, 24);
      $('#plsug').innerHTML = list.map(p => `<button class="chip sm" data-a="notePickPl" data-v="${esc(p.name)}">${esc(p.name)}</button>`).join('') || '<p class="muted small">Sin coincidencias: tocá "Crear nota".</p>';
    };
    fill('');
    $('#plq').addEventListener('input', e => fill(e.target.value));
  },
  notePlCreate: () => {
    const name = $('#plq').value.trim();
    if (!name) { toast('Escribí el nombre del jugador', 'err'); return; }
    // si ya existe con otra forma de escribirlo, usa ese nombre
    const known = knownPlayers().find(p => norm(p.name) === norm(name));
    closeSheet();
    openNote(plBase(known ? known.name : name));
  },
  noteBack: () => { flushNote(); S.noteOpen = null; renderNotas(); window.scrollTo(0, 0); },
  noteTemplate: () => {
    const ta = view.querySelector('[data-in="noteText"]');
    ta.value = NOTE_TEMPLATES[S.noteOpen.kind] + ta.value;
    queueNote(ta.value);
    ta.focus();
  },
  noteDelete: async () => {
    const ok = await ask('Borrar nota', 'Se borra esta nota. Las notas de tus games no se tocan.', [{ value: 'y', label: 'Borrar nota', cls: 'danger' }]);
    if (!ok) return;
    notePending = null; clearTimeout(noteTimer);
    await saveNote(S.noteOpen, '');
    S.noteOpen = null;
    renderNotas();
    toast('Nota borrada');
  },
  noteGame: t => { flushNote(); editGame(t.dataset.v, 'notas'); },
  noteView: t => {
    const n = getNote(t.dataset.v);
    if (!n) return;
    openReader(n.kind === 'mu' ? `${esc(n.myChar)} vs ${esc(n.oppChar)}` : esc(n.player), n.kind === 'mu' ? 'Nota del matchup' : 'Nota del jugador',
      `<div class="note-read">${esc(n.text)}</div>`, `<button class="btn big" data-a="noteEditFrom" data-v="${esc(n.id)}">Editar en Notas</button>`);
  },
  noteEditFrom: t => {
    const n = getNote(t.dataset.v);
    closeSheet();
    if (n) openNote({ id: n.id, kind: n.kind, myChar: n.myChar, oppChar: n.oppChar, player: n.player });
  },
  closeSheet: () => closeSheet(),
  answer: t => { const r = sheetResolve; sheetResolve = null; closeSheet(); r && r(t.dataset.v); },
  nextGame: () => { S.form = nextForm(S.lastSaved); S.lastSaved = null; render(); window.scrollTo(0, 0); },
  resStock: t => {
    const f = S.form, k = Number(t.dataset.v);
    if (!f.result) return;
    if (f.result === 'W') { f.myStocksLeft = k; f.oppStocksLeft = 0; } else { f.oppStocksLeft = k; f.myStocksLeft = 0; }
    if (navigator.vibrate) navigator.vibrate(15);
    renderCargar();
  },
  showSet: () => { S.form.showSet = true; renderCargar(); },
  banMode: () => {
    S.settings.banMode = S.settings.banMode === 'pick' ? 'all' : 'pick';
    db.put('meta', S.settings, 'settings');
    if (S.form) Object.assign(S.form, { bans: [], stage: '', stagePicker: null });
    S.tab === 'cargar' ? renderCargar() : renderAjustes();
  },
  freshInfo: () => openSheet(`<div class="sheet-head"><h2>📦 La app arrancó sin datos</h2><button class="btn icon ghost" data-a="closeSheet" aria-label="Cerrar">✕</button></div>
    <div class="sheet-body"><p class="small">Si es la primera vez que la abrís, ignorá esto. Si ya tenías games, notas o tu token de start.gg,
      <b>el navegador borró los datos de este sitio</b>. Tus torneos de start.gg se cargan de nuevo solos; lo demás se recupera importando un respaldo.</p>
      <button class="btn" data-a="storageHelp">Cómo evitar que pase</button>
      <label class="btn file-btn">Importar respaldo<input type="file" accept=".json,.txt,application/json,text/plain" data-in="importFile" hidden></label>
      ${drive.CLIENT_ID ? '<button class="btn" data-a="driveRestore">Recuperar desde Google Drive</button>' : ''}</div>`),
  newSet: () => { S.form = newForm(); S.lastSaved = null; render(); window.scrollTo(0, 0); },
  editLast: () => { const id = S.lastSaved.id; S.lastSaved = null; editGame(id, 'cargar'); },
  cancelEdit: () => {
    if (S.returnTab === 'cargar') { S.lastSaved = S.games.find(g => g.id === S.editingId) || null; S.form = S.lastSaved ? null : newForm(); }
    else S.form = newForm();
    S.editingId = null;
    S.vodFocus = false;
    go(S.returnTab || 'historial');
  },
  go: t => go(t.dataset.v),
  toggleFilters: () => { S.filtersOpen = !S.filtersOpen; renderStats(); },
  clearFilters: () => { S.filters = {}; renderStats(); },
  range: t => {
    S.filters.to = null;
    S.filters.from = t.dataset.v === 'all' ? null : daysAgo(Number(t.dataset.v));
    renderStats();
  },
  statsTab: t => { S.statsTab = t.dataset.v; renderStats(); },
  sggImport: async () => {
    await importStartgg('always');
    const merged = await reconcile();
    if (merged) toast(mergedMsg(merged), 'ok');
    renderAjustes();
  },
  dupReview: () => openSheet(dupSheetHTML()),
  dupMerge: async t => {
    const [m, i] = t.dataset.v.split('|');
    const sets = st.groupSets(S.games);
    if (!sets.get(m) || !sets.get(i)) return;
    await mergeSets(sets.get(m), sets.get(i));
    await reconcile();
    refreshDups();
    toast('Sets unidos', 'ok');
  },
  dupSkip: async t => {
    if (!S.dupSkip.includes(t.dataset.v)) S.dupSkip.push(t.dataset.v);
    await db.put('meta', S.dupSkip, 'dupSkip');
    S.dups = S.dups.filter(d => `${d.m}|${d.i}` !== t.dataset.v);
    refreshDups();
  },
  openTwin: t => {
    const s = st.groupSets(S.games).get(t.dataset.v);
    if (!s) return;
    Object.assign(S, { histMode: 'all', histSource: 'all', histQuery: s.rival, histLimit: 25 });
    S.histOpen.add(s.setId);
    go('historial');
    view.querySelector(`.set-head[data-v="${CSS.escape(s.setId)}"]`)?.scrollIntoView({ block: 'start' });
  },
  sggSync: () => runSync(true),
  storageHelp: () => openSheet(`<div class="sheet-head"><h2>Que Brave no borre tus datos</h2>
    <button class="btn icon" data-a="closeSheet" aria-label="cerrar">✕</button></div><div class="sheet-body">${STORAGE_HELP}</div>`),
  freshOk: () => { S.freshDismissed = true; render(); },
  driveBackup: () => {
    if (!S.games.length && !S.notes.length) { toast('Todavía no hay datos para respaldar', 'err'); return; }
    runDrive('backup');
  },
  driveRestore: () => runDrive('restore'),
  driveFile: t => driveFile(t.dataset.v, t.dataset.n),
  driveLater: () => { S.driveLater = true; render(); },
  driveRemind: t => { S.drive.remind = t.dataset.v === 'on'; saveDrive(); renderAjustes(); },
  driveForget: async () => {
    const ok = await ask('Desconectar Google Drive', `La app deja de usar <b>${esc(S.drive.email)}</b>. Los respaldos que ya están en tu Drive no se borran.`,
      [{ value: 'y', label: 'Desconectar', cls: 'danger' }]);
    if (!ok) return;
    if (driveAuth) drive.revoke(driveAuth.token);
    driveAuth = null;
    S.drive = { email: '', lastBackup: null, remind: true };
    await saveDrive();
    renderAjustes();
  },
  sggSaveToken: async () => {
    const token = view.querySelector('[data-in="sggToken"]').value.trim();
    if (!/^[a-z0-9]{20,}$/i.test(token)) { toast('Eso no parece un token de start.gg', 'err'); return; }
    try {
      const me = await identify(token);
      S.sgg.token = token;
      await saveSgg();
      toast(`Conectado como ${me.gamerTag}`, 'ok');
      runSync(true);
    } catch (err) { toast('No se pudo conectar: ' + err.message, 'err'); }
  },
  sggAuto: t => { S.sgg.auto = t.dataset.v === 'on'; saveSgg(); renderAjustes(); },
  sggForget: async () => {
    const ok = await ask('Borrar token', 'Se borra el token de este teléfono. Los torneos ya bajados quedan.', [{ value: 'y', label: 'Borrar token', cls: 'danger' }]);
    if (!ok) return;
    S.sgg.token = ''; S.sgg.lastError = null;
    await saveSgg();
    renderAjustes();
  },
  sggRemove: async () => {
    const ids = S.games.filter(g => g.imported).map(g => g.id);
    const ok = await ask('Quitar torneos importados', `Se van a quitar <b>${ids.length}</b> games importados de start.gg (también los % u openings que les hayas agregado). Tus games cargados a mano no se tocan.`,
      [{ value: 'y', label: 'Sí, quitarlos', cls: 'danger' }]);
    if (!ok) return;
    await db.delMany('games', ids);
    S.games = S.games.filter(g => !g.imported);
    await db.put('meta', 'off', 'sggImport');
    renderAjustes();
    toast('Games importados quitados');
  },
  extRange: t => { S.extRange = t.dataset.v; renderStats(); },
  extAllEvents: () => { S.extAllEvents = true; renderStats(); },
  mSort: t => { S.mSort = t.dataset.v; renderStats(); },
  toggleSet: t => { const id = t.dataset.v; S.histOpen.has(id) ? S.histOpen.delete(id) : S.histOpen.add(id); renderHist(); },
  more: () => { S.histLimit += 25; renderHist(); },
  histSource: t => { S.histSource = t.dataset.v; S.histLimit = 25; renderHist(); window.scrollTo(0, 0); },
  edit: t => editGame(t.dataset.v, 'historial'),
  vodFill: t => editGame(t.dataset.v, 'historial', true),
  vodSkip: t => skipVod([t.dataset.v]),
  vodSkipAll: async () => {
    const ids = S.games.filter(needsVod).map(g => g.id);
    const ok = await ask('Quitar pendientes', `Se van a quitar <b>${ids.length}</b> games de la lista de VOD pendientes. Los datos no se borran.`, [{ value: 'y', label: 'Sí, quitarlos', cls: 'primary' }]);
    if (ok) skipVod(ids);
  },
  histMode: t => { S.histMode = t.dataset.v; renderHist(); window.scrollTo(0, 0); },
  addToSet: t => {
    const gs = S.games.filter(g => g.setId === t.dataset.v).sort((a, b) => b.gameNum - a.gameNum);
    S.form = nextForm(gs[0]); S.lastSaved = null; S.editingId = null; go('cargar');
  },
  delGame: async t => {
    const g = S.games.find(x => x.id === t.dataset.v);
    const ok = await ask('Borrar game', `¿Borrar G${g.gameNum} vs <b>${esc(g.rival)}</b> (${esc(g.myChar)} vs ${esc(g.oppChar)}, ${fmtDate(g.date)})?`, [{ value: 'y', label: 'Sí, borrar', cls: 'danger' }]);
    if (!ok) return;
    await db.del('games', g.id);
    S.games = S.games.filter(x => x.id !== g.id);
    if (S.lastSaved?.id === g.id) { S.lastSaved = null; S.form = newForm(); }
    render();
    toast('Game borrado');
  },
  export: t => doExport(t.dataset.k, t.dataset.m),
  setStocks: t => {
    S.settings.casualStocks = Number(t.dataset.v);
    db.put('meta', S.settings, 'settings');
    if (S.form && !S.editingId && S.form.type === 'casual') S.form.stocks = S.settings.casualStocks;
    renderAjustes();
  },
  setStageStyle: t => { S.settings.stageStyle = t.dataset.v; db.put('meta', S.settings, 'settings'); renderAjustes(); },
  loadSample: () => loadSample(),
  clearSample: async () => {
    const ids = S.games.filter(g => g.sample).map(g => g.id);
    await db.delMany('games', ids);
    S.games = S.games.filter(g => !g.sample);
    render();
    toast('Datos de ejemplo borrados');
  },
  wipe: async () => {
    const ok = await ask('Borrar todo', `Se van a borrar <b>${S.games.length}</b> games y <b>${S.notes.length}</b> notas de este teléfono. No se puede deshacer. ¿Exportaste un respaldo?`,
      [{ value: 'y', label: 'Sí, borrar todo', cls: 'danger' }]);
    if (!ok) return;
    await db.clear('games'); await db.clear('notes');
    S.games = []; S.notes = []; S.noteOpen = null; S.lastSaved = null; S.form = newForm();
    render();
    toast('Datos borrados');
  },
};

function onClick(e) {
  const tip = e.target.closest('[data-tip]');
  if (tip) { toast(tip.dataset.tip); return; }
  const t = e.target.closest('[data-a]');
  if (t && actions[t.dataset.a]) actions[t.dataset.a](t, e);
}
view.addEventListener('click', onClick);
// en PC, tocar el texto de la fecha también abre el calendario
view.addEventListener('click', e => { if (e.target.matches('.date-pick input')) try { e.target.showPicker(); } catch {} });
sheet.addEventListener('click', onClick);
// escribir en la nota a pantalla completa
sheet.addEventListener('input', e => { if (e.target.dataset.in === 'noteText') queueNote(e.target.value); });

view.addEventListener('input', e => {
  const t = e.target;
  const k = t.dataset.in;
  if (!k) return;
  if (k === 'rival') {
    S.form.rival = t.value;
    const changed = autoOppChar(S.form);
    $('#rivalSug').innerHTML = rivalSuggestions();
    $('#rivalH2H').innerHTML = rivalBoxHTML();
    $('#oppCharBox').innerHTML = oppCharsHTML(S.form);
    // cambió el personaje del rival: se actualizan la nota del matchup y los stages, sin tocar el campo que estás escribiendo
    if (changed) {
      syncBans(S.form);
      $('#muHint').innerHTML = muNoteHint();
      $('#stageBox').innerHTML = stageSectionHTML(S.form);
    }
  }
  else if (k === 'notes') S.form.notes = t.value;
  else if (k === 'kill' || k === 'death') {
    t.value = t.value.replace(/\D/g, '').slice(0, 3);
    const arr = k === 'kill' ? S.form.killPercents : S.form.deathPercents;
    arr[Number(t.dataset.i)] = t.value === '' ? null : Number(t.value);
  } else if (k === 'histQuery' || k === 'noteQuery') {
    S[k] = t.value;
    const pos = t.selectionStart;
    k === 'histQuery' ? renderHist() : renderNotas();
    const inp = view.querySelector(`[data-in="${k}"]`);
    inp.focus(); inp.setSelectionRange(pos, pos);
  } else if (k === 'noteText') queueNote(t.value);
});

view.addEventListener('change', async e => {
  const t = e.target;
  if (t.closest('.date-pick')) t.previousElementSibling.textContent = '📅 ' + (t.value ? fmtDateLong(t.value) : 'dd/mm/aaaa');
  if (t.dataset.filter) { S.filters[t.dataset.filter] = t.value || null; renderStats(); return; }
  const k = t.dataset.in;
  if (k === 'date') S.form.date = t.value || today();
  else if (k === 'focusKpi') { S.focusKpi = t.value; db.put('meta', t.value, 'focusKpi'); renderStats(); }
  else if (k === 'setMain' || k === 'setSecond') {
    S.settings[k === 'setMain' ? 'main' : 'second'] = t.value;
    await db.put('meta', S.settings, 'settings');
    if (S.form && !S.editingId && !S.form.rival) S.form.myChar = S.settings.main;
    toast('Guardado', 'ok');
  } else if (k === 'importFile' && t.files[0]) { await importFile(t.files[0]); t.value = ''; }
});

// recuerda si la sección de VOD quedó abierta o cerrada (toggle no burbujea: se escucha en captura)
view.addEventListener('toggle', e => {
  if (S.form && e.target.matches?.('[data-vod]')) S.form.vodOpen = e.target.open;
  // "Recovery y Limit": queda abierto o cerrado como lo dejaste, para todos los games
  if (e.target.matches?.('[data-more]') && S.settings.moreOpen !== e.target.open) {
    S.settings.moreOpen = e.target.open;
    db.put('meta', S.settings, 'settings');
  }
}, true);

// importar un respaldo desde una hoja (aviso de "la app arrancó sin datos")
sheet.addEventListener('change', async e => {
  if (e.target.dataset.in === 'importFile' && e.target.files[0]) { const file = e.target.files[0]; closeSheet(); await importFile(file); }
});

// Enter en un campo de % pasa al siguiente
view.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList.contains('pct')) return;
  e.preventDefault();
  const all = [...view.querySelectorAll('input.pct')];
  const next = all[all.indexOf(e.target) + 1];
  next ? next.focus() : e.target.blur();
});

document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) go(b.dataset.tab);
});

async function init() {
  // vuelta de Google con el permiso para Drive (se limpia la dirección enseguida)
  const driveRet = drive.takeRedirect();
  if (driveRet) S.tab = 'ajustes';
  try {
    const [games, settings, lastBackup, focusKpi, notes, driveConf, dupSkip] = await Promise.all([
      db.getAll('games'), db.get('meta', 'settings'), db.get('meta', 'lastBackup'), db.get('meta', 'focusKpi'), db.getAll('notes'),
      db.get('meta', 'drive'), db.get('meta', 'dupSkip'),
    ]);
    Object.assign(S.drive, driveConf || {});
    S.dupSkip = Array.isArray(dupSkip) ? dupSkip : [];
    S.notes = notes;
    // quita restos del formato de ataques que ya no se usa
    S.games = games.map(g => { if ('attacks' in g) delete g.attacks; return g; });
    Object.assign(S.settings, settings || {});
    S.lastBackup = lastBackup || null;
    if (focusKpi && KPIS[focusKpi]) S.focusKpi = focusKpi;
    S.persisted = (await navigator.storage?.persisted?.()) || false;
    // fecha de creación de la base: si falta y no hay nada guardado, la base arrancó vacía
    // (primera vez, o Brave borró los datos del sitio)
    let createdAt = await db.get('meta', 'createdAt');
    if (!createdAt) {
      S.freshDb = !games.length && !notes.length && !settings && !lastBackup;
      createdAt = Date.now();
      await db.put('meta', createdAt, 'createdAt');
    }
    S.createdAt = createdAt;
  } catch (err) {
    view.innerHTML = `<p class="empty">No se pudo abrir la base de datos: ${esc(err.message)}</p>`;
    return;
  }
  S.form = newForm();
  render();
  if (driveRet?.error) toast('Google Drive: ' + driveRet.error, 'err');
  else if (driveRet?.token) { driveAuth = driveRet; if (DRIVE_ACTIONS[driveRet.pending]) runDrive(driveRet.pending); }
  requestPersist();
  loadMre();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  // historial de torneos: solo el que bajó este teléfono con su propio token (la app no trae datos de nadie)
  const [stored, sggConf] = await Promise.all([db.get('meta', 'sggExt'), db.get('meta', 'sgg')]);
  Object.assign(S.sgg, sggConf || {});
  S.ext = stored?.format === 'smash-kpi-torneos' ? stored : null;
  await loadScout();
  if (S.ext) {
    // cada versión nueva agrega sus games una vez (salvo que los hayas quitado en Ajustes)
    const done = await db.get('meta', 'sggImport');
    if (done !== extVersion() && done !== 'off') await importStartgg('ifAny');
  }
  // sets cargados a mano que también bajaron de start.gg
  const merged = await reconcile();
  if (merged) toast(mergedMsg(merged), 'ok');
  if (S.tab !== 'cargar') render();
  // actualización automática: una vez por día si hay token e internet
  const due = !S.sgg.lastSync || Date.now() - S.sgg.lastSync > DAY;
  if (S.sgg.auto && S.sgg.token && navigator.onLine && due) runSync(false);
}

const extVersion = () => `${S.ext.fetchedAt}:${S.ext.games.length}`;
const saveSgg = () => db.put('meta', S.sgg, 'sgg');

// Averigua de quién es el token. Si es otra cuenta, quita los torneos de la anterior.
async function identify(token) {
  const me = await sgg.whoAmI(token);
  // dueño de los torneos guardados; las versiones viejas traían incluidos los de Zephyr (71176)
  const prev = S.sgg.playerId ?? S.ext?.playerId ?? (S.games.some(g => g.imported) ? 71176 : null);
  if (prev && prev !== me.id) {
    const ids = S.games.filter(g => g.imported).map(g => g.id);
    await db.delMany('games', ids);
    S.games = S.games.filter(g => !g.imported);
    S.ext = null;
    await db.del('meta', 'sggExt');
    await db.del('meta', 'sggImport');
    S.sgg.lastSync = null;
    toast('Cuenta distinta: se quitaron los torneos de la cuenta anterior');
  }
  S.sgg.playerId = me.id;
  S.sgg.gamerTag = me.gamerTag;
  return me;
}

async function runSync(manual) {
  if (S.syncing) return;
  if (!S.sgg.token) { toast('Primero guardá tu token de start.gg', 'err'); return; }
  S.syncing = true;
  S.syncMsg = 'Buscando torneos nuevos…';
  if (S.tab === 'ajustes') renderAjustes();
  try {
    if (!S.sgg.playerId) await identify(S.sgg.token);
    const add = await sgg.fetchNew({
      token: S.sgg.token, playerId: S.sgg.playerId, ext: S.ext,
      onProgress: (p, total) => { S.syncMsg = `Buscando torneos nuevos… página ${p} de ${total}`; if (S.tab === 'ajustes') renderAjustes(); },
    });
    S.ext = sgg.mergeExt(S.ext, add, today(), S.sgg.playerId);
    await db.put('meta', S.ext, 'sggExt');
    const importOn = (await db.get('meta', 'sggImport')) !== 'off';
    if (importOn) await importStartgg('never');
    const merged = await reconcile();
    S.sgg.lastSync = Date.now();
    S.sgg.lastError = null;
    if (add.sets.length || manual) {
      toast((add.sets.length ? `start.gg: ${add.sets.length} sets nuevos (${add.games.length} games)` : 'start.gg: no hay torneos nuevos')
        + (merged ? ` · ${mergedMsg(merged)}` : ''), 'ok');
    }
  } catch (err) {
    S.sgg.lastError = err.message;
    if (manual) toast('No se pudo actualizar: ' + err.message, 'err');
  } finally {
    S.syncing = false;
    await saveSgg();
    if (S.tab !== 'cargar') render();
  }
}

const expandImported = g => ({
  type: 'torneo', stocks: 3, myOpenings: 0, oppOpenings: 0, killPercents: [], deathPercents: [], recoveryDeaths: 0,
  limitsCharged: 0, limitsUsed: 0, limitsConverted: 0, notes: '', bans: [], stagePicker: null,
  imported: 'startgg', vodSkip: true, updatedAt: Date.now(), ...g,
  stocksUnknown: g.myStocksLeft == null || g.oppStocksLeft == null,
});

// toast: 'always' (botón), 'ifAny' (al abrir la app) o 'never' (lo avisa la sincronización)
async function importStartgg(toastMode = 'ifAny') {
  const have = new Set(S.games.map(g => g.id));
  // los sets ya unidos con uno cargado a mano no se vuelven a agregar
  const linked = linkedSggSets();
  const add = S.ext.games.filter(g => !have.has(g.id) && !linked.has(g.setId)).map(expandImported);
  if (add.length) { await db.putMany('games', add); S.games.push(...add); }
  await db.put('meta', extVersion(), 'sggImport');
  if (toastMode === 'always' || (toastMode === 'ifAny' && add.length)) toast(`${add.length} games de torneos importados de start.gg`, 'ok');
}

// ---------- sets cargados a mano que también bajaron de start.gg ----------
// Se unen en uno solo: el set cargado a mano queda como principal (baneos, %, openings, Limit, notas) y se le suma
// lo de start.gg (torneo, ronda, online, stage o stocks si faltaban, y los games que no cargaste).
// Sus games guardan sggSet (el set de start.gg): así no se vuelve a agregar, ni siquiera al importar un respaldo.
const isSggSet = id => String(id).startsWith('sgg-');
const rivalKey = s => norm(String(s || '').split('|').pop());
const nearDate = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= DAY; // torneos que terminan de madrugada
const linkedSggSets = () => new Set(S.games.filter(g => g.sggSet).map(g => g.sggSet));

// cada game cargado coincide con el de start.gg del mismo número (resultado, y personajes y stage si los dos los tienen)
function sameGames(m, i) {
  if (!m.games.length || m.games.length > i.games.length) return false;
  return m.games.every(g => {
    const x = i.games.find(y => y.gameNum === g.gameNum);
    return x && x.result === g.result
      && (!g.stage || !x.stage || g.stage === x.stage)
      && (!x.myChar || g.myChar === x.myChar)
      && (!x.oppChar || g.oppChar === x.oppChar);
  });
}

// Pares (set cargado, set de start.gg) del mismo rival con un día de diferencia como mucho.
// strong: modo Torneo y todo coincide, sin otro candidato posible → se unen solos. El resto se pregunta.
function dupPairs() {
  const sets = [...st.groupSets(S.games.filter(g => !g.sample)).values()];
  const linked = linkedSggSets();
  const manualByRival = new Map();
  for (const m of sets) {
    if (isSggSet(m.setId) || m.games.some(g => g.sggSet)) continue;
    const k = rivalKey(m.rival);
    manualByRival.set(k, [...(manualByRival.get(k) || []), m]);
  }
  const pairs = [];
  for (const i of sets) {
    if (!isSggSet(i.setId) || linked.has(i.setId)) continue;
    for (const m of manualByRival.get(rivalKey(i.rival)) || []) {
      if (!nearDate(m.date, i.date) || S.dupSkip.includes(`${m.setId}|${i.setId}`)) continue;
      pairs.push({ m, i, strong: m.type === 'torneo' && sameGames(m, i) });
    }
  }
  const strongWith = id => pairs.filter(p => p.strong && (p.m.setId === id || p.i.setId === id)).length;
  const ambiguous = pairs.filter(p => p.strong && (strongWith(p.m.setId) > 1 || strongWith(p.i.setId) > 1));
  ambiguous.forEach(p => { p.strong = false; });
  return pairs;
}

async function mergeSets(m, i) {
  const now = Date.now();
  const info = i.games[0];
  const put = [], del = [];
  for (const g of m.games) {
    const x = i.games.find(y => y.gameNum === g.gameNum);
    Object.assign(g, { sggSet: i.setId, event: info.event, eventId: info.eventId, online: info.online, round: info.round, updatedAt: now });
    if (x) {
      // si no coincide, queda lo de start.gg (es lo oficial); los datos extra cargados a mano no se tocan
      if (x.result !== g.result) Object.assign(g, { result: x.result, myStocksLeft: x.myStocksLeft, oppStocksLeft: x.oppStocksLeft });
      else if ((g.myStocksLeft == null || g.oppStocksLeft == null) && x.myStocksLeft != null && x.oppStocksLeft != null) {
        Object.assign(g, { myStocksLeft: x.myStocksLeft, oppStocksLeft: x.oppStocksLeft });
      }
      if (x.myChar) g.myChar = x.myChar;
      if (x.oppChar) g.oppChar = x.oppChar;
      if (x.stage) g.stage = x.stage;
      g.stocksUnknown = g.myStocksLeft == null || g.oppStocksLeft == null;
      del.push(x.id);
    }
    put.push(g);
  }
  // los games que no cargaste pasan al set cargado, con sus datos de start.gg
  const nums = new Set(m.games.map(g => g.gameNum));
  for (const x of i.games) {
    if (nums.has(x.gameNum)) continue;
    Object.assign(x, { setId: m.setId, rival: m.rival, date: m.date, type: m.type, sggSet: i.setId, updatedAt: now });
    put.push(x);
  }
  await db.putMany('games', put);
  await db.delMany('games', del);
  const gone = new Set(del);
  S.games = S.games.filter(g => !gone.has(g.id));
}

// Une los duplicados seguros y deja el resto en S.dups para revisar. Devuelve cuántos sets unió.
async function reconcile() {
  // un respaldo viejo puede traer de vuelta los games de start.gg de un set que ya está unido
  const linked = linkedSggSets();
  const stale = S.games.filter(g => isSggSet(g.setId) && linked.has(g.setId)).map(g => g.id);
  if (stale.length) {
    await db.delMany('games', stale);
    const gone = new Set(stale);
    S.games = S.games.filter(g => !gone.has(g.id));
  }
  const pairs = dupPairs();
  const strong = pairs.filter(p => p.strong);
  for (const p of strong) await mergeSets(p.m, p.i);
  const used = new Set(strong.flatMap(p => [p.m.setId, p.i.setId]));
  S.dups = pairs.filter(p => !p.strong && !used.has(p.m.setId) && !used.has(p.i.setId)).map(p => ({ m: p.m.setId, i: p.i.setId }));
  return strong.length;
}

const mergedMsg = n => `${n} set${n === 1 ? '' : 's'} de start.gg unido${n === 1 ? '' : 's'} con lo que cargaste a mano`;

function dupsCardHTML() {
  if (!S.dups.length) return '';
  const n = S.dups.length;
  return `<section class="card alert">
    <b>⚠ ${n} posible${n === 1 ? '' : 's'} duplicado${n === 1 ? '' : 's'}</b>
    <p class="small">${n === 1 ? 'Un set que cargaste a mano también bajó' : 'Sets que cargaste a mano también bajaron'} de start.gg, pero no ${n === 1 ? 'coincide' : 'coinciden'} del todo. ${n === 1 ? 'Revisalo' : 'Revisalos'} para no contarlos dos veces.</p>
    <button class="btn" data-a="dupReview">Revisar</button>
  </section>`;
}

function dupSheetHTML() {
  const sets = st.groupSets(S.games);
  const side = (s, title) => `<div class="dup-side"><small class="muted">${title}</small>
    <b>vs ${esc(s.rival)}</b><small class="muted">${fmtDate(s.date)} · ${TYPE_LABEL[s.type] || s.type}</small>
    ${s.games.map(g => `<small>G${g.gameNum} <b class="${g.result === 'W' ? 'win' : 'loss'}">${g.result}</b> ${esc(g.myChar)} vs ${esc(g.oppChar)}${g.stage ? ` · ${esc(g.stage === 'Pokémon Stadium 2' ? 'PS2' : g.stage)}` : ''}</small>`).join('')}</div>`;
  const items = S.dups.map(({ m, i }) => {
    const M = sets.get(m), I = sets.get(i);
    if (!M || !I) return '';
    const ev = I.games[0];
    return `<div class="dup-pair">
      <div class="dup-cols">${side(M, '✍️ Cargado por vos')}${side(I, `🏆 ${esc(ev.event || 'start.gg')}${ev.round ? ' · ' + esc(ev.round) : ''}`)}</div>
      <div class="btn-row"><button class="btn primary" data-a="dupMerge" data-v="${esc(m)}|${esc(i)}">Unir</button>
        <button class="btn" data-a="dupSkip" data-v="${esc(m)}|${esc(i)}">Son distintos</button></div>
    </div>`;
  }).join('');
  return `<div class="sheet-head"><h2>Posibles duplicados</h2><button class="btn icon ghost" data-a="closeSheet" aria-label="Cerrar">✕</button></div>
    <div class="sheet-body">
      <p class="muted small">Al unir queda un solo set con tus baneos, %, openings, Limit y notas. Si algo no coincide, el resultado, los personajes y el stage quedan como en start.gg, que es lo oficial.</p>
      ${items || '<p class="empty">No quedan duplicados para revisar.</p>'}
    </div>`;
}

const refreshDups = () => {
  if (!sheet.classList.contains('hidden') && sheet.querySelector('.dup-pair, .empty')) {
    if (S.dups.length) sheet.querySelector('.sheet-panel').innerHTML = dupSheetHTML(); else closeSheet();
  }
  if (S.tab === 'historial') renderHist();
};

// Al empezar a cargar un set de torneo que ya bajó de start.gg (mismo rival, mismo día): mejor completarlo que duplicarlo.
function sggTwinHTML() {
  const f = S.form;
  if (!f || S.editingId || f.type !== 'torneo' || rivalKey(f.rival).length < 2 || setInfo(f.setId).n) return '';
  const twin = [...st.groupSets(S.games.filter(g => isSggSet(g.setId))).values()]
    .filter(s => rivalKey(s.rival) === rivalKey(f.rival) && nearDate(s.date, f.date))
    .sort((a, b) => b.lastTs - a.lastTs)[0];
  if (!twin) return '';
  const ev = twin.games[0];
  return `<div class="h2h twin">🏆 Este set ya bajó de start.gg: <b>${esc(ev.event || '')}</b>${ev.round ? ` · ${esc(ev.round)}` : ''} ·
    <b class="${twin.wins > twin.losses ? 'win' : 'loss'}">${twin.wins}-${twin.losses}</b>
    <small>En vez de cargarlo de nuevo, completalo (baneos, %, notas) editando sus games.</small>
    <button type="button" class="btn sm" data-a="openTwin" data-v="${esc(twin.setId)}">Completar ese set</button></div>`;
}

init();
