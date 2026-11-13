// Copia plan/beats.json de un video a src/beats.js (el motor solo sirve src/ y assets/).
import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2];
const b = readFileSync(`${dir}/plan/beats.json`, "utf8");
writeFileSync(`${dir}/src/beats.js`, `// GENERADO desde plan/beats.json con scripts/beats_to_src.mjs — no editar a mano.\nexport const BEATS = ${b.trim()};\n`);
console.log("beats.js listo");
