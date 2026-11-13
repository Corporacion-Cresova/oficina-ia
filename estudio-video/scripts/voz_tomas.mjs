// Genera N tomas del guion de un video con El Faraón (eleven_v4) + tiempos por carácter.
// Uso: node scripts/voz_tomas.mjs videos/01-te-encuentran 3
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const [dir, n = "1"] = process.argv.slice(2);
// En el servidor la llave llega por ELEVENLABS_API_KEY; en la PC se lee del archivo de siempre.
const KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const md = readFileSync(`${dir}/plan/script.md`, "utf8");
const text = md.split("--- TEXTO PARA ELEVENLABS ---")[1].split("--- FIN ---")[0].trim();
const VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const out = `${dir}/assets/vo`;
mkdirSync(out, { recursive: true });
for (let i = 1; i <= Number(n); i++) {
  const base = `${out}/Voz toma ${i}`;
  if (existsSync(base + ".mp3")) { console.log("ya existe toma", i); continue; }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_v4", voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.15, speed: 1.0, use_speaker_boost: true } }),
  });
  if (!r.ok) { console.log("toma", i, "ERROR", r.status, (await r.text()).slice(0, 300)); break; }
  const j = await r.json();
  writeFileSync(base + ".mp3", Buffer.from(j.audio_base64, "base64"));
  writeFileSync(base + ".alignment.json", JSON.stringify(j.alignment));
  console.log("toma", i, "OK");
}
const s = await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": KEY } })).json();
console.log("créditos usados:", s.character_count, "/", s.character_limit);
