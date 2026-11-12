// Gastos que llegan solos desde n8n (cargos de Meta, Lovable, dominios… leídos del correo).
// Mismo JSON y mismas reglas que /api/public/expenses de cresova.com: en n8n solo cambia la URL.
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { q } from './db.mjs';
import { log } from '../state.mjs';

const fecha = /^\d{4}-\d{2}-\d{2}$/;
const esquema = z.object({
  amount: z.coerce.number().positive('amount debe ser mayor que 0').max(10_000_000),
  description: z.string().trim().min(1).max(300).optional(),
  expense_date: z.string().regex(fecha, 'expense_date debe ser YYYY-MM-DD').optional(),
  currency: z.string().trim().toUpperCase().max(8).optional(),
  fx_rate: z.coerce.number().positive().max(1000).optional(),
  category_key: z.string().trim().max(60).optional(),
  expense_type: z.enum(['project_direct', 'operating', 'growth', 'client_managed']).optional(),
  method: z.enum(['transfer', 'cash', 'card', 'paypal', 'other']).optional(),
  status: z.enum(['pending', 'paid']).optional(),
  vendor: z.string().trim().max(200).optional(),
  reference: z.string().trim().min(1).max(200).optional(),
  account_name: z.string().trim().max(120).optional(),
  quote_number: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// Publicidad de Cresova = crecimiento; anuncios que manejamos para un cliente = dinero administrado.
const tipoPorCategoria = (k) => (k === 'ads_cresova' ? 'growth' : k === 'ads_clients' ? 'client_managed' : 'operating');
const hoyHn = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);

export function llaveValida(dada) {
  const esperada = process.env.GASTOS_API_KEY?.trim();
  if (!esperada) return null;
  const a = Buffer.from(String(dada || '').trim()), b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registrar(raw) {
  const r = esquema.safeParse(raw);
  if (!r.success) return { status: 400, body: { ok: false, error: 'Datos inválidos', issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) } };
  const p = r.data;
  if (p.reference) {
    const [dup] = await q('select id from expenses where external_ref = $1 limit 1', [p.reference]);
    if (dup) return { status: 200, body: { ok: true, duplicate: true, expense_id: dup.id } };
  }
  let categoria = null;
  if (p.category_key) {
    const [c] = await q('select id from expense_categories where key = $1 and is_active limit 1', [p.category_key]);
    if (!c) return { status: 400, body: { ok: false, error: 'category_key no existe', valid: (await q('select key from expense_categories where is_active order by sort_order')).map((x) => x.key) } };
    categoria = c.id;
  }
  // Lo que el banco marca como "Personal" es de Diego: va a su nómina.
  let notaPersonal = null;
  if (!categoria && /^\s*personal\s*$/i.test(p.vendor || '')) { const neg = await import('./negocio.mjs'); categoria = await neg.categoriaNomina(); notaPersonal = neg.NOTA_PERSONAL; }
  let cuenta = null;
  if (p.account_name) {
    const cs = await q('select id from treasury_accounts where is_active and name ilike $1 limit 2', [p.account_name.replace(/[%_]/g, '')]);
    if (cs.length === 1) cuenta = cs[0].id;
  }
  let cotizacion = null, cliente = null;
  if (p.quote_number) {
    const [x] = await q('select id, client_id from quotes where quote_number = $1 limit 1', [p.quote_number]);
    if (x) { cotizacion = x.id; cliente = x.client_id; }
  }
  const dia = p.expense_date || hoyHn();
  const estado = p.status || 'paid';
  const moneda = p.currency || 'HNL';
  const fx = p.fx_rate || 1;
  const [fila] = await q(`insert into expenses (amount, currency, fx_rate, amount_hnl, description, expense_date, expense_type, category_id, payment_method, status, paid_at, vendor, account_id, quote_id, client_id, notes, external_ref, source)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'n8n') returning id`,
  [p.amount, moneda, fx, moneda === 'HNL' ? p.amount : p.amount * fx, p.description || p.vendor || 'Gasto desde n8n', dia,
    p.expense_type || (cotizacion && !p.category_key ? 'project_direct' : tipoPorCategoria(p.category_key)), categoria, p.method || 'card', estado,
    estado === 'paid' ? dia : null, p.vendor || null, cuenta, cotizacion, cliente, p.notes || notaPersonal || null, p.reference || null]);
  log(null, `Gasto de ${moneda} ${p.amount} registrado desde n8n${p.vendor ? ` (${p.vendor})` : ''}`, 'info');
  return { status: 201, body: { ok: true, expense_id: fila.id, category_matched: Boolean(categoria), account_matched: Boolean(cuenta), linked_quote: Boolean(cotizacion) } };
}
