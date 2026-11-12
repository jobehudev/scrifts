"""Canonical JSON dump of a font as FontForge's core sees it. Runs under ffpython.

  ffpython ffdump.py dump <font>            -> JSON model on stdout
  ffpython ffdump.py resave <in> <out>      -> plain FontForge open+save (baseline)

The dump is the oracle for "no data loss": two files are equivalent if
FontForge loads them into the same model.
"""
import json
import os
import sys

_out = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)
import fontforge  # noqa: E402


def r(v):
    return round(v, 4) if isinstance(v, float) else v


def layer(l):
    return [[(r(p.x), r(p.y), p.on_curve) for p in c] + [c.closed] for c in l]


def glyph(g):
    d = {
        "unicode": g.unicode,
        "altuni": sorted(g.altuni or []),
        "width": g.width,
        "vwidth": g.vwidth,
        "layers": {str(i): layer(g.layers[i]) for i in range(g.layer_cnt)},
        "refs": [(n, tuple(map(r, t))) for n, t, *_ in g.references],
        "anchors": sorted(map(str, g.anchorPoints)),
        "possub": sorted(map(str, g.getPosSub("*"))),
        "comment": g.comment,
        "color": g.color,
        "glyphclass": g.glyphclass,
        "unlinkRmOvrlpSave": g.unlinkRmOvrlpSave,
        "hhints": [tuple(map(r, h)) for h in g.hhints],
        "vhints": [tuple(map(r, h)) for h in g.vhints],
        "ttinstrs": len(g.ttinstrs or b""),
        "lcarets": list(g.lcarets or ()),
        "tex": [g.texheight, g.texdepth],
        "italic": [g.italicCorrection, g.topaccent],
        "math": [g.isExtendedShape],
    }
    return d


def font_attrs(f):
    keys = ["fontname", "familyname", "fullname", "weight", "copyright", "version",
            "em", "ascent", "descent", "italicangle", "upos", "uwidth", "encoding",
            "is_quadratic", "is_cid", "sfnt_names", "os2_version", "os2_weight",
            "os2_width", "os2_fstype", "os2_panose", "os2_vendor",
            "os2_winascent", "os2_windescent", "os2_typoascent", "os2_typodescent",
            "os2_typolinegap", "hhea_ascent", "hhea_descent", "hhea_linegap",
            "comment", "fontlog", "uniqueid", "xuid", "layer_cnt",
            "private", "gasp", "gsub_lookups", "gpos_lookups", "markClasses",
            "cidregistry", "cidordering", "cidsupplement"]
    out = {}
    for k in keys:
        try:
            v = getattr(f, k)
        except Exception as e:
            v = f"<{type(e).__name__}>"
        if k == "private":
            v = sorted((n, str(v[n])) for n in v) if v is not None else None
        out[k] = v if isinstance(v, (int, float, str, type(None))) else repr(v)
    out["lookups"] = {lk: repr(f.getLookupInfo(lk))
                      for lk in (f.gsub_lookups + f.gpos_lookups)}
    out["subtables"] = {lk: list(f.getLookupSubtables(lk))
                        for lk in (f.gsub_lookups + f.gpos_lookups)}
    out["kernclasses"] = {st: repr(f.getKerningClass(st))
                          for subs in out["subtables"].values() for st in subs
                          if f.isKerningClass(st)}
    out["bitmapSizes"] = list(f.bitmapSizes)
    return out


def dump(path):
    f = fontforge.open(path, ("hidewindow", "alltables"))
    model = {"font": font_attrs(f),
             "glyphs": {g.glyphname: glyph(g) for g in f.glyphs()}}
    f.close()
    return model


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "dump":
        _out.write(json.dumps(dump(sys.argv[2]), sort_keys=True, default=repr))
    elif cmd == "resave":
        f = fontforge.open(sys.argv[2], ("hidewindow", "alltables"))
        f.save(sys.argv[3])
        f.close()
    _out.flush()
