#!/usr/bin/env python3
"""Embeds the radio-side binaries the flasher needs into JS modules (base64), so the page has no fetch of its own.

  py tools/web/embed_bin.py

  tools/debug/updater/updater.bin -> js/radio/updater-bin.js   (UPDATER_BIN)
  tools/backup/dumper/dumper.bin  -> js/radio/dumper-bin.js    (DUMPER_BIN)

Both were built from src/ (updater/updater.c, tools/backup/dumper/dumper.c) and are kept in git; run this after
rebuilding either.
"""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FILES = [
    ('tools/debug/updater/updater.bin', 'js/radio/updater-bin.js', 'UPDATER_BIN',
     'The firmware update program (tools/debug/updater/updater.c), loaded into the radio\'s RAM by its loader.'),
    ('tools/backup/dumper/dumper.bin', 'js/radio/dumper-bin.js', 'DUMPER_BIN',
     'The flash reader (tools/backup/dumper/dumper.c), loaded into the radio\'s RAM by the chip bootloader.'),
]


def wrap(text, width=96):
    return '\n'.join("    '%s' +" % text[i:i + width] for i in range(0, len(text), width))[:-1]


def main():
    for source, target, name, doc in FILES:
        data = (ROOT / source).read_bytes()
        text = base64.b64encode(data).decode('ascii')
        out = (f'// {doc}\n'
               f'// {source}, {len(data)} bytes, base64. Made by tools/web/embed_bin.py: do not edit.\n\n'
               f'export const {name} = (\n{wrap(text)}\n);\n\n'
               f'// The image as bytes\n'
               f'export function {name.lower()}() {{\n'
               f'    const bin = atob({name});\n'
               f'    const out = new Uint8Array(bin.length);\n'
               f'    for (let i = 0; i < bin.length; i++) {{\n'
               f'        out[i] = bin.charCodeAt(i);\n'
               f'    }}\n'
               f'    return out;\n'
               f'}}\n')
        (ROOT / target).write_text(out, encoding='utf-8', newline='\n')
        print(f'{target}: {len(data)} bytes')


if __name__ == '__main__':
    main()
