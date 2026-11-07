#!/usr/bin/env bash
# Builds build/bundle.tgz: the application bundle that Terraform ships to both VMs through instance metadata.
# Deterministic (sorted, fixed mtime/owner, no gzip timestamp) so `terraform plan` shows no diff unless the code changed.
# Uses python3 so it behaves the same on Linux (Cloud Shell) and macOS (bsdtar has no GNU flags).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
python3 - <<'PY'
import gzip, io, os, tarfile

SKIP_DIRS = {"node_modules"}
SKIP_PREFIX = ("app/test",)
PUBLIC = "app/admin/public"  # shipped separately (admin VM only): its own metadata value keeps both under the 256 KB limit

def keep(path):
    if path.startswith(SKIP_PREFIX) or path.endswith(".log") or path.endswith(".DS_Store"):
        return False
    return not any(p in SKIP_DIRS for p in path.split("/"))

def collect(roots, want):
    paths = []
    for root in roots:
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            rel = d.replace(os.sep, "/")
            if keep(rel) and want(rel):
                paths.append(rel)
            for f in sorted(files):
                p = f"{rel}/{f}"
                if keep(p) and want(p):
                    paths.append(p)
    paths.sort()
    return paths

def write(paths, out_path, strip=""):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for p in paths:
            ti = tar.gettarinfo(p)
            if strip:
                ti.name = p[len(strip):] or "."
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = ""
            ti.mtime = 1577836800  # 2020-01-01
            ti.mode = 0o755 if (ti.isdir() or ti.mode & 0o111) else 0o644
            if ti.isfile():
                with open(p, "rb") as fh:
                    tar.addfile(ti, fh)
            else:
                tar.addfile(ti)
    with open(out_path, "wb") as out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=out, compresslevel=9, mtime=0) as gz:
            gz.write(buf.getvalue())

inpub = lambda p: p == PUBLIC or p.startswith(PUBLIC + "/")
write(collect(["app", "common", "vm-cs2", "vm-admin"], lambda p: not inpub(p)), "build/bundle.tgz")
write(collect([PUBLIC], inpub), "build/public.tgz", strip=PUBLIC + "/")
PY
check() {
  SIZE=$(stat -c %s "$1" 2>/dev/null || stat -f %z "$1")
  HASH=$( (sha256sum "$1" 2>/dev/null || shasum -a 256 "$1") | cut -c1-16)
  echo "$1: $SIZE bytes, sha256 $HASH"
  # Yandex metadata limit: 256 KB per value (base64 grows the file by 4/3)
  if [ $((SIZE * 4 / 3)) -gt 250000 ]; then echo "$1 too large for one metadata value" >&2; exit 1; fi
}
check build/bundle.tgz
check build/public.tgz
