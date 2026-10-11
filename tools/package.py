"""Build/verify the install ZIP using only the Python standard library."""
from pathlib import Path
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'module.json').read_text())
PACKAGE = json.loads((ROOT / 'package.json').read_text())
assert MANIFEST['version'] == PACKAGE['version'], 'module.json/package.json version mismatch'
ARCHIVE = ROOT / 'dist' / 'grimnir-lyonesse.zip'
FILES = [ROOT / name for name in ['module.json', 'README-RU.md', 'AUTOMATION.html']]
for folder in ['scripts', 'packs', 'data']:
    FILES.extend(p for p in (ROOT / folder).rglob('*') if p.is_file() and p.name != 'LOCK')
FILES.sort()
EXPECTED = {f"{MANIFEST['id']}/{p.relative_to(ROOT).as_posix()}": p.read_bytes() for p in FILES}

if '--check' not in sys.argv:
    ARCHIVE.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(ARCHIVE, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in EXPECTED.items():
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, data)
with zipfile.ZipFile(ARCHIVE) as z:
    assert z.testzip() is None, 'Corrupt ZIP'
    assert set(z.namelist()) == set(EXPECTED), 'Archive file list differs from module files'
    for name, data in EXPECTED.items():
        assert z.read(name) == data, f'Stale archive member: {name}'
print(f'ZIP verified: {len(EXPECTED)} files, version {MANIFEST["version"]}')
