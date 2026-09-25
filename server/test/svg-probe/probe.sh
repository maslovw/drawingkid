#!/usr/bin/env bash
# Probes whether an OpenAI image model can return SVG.
# Usage: OPENAI_API_KEY=... ./probe.sh [model] [outdir]
set -u
MODEL="${1:-gpt-image-2.5-flare}"
OUT="${2:-./out}"
mkdir -p "$OUT"
PROMPT='A simple coloring page for a 4-year-old: a smiling cat sitting on a pillow. Thick black outlines on white, no shading, no text.'
H=(-H "Authorization: Bearer $OPENAI_API_KEY" -H "Content-Type: application/json")

echo "== 0. model visible to this key?"
curl -s "${H[@]}" "https://api.openai.com/v1/models/$MODEL" | head -c 400; echo

echo "== 1. Images API, output_format=svg"
curl -s "${H[@]}" https://api.openai.com/v1/images/generations \
  -d "$(jq -n --arg m "$MODEL" --arg p "$PROMPT" '{model:$m,prompt:$p,size:"1024x1024",quality:"low",output_format:"svg"}')" \
  > "$OUT/1-images-svg.json"
jq -c 'if .error then .error else {keys:(.data[0]|keys), output_format, size, usage} end' "$OUT/1-images-svg.json"

echo "== 2. Responses API, model asked to write SVG markup as text"
curl -s "${H[@]}" https://api.openai.com/v1/responses \
  -d "$(jq -n --arg m "$MODEL" --arg p "$PROMPT" '{model:$m,input:("Reply with only a complete standalone SVG document (no markdown) for: " + $p)}')" \
  > "$OUT/2-responses-text.json"
jq -c 'if .error then .error else {status, types:[.output[].type], usage} end' "$OUT/2-responses-text.json"
jq -r '[.output[]?|select(.type=="message")|.content[]?|.text?]|join("")' "$OUT/2-responses-text.json" > "$OUT/2.svg"
head -c 200 "$OUT/2.svg"; echo

echo "== 3. Responses API, image_generation tool with output_format=svg"
curl -s "${H[@]}" https://api.openai.com/v1/responses \
  -d "$(jq -n --arg m "$MODEL" --arg p "$PROMPT" '{model:"gpt-5.5",input:$p,tools:[{type:"image_generation",model:$m,output_format:"svg",quality:"low",size:"1024x1024"}]}')" \
  > "$OUT/3-tool-svg.json"
jq -c 'if .error then .error else {status, types:[.output[].type], fmt:[.output[]|select(.type=="image_generation_call")|.output_format]} end' "$OUT/3-tool-svg.json"
