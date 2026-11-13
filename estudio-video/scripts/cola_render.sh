#!/bin/bash
# Cola de renders: cada línea "video|duración|nombre". Corre de N en N (N=$2, por defecto 2).
cd "$(dirname "$0")/.."
LIST=$1; N=${2:-2}
run() { IFS='|' read -r v d n <<< "$1"; node scripts/mezcla.mjs videos/$v >/dev/null; rm -f "videos/$v/renders/previews/$n.mp4";
  (time node videos/$v/src/render.js --from 0 --to $d --fps 30 --scale 1 --out videos/$v/renders/previews --name "$n" --audio videos/$v/renders/mix.wav) > "videos/$v/renders/logs/$(echo $n | tr ' ' '_').log" 2>&1; echo "listo $v $(date +%H:%M)"; }
while IFS= read -r line; do [ -z "$line" ] && continue; while [ "$(jobs -rp | wc -l)" -ge "$N" ]; do sleep 20; done; run "$line" & done < "$LIST"
wait
