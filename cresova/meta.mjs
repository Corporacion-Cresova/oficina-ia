// Meta Conversions API desde la base propia (antes lo hacía cresova.com cada hora).
// Copia la lógica de cresova.com: "Lead" cuando se crea una cotización y "Purchase" cuando se acepta, de los
// últimos 7 días, con event_id `lead-<id>` / `purchase-<id>` (Meta descarta repetidos con el mismo id).
// action_source es "website" solo si el cliente trae fbp/fbc de la web; si no, "system_generated".
// Las columnas meta_lead_sent_at / meta_purchase_sent_at marcan lo ya enviado: repetir el barrido no duplica nada.
import { createHash } from 'node:crypto';
import { q } from './db.mjs';
import { log } from '../state.mjs';

const VERSION = 'v26.0';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const pixel = () => process.env.META_PIXEL_ID?.trim();
const token = () => process.env.META_CAPI_TOKEN?.trim() || process.env.METAADS_TOKEN?.trim();
export const configurado = () => Boolean(pixel() && token());

// Teléfono en E.164 sin "+": los números hondureños de 8 dígitos llevan 504.
function telefono(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = `504${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}
const correo = (raw) => { const e = String(raw || '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; };

function evento({ nombre, id, cuando, tel, email, externo, fbp, fbc, valor }) {
  const web = Boolean(fbp || fbc);
  const user_data = {};
  const ph = telefono(tel), em = correo(email);
  if (ph) user_data.ph = [sha(ph)];
  if (em) user_data.em = [sha(em)];
  if (externo) user_data.external_id = [sha(String(externo))];
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  if (web) user_data.client_user_agent = 'Mozilla/5.0';
  const e = { event_name: nombre, event_time: Math.floor(new Date(cuando).getTime() / 1000), event_id: id, action_source: web ? 'website' : 'system_generated', user_data };
  if (web) e.event_source_url = 'https://cresova.com/web-page';
  if (valor > 0) e.custom_data = { value: Math.round(valor * 100) / 100, currency: 'HNL' };
  return e;
}

export async function enviar(eventos, codigoPrueba = null) {
  if (!configurado()) return { ok: false, status: 0, body: { error: 'Meta no configurado' } };
  const payload = { data: eventos, ...(codigoPrueba || process.env.META_TEST_EVENT_CODE ? { test_event_code: codigoPrueba || process.env.META_TEST_EVENT_CODE } : {}) };
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${pixel()}/events?access_token=${encodeURIComponent(token())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
const errorDe = (b) => String(b?.error?.error_user_msg || b?.error?.message || 'Error de Meta').slice(0, 300);

const SEL = `select qq.id, qq.created_at, qq.accepted_at, qq.total_hnl, qq.total, qq.client_phone, qq.client_email, qq.client_id, qq.meta_attempts,
  c.phone as c_phone, c.email as c_email, c.meta_fbp, c.meta_fbc from quotes qq left join clients c on c.id = qq.client_id`;

export async function barrer() {
  if (!configurado()) return { omitido: true, enviados: 0, fallidos: 0 };
  const leads = await q(`${SEL} where qq.meta_lead_sent_at is null and qq.created_at >= now() - interval '7 days' and coalesce(qq.meta_attempts, 0) < 10 order by qq.created_at limit 50`);
  // Purchase = cuando ya entró el 50 % (decisión de Diego, 6 nov: "aceptada" sin anticipo no es venta). La fecha del
  // evento es la del pago que completó el anticipo (o la aceptación si fue después).
  const compras = (await q(`select s.*, greatest(s.accepted_at, p.ultimo) as compra_at from (${SEL}) s
      join (select quote_id, sum(amount) as pagado, max(paid_at)::timestamptz + interval '18 hours' as ultimo from quote_payments group by quote_id) p on p.quote_id = s.id
      join quotes qq on qq.id = s.id
    where qq.status = 'accepted' and qq.meta_purchase_sent_at is null and coalesce(qq.meta_attempts, 0) < 10
      and p.pagado >= coalesce(nullif(qq.total_hnl, 0), qq.total) * 0.5 - 1 and greatest(qq.accepted_at, p.ultimo) >= now() - interval '7 days'
    order by compra_at limit 50`)).map((f) => ({ ...f, accepted_at: new Date(Math.min(new Date(f.compra_at).getTime(), Date.now() - 60e3)) }));
  let enviados = 0, fallidos = 0;
  // Los que vinieron de un anuncio de WhatsApp con su clic se reportan como mensajería (meta-mensajeria.mjs):
  // acá se saltan para no contar doble, siempre que ese envío esté funcionando.
  const mm = await import('./meta-mensajeria.mjs');
  const conClic = mm.estado().dataset && !mm.estado().error ? await mm.telefonosConClic().catch(() => new Set()) : new Set();
  for (const [tipo, filas] of [['Lead', leads], ['Purchase', compras]]) {
    for (const f of filas) {
      const tel = f.c_phone || f.client_phone;
      if (conClic.has(String(tel || '').replace(/\D/g, '').slice(-8))) continue;
      if (!tel && !f.meta_fbc && !f.meta_fbp) continue; // sin con qué identificar a la persona, Meta no lo puede usar
      const r = await enviar([evento({
        nombre: tipo, id: `${tipo.toLowerCase()}-${f.id}`, cuando: tipo === 'Purchase' ? f.accepted_at : f.created_at,
        tel, email: f.c_email || f.client_email, externo: f.client_id, fbp: f.meta_fbp, fbc: f.meta_fbc,
        valor: tipo === 'Purchase' ? Number(f.total_hnl ?? f.total ?? 0) : null,
      })]);
      if (r.ok) { await q(`update quotes set ${tipo === 'Lead' ? 'meta_lead_sent_at' : 'meta_purchase_sent_at'} = now(), meta_last_error = null where id = $1`, [f.id]); enviados++; }
      else { await q('update quotes set meta_last_error = $2, meta_attempts = coalesce(meta_attempts, 0) + 1 where id = $1', [f.id, errorDe(r.body)]); fallidos++; }
    }
  }
  if (enviados || fallidos) log(null, `Meta CAPI: ${enviados} evento(s) enviados${fallidos ? `, ${fallidos} con error` : ''}`, fallidos ? 'warn' : 'info');
  return { omitido: false, enviados, fallidos };
}

// Prueba sin efectos reales: reenvía el "Lead" de la última cotización ya reportada, con el mismo event_id,
// así Meta lo reconoce como repetido. Sirve para ver que el dataset y la llave funcionan.
export async function probar() {
  if (!configurado()) return { ok: false, error: 'Falta el dataset (META_PIXEL_ID) o la llave de Meta.' };
  const [f] = await q(`${SEL} where qq.meta_lead_sent_at is not null and coalesce(qq.client_phone, '') <> '' order by qq.meta_lead_sent_at desc limit 1`);
  if (!f) return { ok: false, error: 'No hay ninguna cotización ya reportada para usar de prueba.' };
  const r = await enviar([evento({ nombre: 'Lead', id: `lead-${f.id}`, cuando: f.created_at, tel: f.c_phone || f.client_phone, email: f.c_email || f.client_email, externo: f.client_id, fbp: f.meta_fbp, fbc: f.meta_fbc })]);
  return r.ok ? { ok: true, recibidos: r.body.events_received ?? null, fbtrace: r.body.fbtrace_id ? 'sí' : 'no' } : { ok: false, status: r.status, error: errorDe(r.body) };
}

export async function estado() {
  const [r] = await q(`select count(*) filter (where meta_lead_sent_at is not null)::int as leads, count(*) filter (where meta_purchase_sent_at is not null)::int as compras,
    max(meta_lead_sent_at) as ultimo_lead, max(meta_purchase_sent_at) as ultima_compra,
    count(*) filter (where meta_last_error is not null and (meta_lead_sent_at is null or (status = 'accepted' and meta_purchase_sent_at is null)))::int as con_error,
    (select meta_last_error from quotes where meta_last_error is not null order by updated_at desc limit 1) as ultimo_error from quotes`);
  return { configurado: configurado(), dataset: pixel() || null, llave: process.env.META_CAPI_TOKEN?.trim() ? 'CAPI propia' : process.env.METAADS_TOKEN?.trim() ? 'la de anuncios (METAADS_TOKEN)' : null, ...r };
}
