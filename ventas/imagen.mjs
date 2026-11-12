// Lee las imágenes que manda un cliente por WhatsApp (flyers, logos, fotos del local, capturas) para que el
// vendedor sepa qué dicen: nombre del negocio, a qué se dedica, servicios, teléfonos. Usa Gemini con la llave de
// Google (GEMINI_API_KEY); si no hay o falla, OpenRouter. Si nada funciona, el vendedor sigue sin la lectura.
import { log } from '../state.mjs';

const PROMPT = `Esta imagen la mandó por WhatsApp el dueño de un negocio de Honduras que quiere una página web.
Describí en español, en 2 a 5 líneas cortas y sin inventar nada:
- qué es (logo, flyer o afiche, foto del local, foto de productos, captura de pantalla, documento);
- el nombre del negocio si aparece;
- a qué se dedica y los servicios o productos que se leen (copialos tal cual);
- teléfonos, dirección, horarios, redes o sitio web si aparecen.
Si no se puede leer o no tiene nada que ver con un negocio, decilo en una línea.`;

let modelos = null;
async function modelosGemini(key) {
  if (modelos) return modelos;
  try {
    const j = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15_000) })).json();
    const ids = (j.models || []).filter((x) => (x.supportedGenerationMethods || []).includes('generateContent')).map((x) => x.name.replace('models/', ''));
    const ver = (n) => parseFloat(n.split('-')[1]) || 0;
    modelos = [...ids.filter((n) => /^gemini-[\d.]+-flash$/.test(n)), ...ids.filter((n) => /^gemini-[\d.]+-flash-lite$/.test(n))].sort((a, b) => ver(b) - ver(a)).slice(0, 3);
  } catch {}
  if (!modelos?.length) modelos = ['gemini-2.5-flash'];
  return modelos;
}

async function conGemini(b64, mime) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  let mejor = null;
  for (const model of await modelosGemini(key)) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: PROMPT }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096, ...(/^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
      signal: AbortSignal.timeout(25_000),
    }).catch(() => null);
    if (!r) continue;
    const j = await r.json().catch(() => ({}));
    const t = (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
    if (r.ok && t && t.length > 120) return t;
    if (r.ok && t) mejor ||= t;
  }
  return mejor;
}

async function conOpenRouter(b64, mime) {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.TRANSCRIBE_MODEL || 'google/gemini-3.5-flash-lite', temperature: 0.1, max_tokens: 600, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }, { type: 'text', text: PROMPT }] }] }),
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => ({}));
  return String(j.choices?.[0]?.message?.content || '').trim() || null;
}

export async function leerImagen(b64, mime = 'image/jpeg') {
  if (!b64 || b64.length > 14e6) return null;
  try {
    const t = (await conGemini(b64, mime)) || (await conOpenRouter(b64, mime));
    return t ? t.replace(/\s*\n+\s*/g, ' · ').slice(0, 900) : null;
  } catch (e) {
    log('vendedor', `No se pudo leer una imagen: ${e.message}`, 'warn');
    return null;
  }
}

// Texto corto con Gemini (por ejemplo, clasificar una respuesta). Devuelve null si no se pudo.
export async function textoGemini(prompt) {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;
  for (const m of await modelosGemini(key)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json' } }), signal: AbortSignal.timeout(45_000) });
      if (!r.ok) continue;
      const t = (await r.json()).candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (t) return t;
    } catch {}
  }
  return null;
}
