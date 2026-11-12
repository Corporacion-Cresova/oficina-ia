// Abogado del diablo: antes de que Diego vea una propuesta importante (decisiones de Pauta, Ventas, Contenido,
// Prospección y Dirección), un modelo DISTINTO (Gemini, no Claude, para no compartir los mismos sesgos) intenta
// tirarla abajo: evidencia débil, muestras chicas, explicaciones alternativas, números que no cuadran, riesgos.
// La crítica se agrega al documento y la tarjeta de la Bandeja muestra el veredicto.
import fs from 'node:fs';
import { state, saveNow, log, broadcast } from './state.mjs';

const AGENTES = new Set(['media', 'analista_pauta', 'gerente_ventas', 'estratega', 'prospector', 'coordinador', 'auditor']);
export const aplica = (d) => d.kind === 'decision' && AGENTES.has(d.agentId) && !d.devProyecto && !d.prospeccionLote && !d.pagoAnticipo && !d.ventasConv && !d.recontactoLote;

const PROMPT = (titulo, contenido) => `Sos el abogado del diablo de la oficina de Cresova (agencia de páginas web de Honduras que vende por WhatsApp con anuncios de Meta). Un agente de IA le está proponiendo esto a Diego, el dueño. Tu trabajo NO es estar de acuerdo: es encontrar por qué podría estar mal, para que Diego decida con los ojos abiertos.

Revisá:
1. Evidencia: ¿cada afirmación tiene un número y una fuente? ¿O son opiniones?
2. Tamaño de la muestra: ¿se concluye con muy pocos datos (menos de ~10 leads, menos de ~L 500 de gasto, menos de 7 días)?
3. Explicaciones alternativas: ¿qué otra cosa podría explicar lo mismo (estacionalidad, un solo cliente, cambio de presupuesto, un error de medición)?
4. Números: ¿cuadran entre sí (sumas, porcentajes, costos = gasto / resultados)?
5. Riesgos y costo de equivocarse, y si hay una prueba más barata para decidir.
6. ¿La propuesta parece hecha para complacer a Diego en vez de por los datos?

Respondé SOLO con JSON:
{"veredicto": "sólida" | "con dudas" | "débil", "resumen": "1-2 frases para Diego", "objeciones": ["…"], "datos_faltantes": ["…"], "prueba_mas_barata": "si aplica, una frase"}

PROPUESTA: ${titulo}
---
${String(contenido).slice(0, 24000)}`;

async function gemini(texto) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de Gemini');
  for (const model of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-flash-latest']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: texto }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 4096 } }),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json().catch(() => ({}));
    const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    try { return { ...JSON.parse(t.replace(/^```(?:json)?|```$/g, '').trim()), modelo: model }; } catch {}
  }
  throw new Error('Gemini no devolvió una crítica');
}

export async function criticar(id) {
  const d = state.deliverables.find((x) => x.id === id);
  if (!d || !aplica(d) || d.critica) return;
  let contenido = '';
  try { contenido = fs.readFileSync(d.file, 'utf8'); } catch { return; }
  let c;
  try { c = await gemini(PROMPT(d.title, contenido)); } catch (e) { log(null, `Abogado del diablo no pudo revisar "${d.title}": ${e.message}`, 'warn'); return; }
  d.critica = { veredicto: c.veredicto, resumen: String(c.resumen || '').slice(0, 400), modelo: c.modelo, ts: Date.now() };
  const lista = (t, l) => (l?.length ? `**${t}:**\n${l.map((x) => `- ${x}`).join('\n')}\n` : '');
  fs.appendFileSync(d.file, `\n\n---\n\n## 🔎 Crítica independiente (abogado del diablo · ${c.modelo})\n**Veredicto: ${c.veredicto}.** ${c.resumen || ''}\n\n${lista('Objeciones', c.objeciones)}${lista('Datos que faltan', c.datos_faltantes)}${c.prueba_mas_barata ? `**Prueba más barata:** ${c.prueba_mas_barata}\n` : ''}`);
  saveNow();
  broadcast({ type: 'deliverable-updated', deliverable: { ...d, file: undefined } });
  log(d.agentId, `Abogado del diablo: "${d.title}" → ${c.veredicto}`, c.veredicto === 'débil' ? 'warn' : 'info');
}
