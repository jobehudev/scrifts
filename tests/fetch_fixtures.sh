#!/bin/sh
# Real-world .sfd fixtures from FontForge's own test suite (not vendored).
set -e
cd "$(dirname "$0")"
[ -d fixtures/ff-src ] || git clone -q --depth 1 --filter=blob:none --sparse \
  https://github.com/fontforge/fontforge.git fixtures/ff-src
git -C fixtures/ff-src sparse-checkout set tests/fonts
mkdir -p fixtures/sfd
cp fixtures/ff-src/tests/fonts/*.sfd fixtures/sfd/

# Glyphs (.glyphs) sources from glyphsLib's own tests (Apache-2.0) and one OFL font, for the Glyphs import tests.
mkdir -p fixtures/glyphs
B=https://raw.githubusercontent.com/googlefonts/glyphsLib/main/tests/data
for f in GlyphsUnitTestSans.glyphs GlyphsUnitTestSans3.glyphs MontserratStrippedDown.glyphs; do
  [ -f "fixtures/glyphs/$f" ] || curl -sfL -o "fixtures/glyphs/$f" "$B/$f"
done
[ -f fixtures/glyphs/Oi.glyphs ] || curl -sfL -o fixtures/glyphs/Oi.glyphs "$B/gf/Oi.glyphs"
[ -f fixtures/glyphs/OFL.txt ] || curl -sfL -o fixtures/glyphs/OFL.txt "$B/gf/OFL.txt"
