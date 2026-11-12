// Reuniones con clientes por Google Meet, en el Google Calendar de Diego (11 nov 2026). Caso de origen: Elvin pidió
// una reunión con sus ingenieros para detallar la página ("ahí se le hace el anticipo") y Diego tuvo que proponer
// horarios a mano media hora después. Ahora el bot ofrece 2-3 huecos libres reales del calendario, agenda el que el
// cliente elige, crea el evento con enlace de Meet y avisa a Diego. Recordatorio al cliente 1 h antes y a Diego 30 min
// antes. La llave de Google (refresh token) vive solo en /data/google.json (permisos 600) y nunca sale al navegador.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { state, DATA_DIR, log, saveNow } from '../state.mjs';

const ARCH = path.join(DATA_DIR, 'google.json');
const BASE = (process.env.OFICINA_PUBLIC_URL || 'https://marketing-oficina.emxfr6.easypanel.host').replace(/\/$/, '');
const REDIRECT = `${BASE}/api/google/callback`;
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const TZ = 'America/Tegucigalpa';
const HN = 6 * 3600e3;
const DIA = 864e5;

state.citas ||= { lista: [], config: {} };
const C = state.citas;
C.lista ||= [];
// Horario en que el bot puede ofrecer reuniones (Diego lo puede cambiar con POST /api/citas/config).
const CONFIG_BASE = { dias: [1, 2, 3, 4, 5, 6], bloques: [[9, 12], [14, 17]], minutos: 45, anticipacionHoras: 3, diasAdelante: 5, maxPorDia: 3 };
const cfg = () => ({ ...CONFIG_BASE, ...(C.config || {}) });

// ---------- Conexión con Google ----------
const leerArch = () => { try { return JSON.parse(fs.readFileSync(ARCH, 'utf8')); } catch { return {}; } };
const guardarArch = (o) => { fs.writeFileSync(ARCH, JSON.stringify(o)); try { fs.chmodSync(ARCH, 0o600); } catch {} };
export const conectado = () => Boolean(leerArch().refresh_token && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function urlConectar() {
  if (!process.env.GOOGLE_CLIENT_ID) throw new Error('Falta cargar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Sistema → Llaves.');
  const g = leerArch();
  g.estado = randomUUID();
  guardarArch(g);
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', state: g.estado });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function callback(code, estado) {
  const g = leerArch();
  if (!estado || estado !== g.estado) throw new Error('El enlace de conexión ya no es válido. Volvé a tocar "Conectar Google Calendar".');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.refresh_token) throw new Error(`Google no dio acceso: ${j.error_description || j.error || r.status}`);
  guardarArch({ refresh_token: j.refresh_token, conectado: Date.now() });
  tok = { valor: j.access_token, vence: Date.now() + (j.expires_in - 120) * 1000 };
  log('vendedor', 'Google Calendar conectado: el bot ya puede ofrecer y agendar reuniones por Meet', 'ok');
  return true;
}

let tok = { valor: null, vence: 0 };
async function token() {
  if (tok.valor && Date.now() < tok.vence) return tok.valor;
  const { refresh_token } = leerArch();
  if (!refresh_token) throw new Error('Google Calendar no está conectado.');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google Calendar: no se pudo renovar el acceso (${j.error || r.status}). Hay que reconectarlo.`);
  tok = { valor: j.access_token, vence: Date.now() + (j.expires_in - 120) * 1000 };
  return tok.valor;
}
async function gcal(ruta, body, metodo = 'POST') {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Calendar ${r.status}: ${j.error?.message || 'error'}`);
  return j;
}

// ---------- Horarios ----------
// Las horas de Honduras como timestamp (Honduras no tiene horario de verano: siempre UTC-6).
const tsHN = (fecha, h, m = 0) => Date.parse(`${fecha}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-06:00`);
const fechaHN = (ts) => new Date(ts - HN).toISOString().slice(0, 10);
const isoHN = (ts) => `${new Date(ts - HN).toISOString().slice(0, 19)}-06:00`;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export function textoHora(ts) {
  const d = new Date(ts - HN);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const hora = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'a. m.' : 'p. m.'}`;
  const hoy = fechaHN(Date.now()), f = fechaHN(ts), manana = fechaHN(Date.now() + DIA);
  const dia = f === hoy ? 'hoy' : f === manana ? `mañana ${DIAS[d.getUTCDay()]}` : `el ${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`;
  return `${dia} a las ${hora}`;
}

async function ocupado(desde, hasta) {
  const j = await gcal('/freeBusy', { timeMin: new Date(desde).toISOString(), timeMax: new Date(hasta).toISOString(), timeZone: TZ, items: [{ id: 'primary' }] });
  return (j.calendars?.primary?.busy || []).map((b) => [Date.parse(b.start), Date.parse(b.end)]);
}
const choca = (ini, fin, busy) => busy.some(([a, b]) => ini < b && fin > a);
const enHorario = (ini, c = cfg()) => {
  const d = new Date(ini - HN);
  if (!c.dias.includes(d.getUTCDay())) return false;
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return c.bloques.some(([a, b]) => h >= a && h + c.minutos / 60 <= b);
};
const citasDelDia = (f) => C.lista.filter((x) => x.estado !== 'cancelada' && fechaHN(x.inicio) === f).length;

// Huecos libres reales: los próximos días hábiles, cada media hora dentro de los bloques, sin chocar con el calendario.
// Devuelve pocos y repartidos (no tres seguidos el mismo día) para que el cliente elija fácil.
export async function huecos({ cuantos = 3 } = {}) {
  const c = cfg();
  const desde = Date.now() + c.anticipacionHoras * 3600e3;
  const hasta = Date.now() + (c.diasAdelante + 2) * DIA;
  const busy = await ocupado(Date.now(), hasta);
  const libres = [];
  for (let d = 0; d <= c.diasAdelante + 1 && libres.length < 12; d++) {
    const f = fechaHN(Date.now() + d * DIA);
    if (citasDelDia(f) >= c.maxPorDia) continue;
    for (const [a, b] of c.bloques) for (let h = a; h + c.minutos / 60 <= b; h += 0.5) {
      const ini = tsHN(f, Math.floor(h), h % 1 ? 30 : 0);
      if (ini < desde || !enHorario(ini, c) || choca(ini, ini + c.minutos * 60e3, busy)) continue;
      libres.push(ini);
    }
  }
  // Repartidos: el primero libre, otro en la otra mitad del día o el día siguiente, y uno más.
  const elegidos = [];
  for (const t of libres) {
    if (elegidos.length >= cuantos) break;
    const ult = elegidos.at(-1);
    if (!ult || fechaHN(t) !== fechaHN(ult) || Math.abs(t - ult) >= 3 * 3600e3) elegidos.push(t);
  }
  return elegidos.map((t) => ({ inicio: isoHN(t), texto: textoHora(t) }));
}

// ---------- Agendar ----------
export async function agendar({ conv, inicio, tema = '', con_quien = '', por = 'el bot' }) {
  const c = cfg();
  const ini = Date.parse(inicio);
  if (Number.isNaN(ini)) throw new Error('Fecha y hora inválidas.');
  if (ini < Date.now() + 30 * 60e3) throw new Error('Esa hora ya pasó o es muy pronto.');
  if (!enHorario(ini, c)) throw new Error('Esa hora está fuera del horario de reuniones.');
  const fin = ini + c.minutos * 60e3;
  if (choca(ini, fin, await ocupado(ini - 60e3, fin + 60e3))) throw new Error('Diego ya tiene algo a esa hora.');
  const ya = (conv.estado?.reunion && conv.estado.reunion.estado === 'agendada' && conv.estado.reunion.inicio > Date.now()) ? conv.estado.reunion : null;
  if (ya) throw new Error(`Ya tiene una reunión agendada ${textoHora(ya.inicio)}.`);
  const quien = conv.contacto?.empresa || conv.contacto?.nombre || conv.title;
  const tel = String(conv.phone || '').replace(/^lid:/, '');
  const ev = await gcal('/calendars/primary/events?conferenceDataVersion=1', {
    summary: `Cresova · ${quien}${con_quien ? ` (${con_quien})` : ''}`,
    description: [`Reunión agendada por ${por} desde WhatsApp.`, tema && `Tema: ${tema}`, `Cliente: ${conv.contacto?.nombre || ''} ${tel ? `+${tel}` : ''}`, conv.estado?.cotizacion && `Cotización: ${conv.estado.cotizacion}`, conv.estado?.demoUrl && `Demo: ${conv.estado.demoUrl}`].filter(Boolean).join('\n'),
    start: { dateTime: isoHN(ini), timeZone: TZ }, end: { dateTime: isoHN(fin), timeZone: TZ },
    conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
  });
  const meet = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri || null;
  const cita = { id: ev.id, conv: conv.id, cliente: quien, telefono: tel, inicio: ini, fin, meet, tema: String(tema).slice(0, 200), con_quien: String(con_quien).slice(0, 80), estado: 'agendada', creada: Date.now(), por, enlace: ev.htmlLink };
  C.lista = [...C.lista.filter((x) => x.inicio > Date.now() - 30 * DIA), cita];
  conv.estado ||= {};
  conv.estado.reunion = { id: cita.id, inicio: ini, meet, estado: 'agendada' };
  delete conv.estado.reunionOfrecida;
  // Si el compromiso abierto era justamente la reunión, queda cumplido.
  if (conv.estado.compromiso?.tipo === 'reunion') {
    conv.estado.compromisos = [...(conv.estado.compromisos || []), { ...conv.estado.compromiso, cerrado: Date.now(), como: 'reunión agendada' }].slice(-10);
    delete conv.estado.compromiso;
  }
  saveNow();
  log('vendedor', `Reunión agendada con ${quien} ${textoHora(ini)} (Meet)`, 'ok');
  import('./whatsapp.mjs').then((w) => w.avisarDiego(`📅 *Reunión agendada* con *${quien}*${con_quien ? ` (${con_quien})` : ''}: ${textoHora(ini)}, ${c.minutos} min.\n${tema ? `Tema: ${tema}\n` : ''}Meet: ${meet || '(sin enlace)'}\nYa está en tu Google Calendar.`)).catch(() => {});
  return { ok: true, cuando: textoHora(ini), inicio: isoHN(ini), meet, minutos: c.minutos };
}

export const proximas = () => C.lista.filter((x) => x.estado === 'agendada' && x.fin > Date.now()).sort((a, b) => a.inicio - b.inicio);
export const estado = () => ({ conectado: conectado(), config: cfg(), proximas: proximas().map((x) => ({ ...x, cuando: textoHora(x.inicio) })) });
export function configurar(o = {}) {
  const n = {};
  if (Array.isArray(o.dias)) n.dias = o.dias.map(Number).filter((d) => d >= 0 && d <= 6);
  if (Array.isArray(o.bloques)) n.bloques = o.bloques.filter((b) => Array.isArray(b) && b[0] < b[1]).map((b) => [Number(b[0]), Number(b[1])]);
  for (const k of ['minutos', 'anticipacionHoras', 'diasAdelante', 'maxPorDia']) if (Number(o[k]) > 0) n[k] = Number(o[k]);
  C.config = { ...(C.config || {}), ...n };
  saveNow();
  return cfg();
}

// ---------- Recordatorios ----------
// Cliente: 1 h antes, con el enlace (si WhatsApp todavía deja escribirle libre; si no, va a Llamadas). Diego: 30 min antes.
setInterval(async () => {
  for (const x of proximas()) {
    const falta = x.inicio - Date.now();
    if (falta <= 65 * 60e3 && falta > 20 * 60e3 && !x.recordadoCliente) {
      x.recordadoCliente = Date.now();
      saveNow();
      const w = await import('./whatsapp.mjs');
      await w.recordarReunion(x.conv, `Hola, te recuerdo nuestra reunión de ${textoHora(x.inicio).replace(/^hoy /, 'hoy ')} por Google Meet. Este es el enlace: ${x.meet}`).catch(() => {});
    }
    if (falta <= 32 * 60e3 && falta > 0 && !x.recordadoDiego) {
      x.recordadoDiego = Date.now();
      saveNow();
      const w = await import('./whatsapp.mjs');
      w.avisarDiego(`⏰ En ${Math.round(falta / 60e3)} min: reunión con *${x.cliente}*${x.con_quien ? ` (${x.con_quien})` : ''}.\n${x.tema ? `Tema: ${x.tema}\n` : ''}Meet: ${x.meet}`).catch(() => {});
    }
  }
}, 5 * 60e3);
