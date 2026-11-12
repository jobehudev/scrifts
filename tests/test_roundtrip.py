"""Round-trip tests. These gate everything else in Forge.

Oracles, strongest first:
  1. forge_equals_fontforge  Forge's save == plain FontForge's save, byte for
     byte (minus timestamps), after Forge has read every outline the UI would.
     Proves Forge adds no loss of its own.
  2. model_preserved         original and Forge-saved file load into the same
     FontForge model (glyphs, points, refs, anchors, lookups, kerning, names,
     hints, instructions, bitmap strikes). Proves no data loss vs the source.
  3. text_diff_explained     for current-format (3.x) sources, every text diff
     line falls in a documented, explained category.
  4. fixpoint                save(open(save(x))) == save(x). Known FontForge
     core non-idempotences are xfail(strict) with the reason recorded.
"""
import difflib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from server import FFPYTHON, Worker  # noqa: E402

FIXTURES = Path(os.environ.get("FORGE_SFD_DIR", ROOT / "tests" / "fixtures" / "sfd"))
SFDS = sorted(FIXTURES.glob("*.sfd"))
DUMP = str(ROOT / "tests" / "ffdump.py")

# FontForge core behaviour, reproducible with plain `fontforge` and no Forge
# code involved. Each is an upstream issue, not something Forge may paper over.
CORE_NOT_IDEMPOTENT = {
    "Ambrosia.sfd": "background PNG image re-encoded on every save (Image2 byte count changes)",
    "Caliban.sfd": "first save writes BDFChar orig_pos -1 for bitmaps of dropped glyphs; "
                   "the reader rejects orig<0, so they vanish on the second save (upstream bug)",
    "CaslonMM.sfd": "blend font gains 'space' on second save (see CORE_MODEL_CHANGE)",
    "dvng10a-crash.sfd": "background PNG image re-encoded on every save",
}

# Model-level changes the core makes on open+save, reproducible without Forge.
CORE_MODEL_CHANGE = {
    "CaslonMM.sfd": "multiple master: blend font lacks 'space' that both masters have; the "
                    "core adds it on save (BeginChars 229 -> 230). MM is out of scope for v0",
}

# Every way a FontForge save may legitimately differ from its source, each
# traced to sfd.cpp. Lines are normalised by these before diffing; whatever
# survives is unexplained and fails the test.
DROP = re.compile(
    r"^(SplineFontDB"            # format version, rewritten as 3.2
    r"|CreationTime|ModificationTime"
    r"|WinInfo"                  # FontView window geometry: editor state
    r"|NeedsXUIDChange"          # recomputed from use_xuid && changed (sfd.cpp ~2256)
    r"|InvalidEm"                # always written by 3.x (sfd.cpp ~2223)
    r"):")
POINT = re.compile(r"^( ?[-0-9.e+ ]+ [mlc] )(\d+)(,-?\d+,-?\d+)?(.*)$")
EXPONENT = re.compile(r"e([+-])0+(\d)")


def normalise(line):
    if DROP.match(line):
        return None
    # MinGW printf writes 1e-015 where other builds write 1e-15: same double.
    line = EXPONENT.sub(r"e\1\2", line)
    m = POINT.match(line)
    if m:
        # 0x400 SFD_PTFLAG_FORCE_OPEN_PATH: newer writers mark the last point
        # of an open contour explicitly; older files left it implied.
        # ",ttfindex,nextcpindex" is TrueType point numbering, derived and
        # renumbered by the core. It only carries meaning for glyphs with
        # instructions; text() refuses to drop it from files that have any.
        line = f"{m[1]}{int(m[2]) & ~0x400}{m[4]}"
    if line.startswith("Flags: "):
        # H = changedsincelasthinted (recomputed), O = glyph had an open
        # window (editor state). M/W/I are real data and stay.
        line = "Flags: " + line[7:].replace("H", "").replace("O", "")
    if line.startswith("BDFChar: "):
        # Field 2 is the encoding slot, rewritten from the current map;
        # orig_pos (field 1) is what the reader keys on (sfd.cpp ~5966).
        f = line.split(" ")
        f[2] = "*"
        line = " ".join(f)
    if line.startswith("Layer: "):
        line = " ".join(line.split())  # column spacing only
    if line.startswith("AltUni2: "):
        # Same set, order follows an internal list FontForge reverses on save.
        line = "AltUni2: " + " ".join(sorted(line[9:].split()))
    if line.startswith("BitmapFont: "):
        # Field 2 is the strike's glyph count, recomputed on save.
        f = line.split(" ")
        f[2] = "*"
        line = " ".join(f)
    line = line.rstrip()
    return line or None  # blank lines carry nothing


# Deliberately malformed inputs (parser-robustness fixtures). The core is
# meant to drop their invalid records; a text diff is the expected outcome.
MALFORMED = {
    "SFDBitmapParsing.sfd": "fuzz fixture: out-of-range BDFChar/BDFRefChar records and duplicate "
                            "glyph slots, discarded by the parser by design",
}


@pytest.fixture(scope="module")
def worker():
    w = Worker()
    yield w
    w.close()


def ff(*args):
    r = subprocess.run([FFPYTHON, DUMP, *map(str, args)], capture_output=True,
                       encoding="utf-8", timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
    return r.stdout


def text(p):
    raw = Path(p).read_text("utf-8", "replace")
    lines = [normalise(l) for l in raw.splitlines()]
    if "TtInstrs:" in raw:  # point numbering matters here: compare it raw
        lines = [normalise(l) if not POINT.match(l) else EXPONENT.sub(r"e\1\2", l)
                 for l in raw.splitlines()]
    return [l for l in lines if l is not None]


def diff(a, b):
    return [l for l in difflib.unified_diff(text(a), text(b), lineterm="", n=0)
            if l[:1] in "+-" and l[:3] not in ("+++", "---")]


@pytest.fixture(scope="module")
def saved(worker, tmp_path_factory):
    """Forge-saved copy of every fixture, made once, reused by every oracle."""
    out = tmp_path_factory.mktemp("forge")
    cache = {}

    def get(src):
        if src not in cache:
            info = worker.call("open", path=str(src))
            names = [g["name"] for g in info["glyphs"]]
            worker.call("outlines", names=names)  # everything the grid reads
            for n in names[:50]:
                worker.call("points", name=n)  # what the glyph view reads
            dst = out / src.name
            worker.call("save", path=str(dst))
            cache[src] = dst
        return cache[src]

    return get


def test_fixtures_present():
    assert len(SFDS) >= 20, f"run tests/fetch_fixtures.sh (looked in {FIXTURES})"


@pytest.mark.parametrize("src", SFDS, ids=lambda p: p.name)
def test_forge_equals_fontforge(src, saved, tmp_path):
    base = tmp_path / ("ff_" + src.name)
    ff("resave", src, base)
    assert diff(base, saved(src)) == []


@pytest.mark.parametrize("src", SFDS, ids=lambda p: p.name)
def test_model_preserved(src, saved, request):
    if src.name in CORE_MODEL_CHANGE:
        request.applymarker(pytest.mark.xfail(strict=True, reason=CORE_MODEL_CHANGE[src.name]))
    a, b = json.loads(ff("dump", src)), json.loads(ff("dump", saved(src)))
    assert a["font"] == b["font"]
    assert a["glyphs"].keys() == b["glyphs"].keys()
    bad = [n for n in a["glyphs"] if a["glyphs"][n] != b["glyphs"][n]]
    assert bad == [], f"{len(bad)} glyphs differ, first: {bad[:5]}"


@pytest.mark.parametrize("src", SFDS, ids=lambda p: p.name)
def test_text_diff_explained(src, saved):
    version = Path(src).read_text("utf-8", "replace").split("\n", 1)[0]
    if not version.startswith("SplineFontDB: 3"):
        pytest.skip(f"legacy '{version}': core upgrades the format; model_preserved covers it")
    if src.name in MALFORMED:
        pytest.skip(MALFORMED[src.name])
    assert diff(src, saved(src)) == []


@pytest.mark.parametrize("src", SFDS, ids=lambda p: p.name)
def test_fixpoint(src, saved, tmp_path, request):
    if src.name in CORE_NOT_IDEMPOTENT:
        request.applymarker(pytest.mark.xfail(strict=True, reason=CORE_NOT_IDEMPOTENT[src.name]))
    again = tmp_path / src.name
    ff("resave", saved(src), again)
    assert diff(saved(src), again) == []
