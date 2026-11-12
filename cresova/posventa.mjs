// Posventa: a los 7 días de entregar la página, pedido de reseña en Google + referido (y el bot pide un
// testimonio corto si el cliente responde contento). Para los 28 ya entregados, una sola tanda.
// APAGADO hasta que Diego apruebe el texto, dé el enlace de reseñas de Google y Meta apruebe la plantilla.
// Envío: plantilla de WhatsApp `cresova_resena` (sale aunque la ventana de 24 h esté cerrada).
// Máximo 8 por día, entre 9:00 y 18:00 HN, para no golpear la calidad del número.
import { q, enUso } from './db.mjs';
import { state, log, saveNow } from '../state.mjs';

state.posventa ||= { activo: false, enlaceGoogle: '', enviados: {} };
const P = state.posventa;
P.enviados ||= {};
export const PLANTILLA = 'cresova_resena';
const POR_DIA = 8;
const ult8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);

export async function candidatos() {
  const filas = await q(`select qq.id, qq.quote_number, coalesce(nullif(qq.client_company, ''), qq.client_name) as cliente, qq.client_phone,
      coalesce(qq.delivered_at, qq.updated_at) as entregada
    from quotes qq where qq.status = 'accepted' and qq.project_status = 'delivered' and coalesce(qq.delivered_at, qq.updated_at) <= now() - interval '7 days'
    order by entregada desc`);
  const V = (await import('../ventas/vendedor.mjs')).ventasState;
  return filas.map((f) => {
    const conv = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && ult8(c.phone) === ult8(f.client_phone));
    return { ...f, conv: conv?.id || null, enviado: P.enviados[f.id] || null };
  });
}

export async function vistaPrevia() {
  const YC = await import('../ventas/ycloud.mjs');
  await YC.plantillas().catch(() => {});
  const lista = await candidatos();
  return { activo: Boolean(P.activo), enlaceGoogle: P.enlaceGoogle || null, plantillaAprobada: YC.aprobada(PLANTILLA), porDia: POR_DIA,
    pendientes: lista.filter((f) => !f.enviado), sinTelefono: lista.filter((f) => !f.enviado && !f.client_phone).map((f) => f.cliente), enviados: lista.filter((f) => f.enviado).length };
}

export function configurar({ activo, enlaceGoogle } = {}) {
  if (enlaceGoogle !== undefined) {
    const u = String(enlaceGoogle || '').trim();
    if (u && !/^https:\/\/\S+$/.test(u)) throw new Error('El enlace de Google tiene que empezar con https://');
    P.enlaceGoogle = u;
  }
  if (typeof activo === 'boolean') {
    if (activo && !P.enlaceGoogle) throw new Error('Falta el enlace de reseñas de Google.');
    P.activo = activo;
  }
  saveNow();
  return { activo: P.activo, enlaceGoogle: P.enlaceGoogle };
}

export async function correr() {
  if (!P.activo || !P.enlaceGoogle || !enUso()) return { enviados: 0 };
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (h < 9 || h >= 18) return { enviados: 0 };
  const YC = await import('../ventas/ycloud.mjs');
  await YC.plantillas().catch(() => {});
  if (!YC.aprobada(PLANTILLA)) return { enviados: 0, espera: 'plantilla sin aprobar' };
  const hoy = Object.values(P.enviados).filter((e) => Date.now() - e.ts < 24 * 3600e3).length;
  const wa = await import('../ventas/whatsapp.mjs');
  const V = (await import('../ventas/vendedor.mjs')).ventasState;
  let n = 0;
  for (const f of (await candidatos()).filter((x) => !x.enviado && x.client_phone)) {
    if (hoy + n >= POR_DIA) break;
    try {
      const conv = (f.conv && V.convs[f.conv]) || await wa.convParaTelefono(f.client_phone, f.cliente);
      if (conv?.pausa?.total) continue;
      if (!conv || conv.optOut) { P.enviados[f.id] = { ts: Date.now(), omitido: 'no quiere contacto' }; continue; }
      await wa.mandarPlantilla(conv.id, PLANTILLA, [null, P.enlaceGoogle]);
      conv.estado ||= {};
      conv.estado.posventa = Date.now(); // el bot sabe que es cliente entregado: agradece, pide testimonio, toma el referido
      P.enviados[f.id] = { ts: Date.now() };
      n++;
      log('vendedor', `Posventa: pedido de reseña y referido a ${f.cliente} (${f.quote_number})`, 'info');
    } catch (e) { log('vendedor', `Posventa: no salió a ${f.cliente}: ${e.message}`, 'warn'); }
  }
  saveNow();
  return { enviados: n };
}

setInterval(() => { correr().catch((e) => log('vendedor', `Posventa: ${e.message}`, 'warn')); }, 60 * 60e3);
