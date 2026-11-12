// Calidad del número de ventas (Meta): la calificación GREEN / YELLOW / RED que Meta le pone al número según
// bloqueos y reportes. Si baja, Meta limita cuántos mensajes podés mandar justo en el número que vende.
// - Se revisa cada 3 horas (y al arrancar); el resumen va una vez al día.
// - Si deja de estar en GREEN: aviso a Diego (WhatsApp/Discord) y se FRENA el recontacto automático.
//   Si vuelve a GREEN y el freno lo puso esto, se reanuda solo (con aviso).
// - Cuenta cuántas plantillas salen por día y de qué tipo (MARKETING cuesta más que UTILITY).
import { log, saveNow } from '../state.mjs';
import { ventasState as V } from './vendedor.mjs';
import { PLANTILLAS } from './plantillas.mjs';

V.calidad ||= { historial: [], porDia: {} };
const C = V.calidad;
C.porDia ||= {};
C.historial ||= [];
const hoyHN = (t = Date.now()) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10);
const categoria = (name) => PLANTILLAS.find((p) => p.name === name)?.category || 'OTRA';

// Lo llama ycloud.enviarPlantilla cada vez que una plantilla sale bien.
export function contarPlantilla(name, t = Date.now()) {
  const d = (C.porDia[hoyHN(t)] ||= { MARKETING: 0, UTILITY: 0, OTRA: 0, plantillas: {} });
  d[categoria(name)] = (d[categoria(name)] || 0) + 1;
  d.plantillas[name] = (d.plantillas[name] || 0) + 1;
  // Solo los últimos 90 días.
  for (const k of Object.keys(C.porDia).sort().slice(0, -90)) delete C.porDia[k];
  saveNow();
}

// Una sola vez: reconstruye el conteo desde las conversaciones (mensajes del bot marcados con su plantilla).
function reconstruir() {
  if (C.reconstruido2) return;
  C.porDia = {};
  for (const c of Object.values(V.convs || {})) for (const m of c.msgs || []) if ((m.role === 'bot' || m.role === 'equipo') && m.meta?.plantilla) contarPlantilla(m.meta.plantilla, m.ts);
  C.reconstruido2 = Date.now();
  saveNow();
}

export function conteo(dias = 14) {
  reconstruir();
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    const f = hoyHN(Date.now() - i * 864e5);
    const d = C.porDia[f] || {};
    out.push({ fecha: f, marketing: d.MARKETING || 0, utility: d.UTILITY || 0, plantillas: d.plantillas || {} });
  }
  const sum = (k) => out.reduce((s, x) => s + x[k], 0);
  return { dias: out, total: { marketing: sum('marketing'), utility: sum('utility') }, promedioMarketingDia: Math.round((sum('marketing') / dias) * 10) / 10 };
}

async function avisar(texto) {
  // Si la calidad baja, mejor no depender del mismo número: primero Discord; si no está, WhatsApp.
  try { const { mensajeDiscord } = await import('../voz.mjs'); await mensajeDiscord(texto); return; } catch {}
  const wa = await import('./whatsapp.mjs');
  await wa.avisarDiego(texto).catch(() => {});
}

export async function revisar({ forzarResumen = false } = {}) {
  const YC = await import('./ycloud.mjs');
  if (!YC.activo()) return { activo: false };
  const est = await YC.estado();
  if (est.error) { log('vendedor', `Calidad del número: no se pudo leer (${est.error})`, 'warn'); return { error: est.error }; }
  const n = est.numeros.find((x) => String(x.numero || '').replace(/\D/g, '') === String(est.from || '').replace(/\D/g, '')) || est.numeros[0];
  const calidad = String(n?.calidad || 'UNKNOWN').toUpperCase();
  const antes = C.ultimo?.calidad || null;
  C.ultimo = { calidad, estado: n?.estado || null, ts: Date.now() };
  if (C.historial.at(-1)?.calidad !== calidad) C.historial.push({ calidad, ts: Date.now() });
  C.historial = C.historial.slice(-60);
  const rc = await import('./recontacto.mjs');
  const c = conteo(7);
  const mk = `Plantillas de marketing: ${c.dias.at(-1).marketing} hoy, ${c.total.marketing} en 7 días (promedio ${c.promedioMarketingDia}/día).`;
  if (calidad !== 'GREEN' && calidad !== 'UNKNOWN') {
    // Frenar el recontacto (manda plantillas de marketing a clientes viejos: lo que más baja la calidad).
    if (!rc.estadoRecontacto().pausado) { rc.pausar(true, `Calidad del número de ventas en ${calidad}: frenado automático`); C.pausaPorCalidad = true; }
    if (antes !== calidad || C.avisadoDia !== hoyHN()) {
      C.avisadoDia = hoyHN();
      await avisar(`🚨 *La calidad del WhatsApp de ventas bajó a ${calidad === 'YELLOW' ? 'AMARILLO' : calidad === 'RED' ? 'ROJO' : calidad}* (Meta). Si sigue bajando, Meta limita cuántos mensajes podemos mandar desde el número que vende.\nFrené el recontacto automático. ${mk}\nLo que más la baja: mensajes a gente que no nos conoce o que no los espera. Conviene bajar los seguimientos con plantilla hasta que vuelva a verde.`);
    }
  } else if (calidad === 'GREEN') {
    if (C.pausaPorCalidad) {
      C.pausaPorCalidad = false;
      if (rc.estadoRecontacto().pausado && /Calidad del número/.test(rc.estadoRecontacto().pausaMotivo || '')) rc.pausar(false);
      await avisar(`✅ La calidad del WhatsApp de ventas volvió a VERDE. Reanudé el recontacto automático. ${mk}`);
    }
  }
  // Resumen diario (una vez al día, a partir de las 9:00 HN): solo al log, salvo que la calidad no esté en verde.
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (forzarResumen || (h >= 9 && C.resumenDia !== hoyHN())) {
    C.resumenDia = hoyHN();
    log('vendedor', `Calidad del número de ventas: ${calidad}. ${mk}`, calidad === 'GREEN' ? 'info' : 'warn');
  }
  saveNow();
  return { calidad, antes, estado: n?.estado || null, recontactoPausado: rc.estadoRecontacto().pausado, pausaPorCalidad: Boolean(C.pausaPorCalidad), historial: C.historial.slice(-10), plantillas: conteo(14) };
}

setTimeout(() => revisar().catch(() => {}), 60e3);
setInterval(() => revisar().catch(() => {}), 3 * 3600e3);
