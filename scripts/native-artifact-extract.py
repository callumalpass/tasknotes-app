"""Reviewed data-only ZIP extraction. No artifact hooks or project execution."""
import os
import stat
import sys
import zipfile
from pathlib import Path

archive, output = sys.argv[1:]
root = Path(output)
root.mkdir(mode=0o700)
seen = set()
total = 0
with zipfile.ZipFile(archive) as bundle:
    if len(bundle.infolist()) > 20001:
        raise ValueError("artifact entry limit")
    for entry in bundle.infolist():
        name = entry.filename.rstrip("/")
        parts = name.split("/")
        if (not name or any(p in ("", ".", "..") or not all(c.isascii() and (c.isalnum() or c in "._~-") for c in p) for p in parts)
                or name.lower() in seen or (name != "receipt.json" and parts[0] != "dist")):
            raise ValueError("unsafe/extra/duplicate artifact path")
        seen.add(name.lower())
        mode = entry.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (entry.is_dir() and kind == stat.S_IFREG):
            raise ValueError("artifact link/nonregular file")
        if entry.file_size > 128 * 1024 * 1024:
            raise ValueError("artifact member size limit")
        total += entry.file_size
        if total > 512 * 1024 * 1024:
            raise ValueError("artifact total size limit")
        dest = root.joinpath(*parts)
        if entry.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(entry) as source, dest.open("xb") as target:
                count = 0
                while chunk := source.read(65536):
                    count += len(chunk)
                    if count > entry.file_size:
                        raise ValueError("artifact streamed size limit")
                    target.write(chunk)
                if count != entry.file_size:
                    raise ValueError("artifact member length mismatch")
            dest.chmod(0o444)
if not (root / "receipt.json").is_file() or not (root / "dist").is_dir():
    raise ValueError("missing receipt/dist")
for directory, _, _ in os.walk(root, topdown=False):
    Path(directory).chmod(0o555)
