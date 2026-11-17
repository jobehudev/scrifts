"""Build the Windows installer: the backend frozen with PyInstaller (FontForge's own runtime inside it),
the frontend built, then Tauri's NSIS installer around both.

    .venv/Scripts/python packaging/build.py

FontForge is taken from its Windows install (FONTFORGE_DIR, default C:\Program Files\FontForgeBuilds).
The installer ends up in src-tauri/target/release/bundle/nsis/."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FF = Path(os.environ.get("FONTFORGE_DIR", r"C:\Program Files\FontForgeBuilds"))
OUT = ROOT / "packaging" / "out"
SEP = os.pathsep


def run(*cmd, cwd=ROOT):
    print("+", " ".join(map(str, cmd)), flush=True)
    subprocess.run([str(c) for c in cmd], cwd=cwd, check=True, shell=os.name == "nt" and cmd[0] in ("npm", "npx"))


def main():
    if not (FF / "bin" / "ffpython.exe").exists():
        sys.exit(f"FontForge not found in {FF}; set FONTFORGE_DIR")
    run(sys.executable, ROOT / "packaging" / "installer_art.py")
    run("npm", "run", "build", cwd=ROOT / "frontend")
    shutil.rmtree(OUT, ignore_errors=True)
    data = [
        (ROOT / "frontend" / "dist", "frontend/dist"),
        (ROOT / "plugins", "plugins"),
        (FF, "FontForgeBuilds"),
        (ROOT / "backend" / "Scrifts Sample.sfd", "backend"),  # copied by op_make_sample
    ] + [(p, "backend") for p in (ROOT / "backend").glob("*.py")]
    args = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed",
            "--name", "forge-backend", "--distpath", OUT / "dist", "--workpath", OUT / "build", "--specpath", OUT,
            "--paths", ROOT / "backend",
            "--collect-submodules", "uvicorn", "--collect-data", "glyphsLib", "--collect-submodules", "glyphsLib",
            "--hidden-import", "glyphs_io", "--hidden-import", "snapshots", "--hidden-import", "plugins",
            "--hidden-import", "sheet", "--hidden-import", "tracing", "--hidden-import", "artboards",
            "--hidden-import", "style_linking", "--hidden-import", "strokes", "--hidden-import", "metrics_keys",
            "--hidden-import", "smart_components"]
    for src, dest in data:
        args += ["--add-data", f"{src}{SEP}{dest}"]
    run(*args, ROOT / "backend" / "server.py")
    # Keep the builder's home folder and user name out of the binary: remap source paths, and with the MSVC
    # toolchain also replace the PDB path (the GNU toolchain has no PDB and would reject that linker flag).
    host = subprocess.run(["rustc", "-vV"], capture_output=True, text=True).stdout
    pdb = " -C link-arg=/PDBALTPATH:%_PDB%" if "msvc" in host else ""
    os.environ["RUSTFLAGS"] = (os.environ.get("RUSTFLAGS", "") + f" --remap-path-prefix={ROOT}=src"
                               f" --remap-path-prefix={Path.home()}=~" + pdb).strip()
    run(ROOT / "frontend" / "node_modules" / ".bin" / "tauri.cmd", "build")


if __name__ == "__main__":
    main()
