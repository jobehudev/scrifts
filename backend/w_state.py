"""What the worker is working on. These are rebound while it runs (a font is opened, a request names a font),
so every module reads them through this one: `import w_state as state`, then `state.FONT`."""
import time

# ids start somewhere new in every worker, so one from before a restart never names a font opened after it
NEXT_FID = int(time.time()) % 10**8 * 100
FONTS = {}   # fid -> (font, path): every open is its own handle, so two clients can never read or edit each other's font
FONT = None  # the font the current request addressed (set in worker.main)
PATH = None
FID = None   # the fid the current request addressed
