// Genera candidatos de identidad sonora de Cresova (firmas cortas + temas) con ElevenLabs Music.
// Una petición por archivo, sin reintentos, no sobrescribe. Salida: assets/marca-sonora/candidatos/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
// En el servidor la llave llega por ELEVENLABS_API_KEY; en la PC se lee del archivo de siempre.
const KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const out = "assets/marca-sonora/candidatos";
mkdirSync(out, { recursive: true });
const MOTIF = "built around one short memorable three-note motif (two quick notes then a long rising third note, like saying 'cre-so-VA')";
const JOBS = [
  // Firmas (logo): cortas, con final claro.
  ["Firma A1 epica", 10000, `Epic cinematic sonic logo for a premium brand: a deep impact hit, then ${MOTIF} played by bold brass and strings, ending on a big open major chord that rings out, trailer quality, no vocals, no drums loop`],
  ["Firma A2 epica", 10000, `Short cinematic brand signature: rising tension swell for one second, a huge low boom, then ${MOTIF} on soaring strings and choir pad without words, resolving to a triumphant held chord, no vocals`],
  ["Firma AC1 epica latina", 10000, `Epic cinematic sonic logo with subtle Latin color: big orchestral hit with congas and timbales accent, then ${MOTIF} played on warm marimba doubled by strings, ending on a bright open chord with a final cymbal swell, premium, no vocals`],
  ["Firma AC2 epica latina", 10000, `Modern cinematic brand sting from Central America: deep taiko-like hit layered with conga slap, ${MOTIF} on clean nylon guitar and brass, finishing on a confident wide chord, polished, no vocals`],
  ["Firma AC3 epica latina", 10000, `Premium sonic identity: crystalline synth sparkle, a powerful sub boom, then ${MOTIF} on marimba and synth bells with strings underneath, a small shaker flourish, ends on a shining sustained chord, no vocals`],
  ["Firma C1 latina moderna", 10000, `Modern Latin sonic logo: tight percussion fill with congas and shaker, ${MOTIF} on bright marimba and clean electric guitar, ending with a warm chord and a soft tom hit, confident and friendly, no vocals`],
  // Temas (fondo de videos): 24 s, con desarrollo y espacio para la voz.
  ["Tema AC1 epico latino", 24000, `Epic cinematic underscore for a 20 second business ad, 120 BPM, ${MOTIF} repeated on marimba and pizzicato strings, driving taiko and conga percussion, deep pulsing bass, builds to a big emotional lift at 13 seconds, leaves space for a male voiceover, ends with a strong final hit at 21 seconds, no vocals`],
  ["Tema A1 epico", 24000, `Cinematic trailer-style underscore, 120 BPM, ostinato strings and pulsing low synth, ${MOTIF} on brass, ticking percussion, tension that releases into a powerful confident section at 13 seconds, final impact at 21 seconds, room for voiceover, no vocals`],
  ["Tema C1 latino moderno", 24000, `Modern premium Latin electronic underscore, 120 BPM, congas, shaker and deep house kick, warm bass, ${MOTIF} on marimba and clean guitar, uplifting chorus feel from 13 seconds, polished like a global brand ad, room for voiceover, final hit at 21 seconds, no vocals`],
];
const used = async () => (await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": KEY } })).json()).character_count;
const b = await used();
for (const [name, ms, prompt] of JOBS) {
  const f = `${out}/${name}.mp3`;
  if (existsSync(f)) { console.log("ya existe", name); continue; }
  const r = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: ms, model_id: "music_v1" }),
  });
  if (!r.ok) { console.log(name, "ERROR", r.status, (await r.text()).slice(0, 300)); continue; }
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  writeFileSync(f.replace(".mp3", ".json"), JSON.stringify({ source: "ElevenLabs Music API", prompt, length_ms: ms, created: new Date().toISOString(), license: "ElevenLabs Starter (uso comercial)" }, null, 1));
  console.log(name, "OK");
}
await new Promise((o) => setTimeout(o, 4000));
console.log("créditos antes", b, "después", await used());
