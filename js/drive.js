// Respaldo en el Google Drive de cada usuario, sin servidor.
// Permiso con OAuth en el navegador: se va a Google y vuelve con un token de 1 hora en la dirección (#access_token=…).
// Scope drive.file: la app solo ve los archivos que ella misma creó (la carpeta "Smash KPI"), nada más del Drive.

// ID de cliente OAuth (no es secreto: es público en cualquier app web)
export const CLIENT_ID = '369545096944-cdp1qtp9pov6o478tbbqj97dl8lc296s.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'Smash KPI';
const KEEP = 10; // respaldos que quedan en la carpeta; los más viejos van a la papelera
const AUTH_KEY = 'smash-kpi-drive-auth';

// pending: qué hacer al volver ('backup' o 'restore'); hint: email para no elegir cuenta de nuevo
export function authorize(pending, hint) {
  const state = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ state, pending })); } catch {}
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: location.origin + location.pathname, response_type: 'token',
    scope: SCOPE, state, include_granted_scopes: 'true', ...(hint ? { login_hint: hint } : {}),
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
}

// Al abrir la app: si se vuelve de Google, toma el token y limpia la dirección.
export function takeRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTH_KEY)); localStorage.removeItem(AUTH_KEY); } catch {}
  if (!saved || h.get('state') !== saved.state) return { error: 'la respuesta de Google no coincide, probá de nuevo' };
  if (h.has('error')) return { error: h.get('error') === 'access_denied' ? 'no se dio permiso en Google' : h.get('error'), pending: saved.pending };
  return { token: h.get('access_token'), expires: Date.now() + ((Number(h.get('expires_in')) || 3600) - 60) * 1000, pending: saved.pending };
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
