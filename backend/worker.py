"""Scrifts font worker. Runs under FontForge's bundled Python (ffpython).

All font I/O and the font model go through the `fontforge` module, i.e.
FontForge's own C core. This file must stay a thin RPC shim: no format
parsing, no outline maths. Stdlib only besides fontforge.

Protocol: one JSON object per line.
  request  {"id": n, "op": "...", "args": {...}}
  response {"id": n, "ok": true, "result": ...} | {"id": n, "ok": false, "error": "..."}
"""
import json
import math
import os
import sys

# FontForge's C code may printf to stdout. Keep a private copy of the real
# stdout for the protocol, then point fd 1 at stderr so stray output can
# never corrupt a response line.
_proto = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
os.dup2(2, 1)
sys.stdout = sys.stderr

import w_state as state  # noqa: E402
import w_font  # noqa: E402
import w_edit  # noqa: E402
import w_marks  # noqa: E402
import w_spacing  # noqa: E402
import w_glyphs  # noqa: E402
import w_tools  # noqa: E402
import w_files  # noqa: E402
from w_font import FONT_WIDE, _checkpoint  # noqa: E402

MODULES = (w_font, w_edit, w_marks, w_spacing, w_glyphs, w_tools, w_files)  # the operations live by topic; see each file's first line


OPS = {k[3:]: v for m in MODULES for k, v in vars(m).items() if k.startswith("op_")}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        args = req.get("args", {})
        try:
            if "fid" in args:
                fid = args.pop("fid")
                if fid not in state.FONTS:
                    raise LookupError(f"font {fid} is not open (closed, or the worker restarted)")
                state.FONT, state.PATH = state.FONTS[fid]
                state.FID = fid
                if req["op"] in FONT_WIDE and args.get("apply", True):  # an import that only previews changes nothing
                    _checkpoint(req["op"])
            res = {"id": req["id"], "ok": True,
                   "result": OPS[req["op"]](**args)}
        except Exception as e:  # report, don't die: one bad glyph != dead worker
            res = {"id": req["id"], "ok": False, "error": f"{type(e).__name__}: {e}"}
        _proto.write(json.dumps(res) + "\n")
        _proto.flush()


if __name__ == "__main__":
    main()
