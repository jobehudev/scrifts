"""Scrifts backend timings and memory, against a running API on :8765.

  .venv/Scripts/python bench/backend.py <font> [<font> ...]

cold  = worker killed first, so the time includes spawning FontForge's Python
warm  = worker already running
grid  = outlines for the first 60 glyphs (one screen of the grid)
Memory is private bytes of the API process plus the FontForge worker.
"""
import json
import statistics
import subprocess
import sys
import time

import httpx

API = "http://127.0.0.1:8765/api"


def mem_mb():
    """Private MB of every process in the tree under the uvicorn command,
    i.e. API server (and its reloader, if any) plus the FontForge worker."""
    ps = r"""
$all = Get-CimInstance Win32_Process
$tree = @($all | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn*server:app*' })
$i = 0
while ($i -lt $tree.Count) { $tree += @($all | Where-Object { $_.ParentProcessId -eq $tree[$i].ProcessId }); $i++ }
$tree | Sort-Object ProcessId -Unique | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  if ($p) { [pscustomobject]@{name=$_.Name; pid=$_.ProcessId; private=$p.PrivateMemorySize64} } } | ConvertTo-Json
"""
    out = json.loads(subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                                    capture_output=True, text=True).stdout or "[]")
    out = out if isinstance(out, list) else [out]
    total = round(sum(p["private"] for p in out) / 2**20, 1)
    return {"total": total, **{f'{p["name"]}#{p["pid"]}': round(p["private"] / 2**20, 1) for p in out}}


def timed(c, url, body):
    t = time.perf_counter()
    r = c.post(url, json=body, timeout=120)
    r.raise_for_status()
    return (time.perf_counter() - t) * 1000, r.json()


def run(font, runs=3):
    c = httpx.Client()
    res = {"font": font, "cold_open_ms": [], "warm_open_ms": [], "grid_ms": []}
    for _ in range(runs):
        c.post(f"{API}/cancel")
        time.sleep(0.3)
        ms, info = timed(c, f"{API}/open", {"path": font})
        res["cold_open_ms"].append(ms)
        ms, _ = timed(c, f"{API}/open", {"path": font})
        res["warm_open_ms"].append(ms)
        names = [g["name"] for g in info["glyphs"][:60]]
        ms, _ = timed(c, f"{API}/outlines", {"names": names})
        res["grid_ms"].append(ms)
    res["glyphs"] = len(info["glyphs"])
    res["memory_private_mb"] = mem_mb()
    for k in ("cold_open_ms", "warm_open_ms", "grid_ms"):
        res[k] = round(statistics.median(res[k]))
    return res


if __name__ == "__main__":
    # one font per process start gives clean memory numbers; see bench/README.md
    for f in sys.argv[1:]:
        print(json.dumps(run(f)))
