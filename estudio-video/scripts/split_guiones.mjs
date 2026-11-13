// Crea videos/<NN-slug>/plan/script.md a partir de plan/guiones-tanda-1.md (bloque de voz entre marcadores).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const SLUG = { "02": "lo-que-ve-tu-cliente", "03": "con-facebook-me-basta", "04": "asi-se-construye", "05": "y-si-no-me-gusta", "06": "imagina-constructora",
  "07": "comenta-demo", "08": "asi-hacemos-videos", "09": "cinco-cosas", "10": "honduras-de-noche", "11": "pocos-segundos", "12": "cliente-no-volvio" };
const md = readFileSync("plan/guiones-tanda-1.md", "utf8");
for (const block of md.split("\n## ").slice(1)) {
  const id = block.slice(0, 2); if (!SLUG[id]) continue;
  const title = block.split("\n")[0].trim();
  const voice = block.split("\n").slice(1).filter((l) => l.trim() && !l.startsWith("*(") && !l.startsWith("**Ojo") && !l.startsWith("---")).join("\n").trim();
  const dir = `videos/${id}-${SLUG[id]}/plan`; mkdirSync(dir, { recursive: true });
  const f = `${dir}/script.md`;
  if (existsSync(f)) { console.log("ya existe", f); continue; }
  writeFileSync(f, `# ${title} · guion aprobado 2026-10-24 (plan/guiones-tanda-1.md)\n\n--- TEXTO PARA ELEVENLABS ---\n${voice}\n--- FIN ---\n`);
  console.log("ok", f, voice.split(/\s+/).filter((w) => !/^\[/.test(w) && !/\]$/.test(w)).length, "palabras aprox.");
}
