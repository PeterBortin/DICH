#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ЗЛІПОК one · build_one.py — один index.html до 25 МБ, усе всередині.

Кожна бібліотека і модель кладуться як base64(gzip(...)) у text/plain-блоки;
завантажувач розпаковує їх через fflate (він єдиний лежить сирим) і стартує
app-модуль. Зовнішніх запитів у рантаймі немає.

Вжиток:
    python3 build_one.py model.onnx [index.html] [--limit МБ]
"""
import sys, base64, gzip, hashlib, pathlib, re, argparse

HERE = pathlib.Path(__file__).parent
V = HERE / 'vendor_src'
PARTS = ['s_head.html', 's_core.html', 's_worker.html', 's_app.html']

# (id, шлях, стискати?)
LIBS = [
    ('lib-fflate',     V / 'fflate/index.js', False),
    ('lib-three-core', V / 'three/three.core.min.js', True),
    ('lib-three',      V / 'three/three.module.min.js', True),
    ('lib-orbit',      V / 'three/addons/controls/OrbitControls.js', True),
    ('lib-gltf',       V / 'three/addons/exporters/GLTFExporter.js', True),
    ('lib-ortjs',      V / 'ort/ort.min.js', True),
    ('lib-ortmjs',     V / 'ort/ort-wasm-simd-threaded.mjs', True),
    ('bin-ortwasm',    V / 'ort/ort-wasm-simd-threaded.wasm', True),
]

def enc(data: bytes, compress: bool) -> str:
    return base64.b64encode(gzip.compress(data, 9) if compress else data).decode('ascii')

def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('onnx'); ap.add_argument('out', nargs='?', default='index.html')
    ap.add_argument('--limit', type=float, default=25.0, help='ліміт розміру у МБ (дефолт 25)')
    if len(sys.argv) < 2:
        print(__doc__); return 1
    a = ap.parse_args()

    for p in PARTS:
        if not (HERE / p).is_file():
            raise SystemExit(f'ПОМИЛКА: нема частини {p}')
    for _i, p, _c in LIBS:
        if not p.is_file():
            raise SystemExit(f'ПОМИЛКА: нема вендор-файла {p}')

    html = ''.join((HERE / p).read_text(encoding='utf-8') for p in PARTS)

    # app-модуль вирізаємо у payload
    i = html.find('<script type="module">')
    if i < 0:
        raise SystemExit('ПОМИЛКА: не знайшов app-модуль')
    j = html.find('</script>', i)
    app_code = html[html.find('>', i) + 1: j]
    html = html[:i] + '__LOADER_SLOT__' + html[j + len('</script>'):]

    blocks = [f'<script type="text/plain" id="{bid}">{enc(p.read_bytes(), c)}</script>'
              for bid, p, c in LIBS]
    blocks.append(f'<script type="text/plain" id="app-module">{enc(app_code.encode("utf-8"), True)}</script>')

    loader = (HERE / 'loader_one.js').read_text(encoding='utf-8')
    if '</script' in loader:
        raise SystemExit('ПОМИЛКА: у loader_one.js є </script')
    html = html.replace('__LOADER_SLOT__',
                        '\n'.join(blocks) + '\n<script>\n' + loader + '\n</script>')

    # модель — теж gzip+b64, у той самий блок model-weights
    onnx = onnx_bytes = pathlib.Path(a.onnx).read_bytes()
    if not onnx or onnx[0] != 0x08:
        print('УВАГА: модель не схожа на ONNX-protobuf')
    sha = hashlib.sha256(onnx).hexdigest()
    gz = gzip.compress(onnx, 9)
    html = (html.replace('__MODEL_B64__', base64.b64encode(gz).decode('ascii'))
                .replace('__MODEL_SHA__', sha)
                .replace('__MODEL_NAME__', pathlib.Path(a.onnx).name)
                .replace('__MODEL_GZ__', 'true'))

    # верифікація
    errs = []
    ext = sorted(set(re.findall(r'https?://[A-Za-z0-9.-]+', html)))
    for u in ext:
        if u not in ('http://www.w3.org',):
            errs.append('зовнішній URL: ' + u)
    n_open, n_close = len(re.findall(r'<script\b', html)), html.count('</script>')
    if n_open != n_close:
        errs.append(f'дисбаланс script: {n_open}/{n_close}')
    for ph in ('__MODEL_B64__', '__MODEL_SHA__', '__MODEL_NAME__', '__MODEL_GZ__', '__LOADER_SLOT__'):
        if ph in html:
            errs.append('лишився плейсхолдер ' + ph)
    if 'importmap' in html:
        errs.append('лишився importmap')
    size = len(html.encode('utf-8'))
    if size > a.limit * 1_000_000:
        errs.append(f'РОЗМІР {size/1e6:.2f} МБ > ліміту {a.limit} МБ')
    if errs:
        for e in errs:
            print('  ✗ ' + e)
        raise SystemExit('ЗБІРКА НЕВАЛІДНА')

    out = pathlib.Path(a.out)
    out.write_text(html, encoding='utf-8')
    print(f'OK: {out} · {size/1e6:.2f} МБ ({size/1048576:.2f} МіБ) · ліміт {a.limit} МБ')
    print(f'  модель : {pathlib.Path(a.onnx).name} · {len(onnx)/1048576:.2f} МіБ → gz {len(gz)/1048576:.2f} МіБ · sha {sha[:16]}…')
    print(f'  вшито  : {len(LIBS)} бібліотек + app + модель')
    print(f'  запас  : {(a.limit*1_000_000 - size)/1e6:.2f} МБ')
    return 0

if __name__ == '__main__':
    sys.exit(main())
