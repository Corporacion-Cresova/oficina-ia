// Autonomía de la oficina: lo que el equipo hace SOLO, dentro de los límites que Diego fijó (5 nov 2026).
//   🟢 solo · 🟡 lo hace y avisa (Diego puede revertir) · 🔴 pide permiso.
// - Pauta: Renata activa, pausa y mueve presupuesto en Meta sin preguntar mientras el gasto proyectado del mes no
//   pase el tope (por defecto L 8,000/mes ≈ L 270/día). Borrar o pasarse del tope sigue pidiendo permiso.
// - Videos orgánicos: si pasan el control técnico y el revisor de marca (Gemini mira el video), se aprueban solos y
//   Andrés los programa. Los anuncios siguen pasando por Diego.
// - Demos: si Ashley les da 8/10 o más (y tienen las fotos del cliente, si mandó), salen solas en la fecha sugerida,
//   con al menos 2 h para que Diego las cancele.
import fs from 'node:fs';
import { state, saveNow, log } from './state.mjs';

state.autonomia ||= {};
const A = state.autonomia;
A.adsMes ??= 8000;
A.organicoAuto ??= true;
A.demoAuto ??= true;
A.demoVetoH ??= 2;
A.demoNotaMin ??= 8;
A.videoNotaMin ??= 7;
// La campaña principal la decide el dueño; el agente de pauta opera sola una campaña de PRUEBAS con su propio presupuesto.
A.campanaPrincipal ??= process.env.META_CAMPANA_PRINCIPAL || null;
A.campanaPruebas ??= null;
A.pruebasDiario ??= 150;
export const config = () => ({ ...A });
export function setConfig(b = {}) {
  if (b.adsMes != null) A.adsMes = Math.max(0, Math.min(200000, Number(b.adsMes) || 0));
  for (const k of ['organicoAuto', 'demoAuto']) if (b[k] != null) A[k] = Boolean(b[k]);
  if (b.pruebasDiario != null) A.pruebasDiario = Math.max(0, Math.min(5000, Number(b.pruebasDiario) || 0));
  if (b.campanaPruebas !== undefined) A.campanaPruebas = b.campanaPruebas ? String(b.campanaPruebas) : null;
  if (b.demoVetoH != null) A.demoVetoH = Math.max(0, Math.min(48, Number(b.demoVetoH) || 0));
  saveNow();
  log(null, `Autonomía actualizada: anuncios hasta L ${A.adsMes}/mes · videos orgánicos ${A.organicoAuto ? 'solos' : 'con aprobación'} · demos ${A.demoAuto ? `solas (${A.demoVetoH} h para vetar)` : 'con aprobación'}`, 'info');
  return config();
}

// ---------- Pauta: permiso automático dentro del presupuesto ----------
const CUENTA = () => (process.env.META_AD_ACCOUNT || '').trim();
export async function graph(path) {
  const t = process.env.METAADS_TOKEN?.trim();
  const r = await fetch(`https://graph.facebook.com/v26.0${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(30_000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
  return j;
}
// Presupuesto diario activo (campañas y conjuntos activos) y gasto del mes, en la moneda de la cuenta (lempiras).
export async function presupuesto() {
  const [cs, as, ins] = await Promise.all([
    graph(`/${CUENTA()}/campaigns?fields=id,name,effective_status,daily_budget,lifetime_budget&limit=200`),
    graph(`/${CUENTA()}/adsets?fields=id,name,effective_status,daily_budget,lifetime_budget,campaign_id&limit=300`),
    graph(`/${CUENTA()}/insights?fields=spend&date_preset=this_month`),
  ]);
  const activos = (l) => (l.data || []).filter((x) => x.effective_status === 'ACTIVE');
  const camp = activos(cs), sets = activos(as);
  const conCbo = new Set(camp.filter((c) => Number(c.daily_budget) > 0).map((c) => c.id));
  let diario = 0;
  const partidas = [];
  for (const c of camp) if (Number(c.daily_budget) > 0) { diario += Number(c.daily_budget) / 100; partidas.push({ id: c.id, nombre: c.name, nivel: 'campaña', diario: Number(c.daily_budget) / 100 }); }
  for (const s of sets) if (!conCbo.has(s.campaign_id) && Number(s.daily_budget) > 0) { diario += Number(s.daily_budget) / 100; partidas.push({ id: s.id, nombre: s.name, nivel: 'conjunto', diario: Number(s.daily_budget) / 100 }); }
  const gastoMes = Number(ins.data?.[0]?.spend || 0);
  const hoy = new Date(Date.now() - 6 * 3600e3);
  const finMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0)).getUTCDate();
  const diasRestantes = finMes - hoy.getUTCDate() + 1;
  return { diario: Math.round(diario), gastoMes: Math.round(gastoMes), diasRestantes, proyectado: Math.round(gastoMes + diario * diasRestantes), tope: A.adsMes, partidas };
}
const texto = (input) => JSON.stringify(input || {});
// Devuelve { ok, nota } si la acción entra en la autonomía; si no, null (se le pregunta a Diego).
export async function autoAprobar(agent, toolName, input) {
  if (agent.id !== 'media' || !/^mcp__metaads__/.test(toolName)) return null;
  const nombre = toolName.replace(/^mcp__metaads__/, '');
  const t = texto(input);
  if (/delete|remove|archive/i.test(nombre) || /"status"\s*:\s*"(DELETED|ARCHIVED)"/i.test(t)) return null; // borrar: siempre Diego
  // ¿A qué campaña pertenece lo que toca? La principal es de Diego: ahí Renata solo lee y propone.
  const id = String(input?.object_id || input?.id || input?.entity_id || input?.campaign_id || input?.ad_set_id || (Array.isArray(input?.object_ids) ? input.object_ids[0] : '') || '');
  let campana = null;
  if (id) {
    if (id === A.campanaPrincipal || id === A.campanaPruebas) campana = id;
    else {
      // Un anuncio o conjunto trae campaign_id; una campaña no tiene ese campo (Meta da error): entonces es la campaña.
      try { campana = (await graph(`/${id}?fields=campaign_id`)).campaign_id || id; } catch { try { await graph(`/${id}?fields=objective`); campana = id; } catch {} }
    }
  }
  if (campana && campana === A.campanaPrincipal) return { ok: false, nota: 'La campaña principal la decide Diego: Renata propone, no cambia.' };
  // La primera campaña nueva que Renata activa pasa a ser la de pruebas.
  if (campana && !A.campanaPruebas && /activate/.test(nombre)) { A.campanaPruebas = campana; saveNow(); log('media', `Campaña de pruebas: ${campana}`, 'info'); }
  if (campana && A.campanaPruebas && campana !== A.campanaPruebas && /activate|update_entity/.test(nombre) && !/"status"\s*:\s*"PAUSED"/i.test(t)) return { ok: false, nota: 'Solo la campaña de pruebas es de Renata; otra campaña la decide Diego.' };
  // Tope diario de la campaña de pruebas
  const pide = Number(t.match(/"(?:campaign_)?daily_budget"\s*:\s*"?(\d+)/)?.[1] || 0) / 100;
  if (pide > A.pruebasDiario) return { ok: false, nota: `La campaña de pruebas tiene tope de L ${A.pruebasDiario}/día (pidió L ${pide}).` };
  // Crear en borrador o en pausa no gasta: pasa solo.
  if (/^ads_create_|^ads_creative_|upload_media/.test(nombre) && !/"status"\s*:\s*"ACTIVE"/i.test(t)) return { ok: true, nota: 'Crear en pausa no gasta: dentro de la autonomía de Pauta' };
  // Pausar siempre ahorra: pasa solo.
  if (/"status"\s*:\s*"PAUSED"/i.test(t) && !/budget/i.test(t)) return { ok: true, nota: 'Pausar: dentro de la autonomía de Pauta' };
  // Activar o cambiar presupuesto: se calcula el mes proyectado con el cambio.
  if (/activate|update_entity/.test(nombre) || /budget|"status"\s*:\s*"ACTIVE"/i.test(t)) {
    let p;
    try { p = await presupuesto(); } catch (e) { return null; }
    const nuevoDiario = Number(t.match(/"daily_budget"\s*:\s*"?(\d+)/)?.[1] || 0) / 100;
    const actual = p.partidas.find((x) => x.id === id)?.diario || 0;
    // Activar un anuncio o conjunto de una campaña que ya está gastando no suma nada (su presupuesto ya cuenta).
    // Activar una campaña apagada suma su presupuesto diario real.
    let extra = 0;
    if (nuevoDiario) extra = nuevoDiario - actual;
    else if (/activate|"ACTIVE"/i.test(nombre + t) && !actual && !(campana && p.partidas.some((x) => x.id === campana))) {
      let d = 0;
      try { const cp = await graph(`/${campana || id}?fields=daily_budget`); d = Number(cp.daily_budget || 0) / 100; } catch {}
      extra = d || (campana && campana === A.campanaPruebas ? A.pruebasDiario : p.partidas.length ? p.diario / p.partidas.length : 0);
    }
    const proyectado = Math.round(p.gastoMes + (p.diario + extra) * p.diasRestantes);
    if (proyectado <= A.adsMes) return { ok: true, nota: `Dentro del presupuesto del mes: proyectado L ${proyectado} de L ${A.adsMes}` };
    return { ok: false, nota: `Se pasaría del tope del mes: proyectado L ${proyectado} (tope L ${A.adsMes}). Lo decide Diego.` };
  }
  return null;
}

// ---------- videos orgánicos: revisor de marca con Gemini ----------
const KEY = () => process.env.GEMINI_API_KEY?.trim();
async function subirVideo(file) {
  const tam = fs.statSync(file).size;
  const ini = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(KEY())}`, {
    method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(tam), 'X-Goog-Upload-Header-Content-Type': 'video/mp4', 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: { display_name: 'revision-cresova' } }), signal: AbortSignal.timeout(30_000),
  });
  const url = ini.headers.get('x-goog-upload-url');
  if (!url) throw new Error(`Gemini no dio dónde subir (${ini.status})`);
  const up = await fetch(url, { method: 'POST', headers: { 'Content-Length': String(tam), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: fs.readFileSync(file), signal: AbortSignal.timeout(300_000) });
  const j = await up.json();
  let f = j.file;
  for (let i = 0; i < 40 && f?.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    f = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${f.name}?key=${encodeURIComponent(KEY())}`)).json();
  }
  if (f?.state !== 'ACTIVE') throw new Error('Gemini no terminó de procesar el video');
  return f;
}
const REVISION = (titulo) => `Sos el revisor de calidad de videos de Cresova, agencia de páginas web de Honduras (paquete Web Pro: L 8,500 en dos pagos; demo gratis antes de pagar; contacto por WhatsApp). Este video ORGÁNICO se va a publicar en TikTok, YouTube e Instagram: "${titulo}".
Revisalo completo y respondé SOLO con JSON:
{"aprobado": true|false, "puntaje": 1-10, "problemas": ["…"], "bueno": "una frase"}
Rechazalo (aprobado false) si: hay errores de ortografía o texto cortado/ilegible en pantalla; el texto tapa caras o elementos clave; un precio distinto de L 8,500 o promesas que Cresova no cumple (resultados garantizados, "gratis" la página completa); audio con silencios largos, voz cortada o música tapando la voz; cuadros negros o saltos raros; la marca Cresova mal escrita; algo ofensivo, engañoso o de mal gusto; el video no se entiende sin contexto. Puntaje 7+ = publicable sin vergüenza; 9+ = muy bueno.`;
export async function revisarVideo(file, titulo) {
  if (!KEY()) throw new Error('Falta la llave de Gemini');
  const f = await subirVideo(file);
  for (const model of ['gemini-2.5-flash', 'gemini-flash-latest']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(KEY())}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: 'video/mp4', file_uri: f.uri } }, { text: REVISION(titulo) }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 2048 } }),
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json().catch(() => ({}));
    const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    try { const v = JSON.parse(t.replace(/^```(?:json)?|```$/g, '').trim()); fetch(`https://generativelanguage.googleapis.com/v1beta/${f.name}?key=${encodeURIComponent(KEY())}`, { method: 'DELETE' }).catch(() => {}); return v; } catch {}
  }
  throw new Error('El revisor no devolvió un veredicto');
}
// Se llama cuando un video queda listo en el Estudio.
export async function videoListo(d, file, qa) {
  const { tipoVideo } = await import('./enlaces.mjs');
  if (!A.organicoAuto || tipoVideo(d) === 'anuncio') return;
  const tecnico = qa?.formatOk !== false && qa?.loudOk !== false && !/black_start/.test(qa?.negro || '');
  if (!tecnico) { log(d.agentId, `Revisor automático: "${d.title}" no pasó el control técnico; queda para Diego`, 'warn'); return; }
  let v;
  try { v = await revisarVideo(file, d.title.replace(/^🎬\s*/, '')); } catch (e) { log(d.agentId, `Revisor automático no pudo ver "${d.title}": ${e.message}; queda para Diego`, 'warn'); return; }
  const { reviewDeliverable } = await import('./state.mjs');
  const actual = state.deliverables.find((x) => x.id === d.id);
  if (!actual || actual.status !== 'pending') return; // Diego ya lo revisó
  actual.revisorAuto = { aprobado: Boolean(v.aprobado), puntaje: Number(v.puntaje) || 0, problemas: (v.problemas || []).slice(0, 6), ts: Date.now() };
  saveNow();
  if (v.aprobado && Number(v.puntaje) >= A.videoNotaMin) {
    const r = reviewDeliverable(d.id, 'approved', `Aprobado por el revisor automático (${v.puntaje}/10)${v.bueno ? `: ${v.bueno}` : ''}`);
    if (r?.taskId) { const { onReview } = await import('./tareas.mjs'); onReview(r, 'approved', 'Aprobado por el revisor automático'); }
    log(d.agentId, `Revisor automático aprobó "${d.title}" (${v.puntaje}/10): Andrés lo programa`, 'ok');
    const { mensajeDiscord } = await import('./voz.mjs');
    mensajeDiscord(`✅ **Video aprobado solo** (${v.puntaje}/10): ${d.title.replace(/^🎬\s*/, '')}\nAndrés lo programa. Si no te gusta, quitalo en Estudio.`).catch(() => {});
  } else {
    log(d.agentId, `Revisor automático NO aprobó "${d.title}" (${v.puntaje}/10): ${(v.problemas || []).join('; ').slice(0, 200)}. Queda para Diego`, 'warn');
  }
}

// ---------- demos: salen solas si Ashley las aprobó ----------
export function demoAuto(p, { fotosCliente = 0, fotosUsadas = 0 } = {}) {
  if (!A.demoAuto) return null;
  if (!(Number(p.calidad) >= A.demoNotaMin)) return null;
  if (fotosCliente > 0 && fotosUsadas === 0) return null; // mandó fotos y no se usaron: que lo vea Diego
  return { vetoMs: A.demoVetoH * 3600e3 };
}

// ---------- Pauta aprueba sus propios anuncios (6 nov) ----------
// Renata elige qué videos de anuncio usar; el revisor (Gemini) los mira y, si pasan, quedan aprobados sin Diego.
async function medidas(file) {
  const { execFile } = await import('node:child_process');
  return new Promise((res) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file], (e, out) => {
    try { const j = JSON.parse(out); const st = (j.streams || []).find((x) => x.width) || {}; res({ seg: Math.round(Number(j.format?.duration) || 0), ancho: st.width, alto: st.height }); } catch { res({}); }
  }));
}
const formato = (m) => (!m.ancho ? '?' : m.alto > m.ancho * 1.3 ? '9:16' : m.ancho > m.alto * 1.3 ? '16:9' : m.alto > m.ancho ? '4:5' : '1:1');
async function archivo(d) { const { renderFile } = await import('./estudio.mjs'); return renderFile(d.video?.video, d.video?.name); }
export async function anunciosPorAprobar() {
  const { tipoVideo } = await import('./enlaces.mjs');
  const l = state.deliverables.filter((d) => d.kind === 'video' && d.status === 'pending' && tipoVideo(d) === 'anuncio' && Date.now() - d.ts < 30 * 86400e3);
  const out = [];
  for (const d of l.slice(-20)) {
    const f = await archivo(d);
    const m = f ? await medidas(f) : {};
    out.push({ id: d.id.slice(0, 8), titulo: d.title.replace(/^[🎬📣\s·]+/u, ''), formato: formato(m), segundos: m.seg ?? null, apto_meta: formato(m) !== '16:9' && (m.seg || 0) <= 60 });
  }
  return out;
}
export async function aprobarAnuncio(idPrefix, motivo = '') {
  const d = state.deliverables.find((x) => x.kind === 'video' && x.id.startsWith(idPrefix));
  if (!d) throw new Error('No encuentro ese video');
  if (d.status === 'approved') return { ok: true, nota: 'Ya estaba aprobado' };
  const f = await archivo(d);
  if (!f) throw new Error('No encuentro el archivo del video');
  const m = await medidas(f);
  const v = await revisarVideo(f, d.title.replace(/^[🎬📣\s·]+/u, ''));
  d.revisorAuto = { aprobado: Boolean(v.aprobado), puntaje: Number(v.puntaje) || 0, problemas: (v.problemas || []).slice(0, 6), ts: Date.now() };
  saveNow();
  if (!(v.aprobado && Number(v.puntaje) >= A.videoNotaMin)) return { ok: false, puntaje: v.puntaje, problemas: v.problemas, nota: 'El revisor no lo aprobó: pedile la corrección al editor o elegí otro' };
  const { reviewDeliverable } = await import('./state.mjs');
  const r = reviewDeliverable(d.id, 'approved', `Aprobado por Renata (Pauta) con el revisor ${v.puntaje}/10${motivo ? `: ${motivo}` : ''}`);
  if (r?.taskId) { const { onReview } = await import('./tareas.mjs'); onReview(r, 'approved', 'Aprobado por Pauta'); }
  log('media', `Aprobó el anuncio "${d.title}" (${v.puntaje}/10, ${formato(m)}, ${m.seg ?? '?'} s)`, 'ok');
  const { mensajeDiscord } = await import('./voz.mjs');
  mensajeDiscord(`📣 **Renata aprobó un anuncio** (${v.puntaje}/10, ${formato(m)}, ${m.seg ?? '?'} s): ${d.title.replace(/^[🎬📣\s·]+/u, '')}${motivo ? `\n${motivo}` : ''}\nVa a la campaña de pruebas. Si no te gusta, quitalo en Estudio.`).catch(() => {});
  return { ok: true, puntaje: v.puntaje, formato: formato(m), segundos: m.seg };
}
