#!/usr/bin/env bash
# Uso (raíz): bash scripts/hoja_previa.sh <video> <etiqueta> [desde=0] [hasta=dur] [fps=1]  → cache/<etiqueta>/hoja-*.jpg (cuadros a escala 0.35, 4 por fila)
set -e
V=$1; TAG=$2; FROM=${3:-0}; TO=${4:-20}; FPS=${5:-1}
OUT=videos/$V/cache/$TAG; rm -rf "$OUT"; mkdir -p "$OUT"
node videos/$V/src/render.js --from $FROM --to $TO --fps $FPS --scale 0.35 --out "$OUT" --jpg
ffmpeg -v error -y -framerate 1 -i "$OUT/%05d.jpg" -vf "tile=4x2:padding=6:color=white" "$OUT/hoja-%02d.jpg"
ls "$OUT" | grep hoja
