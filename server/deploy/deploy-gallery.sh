#!/bin/sh
# Packs the coloring page pictures, which aren't in git, into one archive and puts it on
# lsp at /var/www/play/drawingkid/gallery/, where web/pages/library.json's "pictures"
# points. Takes only the pictures library.json names, makes the small tile previews that
# are missing (sips + cwebp, so on the Mac), and stops if any page's picture is missing.
#
#   server/deploy/deploy-gallery.sh [source]          # pack and scp to lsp
#   server/deploy/deploy-gallery.sh --local [source]  # pack into web/gallery/ only
#
# source: a folder or a .zip of the pictures (any folder depth); default web/gallery/.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL=
[ "$1" = --local ] && LOCAL=1 && shift
SRC="${1:-$ROOT/web/gallery}"
REMOTE=/var/www/play/drawingkid

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src" "$WORK/gallery"
case "$SRC" in
  *.zip) unzip -q -j -o "$SRC" -d "$WORK/src" ;;
  *) find "$SRC" -type f \( -name '*.png' -o -name '*.webp' \) -exec cp {} "$WORK/src/" \; ;;
esac

# One line per picture: "page <file>", or "preview <file> <page file>" (made if missing),
# or "thumb <file>" (optional).
node -e '
  const { pages } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const p of pages) {
    const i = p.images ?? {};
    const files = i.page ? [i.page] : [i.portrait ?? `${p.id}-portrait.png`, i.landscape ?? `${p.id}-landscape.png`];
    for (const f of files) console.log("page", f);
    if (i.preview) console.log("preview", i.preview, files[0]);
    else console.log("thumb", i.thumb ?? `${p.id}-thumb.webp`);
  }' "$ROOT/web/pages/library.json" | sort -u >"$WORK/list"

missing=0
while read -r kind file from; do
  if [ -f "$WORK/src/$file" ]; then
    cp "$WORK/src/$file" "$WORK/gallery/$file"
  elif [ "$kind" = preview ] && [ -f "$WORK/src/$from" ]; then
    sips -Z 360 -s format png "$WORK/src/$from" --out "$WORK/preview.png" >/dev/null
    cwebp -quiet -q 80 -m 6 "$WORK/preview.png" -o "$WORK/gallery/$file"
  elif [ "$kind" != thumb ]; then
    echo "missing: $file" >&2
    missing=$((missing + 1))
  fi
done <"$WORK/list"
[ "$missing" -eq 0 ] || { echo "$missing picture(s) missing, nothing deployed" >&2; exit 1; }
echo "$(find "$WORK/gallery" -type f | wc -l | tr -d ' ') pictures, $(du -sh "$WORK/gallery" | cut -f1)"

if [ -n "$LOCAL" ]; then
  [ "$SRC" = "$ROOT/web/gallery" ] || { rm -rf "$ROOT/web/gallery"; cp -R "$WORK/gallery" "$ROOT/web/gallery"; }
  echo "web/gallery/ is ready"
  exit 0
fi

# PNG and WebP are compressed already, so a plain tar.
tar -cf "$WORK/gallery.tar" -C "$WORK" gallery
scp -q "$WORK/gallery.tar" lsp:/tmp/drawingkid-gallery.tar
# Unpacked next to the old one, then swapped in, so the site never has half a gallery.
ssh lsp "set -e; cd $REMOTE
  rm -rf gallery.new gallery.old && mkdir gallery.new
  tar -xf /tmp/drawingkid-gallery.tar -C gallery.new --strip-components=1
  [ -d gallery ] && mv gallery gallery.old; mv gallery.new gallery
  rm -rf gallery.old /tmp/drawingkid-gallery.tar
  echo \"lsp: \$(ls gallery | wc -l) pictures in $REMOTE/gallery\""
