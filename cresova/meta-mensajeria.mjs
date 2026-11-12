// Meta Conversions API para Mensajería (anuncios de clic a WhatsApp). Desde el 5 nov 2026 el número de ventas va por
// la API oficial (YCloud), y cada chat que viene de un anuncio trae su `ctwa_clid` (conv.anuncio.clid). Con eso los
// eventos se amarran al anuncio EXACTO y Meta optimiza por clientes que avanzan y compran, no solo por conversaciones.
// Formato: action_source "business_messaging", messaging_channel "whatsapp", user_data { whatsapp_business_account_id,
// ctwa_clid } (sin cifrar), al dataset ligado a la cuenta de WhatsApp Business (GET /{waba}/dataset).
// Eventos (una vez por chat, event_id fijo para que Meta descarte repetidos):
//   LeadSubmitted  → se creó su cotización (vio precio y quiso avanzar)
//   QualifiedLead  → se le mandó la demo
//   Purchase       → aceptó / pagó el anticipo (con el valor de la cotización)
// Los chats que se reportan acá se saltan en el envío viejo (system_generated) para no contar doble.
import { q } from './db.mjs';
import { log, state, saveNow } from '../state.mjs';

const VERSION = 'v26.0';
const token = () => process.env.META_CAPI_TOKEN?.trim() || process.env.METAADS_TOKEN?.trim();
state.capiMsj ||= { dataset: null, waba: null, enviados: {}, error: null };
const S = state.capiMsj;

async function graph(path, { method = 'GET', body } = {}) {
  const r = await fetch(`https://graph.facebook.com/${VERSION}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token())}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.error_user_msg || j?.error?.message || `Meta ${r.status}`);
  return j;
}

// El dataset de la cuenta de WhatsApp Business: si no existe, Meta lo crea con el POST.
export async function dataset() {
  const yc = await import('../ventas/ycloud.mjs');
  const est = await yc.estado().catch(() => ({}));
  const waba = est?.numeros?.find((n) => n.numero && est.from && n.numero.replace(/\D/g, '') === est.from.replace(/\D/g, ''))?.wabaId || est?.numeros?.[0]?.wabaId;
  if (!waba) throw new Error('No encontré la cuenta de WhatsApp Business (¿está activa la API oficial?).');
  if (S.dataset && S.waba === waba) return { waba, dataset: S.dataset };
  let j = await graph(`/${waba}/dataset`);
  let id = j?.data?.[0]?.dataset_id || j?.data?.[0]?.id || j?.id;
  if (!id) { j = await graph(`/${waba}/dataset`, { method: 'POST' }); id = j?.id || j?.dataset_id; }
  if (!id) throw new Error('Meta no devolvió el dataset de la cuenta de WhatsApp.');
  S.waba = waba; S.dataset = id; saveNow();
  log(null, `Meta (mensajería): dataset ${id} de la cuenta de WhatsApp ${waba}`, 'ok');
  return { waba, dataset: id };
}

const tel8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
// Chats de anuncio con su clic: teléfono (8 dígitos) → { clid, conv }
async function chatsConClic() {
  const { ventasState } = await import('../ventas/vendedor.mjs');
  const m = new Map();
  for (const c of Object.values(ventasState.convs)) {
    if (c.kind !== 'whatsapp' || c.inst || !c.anuncio?.clid) continue;
    const k = tel8(c.phone);
    if (k.length === 8) m.set(k, { clid: c.anuncio.clid, conv: c, en: c.anuncio.en || c.ts });
  }
  return m;
}
export async function telefonosConClic() { return new Set((await chatsConClic()).keys()); }

export async function barrer({ codigoPrueba = null } = {}) {
  const yc = await import('../ventas/ycloud.mjs');
  if (!yc.activo() || !token()) return { omitido: true };
  let ds;
  try { ds = await dataset(); S.error = null; } catch (e) { S.error = e.message; saveNow(); return { error: e.message }; }
  const clics = await chatsConClic();
  if (!clics.size) return { enviados: 0 };
  // Cotizaciones de los últimos 7 días de esos clientes (por los últimos 8 dígitos del teléfono).
  // Purchase solo cuando ya entró el 50 % (pagado/compra_at): "aceptada" sin anticipo no es venta (Diego, 6 nov).
  const filas = await q(`select qq.id, qq.created_at, qq.accepted_at, qq.status, qq.project_status, qq.total_hnl, qq.total, qq.client_phone, c.phone as c_phone,
      coalesce(p.pagado, 0)::float as pagado, greatest(qq.accepted_at, p.ultimo) as compra_at
    from quotes qq left join clients c on c.id = qq.client_id
    left join (select quote_id, sum(amount) as pagado, max(paid_at)::timestamptz + interval '18 hours' as ultimo from quote_payments group by quote_id) p on p.quote_id = qq.id
    where qq.created_at >= now() - interval '7 days' or greatest(qq.accepted_at, p.ultimo) >= now() - interval '7 days'`);
  const eventos = [];
  const marca = (k) => !S.enviados[k];
  for (const f of filas) {
    const ch = clics.get(tel8(f.c_phone || f.client_phone));
    if (!ch) continue;
    const base = (nombre, cuando, extra = {}) => ({
      event_name: nombre, event_time: Math.floor(new Date(cuando).getTime() / 1000), event_id: `${nombre.toLowerCase()}-${f.id}`,
      action_source: 'business_messaging', messaging_channel: 'whatsapp',
      user_data: { whatsapp_business_account_id: ds.waba, ctwa_clid: ch.clid }, ...extra,
    });
    const valor = Math.round(Number(f.total_hnl ?? f.total ?? 0) * 100) / 100;
    if (marca(`lead-${f.id}`)) eventos.push(base('LeadSubmitted', f.created_at));
    const demo = ch.conv.estado?.demoEnviada || (['demo_sent', 'in_revisions', 'approved', 'client_approved', 'in_progress', 'awaiting_approval', 'finished', 'delivered'].includes(f.project_status) ? Date.parse(f.created_at) : null);
    if (demo && marca(`qualifiedlead-${ch.conv.id}`)) eventos.push({ ...base('QualifiedLead', Math.max(demo, Date.parse(f.created_at))), event_id: `qualifiedlead-${ch.conv.id}` });
    const anticipo = f.pagado >= Number(f.total_hnl || f.total || 0) * 0.5 - 1;
    if (f.status === 'accepted' && f.accepted_at && anticipo && marca(`purchase-${f.id}`)) eventos.push(base('Purchase', Math.min(new Date(f.compra_at || f.accepted_at).getTime(), Date.now() - 60e3), valor > 0 ? { custom_data: { currency: 'HNL', value: valor } } : {}));
  }
  // Leads que Sofía marcó como calificados (aunque todavía no tengan cotización).
  for (const ch of clics.values()) {
    const cal = ch.conv.estado?.calidadLead;
    if (cal?.nivel !== 'calificado' || !marca(`qualifiedlead-${ch.conv.id}`) || eventos.some((e) => e.event_id === `qualifiedlead-${ch.conv.id}`)) continue;
    eventos.push({ event_name: 'QualifiedLead', event_time: Math.floor(cal.ts / 1000), event_id: `qualifiedlead-${ch.conv.id}`, action_source: 'business_messaging', messaging_channel: 'whatsapp', user_data: { whatsapp_business_account_id: ds.waba, ctwa_clid: ch.clid } });
  }
  // Meta no acepta eventos de más de 7 días.
  const vigentes = eventos.filter((e) => Date.now() / 1000 - e.event_time < 7 * 86400 - 3600);
  if (!vigentes.length) return { enviados: 0 };
  try {
    const r = await graph(`/${ds.dataset}/events`, { method: 'POST', body: { data: vigentes, ...(codigoPrueba ? { test_event_code: codigoPrueba } : {}) } });
    if (!codigoPrueba) for (const e of vigentes) S.enviados[e.event_id] = Date.now();
    S.ultimo = { ts: Date.now(), n: vigentes.length, recibidos: r.events_received ?? null }; S.error = null; saveNow();
    log(null, `Meta (mensajería): ${vigentes.length} evento(s) amarrados a su anuncio (${[...new Set(vigentes.map((e) => e.event_name))].join(', ')})`, 'ok');
    return { enviados: vigentes.length, recibidos: r.events_received ?? null };
  } catch (e) { S.error = e.message; saveNow(); log(null, `Meta (mensajería): ${e.message}`, 'warn'); return { error: e.message }; }
}
export const estado = () => ({ dataset: S.dataset, waba: S.waba, error: S.error, ultimo: S.ultimo || null, enviados: Object.keys(S.enviados).length });
