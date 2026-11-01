import * as db from './db.js';
import { ROSTER, STAGE_GROUPS, STARTERS, LEGAL, TYPES, TYPE_LABEL, KPIS, ATTACK_EXAMPLE } from './data.js';
import * as st from './stats.js';
import { lineChart } from './charts.js';
import { stageArt } from './stages.js';

const APP_VERSION = '1.0.0';
const DAY = 86400000;
const MIN_N = 5;

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const sheet = $('#sheet');

const S = {
  tab: 'cargar',
  games: [],
  attackLogs: [],
  settings: { main: 'Cloud', second: 'Steve', casualStocks: 3, defaultType: 'torneo', stageStyle: 'img' },
  lastBackup: null,
  focusKpi: 'winGames',
  persisted: false,
  ext: null,          // historial de torneos (supermajor)
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
  histOpen: new Set(),
  histLimit: 25,
};

// ---------- utilidades ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => st.ymd(new Date());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}`; };
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

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function setTitle(t) { $('#title').textContent = t; }

const backupOverdue = () => S.games.length > 0 && (!S.lastBackup || Date.now() - S.lastBackup > 7 * DAY);

// ---------- hoja inferior (modal) ----------
let sheetPushed = false, ignorePop = false, sheetResolve = null;

function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-backdrop" data-a="closeSheet"></div><div class="sheet-panel">${html}</div>`;
  sheet.classList.remove('hidden');
  if (!sheetPushed) { history.pushState({ sheet: true }, ''); sheetPushed = true; }
}
function closeSheet(fromPop = false) {
  sheet.classList.add('hidden');
  sheet.innerHTML = '';
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }
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
  };
}

function nextForm(g) {
  const inSet = S.games.filter(x => x.setId === g.setId);
  const maxNum = Math.max(...inSet.map(x => x.gameNum), g.gameNum);
  return {
    ...newForm(), setId: g.setId, gameNum: Math.min(5, maxNum + 1), type: g.type,
    rival: g.rival, myChar: g.myChar, oppChar: g.oppChar, date: g.date, stocks: g.stocks || 3,
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
// Pendiente de VOD: game de torneo o práctica sin openings ni % cargados.
const needsVod = g => g.type !== 'casual' && !g.vodSkip && !hasVodData(g);

function setInfo(setId, excludeId) {
  const gs = S.games.filter(g => g.setId === setId && g.id !== excludeId);
  return { n: gs.length, w: gs.filter(g => g.result === 'W').length, l: gs.filter(g => g.result === 'L').length };
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

function stageSectionHTML(f) {
  const plan = banPlan(f);
  const step = plan && !plan.need ? currentStep(plan, f) : null;
  const groups = plan
    ? STAGE_GROUPS.map(([g, ss]) => [g, ss.filter(s => plan.pool.includes(s))]).filter(([, ss]) => ss.length)
    : STAGE_GROUPS;
  const tile = s => {
    const ban = f.bans.find(b => b.stage === s);
    const on = f.stage === s && !ban;
    const cls = `${on ? 'on' : ''} ${ban ? 'banned' : ''} ${plan?.need ? 'dim' : ''}`;
    const tag = ban ? `<em class="ban-tag">✕ ${ban.by === 'me' ? 'Vos' : esc(f.rival.trim() || 'Rival')}</em>` : '';
    const label = esc(s === 'Pokémon Stadium 2' ? 'PS2' : s);
    return S.settings.stageStyle === 'text'
      ? `<button type="button" class="chip sm ${cls}" data-a="stageTap" data-v="${esc(s)}">${ban ? '✕ ' : ''}${esc(s)}</button>`
      : `<button type="button" class="stage ${cls}" data-a="stageTap" data-v="${esc(s)}">${stageArt(s)}${tag}<span>${label}</span></button>`;
  };
  return `<section class="card">
    ${plan ? banHeaderHTML(plan, f) : ''}
    ${groups.map(([group, stages]) => `<span class="lbl">${group}</span>
      <div class="${S.settings.stageStyle === 'text' ? 'chips' : 'stage-grid'}">${stages.map(tile).join('')}</div>`).join('')}
    ${f.type === 'torneo' ? `<div class="ban-tools">
      ${plan && !plan.need && (f.bans.length || f.stage) ? '<button type="button" class="btn sm" data-a="banReset">↺ Reiniciar baneos</button>' : ''}
      <button type="button" class="btn sm ghost" data-a="banFree">${f.banFree ? 'Usar ayuda de baneos' : 'Elegir sin ayuda'}</button></div>` : ''}
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
  const quickOpp = topChars('oppChar', 6);
  // los personajes que usa este rival en torneos van primero
  for (const c of [...new Set(extSetsVs(f.rival).map(s => s.oppChar).filter(Boolean))].slice(0, 2).reverse()) {
    if (quickOpp.includes(c)) quickOpp.splice(quickOpp.indexOf(c), 1);
    quickOpp.unshift(c);
  }
  if (f.oppChar && !quickOpp.includes(f.oppChar)) quickOpp.unshift(f.oppChar);
  const k = killsKnown(f), d = deathsKnown(f);

  view.innerHTML = `
  ${si.n ? `<div class="setbar">Set vs <b>${esc(f.rival)}</b> · va <b class="win">${si.w}</b>-<b class="loss">${si.l}</b> · cargando G${f.gameNum}</div>` : ''}
  <section class="card">
    <div class="row-between"><span class="lbl">Tipo de partida</span>
      <input type="date" class="inp date" data-in="date" value="${f.date}" max="${today()}"></div>
    <div class="chips">${TYPES.map(([v, l]) => chip('type', v, l, f.type === v)).join('')}</div>
    <label class="lbl" for="rival">Rival</label>
    <input id="rival" class="inp" data-in="rival" value="${esc(f.rival)}" placeholder="Nombre del rival" autocomplete="off" autocapitalize="words" enterkeyhint="done">
    <div class="chips scroll-x" id="rivalSug">${rivalSuggestions()}</div>
    <div id="rivalH2H">${rivalH2H()}</div>
    <span class="lbl">Game del set</span>
    <div class="chips nums">${[1, 2, 3, 4, 5].map(n => chip('gameNum', n, 'G' + n, f.gameNum === n)).join('')}</div>
  </section>

  <section class="card">
    <span class="lbl">Mi personaje</span>
    <div class="chips">
      ${chip('myChar', main, esc(main), f.myChar === main)}
      ${chip('myChar', second, esc(second), f.myChar === second)}
      ${otherMine ? chip('myChar', f.myChar, esc(f.myChar), true) : ''}
      <button type="button" class="chip ghost" data-a="pickChar" data-v="my">Otro…</button>
    </div>
    <span class="lbl">Personaje del rival</span>
    <div class="chips">
      ${quickOpp.map(c => chip('oppChar', c, esc(c), f.oppChar === c)).join('')}
      <button type="button" class="chip ghost" data-a="pickChar" data-v="opp">${quickOpp.length ? 'Buscar…' : 'Elegir personaje…'}</button>
    </div>
  </section>

  ${stageSectionHTML(f)}

  <section class="card">
    <span class="lbl">Resultado</span>
    <div class="result-row">
      <button type="button" class="res win ${f.result === 'W' ? 'on' : ''}" data-a="set" data-f="result" data-v="W">Gané</button>
      <button type="button" class="res loss ${f.result === 'L' ? 'on' : ''}" data-a="set" data-f="result" data-v="L">Perdí</button>
    </div>
    ${f.result ? `
      <span class="lbl">${f.result === 'W' ? 'Stocks que me quedaron' : 'Stocks que le quedaron al rival'}</span>
      <div class="chips nums">${Array.from({ length: f.stocks }, (_, i) => i + 1).map(n => {
        const field = f.result === 'W' ? 'myStocksLeft' : 'oppStocksLeft';
        return chip(field, n, String(n), f[field] === n);
      }).join('')}</div>` : ''}
  </section>

  <section class="card">
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
  </section>

  <section class="card">
    <div class="counters one">${counter('recoveryDeaths', 'Muertes por recovery / edgeguard')}</div>
  </section>

  ${f.myChar === 'Cloud' ? `
  <section class="card limit">
    <span class="lbl">Limit</span>
    <div class="counters three">${counter('limitsCharged', 'Cargados')}${counter('limitsUsed', 'Usados')}${counter('limitsConverted', 'Dieron kill')}</div>
    <p class="muted small">Dieron kill = Limits usados que le sacaron un stock al rival.</p>
  </section>` : ''}

  <section class="card">
    <details ${f.notes ? 'open' : ''}><summary class="lbl">Notas (opcional)</summary>
      <textarea class="inp" rows="3" data-in="notes" placeholder="Qué funcionó, qué no…">${esc(f.notes)}</textarea>
    </details>
  </section>

  <div class="savebar">
    ${S.editingId ? '<button type="button" class="btn big" data-a="cancelEdit">Cancelar</button>' : ''}
    <button type="button" class="btn big primary grow" data-a="save">${S.editingId ? 'Guardar cambios' : 'Guardar game'}</button>
  </div>`;
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
  const v = ['gameNum', 'myStocksLeft', 'oppStocksLeft'].includes(field) ? Number(raw) : raw;
  f[field] = v;
  if (field === 'result') {
    if (v === 'W') { f.oppStocksLeft = 0; if (!f.myStocksLeft) f.myStocksLeft = null; }
    else { f.myStocksLeft = 0; if (!f.oppStocksLeft) f.oppStocksLeft = null; }
  }
  if (field === 'myChar' && v !== 'Cloud') { f.limitsCharged = f.limitsUsed = f.limitsConverted = 0; }
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
    notes: f.notes.trim(), attacks: f.attacks, sample: f.sample, updatedAt: Date.now(),
    rpsWinner: f.type === 'torneo' ? f.rpsWinner : null, prevWinner: f.type === 'torneo' ? f.prevWinner : null,
    bans: f.type === 'torneo' ? f.bans : [], stagePicker: f.stage ? f.stagePicker : null,
    vodSkip: !!f.vodSkip,
    // datos de torneos importados de start.gg
    ...(f.imported ? { imported: f.imported, event: f.event, eventId: f.eventId, online: f.online, round: f.round } : {}),
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
  linkPendingAttacks(g);
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
  S.lastSaved = g;
  S.form = null;
  render();
  window.scrollTo(0, 0);
  toast('Game guardado', 'ok');
}

function editGame(id, returnTab, vodFocus = false) {
  const g = S.games.find(x => x.id === id);
  if (!g) return;
  S.form = { ...newForm(), ...structuredClone(g), notes: g.notes || '', vodOpen: vodFocus || undefined };
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
  const field = pickerTarget === 'opp' ? 'oppChar' : 'myChar';
  const current = S.form?.[field];
  const top = topChars(field, 8, pickerTarget === 'my' ? [S.settings.main, S.settings.second] : []);
  const matches = ROSTER.filter(([n, a]) => !nq || norm(n + ' ' + (a || '')).includes(nq)).map(r => r[0]).sort((a, b) => a.localeCompare(b));
  const btn = c => `<button class="pick ${c === current ? 'on' : ''}" data-a="pickDone" data-v="${esc(c)}">${esc(c)}</button>`;
  $('#plist').innerHTML = `
    ${!nq && top.length ? `<div class="lbl">${pickerTarget === 'opp' ? 'Los que más enfrento' : 'Los que más uso'}</div><div class="pick-grid">${top.map(btn).join('')}</div><div class="lbl">Todo el roster</div>` : ''}
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
        <label class="f-field"><span>Desde</span><input type="date" class="inp" data-filter="from" value="${F.from || ''}"></label>
        <label class="f-field"><span>Hasta</span><input type="date" class="inp" data-filter="to" value="${F.to || ''}"></label>
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
  if (!d) return '<p class="empty">No se pudo cargar el historial de torneos.</p>';
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
  const atk = g.attacks?.me ? Object.entries(g.attacks.me).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, c]) => `${m} ${c}`).join(', ') : '';
  const vod = needsVod(g);
  return `<div class="game ${g.result === 'W' ? 'w' : 'l'}">
    <div class="g-top"><b class="g-res">${g.result}</b><span>G${g.gameNum} · ${esc(g.stage || 'sin stage')}</span>
      ${st.stocksKnown(g) ? `<span class="muted">${g.myStocksLeft}-${g.oppStocksLeft} stocks</span>` : ''}${vod ? '<span class="vod-badge">📼 VOD pendiente</span>' : ''}</div>
    <div class="g-info">${esc(g.myChar)} vs ${esc(g.oppChar)}${(g.myOpenings || g.oppOpenings) ? ` · Openings ${g.myOpenings}/${g.oppOpenings}` : ''}      ${g.stagePicker ? `<br>Stage elegido por ${g.stagePicker === 'me' ? 'mí' : 'el rival'}` : ''}
      ${g.bans?.length ? `<br>Baneos: ${g.bans.map(b => `${esc(b.stage)} (${b.by === 'me' ? 'yo' : 'rival'})`).join(', ')}` : ''}
      ${kp.length ? `<br>Maté a: ${kp.join('%, ')}%` : ''}${dp.length ? `<br>Morí a: ${dp.join('%, ')}%` : ''}
      ${g.recoveryDeaths ? `<br>Muertes por recovery: ${g.recoveryDeaths}` : ''}
      ${g.myChar === 'Cloud' && !(g.imported && !g.limitsCharged) ? `<br>Limit: ${g.limitsCharged} cargados · ${g.limitsUsed} usados · ${g.limitsConverted} dieron kill` : ''}
      ${atk ? `<br>Ataques (mod): ${esc(atk)}` : ''}
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
  return `<article class="card set ${s.decided ? (s.won ? 'won' : 'lost') : ''}">
    <button class="set-head" data-a="toggleSet" data-v="${s.setId}">
      <span class="score"><b class="win">${s.wins}</b>-<b class="loss">${s.losses}</b></span>
      <span class="set-main"><b>vs ${esc(s.rival)}</b><small>${esc(mine)} vs ${esc(chars)}</small>
        ${s.games[0].imported ? `<small>🏆 ${esc(s.games[0].event || '')}${s.games[0].round ? ' · ' + esc(s.games[0].round) : ''}</small>` : ''}</span>
      <span class="set-meta"><small>${fmtDate(s.date)}</small><small class="tag">${TYPE_LABEL[s.type] || s.type}</small></span>
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
      ${sets.map(s => setCardHTML(s, true, s.games.filter(needsVod))).join('')}
      <button class="btn ghost" data-a="vodSkipAll">Quitar todos de pendientes</button>`;
    return;
  }

  const sets = [...st.groupSets(S.games).values()]
    .filter(s => !q || norm(s.rival).includes(q) || s.games.some(g => norm(g.oppChar).includes(q) || norm(g.myChar).includes(q)))
    .sort((a, b) => b.lastTs - a.lastTs);
  const shown = sets.slice(0, S.histLimit);
  view.innerHTML = `
    ${pending.length ? modeChips : ''}
    <input class="inp" type="search" data-in="histQuery" value="${esc(S.histQuery)}" placeholder="Buscar rival o personaje…">
    <p class="muted small">${sets.length} sets · ${sets.reduce((a, s) => a + s.games.length, 0)} games</p>
    ${shown.map(s => setCardHTML(s, S.histOpen.has(s.setId))).join('') || '<p class="empty">No hay games.</p>'}
    ${sets.length > shown.length ? '<button class="btn big" data-a="more">Ver más</button>' : ''}`;
}

// ---------- ajustes, respaldo e importación ----------
function backupData() {
  return { app: 'smash-kpi', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, games: S.games, attackLogs: S.attackLogs };
}

function csvData() {
  const cols = ['fecha', 'tipo', 'set', 'game', 'rival', 'mi_personaje', 'personaje_rival', 'stage', 'resultado',
    'mis_stocks', 'stocks_rival', 'mis_openings', 'openings_rival', 'pct_kills', 'pct_muertes', 'muertes_recovery',
    'limits_cargados', 'limits_usados', 'limits_convertidos', 'eligio_stage', 'baneos', 'notas'];
  const setMap = st.groupSets(S.games);
  const sets = [...st.groupSets(S.games).values()].sort((a, b) => a.lastTs - b.lastTs);
  const setNum = new Map(sets.map((s, i) => [s.setId, i + 1]));
  const cell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = S.games.slice().sort((a, b) => a.ts - b.ts).map(g => [
    g.date, g.type, setNum.get(g.setId), g.gameNum, g.rival, g.myChar, g.oppChar, g.stage, g.result === 'W' ? 'ganado' : 'perdido',
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
  if (data.format === 'smash-kpi-attacks') return importAttacks(data);
  if (data.app !== 'smash-kpi' || !Array.isArray(data.games)) { toast('No es un respaldo de Smash KPI', 'err'); return; }
  const games = data.games.filter(g => g && g.id).map(normalizeGame);
  const mode = await ask('Importar respaldo', `El archivo tiene <b>${games.length}</b> games. Ahora tenés <b>${S.games.length}</b>.`, [
    { value: 'merge', label: 'Combinar con lo actual', cls: 'primary' },
    { value: 'replace', label: 'Reemplazar todo', cls: 'danger' },
  ]);
  if (!mode) return;
  if (mode === 'replace') { await db.clear('games'); await db.clear('attackLogs'); S.games = []; S.attackLogs = []; }
  await db.putMany('games', games);
  if (Array.isArray(data.attackLogs)) await db.putMany('attackLogs', data.attackLogs.filter(l => l && l.id));
  if (data.settings && mode === 'replace') { Object.assign(S.settings, data.settings); await db.put('meta', S.settings, 'settings'); }
  S.games = await db.getAll('games');
  S.attackLogs = await db.getAll('attackLogs');
  render();
  toast(`${games.length} games importados`, 'ok');
}

function findGameForAttack(m) {
  if (m.gameId) return S.games.find(g => g.id === m.gameId) || null;
  const t = Date.parse(m.endedAt || m.startedAt);
  if (!isFinite(t)) return null;
  let best = null, bestDiff = 25 * 60000;
  for (const g of S.games) {
    if (m.myChar && g.myChar !== m.myChar) continue;
    if (m.oppChar && g.oppChar !== m.oppChar) continue;
    const diff = Math.abs((g.ts || 0) - t);
    if (diff < bestDiff) { best = g; bestDiff = diff; }
  }
  return best;
}

const attackPayload = (m, source) => ({ me: m.attacks?.me || {}, opp: m.attacks?.opp || {}, source: source || 'mod', importedAt: Date.now() });

async function importAttacks(data) {
  const matches = Array.isArray(data.matches) ? data.matches : [];
  let linked = 0;
  const pending = [];
  for (const m of matches) {
    const g = findGameForAttack(m);
    if (g) { g.attacks = attackPayload(m, data.source); await db.put('games', g); linked++; }
    else pending.push({ id: m.id || uid(), source: data.source, ...m, importedAt: Date.now() });
  }
  if (pending.length) { await db.putMany('attackLogs', pending); S.attackLogs.push(...pending); }
  render();
  toast(`Ataques: ${linked} asociados a games, ${pending.length} pendientes`, 'ok');
}

// Al guardar un game, intenta asociarle conteos de ataques pendientes.
function linkPendingAttacks(g) {
  if (!S.attackLogs.length || g.attacks) return;
  const saved = S.games;
  S.games = [g];
  const log = S.attackLogs.find(m => findGameForAttack(m));
  S.games = saved;
  if (log) {
    g.attacks = attackPayload(log, log.source);
    S.attackLogs = S.attackLogs.filter(l => l !== log);
    db.del('attackLogs', log.id);
  }
}

function requestPersist() {
  if (S.persisted || !navigator.storage?.persist) return;
  navigator.storage.persist().then(p => { S.persisted = p; });
}

function renderAjustes() {
  setTitle('Ajustes');
  const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / DAY) : null;
  const overdue = backupOverdue();
  const sampleN = S.games.filter(g => g.sample).length;
  const charOpts = sel => ROSTER.map(r => r[0]).sort((a, b) => a.localeCompare(b)).map(c => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  view.innerHTML = `
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
    <p class="muted small">Respaldo JSON de esta app, o JSON de ataques del mod de PC.</p>
    <label class="btn big file-btn">Elegir archivo JSON<input type="file" accept=".json,.txt,application/json,text/plain" data-in="importFile" hidden></label>
  </section>

  <section class="card">
    <span class="lbl">Torneos de start.gg</span>
    ${S.ext ? `<p class="muted small">${S.games.filter(g => g.imported).length} games importados de ${S.ext.events.length} torneos · datos del ${fmtDate(S.ext.fetchedAt)}.
      Tienen stage, personajes y ganador; los stocks solo cuando se reportaron.</p>
      ${S.games.some(g => g.imported)
        ? '<button class="btn" data-a="sggRemove">Quitar los games importados</button>'
        : '<button class="btn" data-a="sggImport">Importar games de torneos</button>'}`
      : '<p class="muted small">Cargando…</p>'}
  </section>

  <section class="card">
    <span class="lbl">Ataques por partida (mod de PC)</span>
    <p class="muted small">${S.games.filter(g => g.attacks).length} games con ataques · ${S.attackLogs.length} registros esperando un game que coincida.</p>
    <button class="btn" data-a="attackFormat">Ver formato del JSON</button>
  </section>

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
  </section>

  <section class="card">
    <span class="lbl">Datos</span>
    <p class="muted small">${S.games.length} games guardados en este teléfono${sampleN ? ` (${sampleN} de ejemplo)` : ''}.
      ${S.persisted ? 'Almacenamiento persistente activado.' : ''}</p>
    <div class="stack">
      ${sampleN ? '<button class="btn big" data-a="clearSample">Borrar datos de ejemplo</button>' : '<button class="btn big" data-a="loadSample">Cargar datos de ejemplo</button>'}
      <button class="btn big danger" data-a="wipe">Borrar todo</button>
    </div>
  </section>
  <p class="muted small center">Smash KPI v${APP_VERSION} · funciona sin internet · tus datos no salen del teléfono</p>`;
}

async function loadSample() {
  const { makeSample } = await import('./sample.js');
  const games = makeSample();
  await db.putMany('games', games);
  S.games.push(...games.filter(g => !S.games.some(x => x.id === g.id)));
  toast(`${games.length} games de ejemplo cargados`, 'ok');
  render();
}

// ---------- navegación y eventos ----------
function go(tab) {
  S.tab = tab;
  if (tab === 'cargar' && !S.form && !S.lastSaved) S.form = newForm();
  render();
  window.scrollTo(0, 0);
}

function render() {
  document.querySelectorAll('.tabbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  $('.tabbar [data-tab="ajustes"]').classList.toggle('dot', backupOverdue());
  ({ cargar: renderCargar, stats: renderStats, historial: renderHist, ajustes: renderAjustes })[S.tab]();
}

const actions = {
  set: t => setField(t.dataset.f, t.dataset.v),
  inc: t => bump(t.dataset.f, 1),
  dec: t => bump(t.dataset.f, -1),
  save: () => saveGame(),
  rivalPick: t => { S.form.rival = t.dataset.v; renderCargar(); },
  pickChar: t => openPicker(t.dataset.v),
  stageTap: t => stageTap(t.dataset.v),
  setBan: t => { S.form[t.dataset.f] = t.dataset.v || null; renderCargar(); },
  banReset: () => { Object.assign(S.form, { bans: [], stage: '', stagePicker: null }); renderCargar(); },
  banFree: () => { S.form.banFree = !S.form.banFree; renderCargar(); },
  pickDone: t => {
    const field = pickerTarget === 'opp' ? 'oppChar' : 'myChar';
    closeSheet();
    setField(field, t.dataset.v);
  },
  closeSheet: () => closeSheet(),
  answer: t => { const r = sheetResolve; sheetResolve = null; closeSheet(); r && r(t.dataset.v); },
  nextGame: () => { S.form = nextForm(S.lastSaved); S.lastSaved = null; render(); window.scrollTo(0, 0); },
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
  sggImport: async () => { await importStartgg(`${S.ext.fetchedAt}:${S.ext.games.length}`); renderAjustes(); },
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
  attackFormat: () => {
    openSheet(`<div class="sheet-head"><h2>Formato de ataques</h2><button class="btn icon" data-a="closeSheet" aria-label="cerrar">✕</button></div>
      <div class="sheet-body"><p class="small">El mod debe generar un JSON así. Cada partida se asocia a un game por <code>gameId</code>,
      o si no lo tiene, por fecha/hora (<code>endedAt</code>, ±25 min) y personajes. Si todavía no cargaste ese game, queda pendiente y se asocia cuando lo cargues.</p>
      <pre class="code">${esc(JSON.stringify(ATTACK_EXAMPLE, null, 2))}</pre>
      <button class="btn big" data-a="dlExample">Descargar ejemplo</button></div>`);
  },
  dlExample: () => shareOrDownload('ejemplo-ataques.json', 'application/json', JSON.stringify(ATTACK_EXAMPLE, null, 2), 'download'),
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
    const ok = await ask('Borrar todo', `Se van a borrar <b>${S.games.length}</b> games de este teléfono. No se puede deshacer. ¿Exportaste un respaldo?`,
      [{ value: 'y', label: 'Sí, borrar todo', cls: 'danger' }]);
    if (!ok) return;
    await db.clear('games'); await db.clear('attackLogs');
    S.games = []; S.attackLogs = []; S.lastSaved = null; S.form = newForm();
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
sheet.addEventListener('click', onClick);

view.addEventListener('input', e => {
  const t = e.target;
  const k = t.dataset.in;
  if (!k) return;
  if (k === 'rival') { S.form.rival = t.value; $('#rivalSug').innerHTML = rivalSuggestions(); $('#rivalH2H').innerHTML = rivalH2H(); }
  else if (k === 'notes') S.form.notes = t.value;
  else if (k === 'kill' || k === 'death') {
    t.value = t.value.replace(/\D/g, '').slice(0, 3);
    const arr = k === 'kill' ? S.form.killPercents : S.form.deathPercents;
    arr[Number(t.dataset.i)] = t.value === '' ? null : Number(t.value);
  } else if (k === 'histQuery') {
    S.histQuery = t.value;
    const pos = t.selectionStart;
    renderHist();
    const inp = view.querySelector('[data-in="histQuery"]');
    inp.focus(); inp.setSelectionRange(pos, pos);
  }
});

view.addEventListener('change', async e => {
  const t = e.target;
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
}, true);

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
  try {
    const [games, logs, settings, lastBackup, focusKpi] = await Promise.all([
      db.getAll('games'), db.getAll('attackLogs'), db.get('meta', 'settings'), db.get('meta', 'lastBackup'), db.get('meta', 'focusKpi'),
    ]);
    S.games = games;
    S.attackLogs = logs;
    Object.assign(S.settings, settings || {});
    S.lastBackup = lastBackup || null;
    if (focusKpi && KPIS[focusKpi]) S.focusKpi = focusKpi;
    S.persisted = (await navigator.storage?.persisted?.()) || false;
  } catch (err) {
    view.innerHTML = `<p class="empty">No se pudo abrir la base de datos: ${esc(err.message)}</p>`;
    return;
  }
  S.form = newForm();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  // historial de torneos de start.gg, incluido en la app (data/torneos.json)
  fetch('data/torneos.json').then(r => (r.ok ? r.json() : null)).catch(() => null).then(async d => {
    if (d?.format !== 'smash-kpi-torneos') return;
    S.ext = d;
    // cada versión nueva del archivo agrega sus games una vez (salvo que los hayas quitado en Ajustes)
    const version = `${d.fetchedAt}:${d.games.length}`;
    const done = await db.get('meta', 'sggImport');
    if (done !== version && done !== 'off') await importStartgg(version, false);
    if (S.tab !== 'cargar') render();
  });
}

const expandImported = g => ({
  type: 'torneo', stocks: 3, myOpenings: 0, oppOpenings: 0, killPercents: [], deathPercents: [], recoveryDeaths: 0,
  limitsCharged: 0, limitsUsed: 0, limitsConverted: 0, notes: '', bans: [], stagePicker: null,
  imported: 'startgg', vodSkip: true, updatedAt: Date.now(), ...g,
  stocksUnknown: g.myStocksLeft == null || g.oppStocksLeft == null,
});

async function importStartgg(version, announce = true) {
  const have = new Set(S.games.map(g => g.id));
  const add = S.ext.games.filter(g => !have.has(g.id)).map(expandImported);
  if (add.length) { await db.putMany('games', add); S.games.push(...add); }
  await db.put('meta', version, 'sggImport');
  if (add.length || announce) toast(`${add.length} games de torneos importados de start.gg`, 'ok');
}

init();
