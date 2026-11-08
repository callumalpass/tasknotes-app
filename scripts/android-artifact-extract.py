#!/usr/bin/env python3
"""Extract only the expected signed build or test APK; execute no artifact code."""
import pathlib
import stat
import sys
import zipfile

EXPECTED = {
    "build": {
        "apk/release/app-release.apk": "application.apk",
        "bundle/release/app-release.aab": "application.aab",
    },
    "host": {"app-release-androidTest.apk": "test-host.apk"},
}


def extract(archive, destination, kind):
    expected = EXPECTED[kind]
    destination = pathlib.Path(destination)
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if len(members) != len(expected) or {m.filename for m in members} != set(expected):
            raise ValueError("unexpected-artifact-members")
        if sum(m.file_size for m in members) > 256 * 1024 * 1024:
            raise ValueError("artifact-size-limit")
        for member in members:
            mode = member.external_attr >> 16
            if member.flag_bits & 1 or stat.S_ISLNK(mode) or member.is_dir():
                raise ValueError("unsafe-artifact-member")
            if stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                raise ValueError("unsafe-artifact-mode")
        for member in members:
            data = source.read(member)
            if len(data) != member.file_size:
                raise ValueError("artifact-size-mismatch")
            with (destination / expected[member.filename]).open("xb") as output:
                output.write(data)


if __name__ == "__main__":
    try:
        extract(*sys.argv[1:])
    except Exception:
        # Fixed diagnostics only, no archive-provided filenames or API payloads.
        print("signed-artifact-extraction-refused", file=sys.stderr)
        sys.exit(1)
