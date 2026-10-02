#!/usr/bin/env python3
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parent.parent
out = root / 'dist' / 'jikan-guard-v0.1.0.zip'
out.parent.mkdir(exist_ok=True)
include = ['extension', 'tests', 'scripts', 'README.md', 'TESTING.md', 'PRIVACY.md', 'package.json', '.gitignore']
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for item in include:
        path = root / item
        for source in sorted(path.rglob('*')) if path.is_dir() else [path]:
            if source.is_file() and '__pycache__' not in source.parts:
                archive.write(source, Path('jikan-guard') / source.relative_to(root))
print(out)
