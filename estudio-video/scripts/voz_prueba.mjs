// Genera la misma frase con varias voces de ElevenLabs (una petición por voz, sin reintentos).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
// En el servidor la llave llega por ELEVENLABS_API_KEY; en la PC se lee del archivo de siempre.
const KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const TEXT = "Tu cliente te busca de noche. Si no te encuentra, le escribe a otro. Pide tu demo gratis por WhatsApp.";
// Ronda 1 (2026-10-24): Miguel, Alex, El Faraon, Zabra, El Marino. Ronda 2: las de abajo.
// [nombre, voice_id, owner de la biblioteca compartida o null si ya está en la cuenta]
const ids = JSON.parse(readFileSync("cache/voices2.json", "utf8"));
const lib = (n) => { const v = ids.find((x) => x.name.startsWith(n)); return [n, v.id, v.owner]; };
const VOICES = [
  lib("Brian C"), lib("Claus Encant"), lib("Bardo Limon"), lib("Rogher"), lib("Jose"), lib("Salvatore"),
  ["Juan Carlos", "G4IAP30yc6c1gK0csDfu", null], ["Gael", "Cmqnney5svFebDMl5Y9L", null],
];
const out = "assets/vo/pruebas";
mkdirSync(out, { recursive: true });
const tts = (id) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
  method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ text: TEXT, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
});
for (const [name, id, owner] of VOICES) {
  const file = `${out}/Prueba voz - ${name}.mp3`;
  if (existsSync(file)) { console.log("ya existe", name); continue; }
  let r = await tts(id);
  if (r.status === 400 || r.status === 404) {
    // Voz de la biblioteca compartida: agregarla a la cuenta (gratis) y reintentar una sola vez.
    const add = await fetch(`https://api.elevenlabs.io/v1/voices/add/${owner}/${id}`, { method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" }, body: JSON.stringify({ new_name: name }) });
    const aj = await add.json();
    console.log(name, "agregada:", add.status, aj.voice_id ? "ok" : JSON.stringify(aj).slice(0, 160));
    if (aj.voice_id) r = await tts(aj.voice_id);
  }
  if (!r.ok) { console.log(name, "ERROR", r.status, (await r.text()).slice(0, 200)); continue; }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(name, "OK");
}
const s = await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": KEY } })).json();
console.log("créditos usados:", s.character_count, "/", s.character_limit);
