// Respaldo en el Google Drive de cada usuario, sin servidor.
// Permiso con OAuth en el navegador: Google se abre en una ventana aparte y vuelve a la app con un token de 1 hora
// en la dirección (#access_token=…). Esa ventana se lo pasa a la app que quedó abierta y se cierra sola, así la app
// nunca se va de su pantalla. Si no se puede abrir otra ventana, se va a Google y vuelve en la misma (como antes).
// Scope drive.file: la app solo ve los archivos que ella misma creó (la carpeta "Smash KPI"), nada más del Drive.

// ID de cliente OAuth (no es secreto: es público en cualquier app web)
export const CLIENT_ID = '369545096944-cdp1qtp9pov6o478tbbqj97dl8lc296s.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'Smash KPI';
const KEEP = 10; // respaldos que quedan en la carpeta; los más viejos van a la papelera
const AUTH_KEY = 'smash-kpi-drive-auth';   // pedido en curso: { state, pending, popup }
const TOKEN_KEY = 'smash-kpi-drive-token';  // la ventana de Google le pasa el permiso a la app…
const ACK_KEY = 'smash-kpi-drive-ack';      // …y la app confirma que lo recibió
const CHANNEL = 'smash-kpi-drive';
let stopListening = null;

// pending: qué hacer al volver ('backup' o 'restore'); hint: email para no elegir cuenta de nuevo;
// onResult({ token, expires } o { error }) recibe el permiso cuando vuelve por la ventana aparte
export function authorize(pending, hint, onResult) {
  const state = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: location.origin + location.pathname, response_type: 'token',
    scope: SCOPE, state, include_granted_scopes: 'true', ...(hint ? { login_hint: hint } : {}),
  });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
  const save = popup => { try { localStorage.setItem(AUTH_KEY, JSON.stringify({ state, pending, popup })); } catch {} };
  save(true);
  const win = window.open(url, 'smash-kpi-google', 'popup,width=480,height=680');
  if (!win) { save(false); location.assign(url); return; }
  listen(state, onResult);
}

// La app espera el permiso que le manda la ventana de Google (por BroadcastChannel o, si no hay, por localStorage).
function listen(state, onResult) {
  stopListening?.();
  let done = false;
  const ch = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
  const receive = data => {
    if (done || data?.state !== state) return;
    done = true;
    ch?.postMessage({ ack: state });
    try { localStorage.setItem(ACK_KEY, state); localStorage.removeItem(TOKEN_KEY); } catch {}
    stopListening();
    onResult(data);
  };
  const onStorage = e => { if (e.key === TOKEN_KEY && e.newValue) { try { receive(JSON.parse(e.newValue)); } catch {} } };
  if (ch) ch.onmessage = e => receive(e.data);
  addEventListener('storage', onStorage);
  stopListening = () => { ch?.close(); removeEventListener('storage', onStorage); stopListening = null; };
}

// En la ventana de Google: le pasa el permiso a la app. true si la app lo recibió (entonces esta ventana se cierra).
export function handOff(ret) {
  return new Promise(resolve => {
    const data = { state: ret.state, token: ret.token, expires: ret.expires, error: ret.error };
    const ch = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    let timer;
    const finish = ok => { clearTimeout(timer); ch?.close(); removeEventListener('storage', onStorage); resolve(ok); };
    const onStorage = e => { if (e.key === ACK_KEY && e.newValue === ret.state) finish(true); };
    addEventListener('storage', onStorage);
    if (ch) { ch.onmessage = e => { if (e.data?.ack === ret.state) finish(true); }; ch.postMessage(data); }
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(data)); } catch {}
    timer = setTimeout(() => {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      finish(false); // la app no respondió (se cerró): esta ventana sigue sola, como antes
    }, 3000);
  });
}

// Al abrir la app: si se vuelve de Google, toma el token y limpia la dirección.
export function takeRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTH_KEY)); localStorage.removeItem(AUTH_KEY); } catch {}
  if (!saved || h.get('state') !== saved.state) return { error: 'la respuesta de Google no coincide, probá de nuevo' };
  const base = { state: saved.state, pending: saved.pending, popup: !!saved.popup };
  if (h.has('error')) return { ...base, error: h.get('error') === 'access_denied' ? 'no se dio permiso en Google' : h.get('error') };
  return { ...base, token: h.get('access_token'), expires: Date.now() + ((Number(h.get('expires_in')) || 3600) - 60) * 1000 };
}

async function api(token, path, opts = {}) {
  const res = await fetch('https://www.googleapis.com' + path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...opts.headers } });
  if (res.status === 401) throw Object.assign(new Error('el permiso de Google venció'), { expired: true });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message || `Google Drive respondió ${res.status}`);
  }
  if (res.status === 204) return null;
  return opts.text ? res.text() : res.json();
}

export const whoAmI = async token => (await api(token, '/drive/v3/about?fields=user(emailAddress)')).user.emailAddress;

async function folderId(token) {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await api(token, `/drive/v3/files?q=${q}&fields=files(id)`);
  if (r.files.length) return r.files[0].id;
  const f = await api(token, '/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return f.id;
}

// respaldos de la carpeta, el más nuevo primero
export async function list(token, parent) {
  parent ||= await folderId(token);
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  return (await api(token, `/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime,size)&pageSize=50`)).files;
}

export async function upload(token, name, content) {
  const parent = await folderId(token);
  const boundary = 'smashkpi' + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
    + JSON.stringify({ name, parents: [parent], mimeType: 'application/json' })
    + `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const f = await api(token, '/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  for (const old of (await list(token, parent)).slice(KEEP)) {
    await api(token, `/drive/v3/files/${old.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
  return f;
}

export const download = (token, id) => api(token, `/drive/v3/files/${id}?alt=media`, { text: true });

// quita el permiso dado a la app en esa cuenta de Google
export const revoke = token => fetch('https://oauth2.googleapis.com/revoke', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(token),
}).catch(() => {});
