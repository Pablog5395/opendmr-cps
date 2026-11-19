#!/usr/bin/env python3
"""Makes dist/paquete/OpenDMR-CPS/: the folder to hand to someone, everything inside and nothing to install.

  py tools/web/make_package.py

  OpenDMR-CPS/
    Abrir CPS.bat        double-click: the page in the browser (Chrome or Edge)
    opendmr-cps.html     the whole CPS and the flasher in one file
    LEEME-PRIMERO.txt    the short guide (Spanish, then English)
    programas/
      updater.bin        the radio's update program, as the flasher uses it
      dumper.bin         the flash reader

The page works from a disk file: the two programs are also inside it (the same bytes), programas/ is so they can be
seen and kept. The folder is also written as OpenDMR-CPS.zip, one file to send.
"""
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dist' / 'paquete' / 'OpenDMR-CPS'

BAT = """@echo off
rem OpenDMR CPS y flasher: abre la pagina en el navegador (Chrome o Edge)
cd /d "%~dp0"
start "" "opendmr-cps.html"
"""

LEEME = """OpenDMR CPS + Flasher  (OpenDMR 0.6.1 en adelante)
==================================================

Que es
------
El programa de escritorio (en el navegador) para la radio Baofeng DM-32 / DM-32UV con firmware OpenDMR:
canales, zonas, contactos, APRS, satelites, temas, y una pagina Flasher para actualizar el firmware y hacer
las copias de seguridad. Gratis, sin instalar nada.

Como se abre
------------
1. Descomprimi esta carpeta entera (no abrir el .html desde dentro del ZIP).
2. Doble clic en  "Abrir CPS.bat".
   Si el navegador no abre solo, doble clic en  "opendmr-cps.html"  (con Chrome o Edge).
3. Conectar la radio: encendida, con el cable de programacion, y en la pagina apretar "Conectar"
   (arriba) y elegir el puerto del cable (COM...).

Antes de tocar nada
-------------------
En la pagina Flasher, "Las tres copias":
  - Codeplug y ajustes       (radio encendida: segundos)
  - Flash de programa        (apagar la radio y prenderla cuando lo pida)
  - Flash de datos (16 MB)   (igual; tarda 10 minutos o mas)
Guardar las tres en un lugar seguro, con el numero de serie de la radio: sin las dos flash no se puede volver atras.

En "Programas de la radio" estan updater.bin y dumper.bin (los mismos que usa la pagina, en la carpeta programas/).
El firmware opendmr.bin se baja de:  https://github.com/va3bpf/OpenDMR/releases

Aviso
-----
Flashear tiene riesgo. Hacer las copias primero. La calibracion de fabrica de cada radio es solo de esa radio.

--------------------------------------------------

English
-------
Unzip the whole folder, then double-click "Abrir CPS.bat" (or "opendmr-cps.html" in Chrome or Edge).
Connect the radio (on, programming cable) and click "Connect". Before flashing anything, make the three backups
in the Flasher page (codeplug, program flash, data flash) and keep them with the radio's serial number.
opendmr.bin comes from https://github.com/va3bpf/OpenDMR/releases
"""


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'programas').mkdir(parents=True)
    shutil.copyfile(ROOT / 'opendmr-cps.html', OUT / 'opendmr-cps.html')
    shutil.copyfile(ROOT / 'assets' / 'updater.bin', OUT / 'programas' / 'updater.bin')
    shutil.copyfile(ROOT / 'assets' / 'dumper.bin', OUT / 'programas' / 'dumper.bin')
    (OUT / 'LEEME-PRIMERO.txt').write_text(LEEME, encoding='utf-8', newline='\r\n')
    (OUT / 'Abrir CPS.bat').write_text(BAT, encoding='utf-8', newline='\r\n')
    total = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
    print(f'{OUT}: {len(list(OUT.rglob("*")))} entries, {total / 1024:.0f} KB')

    zipped = OUT.parent / 'OpenDMR-CPS.zip'
    with zipfile.ZipFile(zipped, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(OUT.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(OUT.parent))
    print(f'{zipped}: {zipped.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
