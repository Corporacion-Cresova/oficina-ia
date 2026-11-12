// Prospección: el departamento que sale a buscar clientes (los anuncios traen a los que nos buscan).
//   1. Búsqueda: una campaña (rubro + ciudad) lanza búsquedas en Google Maps con el scraper interno (tools/maps).
//   2. Investigación y calificación: por cada negocio se revisa su página (si tiene) y la IA arma una ficha con
//      hallazgos comprobables, la oportunidad, qué ofrecerle, un puntaje de 0 a 100 y el primer mensaje.
//   3. Aprobación: Diego aprueba en la Bandeja (o uno por uno en Prospección). Nada sale sin su aprobación.
//   4. Contacto de a poco: WhatsApp por un número aparte (5 por día, separados) y correo con Resend.
//   5. Si responden, el vendedor los atiende como a cualquier lead (sabe que le escribimos nosotros) y se mide
//      hasta la venta: respondió → demo → ganado.
// Los datos viven en la base propia (cresova-db): prospect_campaigns, prospects, prospect_events.
import { q, configurado } from '../cresova/db.mjs';
import { log, state, saveNow, addDeliverable } from '../state.mjs';

const AG = 'gerente_ventas'; // Martín lleva la prospección
const MAPS = () => (process.env.MAPS_SCRAPER_URL || 'http://tools_maps:8080').replace(/\/$/, '');
const INST = 'cresova-prospeccion';
const hn = () => new Date(Date.now() - 6 * 3600e3);
const hoyHN = () => hn().toISOString().slice(0, 10);
const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

state.prospeccion ||= {};
const C = state.prospeccion;
C.waPorDia ??= 5;
C.correoPorDia ??= 15;
C.umbral ??= 60;
C.porTanda ??= 30;
C.activo ??= false; // los envíos arrancan apagados: Diego los enciende
C.firma ??= 'Diego, de Cresova';
C.correoDe ??= '';
C.responderA ??= '';
C.horario ??= { desde: 9, hasta: 17 };

// ---------- base de datos ----------
let listo = null;
export function asegurarTablas() {
  if (!configurado()) return Promise.reject(new Error('La base de Cresova no está conectada.'));
  listo ||= q(`
    create table if not exists prospect_campaigns (
      id serial primary key, nombre text not null, rubro text, ciudad text, busquedas jsonb not null default '[]',
      profundidad int not null default 5, estado text not null default 'buscando', jobs jsonb not null default '[]',
      encontrados int not null default 0, nota text, creado timestamptz default now(), actualizado timestamptz default now());
    create table if not exists prospects (
      id serial primary key, campaign_id int references prospect_campaigns(id) on delete set null,
      clave text unique not null, nombre text not null, categoria text, direccion text, telefono text, tel8 text,
      movil boolean not null default false, web text, emails jsonb not null default '[]', rating numeric, resenas int,
      maps_url text, datos jsonb not null default '{}', estado text not null default 'nuevo', score int, confianza text,
      puntos jsonb, investigacion jsonb, mensaje jsonb, canal text, motivo text, costo numeric not null default 0,
      contactado_en timestamptz, respondio_en timestamptz, conv_id text,
      creado timestamptz default now(), actualizado timestamptz default now());
    alter table prospect_campaigns add column if not exists angulo text;
    alter table prospect_campaigns add column if not exists analizada timestamptz;
    alter table prospect_campaigns add column if not exists propuesta text;
    create index if not exists prospects_estado on prospects(estado);
    create index if not exists prospects_campana on prospects(campaign_id);
    create index if not exists prospects_tel8 on prospects(tel8);
    create table if not exists prospect_events (
      id serial primary key, prospect_id int references prospects(id) on delete cascade, tipo text not null,
      detalle text, ts timestamptz default now());`).catch((e) => { listo = null; throw e; });
  return listo;
}
const evento = (id, tipo, detalle = '') => q('insert into prospect_events (prospect_id, tipo, detalle) values ($1, $2, $3)', [id, tipo, String(detalle).slice(0, 1000)]).catch(() => {});

// ---------- scraper de Google Maps (gosom/google-maps-scraper, servicio interno tools/maps) ----------
async function maps(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${MAPS()}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Buscador de Maps respondió ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  return r;
}
export async function estadoMaps() {
  try { const j = await (await maps('/api/v1/jobs')).json(); return { ok: true, trabajos: Array.isArray(j) ? j.length : 0 }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// CSV con comillas y saltos de línea dentro de los campos.
function parseCSV(txt) {
  const rows = [];
  let row = [], f = '', dentro = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (dentro) {
      if (ch === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else dentro = false; } else f += ch;
    } else if (ch === '"') dentro = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...data] = rows.filter((r) => r.length > 1 || r[0]);
  return (data || []).map((r) => Object.fromEntries((head || []).map((h, i) => [h.trim(), r[i] ?? ''])));
}

// Honduras: 8 dígitos; los celulares empiezan con 3, 7, 8 o 9 (los fijos con 2).
export function normTel(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 8) d = `504${d}`;
  return d.length >= 11 ? d : '';
}
const esMovil = (d) => /^504[3789]\d{7}$/.test(d);
const esRed = (u) => /facebook\.com|fb\.com|instagram\.com|linktr\.ee|tiktok\.com|wa\.me|whatsapp\.com|business\.site|google\.com\/maps/i.test(u || '');

function filaAProspecto(r) {
  const g = (...ks) => { for (const k of ks) if (r[k]) return String(r[k]).trim(); return ''; };
  const nombre = g('title', 'name');
  if (!nombre) return null;
  const telefono = normTel(g('phone', 'phone_number'));
  const emails = [...new Set(g('emails', 'email').split(/[\s,;|]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(x) && !/\.(png|jpe?g|webp|gif|svg)$/.test(x) && !/(sentry|wixpress|example|domain\.com)/.test(x)))].slice(0, 5);
  const clave = g('cid', 'data_id', 'place_id') || g('link') || `${nombre.toLowerCase()}|${telefono}`;
  return {
    clave, nombre: nombre.slice(0, 200), categoria: g('category', 'categories').slice(0, 200), direccion: g('complete_address', 'address').slice(0, 300),
    telefono, tel8: telefono.slice(-8), movil: esMovil(telefono), web: g('website', 'web_site').slice(0, 300), emails,
    rating: Number(g('review_rating', 'rating')) || null, resenas: parseInt(g('review_count', 'reviews_count'), 10) || 0,
    maps_url: g('link').slice(0, 500), cerrado: /permanent|cerrado/i.test(g('status')),
    datos: { descripcion: g('descriptions', 'description').slice(0, 600), horario: g('open_hours').slice(0, 300), dueño: g('owner').slice(0, 200), sobre: g('about').slice(0, 600) },
  };
}

// Para no prospectar a quien ya es cliente, ya cotizó o ya escribió al WhatsApp de ventas.
async function telefonosConocidos() {
  const set = new Set();
  for (const r of await q(`select phone as t from clients union all select telefono_normalizado from clients union all select client_phone from quotes`).catch(() => [])) {
    const d = String(r.t || '').replace(/\D/g, '');
    if (d.length >= 8) set.add(d.slice(-8));
  }
  try {
    const { ventasState } = await import('../ventas/vendedor.mjs');
    for (const c of Object.values(ventasState.convs)) if (c.kind === 'whatsapp' && !c.prospecto) set.add(String(c.phone || '').replace(/\D/g, '').slice(-8));
  } catch {}
  return set;
}

// ---------- campañas ----------
export async function crearCampana({ nombre, rubro, ciudad, busquedas = [], profundidad = 5, angulo = '', propuesta = '' }) {
  await asegurarTablas();
  busquedas = (Array.isArray(busquedas) ? busquedas : String(busquedas).split('\n')).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  if (!busquedas.length) throw new Error('Poné al menos una búsqueda (por ejemplo: "constructora San Pedro Sula").');
  const [c] = await q(`insert into prospect_campaigns (nombre, rubro, ciudad, busquedas, profundidad, angulo, propuesta) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [String(nombre || `${rubro} en ${ciudad}`).slice(0, 120), rubro || '', ciudad || '', JSON.stringify(busquedas), Math.max(1, Math.min(20, Number(profundidad) || 5)), String(angulo || '').slice(0, 600), String(propuesta || '').slice(0, 2000)]);
  await lanzarBusqueda(c);
  return c;
}
async function lanzarBusqueda(c) {
  const busquedas = c.busquedas;
  const r = await maps('/api/v1/jobs', { method: 'POST', body: { name: `cresova-${c.id}-${Date.now().toString(36)}`, keywords: busquedas, lang: 'es', depth: c.profundidad, email: true, max_time: 1800 } });
  const j = await r.json();
  if (!j.id) throw new Error('El buscador no devolvió el trabajo.');
  await q(`update prospect_campaigns set jobs = jobs || $2::jsonb, estado = 'buscando', actualizado = now() where id = $1`, [c.id, JSON.stringify([{ id: j.id, en: Date.now(), estado: 'pending' }])]);
  log(AG, `Prospección: buscando "${busquedas.join('", "')}" en Google Maps (campaña ${c.nombre})`, 'info');
}
// Vuelve a investigar toda la campaña (por ejemplo, después de mejorar las instrucciones de la IA).
export async function reinvestigarCampana(id) {
  const r = await q(`update prospects set estado = 'nuevo', actualizado = now() where campaign_id = $1 and estado in ('calificado', 'descartado', 'error') and coalesce(motivo, '') not in ('Ya es contacto o cliente de Cresova', 'Cerrado permanentemente', 'Descartado por Diego') returning id`, [id]);
  await q(`update prospect_campaigns set estado = 'investigando', actualizado = now() where id = $1`, [id]);
  return { reinvestigar: r.length };
}
export async function buscarDeNuevo(id) {
  const [c] = await q('select * from prospect_campaigns where id = $1', [id]);
  if (!c) throw new Error('Campaña no encontrada');
  await lanzarBusqueda(c);
  return { ok: true };
}

async function revisarBusquedas() {
  if (!configurado()) return;
  await asegurarTablas();
  for (const c of await q(`select * from prospect_campaigns where estado = 'buscando'`)) {
    let cambio = false;
    for (const job of c.jobs) {
      if (job.estado === 'ok' || job.estado === 'failed' || job.importado) continue;
      const st = await (await maps(`/api/v1/jobs/${job.id}`)).json().catch(() => null);
      const estado = String(st?.Status || st?.status || '').toLowerCase();
      if (estado === 'failed') { job.estado = 'failed'; cambio = true; log(AG, `Prospección: una búsqueda de ${c.nombre} falló en el buscador`, 'warn'); continue; }
      if (estado !== 'ok') { if (Date.now() - job.en > 3 * 3600e3) { job.estado = 'failed'; cambio = true; } continue; }
      const csv = await (await maps(`/api/v1/jobs/${job.id}/download`)).text();
      const r = await importar(c, parseCSV(csv));
      job.estado = 'ok'; job.importado = Date.now(); job.filas = r.filas; job.nuevos = r.nuevos;
      cambio = true;
      log(AG, `Prospección: ${r.filas} negocios encontrados para ${c.nombre}; ${r.nuevos} nuevos (${r.conocidos} ya eran contactos, ${r.repetidos} repetidos)`, 'ok');
    }
    if (!cambio) continue;
    const pendientes = c.jobs.some((j) => !['ok', 'failed'].includes(j.estado));
    await q(`update prospect_campaigns set jobs = $2, estado = $3, encontrados = (select count(*) from prospects where campaign_id = $1), actualizado = now() where id = $1`, [c.id, JSON.stringify(c.jobs), pendientes ? 'buscando' : 'investigando']);
  }
}

async function importar(c, filas) {
  const conocidos = await telefonosConocidos();
  let nuevos = 0, repetidos = 0, conoc = 0;
  for (const r of filas) {
    const p = filaAProspecto(r);
    if (!p) continue;
    const yaEs = p.tel8 && conocidos.has(p.tel8);
    const estado = yaEs ? 'descartado' : p.cerrado ? 'descartado' : 'nuevo';
    const motivo = yaEs ? 'Ya es contacto o cliente de Cresova' : p.cerrado ? 'Cerrado permanentemente' : null;
    const [ins] = await q(`insert into prospects (campaign_id, clave, nombre, categoria, direccion, telefono, tel8, movil, web, emails, rating, resenas, maps_url, datos, estado, motivo)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (clave) do nothing returning id`,
    [c.id, p.clave, p.nombre, p.categoria, p.direccion, p.telefono, p.tel8, p.movil, p.web, JSON.stringify(p.emails), p.rating, p.resenas, p.maps_url, JSON.stringify(p.datos), estado, motivo]);
    if (!ins) { repetidos++; continue; }
    if (yaEs) conoc++; else if (estado === 'nuevo') nuevos++;
  }
  return { filas: filas.length, nuevos, repetidos, conocidos: conoc };
}

// ---------- investigación ----------
// Lo que se puede comprobar de su página: si abre, si es segura, si se ve en celular, si tiene WhatsApp, formulario…
async function revisarWeb(url) {
  if (!url) return { tiene: false };
  if (esRed(url)) return { tiene: false, red: url };
  const u = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  try {
    const t0 = Date.now();
    const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'es' }, signal: AbortSignal.timeout(15_000) });
    const html = (await r.text()).slice(0, 600_000);
    const ms = Date.now() - t0;
    const txt = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const anios = [...txt.matchAll(/(?:©|copyright|derechos reservados)[^0-9]{0,20}((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
    return {
      tiene: true, abre: r.ok, codigo: r.status, url: r.url, segura: r.url.startsWith('https://'), ms,
      titulo: (html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').trim().slice(0, 140),
      descripcion: (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || '').slice(0, 200),
      movil: /<meta[^>]+name=["']viewport/i.test(html), whatsapp: /wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(html),
      formulario: /<form[\s>]/i.test(html), tel: /href=["']tel:/i.test(html),
      constructor: /wix\.com|wixstatic/i.test(html) ? 'Wix' : /wp-content/i.test(html) ? 'WordPress' : /squarespace/i.test(html) ? 'Squarespace' : /godaddy|websites\.godaddy/i.test(html) ? 'GoDaddy' : '',
      anio: anios.length ? Math.max(...anios) : null, palabras: txt.split(' ').length,
      texto: txt.slice(0, 2500),
      redes: [...new Set([...html.matchAll(/https?:\/\/(?:www\.)?(facebook|instagram|tiktok)\.com\/[\w.\-/]+/gi)].map((m) => m[0]))].slice(0, 4),
    };
  } catch (e) { return { tiene: true, abre: false, error: String(e.cause?.code || e.message).slice(0, 80) }; }
}

const PROMPT = (p, web, rubroCampana, angulo = '') => `Sos analista comercial de Cresova, una agencia de Honduras que hace páginas web para negocios (paquete principal: Web Pro; también landing pages de cotización, catálogos y rediseños). Te paso un negocio encontrado en Google Maps y lo que se pudo comprobar de su página web.

NEGOCIO (Google Maps)
- Nombre: ${p.nombre}
- Categoría: ${p.categoria || '—'} · Campaña: ${rubroCampana || '—'}
- Dirección: ${p.direccion || '—'}
- Teléfono: ${p.telefono || '—'} (${p.movil ? 'celular' : p.telefono ? 'fijo' : 'sin teléfono'}) · Correos: ${(p.emails || []).join(', ') || '—'}
- Calificación: ${p.rating ?? '—'} con ${p.resenas || 0} reseñas
- RUBRO QUE BUSCAMOS: ${rubroCampana || '—'}
- Descripción: ${p.datos?.descripcion || p.datos?.sobre || '—'}
- Sitio en Maps: ${p.web || 'no tiene'}

PÁGINA WEB (comprobado por la oficina)
${!web.tiene ? (web.red ? `- No tiene página propia: en Maps pone su red social (${web.red}).` : '- No aparece ninguna página web en Maps (puede que exista y no la tengan puesta: no lo afirmes como seguro).') : !web.abre ? `- Pusieron ${p.web} pero NO abre (${web.error || `código ${web.codigo}`}).` : `- Abre: ${web.url} · ${web.segura ? 'https' : 'SIN https'} · ${web.movil ? 'adaptada a celular' : 'NO adaptada a celular'} · ${web.whatsapp ? 'con botón de WhatsApp' : 'sin WhatsApp'} · ${web.formulario ? 'con formulario' : 'sin formulario'}${web.ms > 5000 ? ' · LENTA (más de 5 segundos)' : ''}${web.constructor ? ` · hecha con ${web.constructor}` : ''}${web.anio ? ` · © ${web.anio}` : ''}
- Título: ${web.titulo || '—'} · Descripción: ${web.descripcion || '—'}
- Texto (inicio): ${web.texto?.slice(0, 1500) || '—'}`}

Respondé SOLO con JSON válido, sin texto antes ni después:
{
  "nombre_corto": "cómo le diría una persona al negocio (ej. 'Hormigón' para 'Hormigón S. DE R.L.'; 'Duracreto'; sin S.A., S. de R.L., ni la lista de servicios)",
  "es_del_rubro": true,
  "hallazgos": ["3 a 5 hechos comprobables y cortos, cada uno con su fuente entre paréntesis: (Maps) o (su página). Solo de la lista de arriba: no inventes problemas de velocidad, estructura, diseño o redirecciones."],
  "oportunidad": "1-2 frases: por qué este negocio podría comprarnos, en términos de clientes/confianza/cotizaciones, no de tecnología",
  "oferta": "qué ofrecerle: Web Pro | Rediseño de su página | Landing de cotizaciones | Catálogo digital",
  "puntos": { "necesidad": 0-30, "potencial": 0-25, "encaje": 0-20, "actividad": 0-15 },
  "confianza": "alta | media | baja (baja si casi no hay datos o la conclusión depende de no haber encontrado algo)",
  "descartar": false,
  "motivo_descarte": "si descartar es true: por qué (no es del rubro, es una cadena grande o de gobierno, ya tiene una página muy buena y moderna)",
  "llamada": "guion de 3 a 4 líneas para que Diego lo llame por teléfono: saludo, la observación concreta y la pregunta (por si solo tiene teléfono fijo)",
  "whatsapp": "primer mensaje por WhatsApp",
  "correo": { "asunto": "asunto corto, sin mayúsculas sostenidas ni signos de exclamación", "cuerpo": "correo en texto plano" }
}

PRIMERO decidí si es del rubro que buscamos (es_del_rubro). Google Maps mezcla negocios que no son: si el rubro es construcción, SÍ son constructoras, contratistas, remodelación, acabados, arquitectos que construyen, empresas de concreto o techos; NO son ferreterías, tiendas o distribuidoras de materiales, reparación de electrodomésticos, refrigeración, billares, bancos ni oficinas de gobierno. Si no es del rubro: es_del_rubro false y descartar true.

Cómo puntuar: necesidad (0-30) = qué tanto le falta una buena página (sin página o solo redes = alta; página que no abre, vieja o sin celular = alta; página moderna completa = baja). Potencial (0-25) = valor del cliente para su rubro y tamaño (reseñas, servicios caros como construcción = alto). Encaje (0-20) = qué tan bien lo resuelve una página de Cresova. Actividad (0-15) = señales de que opera hoy (reseñas, horario, redes). No inventes nada: si no lo sabés, no sube el puntaje.

${angulo ? `ÁNGULO DE ESTA CAMPAÑA (lo eligió Brújula y lo aprobó Diego; usalo para la observación y el beneficio): ${angulo}\n\n` : ''}Reglas de los mensajes (los firma "${C.firma}"):
- Español de Honduras, de "usted", cálido y profesional. Empezá con "Buen día," (NUNCA "¡Hola!"). Como máximo un signo de exclamación en todo el mensaje y ningún emoji.
- Usá el nombre corto del negocio, nunca la razón social completa ni la lista de servicios del nombre en Maps.
- Presentate: quién escribe y de dónde (Cresova, páginas web en Honduras).
- UNA observación concreta y verdadera sobre su negocio (de los hallazgos), dicha con respeto, sin hacerlos sentir mal. Nunca digas "no tienen página" si no es seguro: decí "no encontramos su página en Google".
- El beneficio en términos de negocio: que los encuentren, confianza para cotizar, recibir solicitudes por WhatsApp.
- Cerrá con UNA pregunta fácil: si le gustaría ver una propuesta de cómo se vería su página, sin costo ni compromiso.
- No menciones precios, ni descuentos, ni "oferta por tiempo limitado". No digas que los "investigamos".
- WhatsApp: máximo 450 caracteres, 2 o 3 párrafos cortos, y al final una línea: "Si no le interesa, me dice y no le vuelvo a escribir."
- Correo: 80 a 140 palabras, saludo al equipo de ${p.nombre}, firma "${C.firma}" + "cresova.com". No pongas línea de baja: la agrega el sistema.`;

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  for (const model of [process.env.PROSPECCION_MODELO || 'gemini-2.5-flash', 'gemini-flash-latest']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json', ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json().catch(() => ({}));
    const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    const u = j.usageMetadata || {};
    // Precio de referencia de Gemini Flash: US$ 0,30 por millón de entrada y US$ 2,50 por millón de salida.
    if (t) return { t, costo: ((u.promptTokenCount || 0) * 0.3 + (u.candidatesTokenCount || 0) * 2.5) / 1e6 };
  }
  return null;
}
async function openrouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Oficina Cresova - Prospeccion' },
    body: JSON.stringify({ model: 'google/gemini-2.5-flash', temperature: 0.4, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }], usage: { include: true } }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => ({}));
  return { t: j.choices?.[0]?.message?.content || '', costo: Number(j.usage?.cost || 0) };
}
const leerJSON = (t) => { try { return JSON.parse(String(t).replace(/^```(?:json)?|```$/g, '').trim()); } catch { const m = String(t).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } };
const clamp = (n, max) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

export async function investigar(id) {
  const [p] = await q(`select p.*, c.rubro as c_rubro, c.nombre as c_nombre, c.angulo as c_angulo from prospects p left join prospect_campaigns c on c.id = p.campaign_id where p.id = $1`, [id]);
  if (!p) throw new Error('Prospecto no encontrado');
  await q(`update prospects set estado = 'investigando', actualizado = now() where id = $1`, [id]);
  const web = await revisarWeb(p.web);
  const pr = PROMPT(p, web, p.c_rubro || p.c_nombre, p.c_angulo || '');
  const out = (await gemini(pr)) || (await openrouter(pr));
  const j = out && leerJSON(out.t);
  if (!j) {
    await q(`update prospects set estado = 'error', motivo = $2, actualizado = now() where id = $1`, [id, out ? 'La IA no devolvió una ficha válida' : 'Sin IA disponible (falta la llave de Gemini u OpenRouter)']);
    return null;
  }
  const contacto = p.movil ? 10 : p.emails?.length ? 7 : p.telefono ? 3 : 0;
  const puntos = { necesidad: clamp(j.puntos?.necesidad, 30), potencial: clamp(j.puntos?.potencial, 25), encaje: clamp(j.puntos?.encaje, 20), actividad: clamp(j.puntos?.actividad, 15), contacto };
  let score = Object.values(puntos).reduce((a, b) => a + b, 0);
  const confianza = ['alta', 'media', 'baja'].includes(j.confianza) ? j.confianza : 'media';
  // "Ausencia de evidencia no es evidencia de ausencia": con poca confianza el puntaje no pasa de 75.
  if (confianza === 'baja') score = Math.min(score, 75);
  const canal = p.movil ? 'whatsapp' : p.emails?.length ? 'correo' : p.telefono ? 'llamada' : null;
  const descartar = j.descartar === true || j.es_del_rubro === false || !canal;
  const motivo = !canal ? 'Sin teléfono ni correo para contactarlo' : j.es_del_rubro === false ? `No es del rubro: ${String(j.motivo_descarte || p.categoria || '').slice(0, 160)}` : j.descartar ? String(j.motivo_descarte || 'Descartado por la IA').slice(0, 200) : score < C.umbral ? `Puntaje ${score} (menos de ${C.umbral})` : null;
  const estado = descartar || score < C.umbral ? 'descartado' : 'calificado';
  const investigacion = { nombreCorto: String(j.nombre_corto || '').slice(0, 80), hallazgos: (j.hallazgos || []).map(String).slice(0, 6), oportunidad: String(j.oportunidad || '').slice(0, 400), oferta: String(j.oferta || '').slice(0, 80), web, en: Date.now() };
  const mensaje = { whatsapp: String(j.whatsapp || '').slice(0, 700), asunto: String(j.correo?.asunto || '').slice(0, 120), correo: String(j.correo?.cuerpo || '').slice(0, 2000), llamada: String(j.llamada || '').slice(0, 700) };
  delete investigacion.web.texto;
  await q(`update prospects set estado = $2, score = $3, confianza = $4, puntos = $5, investigacion = $6, mensaje = $7, canal = $8, motivo = $9, costo = costo + $10, actualizado = now() where id = $1`,
    [id, estado, score, confianza, JSON.stringify(puntos), JSON.stringify(investigacion), JSON.stringify(mensaje), canal, motivo, out.costo || 0]);
  evento(id, 'investigado', `${score}/100 · ${estado}${motivo ? ` · ${motivo}` : ''}`);
  return { score, estado };
}

let investigando = false;
async function investigarPendientes() {
  if (investigando || !configurado()) return;
  investigando = true;
  try {
    await asegurarTablas();
    await q(`update prospects set estado = 'nuevo' where estado = 'investigando' and actualizado < now() - interval '5 minutes'`);
    for (const c of await q(`select * from prospect_campaigns where estado = 'investigando'`)) {
      const lote = await q(`select id from prospects where campaign_id = $1 and estado = 'nuevo' order by resenas desc nulls last limit $2`, [c.id, C.porTanda]);
      for (const { id } of lote) {
        await investigar(id).catch((e) => q(`update prospects set estado = 'error', motivo = $2 where id = $1`, [id, String(e.message).slice(0, 200)]));
        await sleep(1500);
      }
      const [{ quedan }] = await q(`select count(*)::int as quedan from prospects where campaign_id = $1 and estado = 'nuevo'`, [c.id]);
      if (quedan) continue; // la próxima vuelta sigue con la siguiente tanda
      await q(`update prospect_campaigns set estado = 'lista', actualizado = now() where id = $1`, [c.id]);
      await tarjetaAprobacion(c);
    }
  } finally { investigando = false; }
}

// Tarjeta en la Bandeja con los calificados de la campaña: Diego aprueba el lote (o los revisa en Prospección).
async function tarjetaAprobacion(c) {
  const ps = await q(`select * from prospects where campaign_id = $1 and estado = 'calificado' order by score desc`, [c.id]);
  const [t] = await q(`select count(*)::int as total, count(*) filter (where estado = 'descartado')::int as descartados, coalesce(sum(costo), 0)::float as costo from prospects where campaign_id = $1`, [c.id]);
  if (!ps.length) { log(AG, `Prospección: ${c.nombre} terminó sin negocios calificados (${t.total} revisados)`, 'warn'); return; }
  const cuerpo = ps.map((p) => `### ${p.score}/100 · ${p.nombre}
${p.categoria || ''} · ${p.canal === 'whatsapp' ? `WhatsApp +${p.telefono}` : p.canal === 'llamada' ? `📞 Para que lo llamés: +${p.telefono}` : `Correo ${p.emails[0]}`} · confianza ${p.confianza}${p.web ? ` · ${p.web}` : ' · sin página en Maps'}
${(p.investigacion?.hallazgos || []).map((h) => `- ${h}`).join('\n')}
**Oportunidad:** ${p.investigacion?.oportunidad || '—'} · **Ofrecer:** ${p.investigacion?.oferta || '—'}

> ${String(p.canal === 'whatsapp' ? p.mensaje?.whatsapp : p.canal === 'llamada' ? p.mensaje?.llamada : `${p.mensaje?.asunto}\n\n${p.mensaje?.correo}`).replace(/\n/g, '\n> ')}`).join('\n\n');
  addDeliverable(AG, `Prospección: ${ps.length} negocios listos para contactar (${c.nombre})`,
    `Se revisaron ${t.total} negocios de **${c.nombre}**: ${ps.length} calificados, ${t.descartados} descartados. Costo de la investigación con IA: US$ ${t.costo.toFixed(3)}.\n\nLos que solo tienen teléfono fijo (📞) no se contactan solos: quedan en Prospección con un guion para que los llamés. Si aprobás, el resto sale de a poco y solo en horario: WhatsApp por el número de prospección (máximo ${C.waPorDia} por día, separados) y correo (máximo ${C.correoPorDia} por día). Si alguno responde, el vendedor lo atiende y te aviso. Podés editar o quitar cualquiera en **Negocio → Prospección** antes de aprobar.\n\n${C.activo ? '' : '⚠️ Los envíos de prospección están apagados: encendelos en Prospección cuando estés listo.\n\n'}${cuerpo}`,
    { kind: 'decision', summary: `${ps.length} negocios · ${c.nombre}`, question: '¿Los aprobamos para contactar?', options: ['Sí, aprobarlos', 'Primero los reviso'], prospeccionLote: ps.map((p) => p.id) });
  log(AG, `Prospección: ${ps.length} negocios de ${c.nombre} esperan tu aprobación en la Bandeja`, 'ok');
}

export async function aprobarLote(ids) {
  const r = await q(`update prospects set estado = 'aprobado', actualizado = now() where id = any($1::int[]) and estado = 'calificado' returning id`, [ids.map(Number)]);
  for (const { id } of r) evento(id, 'aprobado', 'Aprobado en la Bandeja');
  log(AG, `Prospección: ${r.length} negocios aprobados; salen de a poco${C.activo ? '' : ' cuando enciendas los envíos'}`, 'ok');
  return { aprobados: r.length };
}

// ---------- envíos ----------
const enHorario = () => { const d = hn(); return d.getUTCDay() >= 1 && d.getUTCDay() <= 6 && d.getUTCHours() >= C.horario.desde && d.getUTCHours() < C.horario.hasta; };
const enviadosHoy = async (canal) => (await q(`select count(*)::int as n from prospects where canal = $1 and contactado_en >= ($2::date + interval '6 hours')`, [canal, hoyHN()]))[0].n;

async function enviarCorreo({ para, asunto, texto }) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de Resend (Sistema → Llaves).');
  if (!C.correoDe) throw new Error('Falta el remitente de los correos (Prospección → Ajustes).');
  const baja = `\n\n—\nSi no desea recibir más correos de Cresova, responda "no" a este mensaje y no le volveremos a escribir.`;
  const wa = C.numeroWa ? `\n\nTambién puede escribirnos por WhatsApp: https://wa.me/${C.numeroWa}` : '';
  const cuerpo = `${texto}${wa}${baja}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222;max-width:560px">${cuerpo.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>').replace(/(https:\/\/wa\.me\/\d+)/, '<a href="$1">$1</a>')}</p>`).join('')}</div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: C.correoDe, to: [para], subject: asunto, text: cuerpo, html, ...(C.responderA ? { reply_to: C.responderA, headers: { 'List-Unsubscribe': `<mailto:${C.responderA}?subject=no>` } } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${j.message || j.error || 'sin detalle'}`);
  return j.id;
}

async function contactar(p) {
  const wa = await import('../ventas/whatsapp.mjs');
  if (p.canal === 'whatsapp') {
    const convId = await wa.enviarProspecto({
      inst: C.inst, telefono: p.telefono, texto: p.mensaje.whatsapp,
      prospecto: { id: p.id, empresa: p.nombre, rubro: p.categoria, hallazgos: p.investigacion?.hallazgos || [], oportunidad: p.investigacion?.oportunidad || '', oferta: p.investigacion?.oferta || '' },
    });
    await q(`update prospects set estado = 'contactado', contactado_en = now(), conv_id = $2, actualizado = now() where id = $1`, [p.id, convId]);
  } else {
    const idCorreo = await enviarCorreo({ para: p.emails[0], asunto: p.mensaje.asunto, texto: p.mensaje.correo });
    await q(`update prospects set estado = 'contactado', contactado_en = now(), actualizado = now() where id = $1`, [p.id]);
    evento(p.id, 'correo', `Resend ${idCorreo}`);
  }
  evento(p.id, 'contactado', p.canal);
  log(AG, `Prospección: se contactó a ${p.nombre} por ${p.canal === 'whatsapp' ? 'WhatsApp' : 'correo'}`, 'info');
}

let enviando = false;
async function enviarPendientes() {
  if (enviando || !C.activo || !configurado() || !enHorario()) return;
  enviando = true;
  try {
    await asegurarTablas();
    for (const canal of ['whatsapp', 'correo']) {
      const prox = canal === 'whatsapp' ? 'proximoWa' : 'proximoCorreo';
      if (Date.now() < (C[prox] || 0)) continue;
      if (canal === 'whatsapp' && !(await numeroListo())) continue;
      if (canal === 'correo' && (!process.env.RESEND_API_KEY?.trim() || !C.correoDe)) continue;
      if ((await enviadosHoy(canal)) >= (canal === 'whatsapp' ? C.waPorDia : C.correoPorDia)) continue;
      const [p] = await q(`select * from prospects where estado = 'aprobado' and canal = $1 order by score desc, id limit 1`, [canal]);
      if (!p) continue;
      try { await contactar(p); }
      catch (e) {
        await q(`update prospects set estado = 'error', motivo = $2, actualizado = now() where id = $1`, [p.id, String(e.message).slice(0, 200)]);
        log(AG, `Prospección: no se pudo contactar a ${p.nombre}: ${e.message}`, 'warn');
      }
      // Separación: WhatsApp entre 30 y 90 minutos (pocos y espaciados para cuidar el número); correo entre 4 y 12.
      C[prox] = Date.now() + (canal === 'whatsapp' ? rnd(30, 90) : rnd(4, 12)) * 60e3;
      saveNow();
    }
  } finally { enviando = false; }
}

// Respondió por WhatsApp (lo llama el webhook del número de prospección). El vendedor ya lo atiende.
export async function respondio(conv, texto) {
  const id = conv.prospecto?.id;
  if (!id) return;
  const [p] = await q(`select id, nombre, estado from prospects where id = $1`, [id]);
  if (!p) return;
  const optout = Boolean(conv.optOut);
  if (p.estado === 'contactado' || (optout && p.estado !== 'optout')) {
    await q(`update prospects set estado = $2, respondio_en = coalesce(respondio_en, now()), actualizado = now() where id = $1`, [id, optout ? 'optout' : 'respondio']);
    evento(id, optout ? 'optout' : 'respondio', String(texto).slice(0, 300));
    const wa = await import('../ventas/whatsapp.mjs');
    wa.avisarDiego(optout
      ? `🛑 *${p.nombre}* (prospección) pidió que no le escribamos: "${String(texto).slice(0, 140)}". Ya no se le escribe más.`
      : `🎯 *${p.nombre}* respondió al mensaje de prospección: "${String(texto).slice(0, 160)}". El vendedor ya lo está atendiendo; lo ves en Ventas.`).catch(() => {});
  }
}

// ---------- número de WhatsApp de prospección (otra instancia de Evolution) ----------
let estadoCache = { at: 0, v: null };
export async function estadoNumero(forzar = false) {
  if (!C.inst) return { conectado: false, existe: false };
  if (!forzar && Date.now() - estadoCache.at < 60e3 && estadoCache.v) return estadoCache.v;
  const wa = await import('../ventas/whatsapp.mjs');
  const s = await wa.evoApi(`/instance/connectionState/${C.inst}`, null, 'GET').catch((e) => ({ error: e.message }));
  const st = s?.instance?.state || s?.state || null;
  let numero = C.numeroWa || null;
  if (st === 'open' && !numero) {
    const ins = await wa.evoApi(`/instance/fetchInstances?instanceName=${C.inst}`, null, 'GET').catch(() => []);
    const jid = (Array.isArray(ins) ? ins : [ins]).map((i) => i?.ownerJid || i?.instance?.owner || i?.owner).find(Boolean);
    numero = String(jid || '').split('@')[0].replace(/\D/g, '') || null;
    if (numero) { C.numeroWa = numero; saveNow(); }
  }
  estadoCache = { at: Date.now(), v: { existe: true, instancia: C.inst, estado: st, conectado: st === 'open', numero, error: s?.error || null } };
  return estadoCache.v;
}
const numeroListo = async () => (await estadoNumero().catch(() => ({}))).conectado;

export async function conectarNumero() {
  const wa = await import('../ventas/whatsapp.mjs');
  const base = process.env.OFFICE_INTERNAL_URL || `http://tools_oficina:${process.env.PORT || 3000}`;
  const webhook = { enabled: true, url: `${base.replace(/\/$/, '')}/hook/evolution-p/${wa.hookTokenProspeccion()}`, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] };
  let qr = null;
  const existentes = await wa.evoApi(`/instance/fetchInstances?instanceName=${INST}`, null, 'GET').catch(() => []);
  if (!(Array.isArray(existentes) ? existentes : [existentes]).some((i) => (i?.name || i?.instance?.instanceName) === INST)) {
    const r = await wa.evoApi('/instance/create', { instanceName: INST, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, rejectCall: false, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false, webhook });
    qr = r?.qrcode?.base64 || null;
    log(AG, 'Prospección: se creó la instancia de WhatsApp para el número de prospección', 'ok');
  }
  C.inst = INST; C.numeroWa = null; saveNow();
  await wa.evoApi(`/webhook/set/${INST}`, { webhook }).catch((e) => log(AG, `Prospección: no se pudo poner el webhook: ${e.message}`, 'warn'));
  const st = await estadoNumero(true);
  if (st.conectado) return { ...st, qr: null };
  if (!qr) { const c = await wa.evoApi(`/instance/connect/${INST}`, null, 'GET'); qr = c?.base64 || null; }
  return { ...st, qr };
}

// ---------- consultas para la pantalla ----------
export async function resumen() {
  await asegurarTablas();
  const campanas = await q(`select c.*, (select json_object_agg(estado, n) from (select estado, count(*)::int as n from prospects where campaign_id = c.id group by estado) x) as conteo,
      (select coalesce(sum(costo), 0)::float from prospects where campaign_id = c.id) as costo from prospect_campaigns c order by c.id desc`);
  const [hoy] = await q(`select count(*) filter (where canal = 'whatsapp')::int as whatsapp, count(*) filter (where canal = 'correo')::int as correo from prospects where contactado_en >= ($1::date + interval '6 hours')`, [hoyHN()]);
  // Embudo hasta la venta: lo que pasó después en Ventas con los que respondieron por WhatsApp.
  const embudo = { demo: 0, ganado: 0 };
  try {
    const { ventasState } = await import('../ventas/vendedor.mjs');
    for (const c of Object.values(ventasState.convs)) if (c.prospecto) { if (c.estado?.demo || c.estado?.demoEnviada) embudo.demo++; if (c.estado?.resultado?.tipo === 'ganado') embudo.ganado++; }
  } catch {}
  return {
    config: { waPorDia: C.waPorDia, correoPorDia: C.correoPorDia, umbral: C.umbral, porTanda: C.porTanda, activo: C.activo, firma: C.firma, correoDe: C.correoDe, responderA: C.responderA, horario: C.horario, resend: Boolean(process.env.RESEND_API_KEY?.trim()), ia: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()) },
    numero: await estadoNumero().catch((e) => ({ error: e.message })), maps: await estadoMaps(), hoy, campanas, embudo,
  };
}
export const prospectos = ({ campana, estado } = {}) => q(`select id, campaign_id, nombre, categoria, telefono, movil, web, emails, rating, resenas, maps_url, estado, score, confianza, puntos, canal, motivo, contactado_en, respondio_en, conv_id, investigacion, mensaje
  from prospects where ($1::int is null or campaign_id = $1) and ($2::text is null or estado = $2) order by (estado = 'calificado') desc, score desc nulls last, resenas desc nulls last limit 400`, [campana ? Number(campana) : null, estado || null]);
export async function prospecto(id) {
  const [p] = await q('select * from prospects where id = $1', [id]);
  if (!p) return null;
  p.eventos = await q('select tipo, detalle, ts from prospect_events where prospect_id = $1 order by ts desc limit 30', [id]);
  return p;
}

export async function accion(id, { accion: a, mensaje, canal }) {
  const [p] = await q('select * from prospects where id = $1', [id]);
  if (!p) throw new Error('Prospecto no encontrado');
  if (a === 'aprobar') {
    if (!['calificado', 'descartado', 'error'].includes(p.estado)) throw new Error(`No se puede aprobar: está ${p.estado}.`);
    if (!(canal || p.canal)) throw new Error('No tiene celular ni correo.');
    await q(`update prospects set estado = 'aprobado', canal = coalesce($2, canal), motivo = null, actualizado = now() where id = $1`, [id, canal || null]);
  } else if (a === 'descartar') await q(`update prospects set estado = 'descartado', motivo = 'Descartado por Diego', actualizado = now() where id = $1`, [id]);
  else if (a === 'calificar') await q(`update prospects set estado = 'calificado', actualizado = now() where id = $1 and estado = 'aprobado'`, [id]);
  else if (a === 'reinvestigar') { await investigar(id); }
  else if (a === 'llamado') await q(`update prospects set estado = 'contactado', contactado_en = now(), actualizado = now() where id = $1`, [id]);
  else if (a === 'respondio') await q(`update prospects set estado = 'respondio', respondio_en = coalesce(respondio_en, now()), actualizado = now() where id = $1`, [id]);
  else if (a === 'mensaje') {
    const m = { ...(p.mensaje || {}), ...Object.fromEntries(Object.entries(mensaje || {}).filter(([k]) => ['whatsapp', 'asunto', 'correo', 'llamada'].includes(k)).map(([k, v]) => [k, String(v).slice(0, k === 'correo' ? 3000 : 800)])) };
    await q(`update prospects set mensaje = $2, canal = coalesce($3, canal), actualizado = now() where id = $1`, [id, JSON.stringify(m), canal || null]);
  } else throw new Error('Acción desconocida');
  evento(id, a, a === 'mensaje' ? 'Mensaje editado' : '');
  return prospecto(id);
}

// Prueba: Diego recibe en su WhatsApp (desde el número de prospección) o en su correo lo que recibiría el negocio.
export async function prueba(id, canal) {
  const [p] = await q('select * from prospects where id = $1', [id]);
  if (!p) throw new Error('Prospecto no encontrado');
  if (canal === 'correo') {
    if (!C.responderA) throw new Error('Poné tu correo en "Respuestas a" para recibir la prueba.');
    await enviarCorreo({ para: C.responderA, asunto: `[Prueba] ${p.mensaje?.asunto || ''}`, texto: p.mensaje?.correo || '' });
    return { ok: true, a: C.responderA };
  }
  if (!(await numeroListo())) throw new Error('El número de prospección no está conectado.');
  const wa = await import('../ventas/whatsapp.mjs');
  await wa.evoApi(`/message/sendText/${C.inst}`, { number: wa.OWNER_NUM(), text: p.mensaje?.whatsapp || '' });
  return { ok: true, a: 'tu WhatsApp' };
}

export function setConfig(b = {}) {
  for (const k of ['waPorDia', 'correoPorDia', 'umbral', 'porTanda']) if (b[k] != null) C[k] = Math.max(0, Math.min(k === 'umbral' ? 100 : 60, Number(b[k]) || 0));
  for (const k of ['firma', 'correoDe', 'responderA']) if (b[k] != null) C[k] = String(b[k]).trim().slice(0, 160);
  if (b.activo != null) { C.activo = Boolean(b.activo); log(AG, `Prospección: envíos ${C.activo ? 'encendidos' : 'apagados'}`, C.activo ? 'ok' : 'warn'); }
  saveNow();
  return C;
}

// ---------- Brújula: resultados, sondeo y propuestas ----------
// Resultados de todas las campañas, para que Brújula decida a quién ir después.
export async function resultados() {
  await asegurarTablas();
  const cs = await q(`select c.id, c.nombre, c.rubro, c.ciudad, c.busquedas, c.angulo, c.estado, c.creado, c.analizada,
      count(p.*)::int as encontrados,
      count(*) filter (where p.estado in ('calificado','aprobado','contactado','respondio','optout'))::int as calificados,
      count(*) filter (where p.estado = 'descartado')::int as descartados,
      count(*) filter (where p.contactado_en is not null)::int as contactados,
      count(*) filter (where p.estado = 'respondio')::int as respondieron,
      count(*) filter (where p.estado = 'optout')::int as no_quieren,
      count(*) filter (where p.estado = 'aprobado')::int as en_cola,
      count(*) filter (where p.contactado_en is not null and p.canal = 'whatsapp')::int as por_whatsapp,
      count(*) filter (where p.contactado_en is not null and p.canal = 'correo')::int as por_correo,
      count(*) filter (where p.contactado_en is not null and p.canal = 'llamada')::int as por_llamada,
      round(avg(p.score) filter (where p.score is not null))::int as puntaje_promedio,
      coalesce(sum(p.costo), 0)::float as costo_ia_usd,
      max(p.contactado_en) as ultimo_contacto
    from prospect_campaigns c left join prospects p on p.campaign_id = c.id group by c.id order by c.id desc`);
  // Lo que pasó después en Ventas (demos y ventas) con los que respondieron por WhatsApp.
  const porCampana = {};
  try {
    const { ventasState } = await import('../ventas/vendedor.mjs');
    const ids = Object.values(ventasState.convs).filter((c) => c.prospecto?.id).map((c) => c.prospecto.id);
    const camp = ids.length ? await q('select id, campaign_id from prospects where id = any($1::int[])', [ids]) : [];
    const de = Object.fromEntries(camp.map((r) => [r.id, r.campaign_id]));
    for (const c of Object.values(ventasState.convs)) {
      if (!c.prospecto?.id) continue;
      const k = de[c.prospecto.id];
      const x = (porCampana[k] ||= { demos: 0, ventas: 0 });
      if (c.estado?.demo || c.estado?.demoEnviada) x.demos++;
      if (c.estado?.resultado?.tipo === 'ganado') x.ventas++;
    }
  } catch {}
  const respuestas = await q(`select p.campaign_id, p.nombre, p.categoria, e.detalle, e.tipo from prospect_events e join prospects p on p.id = e.prospect_id
    where e.tipo in ('respondio', 'optout') order by e.ts desc limit 40`);
  return {
    campanas: cs.map((c) => ({ ...c, ...(porCampana[c.id] || { demos: 0, ventas: 0 }), tasa_respuesta: c.contactados ? Math.round((c.respondieron / c.contactados) * 100) : null })),
    ultimas_respuestas: respuestas,
    propuesta_pendiente: Boolean(C.propuestaPendiente),
    envios: { encendidos: C.activo, whatsapp_por_dia: C.waPorDia, correos_por_dia: C.correoPorDia },
  };
}

// Sondeo rápido en Maps (profundidad 1, sin investigar con IA ni guardar nada): cuántos negocios hay y cómo están.
export async function sondeo(busquedas) {
  busquedas = (Array.isArray(busquedas) ? busquedas : [busquedas]).map(String).filter(Boolean).slice(0, 5);
  if (!busquedas.length) throw new Error('Falta la búsqueda.');
  const r = await maps('/api/v1/jobs', { method: 'POST', body: { name: `sondeo-${Date.now().toString(36)}`, keywords: busquedas, lang: 'es', depth: 1, email: false, max_time: 300 } });
  const { id } = await r.json();
  const fin = Date.now() + 6 * 60e3;
  while (Date.now() < fin) {
    await sleep(10_000);
    const st = await (await maps(`/api/v1/jobs/${id}`)).json().catch(() => null);
    const estado = String(st?.Status || st?.status || '').toLowerCase();
    if (estado === 'failed') throw new Error('El buscador falló en el sondeo.');
    if (estado !== 'ok') continue;
    const filas = parseCSV(await (await maps(`/api/v1/jobs/${id}/download`)).text()).map(filaAProspecto).filter(Boolean);
    maps(`/api/v1/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
    const conocidos = await telefonosConocidos();
    const n = filas.length || 1;
    const pct = (f) => Math.round((filas.filter(f).length / n) * 100);
    return {
      busquedas, encontrados: filas.length,
      sin_pagina_pct: pct((x) => !x.web || esRed(x.web)), con_celular_pct: pct((x) => x.movil), con_correo_pct: pct((x) => x.emails.length),
      ya_conocidos: filas.filter((x) => x.tel8 && conocidos.has(x.tel8)).length,
      resenas_promedio: Math.round(filas.reduce((a, x) => a + (x.resenas || 0), 0) / n),
      categorias: Object.entries(filas.reduce((a, x) => ((a[x.categoria || '—'] = (a[x.categoria || '—'] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 6),
      ejemplos: filas.slice(0, 8).map((x) => `${x.nombre} (${x.categoria || '—'}, ${x.resenas} reseñas${x.web ? '' : ', sin página'})`),
      nota: 'Sondeo con profundidad 1: la campaña real (profundidad 5) suele encontrar de 3 a 5 veces más.',
    };
  }
  throw new Error('El sondeo tardó más de 6 minutos.');
}

// Brújula presenta 2 o 3 campañas: una tarjeta en la Bandeja con una opción por campaña. Al aprobar, se crea sola.
export function proponer({ propuestas, resumen = '' }) {
  if (!Array.isArray(propuestas) || !propuestas.length) throw new Error('Faltan las propuestas.');
  const ps = propuestas.slice(0, 3).map((p, i) => ({
    n: i + 1, nombre: String(p.nombre || `${p.rubro} · ${p.ciudad}`).slice(0, 80), rubro: String(p.rubro || '').slice(0, 80), ciudad: String(p.ciudad || '').slice(0, 60),
    busquedas: (p.busquedas || []).map(String).filter(Boolean).slice(0, 8), angulo: String(p.angulo || '').slice(0, 600), porque: String(p.porque || '').slice(0, 1200),
    tamano: String(p.tamano || '').slice(0, 200), profundidad: Math.max(1, Math.min(10, Number(p.profundidad) || 5)),
  }));
  if (ps.some((p) => !p.busquedas.length || !p.rubro || !p.ciudad)) throw new Error('Cada propuesta necesita rubro, ciudad y al menos una búsqueda.');
  const cuerpo = ps.map((p) => `## ${p.n}. ${p.nombre}
**Por qué:** ${p.porque}
**Tamaño:** ${p.tamano || '—'}
**Ángulo del mensaje:** ${p.angulo || '—'}
**Búsquedas en Maps:** ${p.busquedas.map((b) => `\`${b}\``).join(', ')}`).join('\n\n');
  const d = addDeliverable('prospector', `Prospección: ${ps.length} campañas propuestas`, `${resumen ? `${resumen}\n\n` : ''}${cuerpo}\n\n---\nAl aprobar una, se crea sola: busca en Maps, la IA investiga y califica los negocios, y te llega la tarjeta para aprobar los contactos (nada sale sin tu aprobación).`,
    { kind: 'decision', summary: ps.map((p) => p.nombre).join(' · '), question: '¿Con cuál seguimos?', options: [...ps.map((p) => `Sí, la ${p.n}: ${p.nombre}`.slice(0, 80)), 'Primero ajustar'], prospeccionPropuesta: ps });
  C.propuestaPendiente = d.id; saveNow();
  log('prospector', `Propuso ${ps.length} campañas de prospección; esperan tu decisión en la Bandeja`, 'ok');
  return { ok: true, id: d.id };
}
export function propuestaCerrada() { C.propuestaPendiente = null; saveNow(); }
export async function aprobarPropuesta(ps, respuesta) {
  C.propuestaPendiente = null; saveNow();
  const n = Number(String(respuesta || '').match(/la (\d)/)?.[1]) || 1;
  const p = ps.find((x) => x.n === n) || ps[0];
  const c = await crearCampana({ nombre: p.nombre, rubro: p.rubro, ciudad: p.ciudad, busquedas: p.busquedas, profundidad: p.profundidad, angulo: p.angulo, propuesta: p.porque });
  log('prospector', `Campaña aprobada y creada: ${p.nombre}`, 'ok');
  return c;
}

// Campaña terminada: no queda nadie en cola, se contactó a alguien y pasaron 5 días desde el último contacto.
// Entonces Brújula analiza los resultados y propone las siguientes.
async function revisarTerminadas() {
  if (!configurado() || C.propuestaPendiente) return;
  await asegurarTablas();
  const [c] = await q(`select c.* from prospect_campaigns c where c.estado = 'lista' and c.analizada is null
    and not exists (select 1 from prospects p where p.campaign_id = c.id and p.estado in ('nuevo','investigando','aprobado'))
    and exists (select 1 from prospects p where p.campaign_id = c.id and p.contactado_en is not null)
    and (select max(contactado_en) from prospects p where p.campaign_id = c.id) < now() - interval '5 days' limit 1`);
  if (!c) return;
  await q('update prospect_campaigns set analizada = now() where id = $1', [c.id]);
  const { runAgent } = await import('../runner.mjs');
  runAgent('prospector', { reason: 'campaña terminada', instruction: `Terminó la campaña "${c.nombre}" (id ${c.id}). Analizá sus resultados con prospeccion_resultados, sacá conclusiones (qué rubros y mensajes respondieron, qué no) y proponé las siguientes 2 o 3 campañas con prospeccion_proponer, sondeando antes su tamaño con prospeccion_sondeo.` })
    .catch((e) => log('prospector', `No pude arrancar el análisis: ${e.message}`, 'warn'));
}

// ---------- ciclo ----------
setInterval(() => revisarTerminadas().catch((e) => log('prospector', `Prospección (campañas terminadas): ${e.message}`, 'warn')), 30 * 60e3);
setInterval(() => revisarBusquedas().catch((e) => log(AG, `Prospección (búsquedas): ${e.message}`, 'warn')), 2 * 60e3);
setInterval(() => investigarPendientes().catch((e) => log(AG, `Prospección (investigación): ${e.message}`, 'warn')), 3 * 60e3);
setInterval(() => enviarPendientes().catch((e) => log(AG, `Prospección (envíos): ${e.message}`, 'warn')), 3 * 60e3);
