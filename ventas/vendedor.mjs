// Vendedor de Cresova ("Diego Villalta"): atiende prospectos por WhatsApp con
// cualquier modelo de OpenRouter. Hereda lo que funcionó en Velforce: calificar
// antes de ofrecer la demo, precios solo del catálogo, estado en vivo de cada
// conversación (qué ya preguntó, cuántas veces ofreció la demo), saludo según el
// rubro y el anuncio, escalar al instante si piden una persona y reglas aprendidas.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, state, broadcast, saveNow, log, addDeliverable } from '../state.mjs';
import { callMcpTool } from '../connections.mjs';
import { memoriaFor } from '../memoria.mjs';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isBlocked, publicCupo, noteRateLimit, isLimitError, onLimitHit, noteSpend } from '../cupo.mjs';

const SEED = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'semilla.json'), 'utf8'));
const PLAYBOOK_FILE = path.join(import.meta.dirname, '..', 'prompts', '_playbook_ventas.md');
import { etapaDe, cuentaTs } from './etapa.mjs';
const CASES_FILE = path.join(DATA_DIR, 'ventas', 'casos.json');
fs.mkdirSync(path.dirname(CASES_FILE), { recursive: true });

state.ventas ||= {};
const V = state.ventas;
V.config ||= { model: 'openai/gpt-4o-mini', temperature: 0.5 };
V.playbook ||= [];      // versiones: { ts, by, resumen, texto }
V.rules ||= [];         // { id, regla, categoria, mal, bien, activa, ts, fuente }
V.feedback ||= [];      // correcciones de Diego: { id, convId, cliente, bot, corregida, nota, ts, usada }
V.convs ||= {};         // conversaciones de prueba, casos y (después) WhatsApp
V.cost ||= 0;
for (const c of Object.values(V.convs)) c.busy = false; // un reinicio corta cualquier respuesta en curso

const emit = (conv) => { saveNow(); broadcast({ type: 'ventas', conv: conv ? publicConv(conv) : null, summary: summary() }); };

export const getPlaybook = () => V.playbook.at(-1)?.texto || fs.readFileSync(PLAYBOOK_FILE, 'utf8');
export function savePlaybook(texto, by = 'diego', resumen = '') {
  texto = String(texto || '').trim();
  if (texto.length < 200) throw new Error('El playbook quedó demasiado corto.');
  V.playbook.push({ ts: Date.now(), by, resumen: String(resumen).slice(0, 300), texto: texto.slice(0, 40000) });
  if (V.playbook.length > 30) V.playbook.splice(0, V.playbook.length - 30);
  log(by === 'diego' ? null : by, `Playbook de ventas actualizado${resumen ? `: ${resumen}` : ''}`, 'deliverable');
  emit();
}

export function loadCases() {
  try { return JSON.parse(fs.readFileSync(CASES_FILE, 'utf8')); } catch { return []; }
}
export function saveCases(list) {
  if (!Array.isArray(list)) throw new Error('Se esperaba una lista de casos.');
  fs.writeFileSync(CASES_FILE, JSON.stringify(list));
  log(null, `Ventas: ${list.length} casos de prueba cargados`, 'system');
  emit();
  return list.length;
}

// ---------- utilidades ----------
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// El monto de una cotización que el cliente ya tiene (recontacto) también vale, y su mitad (anticipo 50 %).
const allowedAmounts = (conv) => new Set([...SEED.catalogo.map((p) => Number(p.precio)).filter(Boolean), 2000, 23, 50, 100, ...(conv?.recontacto?.total ? [conv.recontacto.total, conv.recontacto.total / 2] : [])]);

function moneyIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?:L\.?\s?|lps\.?\s?|lempiras\s?|\$\s?)(\d{1,3}(?:[,.]\d{3})+|\d+)(?:\s?(?:lempiras|lps))?|(\d{1,3}(?:,\d{3})+|\d{3,})\s?(?:lempiras|lps)/gi)) {
    const n = Number(String(m[1] || m[2]).replace(/[,.](?=\d{3}\b)/g, ''));
    if (n >= 50) out.push(n);
  }
  return out;
}

function detectSegment(conv) {
  const ad = norm(`${conv.anuncio?.titulo || ''} ${conv.anuncio?.texto || ''}`);
  const said = norm(conv.msgs.filter((m) => m.role === 'cliente').map((m) => m.text).join(' '));
  for (const r of SEED.rubros) if (ad && r.anuncio.some((k) => ad.includes(norm(k)))) return { rubro: r, por: 'anuncio' };
  for (const r of SEED.rubros) if (r.palabras.some((k) => said.includes(norm(k)))) return { rubro: r, por: 'mensajes' };
  return null;
}

function toWhatsApp(text) {
  // Un mensaje entero entre asteriscos sale todo en negrita (gpt-4o-mini lo hacía): se quitan.
  text = String(text).trim().replace(/^\*([^*]+)\*$/s, '$1');
  return String(text).replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/^#+\s*/gm, '').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2').trim();
}

const hn = () => new Intl.DateTimeFormat('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'full', timeStyle: 'short' }).format(new Date());

// ---------- prompt ----------
// Las demos salen como mínimo un día después de pedirlas, de lunes a sábado: se le promete un día concreto.
function diaDemo() {
  const d = new Date(Date.now() - 6 * 3600e3);
  let n = 0;
  // La demo se entrega en 1 día (Diego, nov. 2026): el siguiente día de atención (lunes a sábado).
  while (n < 1) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) n++; }
  return new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}
// Prueba A/B (cresova/ceo.mjs): los leads nuevos se reparten en A (bot actual) y B (bot + la instrucción de la prueba).
// Saber por dónde llegó el cliente que no vino de un anuncio: solo cuando ya mostró interés y en pocos turnos.
function preguntaOrigen(conv) {
  const st = conv.estado;
  if (conv.kind !== 'whatsapp' || conv.anuncio || conv.recontacto || conv.prospecto || conv.contacto?.origen || !(st.pidioDemo || st.demo) || (st.origenTurnos || 0) >= 3) return '';
  st.origenTurnos = (st.origenTurnos || 0) + 1;
  return '# Una pregunta pendiente\nCuando sea natural y sin interrumpir, preguntale una sola vez por dónde conoció a Cresova. Guardá la respuesta con actualizar_contacto en origen (tiktok, instagram, facebook, youtube, google, referido u otro). Si no contesta, no insistas.';
}

export function bloqueExperimento(conv) {
  const e = V.ab?.activo;
  if (!e || conv.kind !== 'whatsapp') return '';
  // El grupo se arma en la primera respuesta, o cuando recibe la demo si la prueba es sobre el cierre.
  const entra = e.puerta === 'demo' ? Boolean(conv.estado?.demoEnviada) : !conv.msgs.some((m) => m.role === 'bot') && !conv.recontacto && !conv.prospecto;
  if (!conv.exp && entra && !conv.pausa) { V.ab.turno = (V.ab.turno || 0) + 1; conv.exp = { id: e.id, grupo: V.ab.turno % 2 ? 'A' : 'B', ts: Date.now() }; }
  return conv.exp?.id === e.id && conv.exp.grupo === 'B' ? `# Instrucción de prueba (seguila en esta conversación)\n${e.instruccion_b}` : '';
}

function systemPrompt(conv) {
  const v = SEED.vendedor, o = SEED.objetivo, st = conv.estado;
  const seg = detectSegment(conv);
  const rules = V.rules.filter((r) => r.activa);
  const corrections = rules.length ? [] : V.feedback.slice(-10);
  const contacto = Object.entries(conv.contacto || {}).filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`).join(' · ') || '(nada todavía)';
  return [
    `Sos ${v.nombre}, ${v.cargo} de ${v.empresa} (Honduras). Atendés por WhatsApp a dueños de negocios que escriben por los anuncios. Hoy es ${hn()}. Moneda: lempiras (L). Atendés en este mismo chat de WhatsApp: nunca mandes al cliente a otro número.`,
    'Escribís como una persona real en su teléfono: 1 a 3 líneas, UNA sola pregunta al final, sin lenguaje de folleto ni muletillas de bot (ver "CÓMO ESCRIBES" en el playbook). Si el cliente solo cierra o agradece y no hay nada pendiente, respondé exactamente SIN_RESPUESTA. Formato de WhatsApp: *negrita* con un asterisco, nunca **, nunca títulos ni tablas ni enlaces markdown (los enlaces van en texto plano).',
    memoriaFor({ id: 'vendedor', dept: 'ventas' }).length ? `# Indicaciones de Diego (prioridad máxima: si algo del playbook las contradice, gana esto)\n${memoriaFor({ id: 'vendedor', dept: 'ventas' }).map((m) => `- ${m.indicacion}`).join('\n')}` : '',
    `# Reglas de ${v.empresa} (playbook vigente: tienen prioridad)\n${getPlaybook()}`,
    `# Objetivo de la conversación\n${o.label}\n${o.descripcion}\nDatos obligatorios antes de pasar a demo: ${o.obligatorios.join(', ')}. Opcionales (pedir una sola vez): ${o.opcionales.join(', ')}.`,
    `# Catálogo (ÚNICA fuente de precios: nunca inventes montos, plazos ni funciones)\n${SEED.catalogo.map((p) => `## ${p.nombre} — ${p.precio ? `L ${Number(p.precio).toLocaleString('en-US')}` : 'a cotizar (no des precio)'}\n${p.descripcion}`).join('\n\n')}`,
    `# Qué paquete recomendar\n${SEED.recomendaciones.map((r) => `- ${r.paquete}: si menciona ${r.palabras.slice(0, 8).join(', ')}. Motivo: ${r.motivo}`).join('\n')}`,
    `# Preguntas frecuentes (respuestas oficiales)\n${SEED.faqs.map((f) => `- ${f.pregunta} → ${f.respuesta}`).join('\n')}`,
    `# Portafolio (páginas reales que hizo Cresova). Comparte 1 o 2 enlaces del rubro del cliente, en texto plano, diciendo de qué negocio es cada uno (por ejemplo: "esta es de una clínica en Santa Rosa: …"). Si no hay de su rubro, el más parecido o el portafolio general. Nunca inventes enlaces.\n${SEED.portafolio.map((p) => `- ${p.titulo}: ${p.url} (${p.uso})`).join('\n')}`,
    seg ? `# Rubro detectado: ${seg.rubro.nombre} (por ${seg.por})\nSaludo sugerido (adaptalo, no lo copies): ${seg.rubro.saludo}\nObjeciones de este rubro:\n${seg.rubro.objeciones}\nEjemplos de este rubro: ${seg.rubro.ejemplos.map((e) => `${e.titulo} ${e.url} (${e.nota})`).join(' · ')}` : '# Rubro: todavía no se sabe. No lo preguntes si ya se deduce de lo que escribió.',
    conv.anuncio?.titulo || conv.anuncio?.texto ? `# El cliente llegó desde este anuncio\nTítulo: ${conv.anuncio.titulo || ''}\nTexto: ${conv.anuncio.texto || ''}\nTu primer mensaje retoma la promesa del anuncio; nada de saludo genérico de agencia.` : '',
    conv.recontacto ? `# SEGUIMIENTO DE UNA COTIZACIÓN QUE QUEDÓ PENDIENTE (prioridad sobre el guion de cliente nuevo)
Este cliente ya habló antes con el equipo${conv.recontacto.vendedorAntes ? ` (lo atendía ${conv.recontacto.vendedorAntes}, que ya no está; si pregunta, ahora lo atendés vos)` : ''}. NO es un prospecto nuevo: no te presentes como si no lo conocieras, no le ofrezcas la demo de cero ni vuelvas a calificarlo.
- Cotización: ${conv.recontacto.cotizacion} por ${conv.recontacto.moneda === 'HNL' ? `L ${Number(conv.recontacto.total).toLocaleString('en-US')}` : `${conv.recontacto.moneda} ${conv.recontacto.total}`} (si pregunta el precio, es ese; el pago es 50 % al empezar y 50 % al entregar)
- Demo: ${conv.recontacto.proyecto === 'demo_sent' ? 'ya se le envió' : 'todavía no se le armó'}
- Lo que sabemos (de Martín): ${conv.recontacto.contexto || '—'}
- Notas de la cotización: ${conv.recontacto.notas || '—'}
${conv.historialN ? `- Tenés la conversación anterior de este cliente al principio del chat (los mensajes marcados como del equipo los escribió una persona de Cresova): leela antes de contestar y no le preguntes lo que ya dijo.` : '- NO tenés la conversación anterior de este cliente (se habló al inicio desde otro teléfono). Si dice que ya contestó o ya habló con alguien del equipo, pedí disculpas en una frase, reconocé lo que te cuenta y pedile que te lo resuma en una línea; no lo hagas repetir todo ni dudes de lo que dice.'}
Si solo te saluda ("Buen día", "Hola"), devolvé el saludo y retomá en una frase por qué le escribiste (la demo que le mandamos) con la pregunta: NUNCA le preguntes "¿en qué puedo ayudarte?", porque le escribiste vos. Si pide cambios en la demo, usá pedir_cambios_demo. Si dice que te avisa o lo ve más adelante, usá agendar_seguimiento.
Objetivo: retomar con calidez, resolver dudas y llevarlo a arrancar. NO uses pasar_a_demo (ya tiene cotización). Si quiere arrancar o pagar, usá enviar_cuenta_anticipo. Si quiere cambiar la cotización o pide la demo de nuevo, usá pasar_a_persona con ese motivo. Si dice que ya no le interesa, agradecé y usá marcar_no_calificado con el motivo.` : '',
    `# Estado en vivo de esta conversación (calculado por el sistema: respetalo)
- Datos del cliente guardados: ${contacto}
- Ya diste precio: ${st.precioDado ? 'sí' : 'no'}
- Veces que ofreciste la demo: ${st.ofertasDemo}${st.ofertasDemo >= 2 ? ' → PROHIBIDO ofrecerla otra vez; pedí los datos o pasá a una persona.' : ''}
- El cliente ya dijo que quiere la demo: ${st.demo ? 'SÍ (ya pasó a demo)' : st.pidioDemo && st.precioDado ? 'SÍ, y ya sabe el precio → no se la vuelvas a preguntar; pedí lo que falte (nombre del negocio) y llamá pasar_a_demo' : st.pidioDemo ? 'la pidió, pero TODAVÍA no le diste el precio → antes de armarla: valor para su rubro + precio (L 8,500 en dos pagos) + demo gratis, y cerrá con "¿Te parece si te armamos la demo?"' : 'no'}
- Ya pasaste el caso a demo: ${st.demo ? `sí (${st.demo})` : 'no'}
- Si pasás a demo hoy, el día que le decís que le llega: ${diaDemo()}
- Consulta al equipo esperando respuesta: ${st.consulta && !st.consulta.respondida ? `sí ("${st.consulta.pregunta.slice(0, 80)}") → si pregunta de nuevo, decile que el equipo ya lo está viendo` : 'no'}
- Demo enviada al cliente: ${st.demoEnviada ? `sí (${new Date(st.demoEnviada).toLocaleDateString('es-HN')}${st.demoUrl ? `, ${st.demoUrl}` : ''})` : 'no'}
- Ya pasaste a una persona: ${st.humano ? `sí (${st.humano})` : 'no'}
- No calificado: ${st.noCalificado ? 'sí → no ofrezcas demo ni hagas seguimiento' : 'no'}
- Tus últimas aperturas (no las repitas): ${conv.msgs.filter((m) => m.role === 'bot').slice(-3).map((m) => `"${m.text.split(/[.!?\n]/)[0].slice(0, 40)}"`).join(' | ') || '(ninguna)'}`,
    `# Herramientas
- actualizar_contacto: en cuanto el cliente dé un dato (nombre del negocio, rubro, logo/Instagram, correo), guardalo en ESE turno. Nunca guardes valores inventados como "N/A" o "Cliente".
- pasar_a_demo: SOLO cuando el cliente calificado ya vio el precio, respondió que sí a "¿Te parece si te armamos la demo?" y ya tenés nombre del negocio y a qué se dedica. Crea la cotización y la tarea de la demo. Después avisale con plazo concreto.
- enviar_cuenta_anticipo: cuando el cliente dice que quiere arrancar, que quiere pagar o pregunta cómo se paga (ya con su demo o cotización). Manda la cuenta y el monto exacto solo; vos no escribas números de cuenta ni montos.
- ofrecer_reunion y agendar_reunion: si pide una reunión, una llamada o "un espacio" para hablar o detallar su página (solo o con su equipo), NO lo pases a una persona: usá ofrecer_reunion y dale las opciones; cuando elija (o proponga otra hora), agendar_reunion y mandale el enlace de Meet. Una reunión a la que va a pagar después es una venta: tratala con prioridad.
- pasar_a_persona: si pide hablar con alguien por otra cosa, cotización formal o factura, o es un sistema a medida. En ese mismo turno, sin pedir datos antes.
- marcar_no_calificado: si no tiene un negocio real o busca algo que no vendemos.
- agendar_seguimiento: SIEMPRE que le prometas al cliente escribirle más adelante ("mañana", "en enero", "la próxima semana") o él diga que te avisa o lo retoma luego. Si no lo agendás, la promesa se pierde. Usá la fecha exacta (AAAA-MM-DD) y en motivo, qué le vas a retomar.
- pedir_cambios_demo: cuando el cliente ya vio su demo y pide cambiarla o rehacerla (diseño, fotos, colores, secciones, "hagamos un intento más"). Pasale los cambios con SUS palabras. Después decile que el equipo le prepara una versión nueva y se la compartís por aquí; no prometas plazos.
- consultar_equipo: si pregunta algo que no sabés con certeza (pagos, datos técnicos, una función, un caso especial). Nunca digas "eso no se puede" ni "es un sistema aparte" sin consultar.
- En actualizar_contacto marcá pidio_demo: true en cuanto el cliente diga con sus palabras que quiere la demo (pedirla no reemplaza darle el precio y preguntarle).
Si el cliente toca un botón de plantilla: "Arrancar" → enviar_cuenta_anticipo. "Llamada de 10 min" o "Llámenme" → ofrecer_reunion. "Ajustarla" o "Quiero cambios" → preguntale qué cambiar y usá pedir_cambios_demo. "Sí, ármala" o "Ármala" → seguí hacia la demo. "No me interesa" → agradecé y no insistas.
Nunca digas que pasaste el caso al equipo sin haber llamado a la herramienta en ese mismo turno.

# Notas de voz
Si un mensaje empieza con "[Nota de voz del cliente, transcrita]", ya la escuchaste: respondé a lo que dijo como si lo hubiera escrito. No digas que no podés escuchar audios. Solo si dice "[El cliente envió un audio que no podés escuchar]" pedile amablemente que lo escriba.`,
    bloqueExperimento(conv),
    preguntaOrigen(conv),
    conv.estado?.posventa ? `# Cliente ya entregado (posventa)
Este cliente YA compró y su página está entregada. Le mandamos el pedido de reseña en Google y de referido. No le vendas nada.
- Si dice que ya dejó la reseña o está contento: agradecé y pedile, si puede, un audio o video cortito contando su experiencia (es su testimonio).
- Si recomienda a alguien: pedí nombre y WhatsApp de esa persona y usá consultar_equipo con esos datos para que el equipo la contacte.
- Si tiene una queja o un problema con la página: usá pasar_a_persona.` : '',
    rules.length ? `# Reglas aprendidas (correcciones del equipo, prioridad alta)\n${rules.map((r, i) => `${i + 1}. [${r.categoria}] ${r.regla}${r.mal ? `\n   ❌ Evitá: "${r.mal.slice(0, 200)}"` : ''}${r.bien ? `\n   ✅ Algo como: "${r.bien.slice(0, 200)}"` : ''}`).join('\n')}` : '',
    corrections.length ? `# Correcciones de Diego (no repitas estos errores)\n${corrections.map((c) => `- Cliente: "${c.cliente.slice(0, 200)}"\n  ❌ Respondiste: "${c.bot.slice(0, 250)}"\n  ✅ Correcto: "${c.corregida.slice(0, 300)}"${c.nota ? `\n  Por qué: ${c.nota}` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

const TOOLS = [
  { type: 'function', function: { name: 'actualizar_contacto', description: 'Guarda datos que dio el cliente.', parameters: { type: 'object', properties: { nombre: { type: 'string' }, empresa: { type: 'string', description: 'Nombre del negocio' }, rubro: { type: 'string', description: 'A qué se dedica' }, logo_o_redes: { type: 'string', description: 'Logo recibido, Instagram, Facebook o web' }, correo: { type: 'string' }, origen: { type: 'string', description: 'Por dónde conoció a Cresova: tiktok, instagram, facebook, youtube, google, referido u otro' }, pidio_demo: { type: 'boolean', description: 'true si el cliente, CON SUS PALABRAS, dijo que quiere la demo o aceptó que se la armemos. El mensaje automático del anuncio ("Hola, quiero ver la demo…") NO cuenta.' } } } } },
  { type: 'function', function: { name: 'consultar_equipo', description: 'El cliente pregunta algo que no está en el catálogo ni en las preguntas frecuentes (pagos, datos técnicos, una función puntual, un precio especial). Avisa al equipo y Diego responde; la respuesta se le manda al cliente. Usala en vez de inventar o decir que no.', parameters: { type: 'object', properties: { tema: { type: 'string', enum: ['pagos', 'tecnico', 'cotizacion', 'funcion', 'otro'] }, pregunta: { type: 'string', description: 'La pregunta del cliente, clara y completa' }, contexto: { type: 'string', description: 'Qué necesita y por qué, en 1-2 líneas' } }, required: ['tema', 'pregunta'] } } },
  { type: 'function', function: { name: 'pasar_a_demo', description: 'El cliente ya sabe el precio y respondió que sí a armarle la demo: crea la cotización en borrador y la tarea para armar la demo.', parameters: { type: 'object', properties: { paquete: { type: 'string', enum: SEED.catalogo.map((p) => p.nombre) }, resumen: { type: 'string', description: 'Diagnóstico y lo acordado, en 2–4 líneas' }, pendientes: { type: 'string' } }, required: ['paquete', 'resumen'] } } },
  { type: 'function', function: { name: 'pasar_a_persona', description: 'Pasa la conversación a una persona del equipo.', parameters: { type: 'object', properties: { motivo: { type: 'string' }, resumen: { type: 'string' } }, required: ['motivo'] } } },
  { type: 'function', function: { name: 'agendar_seguimiento', description: 'Agenda un mensaje tuyo para otro día (en la mañana, hora de Honduras). Usala cada vez que prometas escribirle más adelante.', parameters: { type: 'object', properties: { fecha: { type: 'string', description: 'AAAA-MM-DD del día en que le vas a escribir' }, dias: { type: 'integer', description: 'Alternativa a fecha: dentro de cuántos días' }, motivo: { type: 'string', description: 'Qué le vas a retomar ese día' } }, required: ['motivo'] } } },
  { type: 'function', function: { name: 'pedir_cambios_demo', description: 'El cliente pide cambios o rehacer su demo: se la pasa a Píxel (Desarrollo). La nueva demo la aprueba Diego antes de mandársela.', parameters: { type: 'object', properties: { cambios: { type: 'string', description: 'Los cambios que pide el cliente, con sus palabras y el detalle' } }, required: ['cambios'] } } },
  { type: 'function', function: { name: 'enviar_cuenta_anticipo', description: 'El cliente dice que quiere arrancar, pagar o pregunta cómo se paga: le manda la cuenta oficial de Cresova y el monto exacto del anticipo (50 % de su cotización) con un mensaje fijo, y le pide la foto del comprobante.', parameters: { type: 'object', properties: { motivo: { type: 'string', description: 'Qué dijo el cliente' } }, required: [] } } },
  { type: 'function', function: { name: 'ofrecer_reunion', description: 'El cliente pide una reunión o llamada para hablar o detallar su página (solo o con su equipo, socio, ingenieros): trae 2-3 horarios libres reales del calendario de Diego para ofrecerle (por Google Meet).', parameters: { type: 'object', properties: { motivo: { type: 'string', description: 'Para qué quiere la reunión' } } } } },
  { type: 'function', function: { name: 'agendar_reunion', description: 'El cliente eligió un horario (o propuso otro): crea la reunión en el calendario de Diego con enlace de Google Meet.', parameters: { type: 'object', properties: { inicio: { type: 'string', description: 'Fecha y hora exacta en formato AAAA-MM-DDTHH:MM:00-06:00 (la de la opción que eligió, o la que propuso)' }, tema: { type: 'string', description: 'Para qué es la reunión, en una línea' }, con_quien: { type: 'string', description: 'Quién más entra, si lo dijo (ej. "con sus ingenieros")' } }, required: ['inicio'] } } },
  { type: 'function', function: { name: 'marcar_no_calificado', description: 'El prospecto no califica (no tiene negocio real o busca otra cosa).', parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } } },
];

// ---------- OpenRouter ----------
async function openrouter(body, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await openrouterOnce(body); } catch (e) {
      if (i >= tries || /llave|User not found|invalid|401|402|403/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

async function openrouterOnce(body) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de OpenRouter (Sistema → Llaves).');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cresova.com', 'X-Title': 'Oficina Cresova - Ventas' },
    body: JSON.stringify({ ...body, usage: { include: true } }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error?.message || `OpenRouter respondió ${res.status}`);
  return j;
}

let modelCache = { ts: 0, list: [] };
export async function listModels() {
  if (Date.now() - modelCache.ts < 3600e3 && modelCache.list.length) return modelCache.list;
  const j = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30_000) }).then((r) => r.json());
  modelCache = {
    ts: Date.now(),
    list: (j.data || []).filter((m) => (m.supported_parameters || []).includes('tools'))
      .map((m) => ({ id: m.id, name: m.name, in: Number(m.pricing?.prompt || 0) * 1e6, out: Number(m.pricing?.completion || 0) * 1e6 }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return modelCache.list;
}

// ---------- herramientas (en prueba no tocan WhatsApp ni el sistema) ----------
async function runTool(conv, name, args) {
  const test = conv.kind !== 'whatsapp';
  if (name === 'actualizar_contacto') {
    const bad = /^(n\/?a|no informado|cliente|desconocido|pendiente|-)$/i;
    const { pidio_demo: pidio, ...datos } = args || {};
    if (pidio === true) conv.estado.pidioDemo = Date.now();
    for (const [k, v] of Object.entries(datos)) if (v && !bad.test(String(v).trim())) conv.contacto[k] = String(v).slice(0, 200);
    return { ok: true, guardado: conv.contacto, ...(pidio ? { demo: conv.estado.precioDado ? 'Anotado: el cliente ya sabe el precio y quiere la demo. Pedí lo que falte (nombre del negocio) y llamá pasar_a_demo.' : 'Anotado. Antes de armarla, dale valor para su rubro y el precio (L 8,500 en dos pagos, demo gratis) y preguntale "¿Te parece si te armamos la demo?". Solo si dice que sí, llamá pasar_a_demo.' } : {}) };
  }
  if (name === 'pasar_a_demo') {
    const missing = ['empresa', 'rubro'].filter((k) => !conv.contacto[k]);
    // Diego (nov. 2026): la demo se arma solo para quien ya sabe cuánto cuesta y dijo que sí.
    if (!conv.estado.precioDado && !conv.estado.precioAviso && !conv.recontacto) {
      conv.estado.precioAviso = true;
      return { ok: false, error: 'precio_primero', instruccion: 'Todavía no le diste el precio. Primero: para qué le sirve la página en su rubro, el precio (L 8,500 en dos pagos: la mitad para empezar y la otra al publicarla) y que la demo es gratis; cerrá con "¿Te parece si te armamos la demo?". Llamá pasar_a_demo solo cuando diga que sí.' };
    }
    if (missing.length && !conv.estado.demoIntento) {
      conv.estado.demoIntento = true;
      return { ok: false, error: 'datos_incompletos', faltan: missing, instruccion: 'Pedí estos datos (máximo 2 por mensaje) y volvé a llamar a pasar_a_demo cuando los tengas.' };
    }
    // Una sola vez por cliente: antes, cada vez que mandaba otra foto el modelo volvía a llamar esta herramienta y se creaban
    // cotizaciones, clientes y tareas repetidos (3 para Asociación Esperanza Catracha, 2 para Brillex).
    if (conv.kind === 'whatsapp' && (conv.estado.demoCreadaTs || conv.estado.cotizacion)) return { ok: true, ya_creada: true, mensaje: 'La cotización y la demo de este cliente YA están creadas y en marcha. No vuelvas a llamar a pasar_a_demo: seguí la conversación (si manda fotos o datos nuevos, agradecé y confirmá que el equipo los suma a su demo).' };
    conv.estado.demo = args.paquete;
    conv.estado.resumenDemo = args.resumen;
    if (test) return { ok: true, prueba: true, mensaje: 'Modo prueba: cotización y tarea simuladas (no se creó nada en el sistema).' };
    conv.estado.demoCreadaTs = Date.now();
    const r = await createDemoCase(conv, args);
    registrarEvento(conv.id, 'demo_aceptada', `${args.paquete}${conv.estado.cotizacion ? ` · ${conv.estado.cotizacion}` : ''}`);
    // Desarrollo arranca la demo solo; Diego la aprueba antes de que se le mande al cliente.
    import('../desarrollo/proyectos.mjs').then((dev) => dev.desdeVenta(conv)).catch((e) => log('constructor', `No se pudo crear la demo de ${conv.contacto.empresa || conv.title}: ${e.message}`, 'error'));
    return r;
  }
  // Reuniones por Google Meet en el calendario de Diego (11 nov 2026, caso Elvin).
  if (name === 'ofrecer_reunion') {
    const ci = await import('./citas.mjs');
    if (!ci.conectado()) return { ok: false, mensaje: 'El calendario de Diego no está conectado: usá pasar_a_persona con motivo "Pide una reunión".' };
    if (test) return { ok: true, prueba: true, opciones: [{ inicio: '2026-11-12T14:00:00-06:00', texto: 'mañana jueves a las 2 p. m.' }, { inicio: '2026-11-13T10:00:00-06:00', texto: 'el viernes 13 a las 10 a. m.' }] };
    const opciones = await ci.huecos({ cuantos: 3 }).catch((e) => { throw new Error(`No pude leer el calendario: ${e.message}`); });
    if (!opciones.length) return { ok: false, mensaje: 'No hay espacios libres en los próximos días: usá pasar_a_persona con motivo "Pide una reunión".' };
    conv.estado.reunionOfrecida = { opciones, ts: Date.now() };
    return { ok: true, opciones, mensaje: 'Ofrecele estas opciones con sus palabras (día y hora tal cual) y preguntale cuál le queda mejor. La reunión es por Google Meet, de unos 45 minutos, y puede sumar a quien quiera. Cuando elija, usá agendar_reunion con el "inicio" exacto de la opción.' };
  }
  if (name === 'agendar_reunion') {
    const ci = await import('./citas.mjs');
    if (!ci.conectado()) return { ok: false, mensaje: 'El calendario de Diego no está conectado: usá pasar_a_persona con motivo "Pide una reunión".' };
    if (test) return { ok: true, prueba: true, cuando: 'mañana jueves a las 2 p. m.', meet: 'https://meet.google.com/abc-defg-hij' };
    try {
      const r = await ci.agendar({ conv, inicio: args.inicio, tema: args.tema || '', con_quien: args.con_quien || '' });
      return { ...r, mensaje: 'Agendada. Confirmale el día y la hora y mandale el enlace de Meet tal cual (puede pasárselo a quien vaya a entrar). Decile que un día antes no hace falta confirmar: le recordamos una hora antes.' };
    } catch (e) {
      const otras = await ci.huecos({ cuantos: 3 }).catch(() => []);
      return { ok: false, error: e.message, opciones: otras, mensaje: 'No se pudo agendar esa hora. Explicale corto y ofrecele estas otras opciones.' };
    }
  }
  if (name === 'pasar_a_persona') {
    conv.estado.humano = args.motivo;
    if (test) return { ok: true, prueba: true };
    conv.handoffPending = true; // se pausa después de enviar la confirmación al cliente
    addDeliverable('vendedor', `🙋 ${conv.contacto.empresa || conv.title} pide una persona`, `**Motivo:** ${args.motivo}

${args.resumen || ''}

**WhatsApp:** +${conv.phone}

El vendedor quedó en pausa en esta conversación. Reactivalo en la pestaña Ventas cuando termines.`,
      { kind: 'decision', summary: `${args.motivo} · +${conv.phone}`, question: '¿Ya le escribiste?', options: ['Ya le escribí', 'Escribile vos (reactivar bot)'], ventasConv: conv.id });
    log('vendedor', `Pasó a una persona: ${conv.contacto.empresa || conv.title} (${args.motivo})`, 'approval');
    return { ok: true, mensaje: 'El equipo ya fue avisado. Confirmale al cliente que una persona le escribe por aquí en breve.' };
  }
  if (name === 'enviar_cuenta_anticipo') {
    const cuenta = String(V.config.cuentaAnticipo || '').trim();
    if (test) return { ok: true, prueba: true, mensaje: cuenta ? 'Modo prueba: no se envió la cuenta.' : 'Modo prueba: falta cargar la cuenta en Ventas → Playbook y reglas.' };
    if (!cuenta) return { ok: false, error: 'sin_cuenta', instruccion: 'Todavía no está cargada la cuenta oficial: usá pasar_a_persona con motivo "Quiere pagar el anticipo".' };
    const cots = await fichaCliente(conv).catch(() => null);
    const c0 = cots?.[0];
    if (!c0) return { ok: false, error: 'sin_cotizacion', instruccion: 'No tiene cotización en el sistema: usá pasar_a_persona con motivo "Quiere arrancar y no tiene cotización".' };
    const monto = Math.max(0, Math.round(c0.total / 2 - c0.pagado));
    if (!monto) return { ok: false, error: 'ya_pago', instruccion: 'Ya pagó el anticipo. Decile que está todo listo para arrancar y, si es algo del proyecto, pasá a una persona.' };
    if (conv.estado.cierre?.enviada && Date.now() - conv.estado.cierre.enviada < 7 * 86400e3) return { ok: true, ya_enviada: true, mensaje: `Ya le mandaste la cuenta (${lps(conv.estado.cierre.monto)}). Si la pide de nuevo, repetile el monto y pedile la foto del comprobante con tus palabras.` };
    const nombre = conv.contacto?.nombre && !/\b(sa|srl|s\. ?de)\b/i.test(conv.contacto.nombre) ? ` ${String(conv.contacto.nombre).split(' ')[0]}` : '';
    const texto = `¡Excelente${nombre}! 🙌 Para arrancar es el 50 %: *${lps(monto)}* (el otro 50 % al entregarte la página).

Podés depositar o transferir a:
${cuenta}

Cuando lo hagás, mandame la foto del comprobante por aquí y arrancamos.`;
    const wa = await import('./whatsapp.mjs');
    await wa.enviarImagenCuenta(conv.id).catch(() => false); // la imagen "bonita" de las cuentas, si Diego la subió
    const ok = await wa.enviarFijo(conv.id, texto, { cuentaAnticipo: true, monto, cotizacion: c0.numero });
    if (!ok) return { ok: false, error: 'no_enviado', instruccion: 'No se pudo enviar la cuenta. Usá pasar_a_persona con motivo "Quiere pagar el anticipo".' };
    conv.estado.cierre = { cotizacion: c0.numero, quoteId: c0.id, monto, enviada: Date.now() };
    registrarEvento(conv.id, 'cuenta_enviada', `${c0.numero} · anticipo ${lps(monto)}`);
    log('vendedor', `Cuenta para el anticipo enviada a ${conv.contacto?.empresa || conv.title}: ${lps(monto)} (${c0.numero})`, 'ok');
    return { ok: true, enviado: true, mensaje: 'Ya se le mandó la cuenta con el monto y el pedido del comprobante (mensaje fijo). Respondé exactamente SIN_RESPUESTA.' };
  }
  if (name === 'marcar_no_calificado') { conv.estado.noCalificado = args.motivo; return { ok: true }; }
  if (name === 'agendar_seguimiento') {
    // 9:00 de Honduras (15:00 UTC) del día pedido; si la fecha no sirve, se usan los días.
    let at = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(args.fecha || ''))) at = Date.parse(`${args.fecha}T15:00:00Z`);
    if (!at || Number.isNaN(at)) { const d = new Date(Date.now() + Math.max(1, Number(args.dias) || 1) * 86400e3); d.setUTCHours(15, 0, 0, 0); at = d.getTime(); }
    if (at < Date.now() + 3600e3) { const d = new Date(Date.now() + 86400e3); d.setUTCHours(15, 0, 0, 0); at = d.getTime(); }
    at += Math.round(30 + Math.random() * 120) * 60e3; // entre 9:30 y 11:30, no todos a las 9:00 en punto
    if (test) return { ok: true, prueba: true, cuando: new Date(at - 6 * 3600e3).toISOString().slice(0, 10) };
    // Una sola promesa por fecha: el bot agendaba dos veces lo mismo (TICNET, 9 nov).
    const repetido = (conv.agenda || []).find((a) => !a.hecho && Math.abs(a.at - at) < 36 * 3600e3);
    if (repetido) return { ok: true, ya_agendado: true, cuando: new Date(repetido.at - 6 * 3600e3).toISOString().slice(0, 10), mensaje: 'Ya estaba agendado un mensaje para esa fecha: no se agregó otro.' };
    (conv.agenda ||= []).push({ id: randomUUID(), at, motivo: String(args.motivo || '').slice(0, 300), creada: Date.now(), hecho: null });
    if (conv.agenda.length > 8) conv.agenda.splice(0, conv.agenda.length - 8);
    log('vendedor', `Seguimiento agendado con ${conv.contacto?.empresa || conv.title} para el ${new Date(at - 6 * 3600e3).toISOString().slice(0, 10)}: ${String(args.motivo).slice(0, 80)}`, 'info');
    return { ok: true, cuando: new Date(at - 6 * 3600e3).toISOString().slice(0, 10), mensaje: 'Agendado: ese día en la mañana le escribís vos. Confirmale al cliente, con naturalidad, que le escribís ese día (sin decir la hora ni que lo agendaste).' };
  }
  if (name === 'pedir_cambios_demo') {
    conv.estado.cambiosPedidos = { cambios: String(args.cambios).slice(0, 800), ts: Date.now() };
    if (test) return { ok: true, prueba: true, mensaje: 'Modo prueba: no se creó trabajo en Desarrollo.' };
    const quien = conv.contacto?.empresa || conv.title;
    import('../desarrollo/proyectos.mjs').then((dev) => dev.cambiosDesdeVenta(conv, args.cambios))
      .catch((e) => { log('vendedor', `No se pudieron pedir los cambios de ${quien}: ${e.message}`, 'error'); import('./whatsapp.mjs').then((wa) => wa.avisarDiego(`⚠️ ${quien} pidió cambios en su demo y no pude pasárselos a Píxel (${e.message}). Revisá la pestaña Desarrollo.`)).catch(() => {}); });
    import('./whatsapp.mjs').then((wa) => wa.avisarDiego(`✏️ *${quien}* pidió cambios en su demo: "${String(args.cambios).slice(0, 220)}". Píxel ya la está rehaciendo; te llega la tarjeta "Demo lista" a la Bandeja y no se le manda nada hasta que la apruebes.`)).catch(() => {});
    return { ok: true, mensaje: 'Píxel (el equipo de diseño) ya está preparando una versión nueva con esos cambios. Decile al cliente que se la compartís por aquí apenas esté lista; sin dar plazo exacto (normalmente en un día).' };
  }
  if (name === 'consultar_equipo') {
    conv.estado.consulta = { tema: args.tema, pregunta: String(args.pregunta).slice(0, 600), ts: Date.now() };
    if (test) return { ok: true, prueba: true, mensaje: 'Modo prueba: la consulta no se envió.' };
    const quien = conv.contacto.empresa || conv.contacto.nombre || conv.title;
    const ultimos = conv.msgs.filter((m) => m.role === 'cliente').slice(-4).map((m) => `> ${m.text.slice(0, 300)}`).join('\n');
    const d = addDeliverable('vendedor', `❓ ${quien} pregunta (${args.tema})`, `**Pregunta del cliente:** ${args.pregunta}\n\n${args.contexto ? `**Contexto:** ${args.contexto}\n\n` : ''}**Lo último que escribió:**\n${ultimos}\n\n**WhatsApp:** +${conv.phone}\n\nRespondé acá con la respuesta correcta (en la nota) y el vendedor se la manda al cliente.`,
      { kind: 'decision', summary: `${args.tema}: ${args.pregunta}`.slice(0, 300), question: '¿Qué le respondemos?', ventasConv: conv.id, ventasPregunta: true });
    conv.estado.consulta.deliverable = d.id;
    log('vendedor', `Consulta al equipo de ${quien}: ${args.pregunta.slice(0, 80)}`, 'approval');
    import('./whatsapp.mjs').then((wa) => wa.avisarDiego(`❓ *${quien}* preguntó por WhatsApp (${args.tema}): "${args.pregunta.slice(0, 200)}". Está en la Bandeja: respondé ahí y el vendedor se lo manda.`)).catch(() => {});
    return { ok: true, mensaje: 'El equipo ya fue avisado. Decile al cliente que lo confirmás con el equipo y le escribís apenas lo tengas (sin dar plazos exactos). No inventes la respuesta.' };
  }
  return { ok: false, error: 'herramienta desconocida' };
}

// Todo lo hablado en el chat, no solo lo del bot: también lo que escribió una persona del equipo.
function historyForModel(conv) {
  const out = [];
  const all = conv.msgs;
  const window = all.length > 60 ? [...all.slice(0, 20), { role: 'sistema-nota' }, ...all.slice(-40)] : all;
  for (const m of window) {
    if (m.role === 'sistema-nota') { out.push({ role: 'user', content: '[…mensajes intermedios omitidos…]' }); continue; }
    if (m.role === 'cliente') out.push({ role: 'user', content: m.text });
    else if (m.role === 'bot') out.push({ role: 'assistant', content: m.text });
    else if (m.role === 'equipo') out.push({ role: 'assistant', content: `[Mensaje escrito por una persona del equipo de Cresova]: ${m.text}` });
  }
  // Mensajes seguidos del cliente se juntan en un solo turno (como el buffer de WhatsApp).
  const merged = [];
  for (const m of out) {
    const last = merged.at(-1);
    if (last && last.role === m.role) last.content += `\n${m.content}`; else merged.push({ ...m });
  }
  return merged;
}

// ---------- plan de Claude (primero) ----------
// El vendedor responde con la suscripción de Claude de la oficina (Agent SDK) mientras haya cupo; OpenRouter
// queda de respaldo. Diego elige en Ventas: "plan primero" (por defecto) o "solo OpenRouter".
const PLAN_MODEL = () => V.config.modeloPlan || 'claude-haiku-5-5';
const PLAN_TOPE = 0.9; // con 90 % usado de la ventana de 5 h o de la semana, el resto queda para Diego
function usarPlan() {
  if (V.config.motor === 'openrouter' || !process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || isBlocked()) return false;
  const { windows } = publicCupo();
  const alto = (w) => w?.utilization != null && !(w.resetsAt && w.resetsAt < Date.now()) && w.utilization >= PLAN_TOPE;
  return !alto(windows?.five_hour) && !alto(windows?.seven_day);
}

// JSON Schema simple de TOOLS → zod (solo los tipos que usan estas herramientas).
function zodDe(props = {}, required = []) {
  const out = {};
  for (const [k, p] of Object.entries(props)) {
    let t = p.enum ? z.enum(p.enum) : p.type === 'boolean' ? z.boolean() : p.type === 'integer' ? z.number().int() : z.string();
    if (p.description) t = t.describe(p.description);
    out[k] = required.includes(k) ? t : t.optional();
  }
  return out;
}

async function turnoPlan(conv, system, proactivo, tools, alFinal = '') {
  const servidor = proactivo ? null : createSdkMcpServer({
    name: 'ventas',
    version: '1.0.0',
    tools: TOOLS.map(({ function: f }) => tool(f.name, f.description, zodDe(f.parameters?.properties, f.parameters?.required), async (args) => {
      const result = await runTool(conv, f.name, args).catch((e) => ({ ok: false, error: e.message }));
      tools.push({ name: f.name, args, result });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    })),
  });
  const quien = (m) => (m.role === 'user' ? 'CLIENTE' : m.content.startsWith('[Mensaje escrito por una persona del equipo') ? 'EQUIPO' : 'VOS');
  const chat = historyForModel(conv).map((m) => `${quien(m)}: ${m.content.replace(/^\[Mensaje escrito por una persona del equipo de Cresova\]: /, '')}`).join('\n\n');
  const prompt = `Conversación de WhatsApp hasta ahora (CLIENTE = el cliente, VOS = tus mensajes anteriores, EQUIPO = una persona de Cresova):\n\n${chat || '(todavía no hay mensajes)'}\n\n---\n${alFinal ? `${alFinal}

---
` : ''}Escribí ahora tu próximo mensaje para el cliente${proactivo ? '' : ' (usá las herramientas mcp__ventas__* si hace falta)'}. Tu respuesta final es EXACTAMENTE el texto que se le manda por WhatsApp: sin comillas, sin explicaciones, sin "VOS:".`;
  const nombres = TOOLS.map((t) => `mcp__ventas__${t.function.name}`);
  const q = query({
    prompt,
    options: {
      model: PLAN_MODEL(),
      effort: 'low',
      systemPrompt: system,
      cwd: DATA_DIR,
      settingSources: [],
      maxTurns: proactivo ? 1 : 8,
      ...(servidor ? { mcpServers: { ventas: servidor } } : {}),
      allowedTools: proactivo ? [] : nombres,
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task', 'Agent', 'NotebookEdit', 'TodoWrite', 'Skill'],
      canUseTool: async (name, input) => (name.startsWith('mcp__ventas__') ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'No disponible.' }),
    },
  });
  let result = null;
  for await (const msg of q) {
    if (msg.type === 'rate_limit_event') noteRateLimit(msg.rate_limit_info);
    else if (msg.type === 'result') result = msg;
  }
  if (!result || result.subtype !== 'success') {
    const det = String(result?.result || result?.subtype || 'sin respuesta');
    if (isLimitError(det)) onLimitHit(null);
    throw new Error(det);
  }
  const text = String(result.result || '').trim().replace(/^VOS:\s*/i, '').replace(/^"([\s\S]*)"$/, '$1');
  if (!text) throw new Error('respuesta vacía');
  const cost = Number(result.total_cost_usd || 0);
  if (cost > 0) noteSpend('vendedor', cost);
  return { text, cost };
}

// Un turno del vendedor: devuelve el mensaje que se enviaría.
// proactivo: mensajes que el vendedor inicia solo (seguimientos, agenda). Sin herramientas: si agenda o marca algo
// en ese turno, termina contándole al cliente lo que hizo ("He agendado…", "He marcado tu consulta…").
// ---------- ficha del cliente (Martín, 3 nov 2026: "el vendedor no sabe en qué etapa está el cliente") ----------
// Antes de cada respuesta el vendedor lee lo que dice la base de Cresova de ese teléfono: cotizaciones, etapa,
// cuánto pagó, la demo y quién lo atiende. Así no le ofrece "armar la demo" a quien ya debe el anticipo (Berakah).
const fichas = new Map();
export async function fichaCliente(conv) {
  if (conv.kind !== 'whatsapp') return null;
  const ult8 = String(conv.phone || '').replace(/\D/g, '').slice(-8);
  if (ult8.length < 8) return null;
  const hit = fichas.get(conv.id);
  if (hit && Date.now() - hit.ts < 90e3) return hit.v;
  const db = await import('../cresova/db.mjs');
  if (!db.enUso()) return null;
  const rows = await db.q(`select q.id, q.quote_number, q.status, q.project_status, q.total, q.currency, q.demo_url, q.created_at, q.accepted_at,
      coalesce((select sum(amount) from quote_payments p where p.quote_id = q.id), 0) as pagado,
      (select string_agg(i.name, ', ') from quote_items i where i.quote_id = q.id) as paquete
    from quotes q where right(regexp_replace(coalesce(q.client_phone, ''), '[^0-9]', '', 'g'), 8) = $1 and coalesce(q.status, '') <> 'rejected'
    order by q.created_at desc limit 3`, [ult8]);
  const v = rows.map((r) => ({ id: r.id, numero: r.quote_number, estado: r.status, etapa: db.etapaDe(r.project_status), total: Number(r.total || 0), moneda: r.currency || 'HNL', pagado: Number(r.pagado || 0), demo: r.demo_url, paquete: r.paquete || '', creada: r.created_at }));
  fichas.set(conv.id, { ts: Date.now(), v });
  return v;
}
export const olvidarFicha = (convId) => fichas.delete(convId);
const lps = (n) => `L ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
async function fichaTexto(conv) {
  const cots = await fichaCliente(conv).catch(() => null);
  if (!cots?.length) return '';
  const db = await import('../cresova/db.mjs');
  const etapaTxt = (e) => db.ETAPAS.find((x) => x.id === e)?.label || e;
  const lineas = cots.map((c) => `- ${c.numero}${c.paquete ? ` · ${c.paquete}` : ''} · ${lps(c.total)} · cotización ${({ draft: 'en borrador', sent: 'enviada', accepted: 'ACEPTADA', expired: 'vencida' })[c.estado] || c.estado} · etapa: ${etapaTxt(c.etapa)} · pagó ${lps(c.pagado)} (saldo ${lps(c.total - c.pagado)})${c.demo ? ` · demo: ${c.demo}` : ''}`);
  const c0 = cots[0];
  const anticipo = Math.max(0, c0.total / 2 - c0.pagado);
  const cierre = conv.estado.cierre;
  const guia = c0.pagado >= c0.total / 2 - 1
    ? 'YA PAGÓ EL ANTICIPO: es cliente. No le vendas ni le ofrezcas la demo: resolvé dudas del proyecto y, si es algo de su página, pasá a una persona.'
    : ['approved', 'in_progress', 'awaiting_approval', 'finished', 'delivered'].includes(c0.etapa) || c0.estado === 'accepted'
      ? `Aprobó la cotización pero falta el anticipo (${lps(anticipo)}). No le ofrezcas la demo de nuevo: llevalo a pagar el anticipo.`
      : c0.etapa === 'demo_sent' || c0.demo
        ? `Ya tiene su demo. No le ofrezcas "armarle la demo": retomá la demo que tiene y llevalo a arrancar con el anticipo de ${lps(anticipo)}.`
        : 'Su demo está en preparación: no la vuelvas a ofrecer ni a pedir sus datos.';
  return `# Ficha del cliente en el sistema de Cresova (fuente oficial: manda sobre lo que creas de la conversación)
${lineas.join('\n')}
- Lo atiende: ${conv.pausa ? `Diego (chat tomado: ${conv.pausa.motivo})` : 'vos, el vendedor'}
- Paso de cierre: ${cierre?.enviada ? `ya le mandaste la cuenta para el anticipo de ${lps(cierre.monto)} (${new Date(cierre.enviada - 6 * 3600e3).toISOString().slice(0, 10)})${cierre.comprobante ? '; mandó el comprobante y Diego lo está validando: decile que en cuanto se confirme arrancamos' : '; si ya pagó, pedile la foto del comprobante'}` : 'todavía no se le mandó la cuenta'}
→ ${guia}`;
}

// Contacto de prospección: Cresova le escribió primero (no llegó por un anuncio). El vendedor tiene que saberlo.
function prospectoTexto(conv) {
  const p = conv.prospecto;
  if (!p) return '';
  return `# Este contacto viene de PROSPECCIÓN (Cresova le escribió primero)
No pidió información ni llegó por un anuncio: le escribimos nosotros desde el número de prospección. Por eso:
- No digas "gracias por escribirnos" ni actúes como si él hubiera preguntado. Agradecé que respondió.
- Respetá su tiempo: mensajes cortos, una sola pregunta por mensaje. Si dice que no le interesa o que no le escribamos, agradecé en una línea y no insistas.
- El objetivo es que acepte ver una propuesta: ofrecele armarle una demo de cómo se vería su página (es gratis y sin compromiso), como con cualquier cliente.
- Usá lo que sabemos del negocio para personalizar, pero no lo recites ni digas que lo "investigamos": hablá de lo que vimos en Google Maps o en su página si viene al caso.

Lo que sabemos de ${p.empresa}${p.rubro ? ` (${p.rubro})` : ''}:
${(p.hallazgos || []).map((h) => `- ${h}`).join('\n') || '- (sin detalle)'}
${p.oportunidad ? `Oportunidad que vimos: ${p.oportunidad}` : ''}
${p.oferta ? `Lo que conviene ofrecerle: ${p.oferta}` : ''}`;
}

export async function sellerTurn(conv, { model = V.config.model, temperature = V.config.temperature, extraSystem = '', proactivo = false } = {}) {
  const ficha = [await fichaTexto(conv).catch(() => ''), prospectoTexto(conv)].filter(Boolean).join('\n\n');
  const messages = [{ role: 'system', content: systemPrompt(conv) + (ficha ? `

${ficha}` : '') + (extraSystem ? `

${extraSystem}` : '') }, ...historyForModel(conv)];
  // En los mensajes que inicia el bot (seguimientos), la instrucción va también al final, junto al chat: si solo está
  // arriba en el sistema, el modelo la ignora y sigue la charla como si el cliente acabara de contestar.
  if (proactivo && extraSystem) messages.push({ role: 'system', content: extraSystem });
  const tools = [];
  let cost = 0, tokens = 0, text = '';
  // Primero el plan de Claude (Diego casi siempre tiene cupo); si no hay cupo o falla, OpenRouter es el respaldo.
  let motor = model;
  let plan = null;
  if (usarPlan()) {
    plan = await turnoPlan(conv, messages[0].content, proactivo, tools, proactivo ? extraSystem : '').catch((e) => {
      log('vendedor', `Plan de Claude no disponible para ${conv.title} (${String(e.message).slice(0, 140)}): respondo con OpenRouter`, 'warn');
      if (tools.length) messages.push({ role: 'system', content: `En este turno ya usaste: ${tools.map((t) => t.name).join(', ')}. No las repitas; escribí el mensaje al cliente.` });
      return null;
    });
  }
  if (plan) { text = plan.text; motor = `plan:${PLAN_MODEL()}`; V.costoPlan = (V.costoPlan || 0) + plan.cost; }
  for (let step = 0; !plan && step < 5; step++) {
    const j = await openrouter({ model, temperature, messages, ...(proactivo ? {} : { tools: TOOLS, tool_choice: 'auto' }) });
    cost += Number(j.usage?.cost || 0);
    tokens += Number(j.usage?.total_tokens || 0);
    const msg = j.choices?.[0]?.message || {};
    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
        const result = await runTool(conv, call.function.name, args).catch((e) => ({ ok: false, error: e.message }));
        tools.push({ name: call.function.name, args, result });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }
    text = String(msg.content || '').trim();
    // Guardia de precios: un monto que no está en el catálogo se corrige una vez.
    const bad = moneyIn(text).filter((n) => !allowedAmounts(conv).has(n));
    if (bad.length && step < 4) {
      messages.push({ role: 'assistant', content: text }, { role: 'system', content: `Ese mensaje tiene montos que no están en el catálogo (${bad.join(', ')}). Reescribilo usando solo precios del catálogo o sin cifras.` });
      tools.push({ name: 'guardia_de_precios', args: { montos: bad }, result: { corregido: true } });
      continue;
    }
    break;
  }
  text = toWhatsApp(text);
  const still = moneyIn(text).filter((n) => !allowedAmounts(conv).has(n));
  if (still.length) {
    text = text.replace(/(?:L\.?\s?|lps\.?\s?|lempiras\s?|\$\s?)(\d{1,3}(?:[,.]\d{3})+|\d+)/gi, (m0, num) => (allowedAmounts(conv).has(Number(num.replace(/[,.](?=\d{3}\b)/g, ''))) ? m0 : 'el precio que te confirma el equipo'));
    tools.push({ name: 'guardia_de_precios', args: { quitados: still }, result: { quitado: true } });
  }
  if (moneyIn(text).some((n) => SEED.catalogo.some((p) => Number(p.precio) === n))) conv.estado.precioDado = true;
  // Cuenta como oferta solo si la pregunta final invita a la demo (no la pregunta de calificación).
  const lastQ = (text.match(/[^.!?\n]*\?/g) || []).at(-1) || '';
  if (/demo|te la (armo|armamos|muestro)|te (armo|armamos)/i.test(lastQ) && !conv.estado.demo) conv.estado.ofertasDemo += 1;
  // Si el vendedor rechazó el rubro sin usar la herramienta, igual queda como no calificado (sin seguimientos).
  if (!conv.estado.noCalificado && /no (te )?(podemos|vamos a poder) (ofrecer|apoyar|ayudar)|no es lo que más te va a ayudar|no te quiero vender/i.test(text)) conv.estado.noCalificado = 'El vendedor indicó que el rubro no aplica';
  V.cost += cost;
  return { text, meta: { model: motor, cost: plan ? 0 : cost, ...(plan ? { costoPlan: plan.cost } : {}), tokens, tools } };
}

// Caso de demo real: cliente, cotización en borrador y tarea en el sistema Cresova.
async function createDemoCase(conv, args) {
  const c = conv.contacto, prod = SEED.catalogo.find((p) => p.nombre === args.paquete);
  const notes = `${args.resumen}${args.pendientes ? `
Pendiente: ${args.pendientes}` : ''}

Creada por el vendedor IA (Diego Villalta) desde WhatsApp +${conv.phone}.${c.logo_o_redes ? `
Logo / redes: ${c.logo_o_redes}` : ''}`;
  const out = { ok: true };
  try {
    const db = await import('../cresova/db.mjs');
    if (db.enUso()) {
      const r = await db.crearCaso({ nombre: c.nombre || c.empresa || `WhatsApp ${conv.phone}`, empresa: c.empresa, telefono: `+${conv.phone}`, rubro: c.rubro, paquete: args.paquete, precio: prod?.precio || 0, descripcion: (prod?.descripcion || '').split(/\n/)[0], notas: notes });
      conv.estado.cotizacion = r.numero;
      out.cotizacion = r.numero;
    } else {
    const client = await callMcpTool('cresova', 'create_client', { name: c.nombre || c.empresa || `WhatsApp ${conv.phone}`, business_name: c.empresa, phone: `+${conv.phone}`, sector: c.rubro, service: args.paquete, notes });
    const clientId = client?.id || client?.client?.id || client?.client_id;
    const quote = await callMcpTool('cresova', 'create_quote', { ...(clientId ? { client_id: clientId } : {}), client_name: c.nombre || c.empresa || `WhatsApp ${conv.phone}`, client_company: c.empresa, client_phone: `+${conv.phone}`, client_email: c.correo, currency: 'HNL',
      items: [{ name: args.paquete, unit_price: Number(prod?.precio || 0), description: (prod?.descripcion || '').split(/\n/)[0] }], notes });
    const quoteNumber = quote?.quote_number || quote?.quote?.quote_number;
    await callMcpTool('cresova', 'create_task', { title: `Armar y enviar la demo de ${c.empresa || conv.phone}`, category: 'seguimiento_ventas', priority: 'high', notes, ...(clientId ? { client_id: clientId } : {}), ...(quoteNumber ? { quote_number: quoteNumber } : {}), due_date: new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10) });
    conv.estado.cotizacion = quoteNumber || 'creada';
    out.cotizacion = conv.estado.cotizacion;
    }
  } catch (e) {
    log('vendedor', `No se pudo crear la cotización en Cresova: ${e.message}`, 'error');
    out.aviso = 'El equipo fue avisado igual.';
  }
  addDeliverable('vendedor', `✅ Demo aceptada: ${c.empresa || conv.phone}`, `**Paquete:** ${args.paquete}
**Cotización:** ${conv.estado.cotizacion || 'no se pudo crear (revisá Cresova)'}
**WhatsApp:** +${conv.phone}

${notes}`,
    { kind: 'informe', summary: `${args.paquete} · ${c.rubro || ''} · cotización ${conv.estado.cotizacion || 'pendiente'}` });
  log('vendedor', `Demo aceptada: ${c.empresa || conv.phone} (${args.paquete})`, 'ok');
  return out;
}

// ---------- conversaciones de prueba ----------
export function newConv({ title, anuncio, kind = 'sim', caseId = null, phone = null } = {}) {
  const conv = {
    id: randomUUID(), kind, caseId, phone, title: String(title || 'Cliente de prueba').slice(0, 80), ts: Date.now(),
    anuncio: anuncio && (anuncio.titulo || anuncio.texto) ? { titulo: String(anuncio.titulo || '').slice(0, 200), texto: String(anuncio.texto || '').slice(0, 600) } : null,
    contacto: {}, msgs: [], estado: { precioDado: false, ofertasDemo: 0, demo: null, humano: null, noCalificado: null }, busy: false,
  };
  V.convs[conv.id] = conv;
  const ids = Object.values(V.convs).sort((a, b) => b.ts - a.ts).map((c) => c.id);
  for (const id of ids.filter((i) => V.convs[i].kind !== 'whatsapp').slice(60)) delete V.convs[id];
  emit(conv);
  return conv;
}

export async function clientSays(id, text, opts = {}) {
  const conv = V.convs[id];
  if (!conv) throw new Error('Conversación no encontrada.');
  if (conv.busy) throw new Error('El vendedor todavía está respondiendo.');
  text = String(text || '').trim().slice(0, 2000);
  if (!text) throw new Error('Mensaje vacío.');
  conv.msgs.push({ role: 'cliente', text, ts: Date.now() });
  conv.busy = true;
  emit(conv);
  try {
    const { text: reply, meta } = await sellerTurn(conv, opts);
    conv.msgs.push({ role: 'bot', text: reply, ts: Date.now(), meta, ...(opts.original ? { original: opts.original } : {}) });
  } catch (e) {
    conv.msgs.push({ role: 'sistema', text: `Error: ${e.message}`, ts: Date.now() });
  } finally {
    conv.busy = false;
    emit(conv);
  }
  return publicConv(conv);
}

// Reproduce un caso real de Velforce: le pasa al vendedor los mensajes del cliente
// turno por turno y guarda lo que había respondido Natally para comparar.
export async function replayCase(caseId, { turns = 6 } = {}) {
  const c = loadCases().find((x) => x.id === caseId);
  if (!c) throw new Error('Caso no encontrado.');
  const conv = newConv({ title: `${c.demo ? '✅' : '·'} ${c.empresa || 'Caso'} (${c.fecha})`, kind: 'caso', caseId, anuncio: c.anuncio ? { titulo: c.anuncio } : null });
  const groups = [];
  for (const m of c.mensajes) {
    const last = groups.at(-1);
    if (m.de === 'cliente') { if (last && !last.bot.length) last.cliente.push(m.texto); else groups.push({ cliente: [m.texto], bot: [] }); }
    else if (last) last.bot.push(m.texto);
  }
  (async () => {
    for (const g of groups.slice(0, turns)) {
      for (const t of g.cliente.slice(0, -1)) conv.msgs.push({ role: 'cliente', text: t, ts: Date.now() });
      await clientSays(conv.id, g.cliente.at(-1), { original: g.bot.join('\n\n') || '(Natally no respondió)' });
      if (conv.msgs.at(-1)?.role === 'sistema') break;
    }
  })();
  return publicConv(conv);
}

export function correct(convId, index, corregida, nota = '') {
  const conv = V.convs[convId];
  const m = conv?.msgs[index];
  if (!m || m.role !== 'bot') throw new Error('Mensaje no encontrado.');
  corregida = String(corregida || '').trim();
  if (!corregida) throw new Error('Escribí cómo debió responder.');
  const cliente = [...conv.msgs.slice(0, index)].reverse().find((x) => x.role === 'cliente')?.text || '';
  const f = { id: randomUUID(), convId, cliente, bot: m.text, corregida: corregida.slice(0, 2000), nota: String(nota).slice(0, 500), ts: Date.now() };
  V.feedback.push(f);
  if (V.feedback.length > 200) V.feedback.splice(0, V.feedback.length - 200);
  m.corregida = f.corregida;
  log(null, 'Ventas: Diego corrigió una respuesta del vendedor', 'ok');
  emit(conv);
  return f;
}

export function addRule({ regla, categoria = 'otros', mal = '', bien = '' }, by = 'gerente_ventas') {
  const r = { id: randomUUID().slice(0, 8), regla: String(regla).slice(0, 600), categoria: String(categoria).slice(0, 40), mal: String(mal).slice(0, 400), bien: String(bien).slice(0, 400), activa: true, ts: Date.now(), fuente: by };
  V.rules.push(r);
  emit();
  return r;
}
export function setRule(id, activa) {
  const r = V.rules.find((x) => x.id === id);
  if (!r) throw new Error('Regla no encontrada.');
  r.activa = Boolean(activa);
  emit();
  return r;
}

export function deleteConv(id) { delete V.convs[id]; emit(); }
export function setConfig({ model, temperature, motor, modeloPlan, cuentaAnticipo }) {
  if (typeof cuentaAnticipo === 'string') V.config.cuentaAnticipo = cuentaAnticipo.trim().slice(0, 600);
  if (motor === 'plan' || motor === 'openrouter') V.config.motor = motor;
  if (typeof modeloPlan === 'string' && /^claude-[\w.-]{3,60}$/.test(modeloPlan)) V.config.modeloPlan = modeloPlan;
  if (typeof model === 'string' && /^[\w./:-]{3,120}$/.test(model)) V.config.model = model;
  if (temperature != null && !isNaN(temperature)) V.config.temperature = Math.min(1.5, Math.max(0, Number(temperature)));
  emit();
  return V.config;
}

// Historial de lo que pasó con el cliente (demo aceptada, lista, programada, enviada, seguimientos, respuesta, resultado).
export function registrarEvento(convId, tipo, texto = '') {
  const c = V.convs[convId];
  if (!c) return;
  (c.eventos ||= []).push({ ts: Date.now(), tipo, texto: String(texto || '').slice(0, 200) });
  if (c.eventos.length > 60) c.eventos.splice(0, c.eventos.length - 60);
  emit(c);
}
// Diego marca el resultado de la venta: ganado o perdido (o lo quita). Frena los mensajes automáticos.
export function marcarResultado(convId, tipo, nota = '') {
  const c = V.convs[convId];
  if (!c) throw new Error('Conversación no encontrada.');
  if (!tipo) { delete c.estado.resultado; registrarEvento(convId, 'resultado', 'Resultado quitado'); return getConv(convId); }
  if (!['ganado', 'perdido'].includes(tipo)) throw new Error('Resultado inválido.');
  c.estado.resultado = { tipo, nota: String(nota || '').slice(0, 300), ts: Date.now() };
  c.followups = { ...(c.followups || {}), next: null };
  if (c.postDemo) c.postDemo = { ...c.postDemo, next: null };
  for (const a of c.agenda || []) if (!a.hecho) { a.hecho = Date.now(); a.resultado = `cancelado: ${tipo}`; }
  registrarEvento(convId, tipo, nota || (tipo === 'ganado' ? 'Venta cerrada' : 'Venta perdida'));
  // La cotización en la base de Cresova queda aceptada o rechazada, con el motivo.
  if (c.estado.cotizacion && c.estado.cotizacion !== 'creada') {
    import('../cresova/db.mjs').then((db) => (db.enUso() ? db.resultado(c.estado.cotizacion, tipo, nota) : null))
      .catch((e) => log('vendedor', `No se pudo marcar ${c.estado.cotizacion} como ${tipo} en Cresova: ${e.message}`, 'warn'));
  }
  return getConv(convId);
}
const publicConv = ({ busy, ...c }) => ({ ...c, busy: Boolean(busy) });
export const getConv = (id) => (V.convs[id] ? publicConv(V.convs[id]) : null);
function summary() {
  return {
    config: V.config, cost: V.cost, playbookVersions: V.playbook.length, rules: V.rules, feedback: V.feedback.length,
    convs: Object.values(V.convs).sort((a, b) => (b.msgs.at(-1)?.ts || b.ts) - (a.msgs.at(-1)?.ts || a.ts)).map((c) => {
      const last = c.msgs.filter((m) => m.role !== 'sistema').at(-1);
      return { id: c.id, kind: c.kind, title: c.title, tel8: String(c.phone || '').replace(/\D/g, '').slice(-8), ts: c.ts, n: c.msgs.length, busy: Boolean(c.busy), estado: c.estado, pausa: c.pausa || null,
        empresa: c.contacto?.empresa || '', rubro: c.contacto?.rubro || '', anuncio: c.anuncio?.titulo || '', followups: c.followups || null,
        postDemo: c.postDemo || null,
        etapaVenta: c.kind === 'whatsapp' ? etapaDe(c) : null,
        respondioDemo: c.estado?.respondioDemo || (c.estado?.demoEnviada ? c.msgs.find((m) => m.role === 'cliente' && !m.auto && m.ts > c.estado.demoEnviada)?.ts || null : null),
        proyecto: (() => { const p = (state.proyectos || []).find((x) => x.origen?.conv === c.id); return p ? { id: p.id, estado: p.estado, envioProgramado: p.envioProgramado || null, enviada: p.enviada || null, calidad: p.calidad || null, preview: p.preview } : null; })(),
        last: last ? { role: last.role, ts: last.ts || c.ts, text: String(last.text || '').slice(0, 90) } : null };
    }),
  };
}
export const ventasSummary = () => ({ ...summary(), cases: loadCases().map(({ mensajes, ...c }) => ({ ...c, n: mensajes.length })) });

// Para el Gerente de Ventas.
export function transcripts({ tipo = 'todas', limite = 10 } = {}) {
  return Object.values(V.convs).filter((c) => tipo === 'todas' || c.kind === tipo).sort((a, b) => b.ts - a.ts).slice(0, limite).map((c) => [
    `## ${c.title} (${c.kind}, ${new Date(c.ts).toLocaleDateString('es-HN')}) · estado: ${JSON.stringify(c.estado)} · datos: ${JSON.stringify(c.contacto)}`,
    ...c.msgs.map((m) => `${m.role === 'cliente' ? 'CLIENTE' : m.role === 'bot' ? `VENDEDOR [${m.meta?.model || ''}]` : 'SISTEMA'}: ${m.text}${m.original ? `\n  (Natally había respondido: ${m.original.slice(0, 500)})` : ''}${m.corregida ? `\n  (Diego lo corrigió así: ${m.corregida})` : ''}${m.meta?.tools?.length ? `\n  [herramientas: ${m.meta.tools.map((t) => t.name).join(', ')}]` : ''}`),
  ].join('\n')).join('\n\n');
}
export const feedbackList = (n = 30) => V.feedback.slice(-n);
export const getCase = (id) => loadCases().find((x) => x.id === id) || null;

// Para el canal de WhatsApp.
export const ventasState = V;
export const touchConv = (conv) => emit(conv);

// Embudo de ventas por anuncio (para Renata, Martín y Jarvis): qué trae cada anuncio, más allá del "resultado" de Meta.
// Con WhatsApp Web (Evolution) el anuncio de origen no llega con el mensaje. Alternativa: cada anuncio usa un texto inicial distinto
// ("Hola, quiero ver la demo… [código]") y aquí se asocia ese texto con el nombre del anuncio.
V.adMap ||= [];
const normAd = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export function registrarAnuncioTexto({ texto, anuncio, id = null }) {
  const k = normAd(texto);
  if (k.length < 6 || !String(anuncio || '').trim()) throw new Error('Falta el texto inicial (mínimo 6 caracteres) o el nombre del anuncio.');
  V.adMap = V.adMap.filter((a) => a.k !== k);
  V.adMap.push({ k, texto: String(texto).slice(0, 200), anuncio: String(anuncio).slice(0, 120), id });
  emit();
  return V.adMap.length;
}
export const anuncioPorTexto = (text) => {
  const t = normAd(text);
  // el más específico (más largo) que esté contenido en el mensaje
  return V.adMap.filter((a) => t.includes(a.k)).sort((a, b) => b.k.length - a.k.length)[0] || null;
};
export const listaAnunciosTexto = () => V.adMap.map(({ texto, anuncio, id }) => ({ texto, anuncio, id }));

export function embudoPorAnuncio(dias = 30) {
  const desde = Date.now() - dias * 86400e3;
  const filas = {};
  for (const c of Object.values(V.convs)) {
    if (c.kind !== 'whatsapp' || c.ts < desde || c.pausa?.existente) continue;
    const k = c.anuncio?.titulo || '(sin anuncio: orgánico o directo)';
    const f = (filas[k] ||= { anuncio: k, adId: c.anuncio?.id || null, leads: 0, ultimos7d: 0, respondieron: 0, vieronPrecio: 0, pidieronDemo: 0, demosAceptadas: 0, demosEnviadas: 0, leGustaron: 0, recibieronCuenta: 0, pagaron: 0, noCalifican: 0, conPersona: 0, cotizaciones: [] });
    f.leads++;
    if (c.ts > Date.now() - 7 * 86400e3) f.ultimos7d++;
    if (c.msgs.filter((m) => m.role === 'cliente').length >= 2) f.respondieron++;
    if (c.estado?.precioDado) f.vieronPrecio++;
    if (c.estado?.pidioDemo || c.estado?.demo) f.pidieronDemo++;
    if (c.estado?.demo) f.demosAceptadas++;
    if (c.estado?.demoEnviada) f.demosEnviadas++;
    const et = etapaDe(c);
    if (['gusto', 'cuenta', 'comprobante', 'pago'].includes(et)) f.leGustaron++;
    if (cuentaTs(c)) f.recibieronCuenta++;
    if (et === 'pago') f.pagaron++;
    if (c.estado?.noCalificado) f.noCalifican++;
    if (c.estado?.humano) f.conPersona++;
    if (c.estado?.cotizacion && c.estado.cotizacion !== 'creada') f.cotizaciones.push(c.estado.cotizacion);
  }
  const lista = Object.values(filas).sort((a, b) => b.leads - a.leads);
  const tot = lista.reduce((t, f) => ({ leads: t.leads + f.leads, demos: t.demos + f.demosAceptadas, noCal: t.noCal + f.noCalifican }), { leads: 0, demos: 0, noCal: 0 });
  return { dias, totales: tot, porAnuncio: lista, nota: 'Ventas cerradas: revisá las cotizaciones pagadas en Cresova (list_quotes / get_sales_summary) con los números de cotización de arriba. El vendedor atiende solo contactos nuevos desde el 30/10.' };
}
