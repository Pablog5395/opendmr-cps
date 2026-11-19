#!/usr/bin/env python3
"""Makes dist/paquete/OpenDMR-CPS/: the folder to hand to someone, everything inside and nothing to install.

  py tools/web/make_package.py

  OpenDMR-CPS/
    Abrir CPS.bat        double-click: the page in the browser (Chrome or Edge)
    LEEME-PRIMERO.html   the guide (Spanish, then English), formatted
    LEEME-PRIMERO.txt    the same, plain text
    opendmr-cps.html     the whole CPS and the flasher in one file
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

LEEME_TXT = """OpenDMR CPS + Flasher  (OpenDMR 0.6.1 en adelante)
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

LEEME_HTML = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenDMR CPS — cómo empezar</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 18px 56px; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         max-width: 820px; margin-inline: auto; background: #fff; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16181c; color: #e6e6e6; } }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #0002; }
  @media (prefers-color-scheme: dark) { h2 { border-color: #fff2; } }
  p, li { margin: 8px 0; }
  ol, ul { padding-left: 24px; }
  ol.steps > li { margin: 12px 0; }
  code, kbd { font: 0.92em ui-monospace, Consolas, monospace; background: #0001; padding: 1px 6px; border-radius: 5px; }
  @media (prefers-color-scheme: dark) { code, kbd { background: #fff2; } }
  .btn { display: inline-block; padding: 2px 8px; border: 1px solid #0003; border-radius: 7px; font-weight: 600; }
  @media (prefers-color-scheme: dark) { .btn { border-color: #fff3; } }
  .box { border: 1px solid #0002; border-left: 4px solid #2563eb; border-radius: 10px; padding: 12px 16px; margin: 16px 0;
         background: #2563eb0d; }
  .warn { border-left-color: #d97706; background: #d977060f; }
  .bad { border-left-color: #dc2626; background: #dc26260f; }
  @media (prefers-color-scheme: dark) { .box { border-color: #fff2; } }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 15px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #0002; vertical-align: top; }
  @media (prefers-color-scheme: dark) { th, td { border-color: #fff2; } }
  th { font-weight: 600; }
  .muted { opacity: .75; font-size: 14px; }
  .file { font-weight: 600; }
  hr { border: 0; border-top: 1px solid #0002; margin: 40px 0; }
  @media (prefers-color-scheme: dark) { hr { border-color: #fff2; } }
</style>
</head>
<body>

<h1>OpenDMR CPS</h1>
<p class="muted">Para la radio <b>Baofeng DM-32 / DM-32UV</b> con firmware <b>OpenDMR 0.6.1</b> o posterior.<br>
Gratis, no hay que instalar nada.</p>

<div class="box">
  <b>En una frase:</b> es el programa para configurar la radio desde la computadora (canales, contactos, APRS,
  satélites) y, en la pestaña <b>Flasher</b>, actualizar el firmware y hacer las <b>copias de seguridad</b>.
</div>

<h2>1. Abrir la página</h2>
<ol class="steps">
  <li>Descomprimí <b>toda la carpeta</b> (no abras el <code>.html</code> desde adentro del ZIP).</li>
  <li>Doble clic en <span class="file btn">Abrir CPS.bat</span>.<br>
      Si no abre, doble clic en <span class="file">opendmr-cps.html</span> con <b>Chrome</b> o <b>Edge</b>
      (Firefox no sirve: no puede hablar por el cable).</li>
  <li>En la página, arriba a la derecha, apretá <span class="btn">Conectar</span> y elegí el puerto del cable
      (<code>COM…</code>). La radio tiene que estar <b>encendida</b> y con el cable puesto.</li>
</ol>
<p class="muted">Sólo la primera vez: el navegador pide permiso para usar el puerto. Aceptá.</p>

<h2>2. Antes de tocar nada: las tres copias</h2>
<p>Andá a la pestaña <b>Flasher</b> (última de la barra de la izquierda) → tarjeta <b>«Las tres copias»</b>.
Hacé las tres, en este orden:</p>
<table>
  <tr><th>Botón</th><th>Cómo</th><th>Cuánto tarda</th></tr>
  <tr><td><b>Codeplug y ajustes</b></td><td>Radio encendida, conectada.</td><td>segundos</td></tr>
  <tr><td><b>Flash de programa</b></td><td>Apagá la radio → apretá el botón → <b>prendela</b> cuando la página lo pida
      (30 segundos). Pantalla negra y LED apagado es lo correcto.</td><td>≈ 1 minuto</td></tr>
  <tr><td><b>Flash de datos (16 MB)</b></td><td>Igual: apagada, botón, encendida.</td><td>10 minutos o más</td></tr>
</table>
<div class="warn box">
  Guardá las tres en un lugar seguro y anotá el <b>número de serie de la radio</b>. Cada radio tiene su propia
  calibración de fábrica: el backup de una <b>no sirve</b> para otra.
</div>

<h2>3. Actualizar el firmware</h2>
<ol class="steps">
  <li>Bajá <code>opendmr.bin</code> de las releases de OpenDMR:
      <a href="https://github.com/va3bpf/OpenDMR/releases">github.com/va3bpf/OpenDMR/releases</a>
      (es el <code>opendmr.bin</code>, <b>no</b> el que dice BFUV32).</li>
  <li>En <b>Flasher</b> → <b>«Actualización de firmware»</b>: <span class="btn">Elegir firmware…</span> y elegí ese archivo.</li>
  <li>Apretá <span class="btn">Actualizar</span>. La radio se reinicia sola al terminar.</li>
</ol>
<p class="muted">Sólo cambia el área de firmware: el bootloader y la calibración no se tocan. Cada sector se compara
primero, así que si ya está esa versión escribe 0 sectores. <b>No</b> transmite mientras actualiza, y no la apagues
en el medio.</p>

<h2>4. Los programas de la radio</h2>
<p>En la tarjeta <b>«Programas de la radio»</b> están <code>updater.bin</code> y <code>dumper.bin</code>, con un botón
para descargarlos (también van en la carpeta <code>programas\\</code>). Los usa la página sola: cargan en la
<b>memoria</b> de la radio, no se graban en la flash.</p>

<h2>5. Si algo no anda</h2>
<table>
  <tr><th>Qué pasa</th><th>Qué mirar</th></tr>
  <tr><td>No aparece ningún <code>COM…</code></td><td>Driver del cable CH340 (buscá «CH340 driver»), cable bien puesto,
      y usá Chrome o Edge.</td></tr>
  <tr><td>«No conecta» o se corta</td><td>Cerrá el CPS oficial u otro programa que use el puerto; probá otro cable USB.</td></tr>
  <tr><td>Al actualizar dice «no answer»</td><td>La radio tiene que estar <b>encendida</b> y con el firmware de OpenDMR
      (no el original) para el modo por cable.</td></tr>
  <tr><td>La copia de las flash no arranca</td><td>Hay que apagarla y prenderla <b>después</b> de apretar el botón,
      dentro de los 30 segundos.</td></tr>
  <tr><td>El PTT del satélite hace un tono de error</td><td>Falta la configuración APRS con el nombre del satélite
      (<code>ISS</code>) o la posición.</td></tr>
</table>

<div class="bad box">
  <b>Aviso:</b> actualizar el firmware tiene riesgo. Hacé las tres copias primero. Si algo sale mal, la radio se
  recupera con el modo upgrade original (radio apagada, encendida con <b>PTT + SK1</b>) y las copias.
</div>

<hr>

<h2>English</h2>
<ol class="steps">
  <li>Unzip the whole folder, then double-click <span class="file btn">Abrir CPS.bat</span>
      (or open <span class="file">opendmr-cps.html</span> in Chrome or Edge — not Firefox).</li>
  <li>Switch the radio on, plug the programming cable, click <span class="btn">Connect</span> and pick the
      <code>COM…</code> port.</li>
  <li>Before flashing anything, open <b>Flasher</b> and make the three backups (codeplug, program flash, data flash);
      keep them with the radio's serial number: a backup only fits its own radio.</li>
  <li><code>opendmr.bin</code> comes from
      <a href="https://github.com/va3bpf/OpenDMR/releases">github.com/va3bpf/OpenDMR/releases</a> (not the BFUV32 one).</li>
</ol>
<p class="muted">The two radio-side programs (<code>updater.bin</code>, <code>dumper.bin</code>) are in
<code>programas\\</code> and inside the page; they are loaded into the radio's RAM, not the flash.</p>

</body>
</html>
"""


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'programas').mkdir(parents=True)
    shutil.copyfile(ROOT / 'opendmr-cps.html', OUT / 'opendmr-cps.html')
    shutil.copyfile(ROOT / 'assets' / 'updater.bin', OUT / 'programas' / 'updater.bin')
    shutil.copyfile(ROOT / 'assets' / 'dumper.bin', OUT / 'programas' / 'dumper.bin')
    (OUT / 'LEEME-PRIMERO.txt').write_text(LEEME_TXT, encoding='utf-8', newline='\r\n')
    (OUT / 'LEEME-PRIMERO.html').write_text(LEEME_HTML, encoding='utf-8', newline='\r\n')
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
