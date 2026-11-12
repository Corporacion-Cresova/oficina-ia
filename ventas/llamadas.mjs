// Llamadas: la lista de Diego para sentarse a llamar. Reemplaza los avisos sueltos de "para llamar" por Discord/WhatsApp.
// Junta en un solo lugar: quién pidió una persona, quién respondió bien a su demo, quién aceptó y no ha pagado,
// promesas sin cumplir y los mensajes que no se pudieron mandar. Cada fila trae el motivo, qué decirle y lo último del chat.
import { saveNow, log } from '../state.mjs';
import { ventasState as V } from './vendedor.mjs';
import * as cdb from '../cresova/db.mjs';
import { etapaDe, cuentaTs } from './etapa.mjs';

V.llamadas ||= { cola: [], resueltas: {} };
const C = V.llamadas;
C.cola ||= []; C.resueltas ||= {};
const DIA = 864e5;
const ult8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);
const nombreDe = (c) => c.contacto?.empresa || c.contacto?.nombre || c.title;

// Lo llama la oficina cuando algo hay que resolverlo con una llamada.
export function agregarLlamada(conv, motivo, tipo = 'seguimiento', sugerencia = '') {
  const key = `${conv.id}:${tipo}`;
  const previa = C.cola.find((x) => x.key === key);
  if (previa) { previa.motivo = String(motivo).slice(0, 220); previa.ts = Date.now(); if (sugerencia) previa.sugerencia = String(sugerencia).slice(0, 300); }
  else C.cola.push({ key, conv: conv.id, tipo, motivo: String(motivo).slice(0, 220), ts: Date.now(), sugerencia: String(sugerencia).slice(0, 300) });
  C.cola = C.cola.slice(-120);
  saveNow();
}

const SUGERENCIA = {
  persona: 'Pidió hablar con alguien: preguntale qué necesita resolver y cerrá el siguiente paso en la llamada.',
  cuenta: 'Ya tiene la cuenta: preguntale si pudo hacer el pago o qué lo está frenando.',
  interes: 'Mostró interés en su demo: preguntale si avanzamos con el 50 % y qué le falta para decidir.',
  anticipo: 'Dijo que sí y falta el anticipo: confirmá que tiene los datos y cuándo puede hacer el pago.',
  promesa: 'Le quedamos debiendo algo: cumplí lo prometido primero y después preguntá cómo sigue.',
  compromiso: 'Dijo que iba a hacer algo: preguntale cómo le fue con eso.',
  seguimiento: 'Una llamada corta: ¿pudo verla, qué le cambiaría, avanzamos?',
  no_enviado: 'WhatsApp no dejó mandarle el mensaje: resolvelo por llamada.',
};
const ORDEN = ['persona', 'pedida', 'compromiso', 'cuenta', 'interes', 'anticipo', 'promesa', 'no_enviado', 'seguimiento'];

export async function lista() {
  const ahora = Date.now();
  const filas = [];
  const add = (conv, tipo, motivo, ts, extra = {}) => filas.push({ key: `${conv.id}:${tipo}`, conv, tipo, motivo, ts, ...extra });
  for (const x of C.cola) { const c = V.convs[x.conv]; if (c) add(c, x.tipo, x.motivo, x.ts, { sugerencia: x.sugerencia }); }
  // Compromisos del cliente que ya tocaba preguntar y nadie preguntó (los de confianza baja quedan solo en la ficha).
  const km = await import('./compromisos.mjs');
  for (const k of km.abiertos()) {
    const c = V.convs[k.conv];
    if (!c || k.confianza === 'baja') continue;
    // Se le escribió solo (Fase 2) y a los 3 días hábiles no contestó: ahora una llamada.
    const seg = k.seguimiento;
    if (k.estado === 'preguntado' && seg?.ok && new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10) >= km.sumarHabiles(new Date(seg.ts - 6 * 3600e3).toISOString().slice(0, 10), 3)) {
      add(c, 'compromiso', `Le escribimos solo por lo que dijo ("${k.cita.slice(0, 90)}") y no ha contestado`, seg.ts, { sugerencia: k.pregunta });
      continue;
    }
    if (k.estado !== 'toca') continue;
    add(c, 'compromiso', `${k.delicado ? 'Delicado: ' : ''}dijo "${k.cita.slice(0, 110)}" (${k.dicho_el.slice(8, 10)}/${k.dicho_el.slice(5, 7)}). Tocaba preguntarle el ${k.revisar_el.slice(8, 10)}/${k.revisar_el.slice(5, 7)}`, Date.parse(`${k.revisar_el}T06:00:00Z`), { sugerencia: k.delicado ? `Con cuidado, primero cómo está. ${k.pregunta}` : k.pregunta });
  }
  const wa = await import('./whatsapp.mjs');
  for (const p of wa.promesasPendientes()) { const c = V.convs[p.conv]; if (c && !/te escribimos por el anticipo/i.test(p.promesa)) add(c, 'promesa', `Hace ${p.hace_horas} h le dijimos: "${p.promesa.slice(0, 130)}"`, p.ts || ahora - p.hace_horas * 3600e3); }
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || c.optOut) continue;
    if (c.estado?.humano && ahora - (c.pausa?.ts || c.ts) < 14 * DIA) add(c, 'persona', `Pidió hablar con una persona: ${String(c.estado.humano).slice(0, 120)}`, c.pausa?.ts || c.ts);
    const tc = cuentaTs(c);
    if (etapaDe(c) === 'cuenta' && tc && ahora - tc > 2 * DIA && ahora - tc < 21 * DIA) add(c, 'cuenta', `Se le mandó la cuenta hace ${Math.floor((ahora - tc) / DIA)} días y no ha pagado`, tc);
    const r = c.estado?.respuestaDemo;
    if (r && ['gusta', 'cambios'].includes(r.tipo) && ahora - r.ts < 10 * DIA && !c.estado?.resultado) add(c, 'interes', r.tipo === 'gusta' ? `Le gustó su demo: "${String(r.texto).replace(/^\[[^\]]*\]:?\s*/, '').slice(0, 130)}"` : `Pidió cambios a su demo: "${String(r.texto).replace(/^\[[^\]]*\]:?\s*/, '').slice(0, 130)}"`, r.ts);
  }
  if (cdb.enUso()) {
    const cob = await import('../cresova/cobranza.mjs');
    for (const r of await cob.cartera().catch(() => [])) {
      if (r.fase !== 'anticipo') continue;
      const c = Object.values(V.convs).find((x) => x.kind === 'whatsapp' && ult8(x.phone) === ult8(r.client_phone));
      if (c) add(c, 'anticipo', `Aceptó la cotización ${r.quote_number} hace ${r.dias} días y no ha pagado el anticipo`, new Date(r.accepted_at).getTime(), { monto: Math.round(r.total / 2) - r.pagado, cotizacion: r.quote_number });
    }
  }
  // Una fila por cliente: la razón más importante manda; las demás quedan como contexto.
  const porConv = new Map();
  for (const f of filas.sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo))) {
    if (f.conv.pausa?.total) continue;
    const res = C.resueltas[f.key];
    if (res && (res.hasta > ahora || (res.hasta === 0 && f.ts <= res.ts))) continue;
    if (porConv.has(f.conv.id)) { porConv.get(f.conv.id).otros.push(f.motivo); continue; }
    porConv.set(f.conv.id, { ...f, otros: [] });
  }
  return [...porConv.values()].sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo) || b.ts - a.ts).map((f) => {
    const c = f.conv, reales = c.msgs.filter((m) => !m.previo && m.role !== 'sistema');
    return { key: f.key, convId: c.id, tipo: f.tipo, cliente: nombreDe(c), contacto: c.contacto?.nombre || '', rubro: c.contacto?.rubro || '', telefono: String(c.phone || '').replace(/^lid:/, ''),
      motivo: f.motivo, otros: f.otros.slice(0, 3), sugerencia: f.sugerencia || SUGERENCIA[f.tipo], monto: f.monto || null, cotizacion: f.cotizacion || c.estado?.cotizacion || null, demo: c.estado?.demoUrl || null,
      ultimos: reales.slice(-3).map((m) => ({ de: m.role === 'cliente' ? 'Cliente' : m.role === 'bot' ? 'Bot' : 'Vos', texto: String(m.text).slice(0, 180), ts: m.ts })), ts: f.ts };
  });
}

// hecha / descartada: sale de la lista (vuelve solo si aparece un motivo nuevo). no_contesto: vuelve mañana.
export function resolver(key, resultado, nota = '') {
  if (!['hecha', 'no_contesto', 'descartada'].includes(resultado)) throw new Error('Resultado inválido.');
  const ahora = Date.now();
  C.resueltas[key] = { resultado, ts: ahora, hasta: resultado === 'no_contesto' ? ahora + DIA : 0, nota: String(nota).slice(0, 500) };
  if (resultado !== 'no_contesto') C.cola = C.cola.filter((x) => x.key !== key);
  const conv = V.convs[String(key).split(':')[0]];
  if (conv && nota) conv.msgs.push({ role: 'sistema', text: `Llamada de Diego: ${String(nota).slice(0, 500)}`, ts: ahora });
  if (conv) log('vendedor', `Llamada a ${nombreDe(conv)}: ${resultado === 'hecha' ? 'hecha' : resultado === 'no_contesto' ? 'no contestó' : 'descartada'}`, 'info');
  saveNow();
  return { ok: true };
}
