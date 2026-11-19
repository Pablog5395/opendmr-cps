#!/usr/bin/env python3
"""Makes dist/web/: the page as a folder, for serving over HTTP (its JS modules do not load from a disk file).

  py tools/web/make_folder.py

  dist/web/index.html      the sources, not the packed page: js/ is loaded as modules
  dist/web/css/, js/       the editor and the flasher
  dist/web/assets/         updater.bin and dumper.bin, the radio-side programs the flasher loads
  dist/web/serve.py        to try it: py serve.py -> http://localhost:8000

The packed single file for opening from disk is opendmr-cps.html (py release.py).
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dist' / 'web'


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    shutil.copyfile(ROOT / 'index.html', OUT / 'index.html')
    shutil.copyfile(ROOT / 'serve.py', OUT / 'serve.py')
    shutil.copytree(ROOT / 'css', OUT / 'css')
    shutil.copytree(ROOT / 'js', OUT / 'js', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(ROOT / 'assets', OUT / 'assets')
    for name in ('README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE'):
        if (ROOT / name).exists():
            shutil.copyfile(ROOT / name, OUT / name)
    total = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
    print(f'{OUT}: {len(list(OUT.rglob("*")))} entries, {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
