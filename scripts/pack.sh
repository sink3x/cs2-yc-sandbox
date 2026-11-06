#!/usr/bin/env bash
# Builds build/bundle.tgz: the application bundle that Terraform ships to both VMs through instance metadata.
# Deterministic (sorted, fixed mtime/owner, no gzip timestamp) so `terraform plan` shows no diff unless the code changed.
# Uses python3 so it behaves the same on Linux (Cloud Shell) and macOS (bsdtar has no GNU flags).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
python3 - <<'PY'
import gzip, io, os, tarfile

ROOTS = ["app", "common", "vm-cs2", "vm-admin"]
SKIP_DIRS = {"node_modules"}
SKIP_PREFIX = ("app/test",)

def keep(path):
    if path.startswith(SKIP_PREFIX) or path.endswith(".log") or path.endswith(".DS_Store"):
        return False
    return not any(p in SKIP_DIRS for p in path.split("/"))

paths = []
for root in ROOTS:
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
        rel = d.replace(os.sep, "/")
        if keep(rel):
            paths.append(rel)
        for f in sorted(files):
            p = f"{rel}/{f}"
            if keep(p):
                paths.append(p)
paths.sort()

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tar:
    for p in paths:
        ti = tar.gettarinfo(p)
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = ""
        ti.mtime = 1577836800  # 2020-01-01
        ti.mode = 0o755 if (ti.isdir() or ti.mode & 0o111) else 0o644
        if ti.isfile():
            with open(p, "rb") as fh:
                tar.addfile(ti, fh)
        else:
            tar.addfile(ti)

with open("build/bundle.tgz", "wb") as out:
    with gzip.GzipFile(filename="", mode="wb", fileobj=out, compresslevel=9, mtime=0) as gz:
        gz.write(buf.getvalue())
PY
SIZE=$(stat -c %s build/bundle.tgz 2>/dev/null || stat -f %z build/bundle.tgz)
HASH=$( (sha256sum build/bundle.tgz 2>/dev/null || shasum -a 256 build/bundle.tgz) | cut -c1-16)
echo "build/bundle.tgz: $SIZE bytes, sha256 $HASH"
# Yandex metadata limit: 256 KB per value (base64 grows the file by 4/3)
if [ $((SIZE * 4 / 3)) -gt 250000 ]; then echo "bundle too large for one metadata value" >&2; exit 1; fi
