#!/usr/bin/env python3
import argparse
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'extension' / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']

DISTRO_INCLUDE = [
    'extension', 'tests', 'scripts', 'README.md', 'TESTING.md', 'PRIVACY.md', 'package.json', '.gitignore',
]


def write_distro(archive: zipfile.ZipFile) -> None:
    for item in DISTRO_INCLUDE:
        path = root / item
        sources = sorted(path.rglob('*')) if path.is_dir() else [path]
        for source in sources:
            if source.is_file() and '__pycache__' not in source.parts:
                archive.write(source, Path('jikan-guard') / source.relative_to(root))


def write_store(archive: zipfile.ZipFile) -> None:
    ext = root / 'extension'
    for source in sorted(ext.rglob('*')):
        if source.is_file():
            archive.write(source, source.relative_to(ext))


def main() -> None:
    parser = argparse.ArgumentParser(description='Create jikan-guard ZIP packages.')
    parser.add_argument(
        '--store',
        action='store_true',
        help='Chrome Web Store upload ZIP (extension/ files at archive root)',
    )
    args = parser.parse_args()

    dist = root / 'dist'
    dist.mkdir(exist_ok=True)
    if args.store:
        out = dist / f'jikan-guard-store-v{version}.zip'
        writer = write_store
    else:
        out = dist / f'jikan-guard-v{version}.zip'
        writer = write_distro

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        writer(archive)
    print(out)


if __name__ == '__main__':
    main()
