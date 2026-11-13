// Genera efectos con ElevenLabs Sound Effects según la lista de abajo. Una petición por archivo, sin reintentos;
// no sobrescribe; guarda .json de procedencia y muestra el costo que reporta la API.
// Uso: node scripts/sfx_gen.mjs <id>[,<id>...] [variantes]      (ids de LIST; "all" = todos)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
// En el servidor la llave llega por ELEVENLABS_API_KEY; en la PC se lee del archivo de siempre.
const KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const LIST = {
  "golpe-grave": [1.0, "Soft deep sub thump, single dry hit, short decay, no reverb tail, no music, no voice"],
  "tick-cursor": [0.5, "One tiny soft digital tick, very short, dry, minimal high frequencies, interface sound"],
  "teclas-suaves": [1.5, "Quiet soft laptop keyboard typing, about eight light keystrokes, close and dry, no room"],
  "pop-ui": [0.5, "Short dry rounded UI pop, soft and modern, no echo, no tail"],
  "destello-particulas": [1.0, "Subtle airy digital shimmer, tiny particles assembling, soft and short, no whoosh"],
  "burbuja-mensaje": [0.5, "Modern chat message received sound, soft single bubble pop, short, not a ringtone"],
  "clic-boton": [0.5, "Crisp soft button click, dry plastic contact, very short, interface"],
  "ding-confirmacion": [1.0, "Gentle warm confirmation chime, single soft note, short decay, premium app"],
  "whoosh-corto": [0.6, "Short filtered swish, soft air movement, under 0.4 seconds, no riser, no boom"],
  "campana-recepcion": [1.5, "Loud clear ding of a hotel front desk service bell being slapped once, bright metallic ring, close microphone"],
  "papel-hojas": [1.0, "Sheets of paper shuffling and sliding quickly, crisp paper, close and dry"],
  "llave-candado": [1.2, "Metal key inserted into a padlock, turns, and the padlock clicks open, close and dry"],
  "cajas-carton": [1.0, "Cardboard boxes sliding and set down on a wooden shelf, soft thuds, close"],
  "cuaderno": [1.0, "Notebook pages flipping quickly then closing with a soft slap, close and dry"],
  "bombillo": [1.0, "Small light bulb switching on with a soft filament hum and a gentle electric click"],
  "planta-crece": [1.5, "Soft organic growing sound, gentle rustling leaves unfolding, subtle and warm, short"],
  "bloques-madera": [0.8, "Two wooden toy blocks dropped onto a table, hollow wooden knock, close"],
  "sello-tinta": [0.6, "Rubber stamp pressed firmly on paper, short thump with paper texture"],
  "check-lapiz": [0.6, "Pencil drawing a quick checkmark on paper, short scratch"],
  "cuchara-taza": [0.8, "Small spoon tapping a ceramic coffee cup twice, gentle clinks"],
  "engranes": [1.2, "Small metal gears clicking and starting to turn, mechanical ratchet, short"],
  "sobre-abrir": [1.0, "Wax seal cracking and an envelope being opened, soft paper, close"],
  "hoja-arrugada": [1.0, "A sheet of paper crumpling into a ball, close and crisp"],
  "calendario-arrancar": [0.8, "Tearing a page off a desk calendar pad, quick paper rip"],
  "apagado": [0.6, "Soft low electronic power-down blip, short descending tone, subtle, dry"],
};
const [ids = "", n = "2"] = process.argv.slice(2);
const pick = ids === "all" ? Object.keys(LIST) : ids.split(",");
const out = "assets/sfx/generated";
mkdirSync(out, { recursive: true });
const used = async () => (await (await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": KEY } })).json()).character_count;
const before = await used();
for (const id of pick) {
  const [dur, prompt] = LIST[id] || [];
  if (!prompt) { console.log("desconocido", id); continue; }
  for (let v = 1; v <= Number(n); v++) {
    const file = `${out}/${id}-0${v}.mp3`;
    if (existsSync(file)) { console.log("ya existe", file); continue; }
    const r = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      method: "POST", headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt, duration_seconds: dur, prompt_influence: 0.5, model_id: "eleven_text_to_sound_v2", loop: false }),
    });
    if (!r.ok) { console.log(id, v, "ERROR", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    writeFileSync(file.replace(".mp3", ".json"), JSON.stringify({ source: "ElevenLabs Sound Effects API", model: "eleven_text_to_sound_v2", prompt, duration_seconds: dur, prompt_influence: 0.5, created: new Date().toISOString(), license: "ElevenLabs Starter (uso comercial)" }, null, 1));
    console.log(id, v, "OK", "costo reportado:", r.headers.get("character-cost") ?? r.headers.get("x-character-count") ?? "n/d");
  }
}
await new Promise((ok) => setTimeout(ok, 3000));
const after = await used();
console.log("créditos antes", before, "después", after, "diferencia", after - before);
