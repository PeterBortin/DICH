// Харнес ядра single-photo пайплайна. Аналітична сцена з відомою
// геометрією → перевірка розгортки, меша, відсікань, UV і PLY.
'use strict';
const fs = require('fs');
const src = fs.readFileSync('s_core.html', 'utf8');
const a = src.indexOf('/*__CORE_BEGIN__*/'), b = src.indexOf('/*__CORE_END__*/');
if (a < 0 || b < 0) throw new Error('маркери ядра не знайдені');
fs.writeFileSync('h_one.cjs', src.slice(a, b + 16) + '\nmodule.exports = ZL;');
const Z = require('./h_one.cjs');

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n + (x ? ' — ' + x : '')); }
  else { fail++; console.log('  ✗ FAIL: ' + n + (x ? ' — ' + x : '')); } };
const near = (p, q, e) => Math.abs(p - q) <= e;

// ── Аналітична сцена: підлога y=-1.2, стіна z=-6, куб перед стіною ──
const BOX = { c: [-0.3, -0.6, -2.6], h: [0.5, 0.6, 0.5] };
function sceneDepth(intr, w, h) {
  const z = new Float32Array(w * h);
  const kind = new Uint8Array(w * h);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const r = Z.rayAt(intr, u + 0.5, v + 0.5);
    const l = Math.hypot(r[0], r[1], r[2]);
    const d = [r[0]/l, r[1]/l, r[2]/l];
    let t = Infinity, k = 0;
    if (d[1] < -1e-9) { const tt = -1.2 / d[1]; if (tt > 0 && tt < t) { t = tt; k = 1; } }
    if (d[2] < -1e-9) { const tt = -6.0 / d[2]; if (tt > 0 && tt < t) { t = tt; k = 2; } }
    let t0 = -Infinity, t1 = Infinity;
    for (let ax = 0; ax < 3; ax++) {
      const lo = BOX.c[ax] - BOX.h[ax], hi = BOX.c[ax] + BOX.h[ax];
      if (Math.abs(d[ax]) < 1e-12) { if (0 < lo || 0 > hi) { t0 = Infinity; break; } continue; }
      let ta = lo / d[ax], tb = hi / d[ax];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    }
    if (t0 !== Infinity && t0 <= t1 && t0 > 0 && t0 < t) { t = t0; k = 3; }
    const i = v * w + u;
    z[i] = t === Infinity ? 0 : t * (-d[2]);   // глибина вздовж оптичної осі
    kind[i] = k;
  }
  return { z, kind };
}
const onSurface = (x, y, zc) => {
  const dFloor = Math.abs(y + 1.2);
  const dWall = Math.abs(zc + 6.0);
  const q = [Math.abs(x - BOX.c[0]) - BOX.h[0], Math.abs(y - BOX.c[1]) - BOX.h[1], Math.abs(zc - BOX.c[2]) - BOX.h[2]];
  const dBox = Math.abs(Math.max(q[0], q[1], q[2]));
  return Math.min(dFloor, dWall, dBox);
};

const W = 260, H = 260;
const intr = Z.intrForShot(62, 4, 3, W, H);

console.log('\n[1] Інтринсики з кута зору');
{
  ok(near(intr.fovY, 62, 1e-9), 'fovY зберігається');
  ok(intr.fovX > intr.fovY, 'для 4:3 горизонтальний кут ширший', intr.fovX.toFixed(1) + '° vs 62°');
  const sq = Z.intrForShot(62, 1, 1, W, H);
  ok(near(sq.fx, sq.fy, 1e-6), 'для квадратного фото fx = fy');
  const wide = Z.intrForShot(90, 4, 3, W, H);
  ok(wide.fx < intr.fx, 'ширший кут → менша фокусна', wide.fx.toFixed(1) + ' < ' + intr.fx.toFixed(1));
  // центр кадру дивиться строго вперед
  const r = Z.rayAt(intr, intr.cx, intr.cy);
  ok(near(r[0], 0, 1e-9) && near(r[1], 0, 1e-9) && r[2] === -1, 'центральний піксель → вісь -Z');
}

console.log('\n[2] Диспаритет → нормалізована глибина (афінна невизначеність)');
{
  const { z: zt } = sceneDepth(intr, W, H);
  const rel = new Float32Array(W * H);
  for (let i = 0; i < rel.length; i++) rel[i] = zt[i] > 0 ? 3.7 * (1 / zt[i]) + 0.9 : 0.9;
  const d = Z.disparityToDepth(rel, {});
  const srt = [...d.z].sort((p, q) => p - q);
  ok(near(srt[srt.length >> 1], 1, 1e-3), 'медіана глибини = 1.0 (безрозмірна сцена)', srt[srt.length >> 1].toFixed(4));
  ok(d.z.every(v => v > 0 && Number.isFinite(v)), 'усі глибини додатні й фінітні');
  // ГОЛОВНИЙ інваріант: порядок глибин зберігається ТОЧНО
  let inv = 0;
  for (let k = 0; k < 4000; k++) {
    const i = (Math.random() * rel.length) | 0, j = (Math.random() * rel.length) | 0;
    if (zt[i] <= 0 || zt[j] <= 0 || i === j) continue;
    if (Math.sign(zt[i] - zt[j]) !== Math.sign(d.z[i] - d.z[j])) inv++;
  }
  ok(inv === 0, 'порядок глибин збережено точно (0 інверсій на 4000 пар)', String(inv));
  // діапазон не роздувається: реципрок недооцінює, min-max роздував у 17×
  let iN = 0, iF = 0, zn = Infinity, zf = 0;
  for (let i = 0; i < zt.length; i++) { if (zt[i] > 0 && zt[i] < zn) { zn = zt[i]; iN = i; } if (zt[i] > zf) { zf = zt[i]; iF = i; } }
  const rTrue = zf / zn, rGot = d.z[iF] / d.z[iN];
  ok(rGot > 1.4 && rGot < rTrue * 1.3, 'відношення дальнє/близьке в межах розумного (не ∞)',
    rGot.toFixed(2) + ' проти істини ' + rTrue.toFixed(2));
  // «глибина фону» мусить монотонно розтягувати діапазон до істини і далі
  const rs = [0, 0.3, 0.6, 0.9].map(sh => {
    const dd = Z.disparityToDepth(rel, { shift: sh });
    return dd.z[iF] / dd.z[iN];
  });
  ok(rs.every((v, i) => i === 0 || v > rs[i-1]), 'shift монотонно розтягує фон', rs.map(v => v.toFixed(1)).join(' → '));
  ok(rs.some((v, i) => i > 0 && Math.abs(v - rTrue) / rTrue < 0.25),
    'існує shift, що відтворює істинний діапазон у межах 25%', 'істина ' + rTrue.toFixed(2));
  ok(Z.disparityToDepth(rel, { shift: 5 }).z.every(v => Number.isFinite(v) && v > 0),
    'позамежний shift не дає NaN/нуля (кліпується)');
}

console.log('\n[3] Розгортка: точки лягають на аналітичні поверхні');
const { z: ztrue, kind } = sceneDepth(intr, W, H);
{
  const p = Z.pointsFromDepth({ z: ztrue, dw: W, dh: H, intr, stride: 1 });
  ok(p.count > W * H * 0.9, 'майже всі пікселі дали точки', p.count + ' з ' + W * H);
  let worst = 0, sum = 0;
  for (let i = 0; i < p.count; i++) {
    const e = onSurface(p.positions[i*3], p.positions[i*3+1], p.positions[i*3+2]);
    sum += e; if (e > worst) worst = e;
  }
  ok(worst < 1e-4, 'максимальна відстань до поверхні ~0', worst.toExponential(2));
  ok(sum / p.count < 1e-5, 'середня відстань ~0', (sum / p.count).toExponential(2));
  // усі точки перед камерою
  let front = true;
  for (let i = 0; i < p.count; i++) if (p.positions[i*3+2] >= 0) front = false;
  ok(front, 'усі точки мають z < 0 (перед камерою)');
}

console.log('\n[4] UV: відповідність пікселя і текстурної координати');
{
  const p = Z.pointsFromDepth({ z: ztrue, dw: W, dh: H, intr, stride: 1 });
  // перша точка — лівий верхній валідний піксель: u≈0, v≈1
  ok(p.uvs[0] < 0.02 && p.uvs[1] > 0.98, 'перший піксель → UV (≈0, ≈1) — верх зображення',
    `(${p.uvs[0].toFixed(3)}, ${p.uvs[1].toFixed(3)})`);
  const last = p.count - 1;
  ok(p.uvs[last*2] > 0.98 && p.uvs[last*2+1] < 0.02, 'останній піксель → UV (≈1, ≈0)');
  // колір із фейкової текстури мусить збігатись із пікселем
  const tw = 8, th = 8, rgba = new Uint8Array(tw*th*4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const s = (y*tw+x)*4; rgba[s] = x*30; rgba[s+1] = y*30; rgba[s+2] = 7; rgba[s+3] = 255;
  }
  const uv = new Float32Array([0.5/tw, 1 - 0.5/th, (tw-0.5)/tw, 1 - (th-0.5)/th]);
  const col = Z.colorsForUV(uv, 2, rgba, tw, th);
  ok(col[0] === 0 && col[1] === 0, 'UV(0,1) → піксель (0,0) текстури');
  ok(col[3] === 7*30 && col[4] === 7*30, 'UV(1,0) → піксель (7,7) текстури', col[3] + ',' + col[4]);
}

console.log('\n[5] Сітковий меш і відсікання силуетів');
{
  const m = Z.buildGridMesh({ z: ztrue, dw: W, dh: H, intr, stride: 2, edgeTol: 0.06, grazeCos: 0.06 });
  ok(m.tris > 5000, 'меш нетривіальний', m.tris + ' трикутників з ' + m.verts + ' вершин');
  ok(m.culledEdge > 100, 'силуети куба відсічено', m.culledEdge + ' трикутників');
  // вершини, що входять у трикутники, мусять лежати на поверхнях
  let worst = 0;
  for (let i = 0; i < m.indices.length; i++) {
    const v = m.indices[i];
    worst = Math.max(worst, onSurface(m.positions[v*3], m.positions[v*3+1], m.positions[v*3+2]));
  }
  ok(worst < 1e-4, 'усі вершини меша на аналітичних поверхнях', worst.toExponential(2));
  // жодного трикутника, що «зшиває» куб зі стіною (перепад ~3.4 у глибині)
  let bridges = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const zs = [0,1,2].map(k => -m.positions[m.indices[i+k]*3+2]);
    const lo = Math.min(...zs), hi = Math.max(...zs);
    if ((hi - lo) / lo > 0.061) bridges++;
  }
  ok(bridges === 0, 'жодного трикутника через розрив глибини', String(bridges));
  // жорсткіший поріг має відсікати більше
  const m2 = Z.buildGridMesh({ z: ztrue, dw: W, dh: H, intr, stride: 2, edgeTol: 0.02, grazeCos: 0.06 });
  ok(m2.culledEdge > m.culledEdge && m2.tris < m.tris, 'менший edgeTol → більше відсічень',
    `${m.culledEdge}→${m2.culledEdge}`);
  // крок сітки
  const m3 = Z.buildGridMesh({ z: ztrue, dw: W, dh: H, intr, stride: 4, edgeTol: 0.06, grazeCos: 0.06 });
  ok(m3.verts < m.verts / 3.5, 'крок 4 дає ~вчетверо менше вершин', m3.verts + ' vs ' + m.verts);
  ok(m.indices instanceof Uint32Array || m.verts <= 65535, 'тип індексів відповідає кількості вершин');
}

console.log('\n[6] Нормали та орієнтація трикутників');
{
  const m = Z.buildGridMesh({ z: ztrue, dw: W, dh: H, intr, stride: 2, edgeTol: 0.06, grazeCos: 0.06 });
  const n = Z.vertexNormals(m.positions, m.indices);
  let unit = true;
  for (let i = 0; i < m.indices.length; i++) {
    const v = m.indices[i] * 3;
    if (Math.abs(Math.hypot(n[v], n[v+1], n[v+2]) - 1) > 1e-5) unit = false;
  }
  ok(unit, 'усі задіяні нормалі одиничні');
  // нормалі мусять дивитись у бік камери (камера в нулі, поверхні перед нею)
  let toward = 0, total = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const v = m.indices[i] * 3;
    const px = m.positions[v], py = m.positions[v+1], pz = m.positions[v+2];
    const l = Math.hypot(px, py, pz) || 1;
    if (-(px/l)*n[v] - (py/l)*n[v+1] - (pz/l)*n[v+2] > 0) toward++;
    total++;
  }
  ok(toward / total > 0.9, 'нормалі спрямовані до камери (обхід CCW правильний)',
    (100*toward/total).toFixed(1) + '%');
  // стінові вершини мусять мати нормаль ≈ +Z
  let wallOk = 0, wallN = 0;
  for (let gi = 0; gi < m.verts; gi++) {
    if (Math.abs(-m.positions[gi*3+2] - 6) < 0.02 && Math.hypot(n[gi*3], n[gi*3+1], n[gi*3+2]) > 0.5) {
      wallN++; if (n[gi*3+2] > 0.9) wallOk++;
    }
  }
  ok(wallN > 50 && wallOk / wallN > 0.9, 'нормалі стіни ≈ +Z', `${wallOk}/${wallN}`);
}

console.log('\n[7] Габарити і PLY');
{
  const p = Z.pointsFromDepth({ z: ztrue, dw: W, dh: H, intr, stride: 3 });
  const bb = Z.bounds(p.positions, p.count);
  ok(near(bb.max[2], -1.9, 0.15), 'найближча точка ≈ передня грань куба z=-2.1', bb.max[2].toFixed(3));
  ok(near(bb.min[2], -6, 0.05), 'найдальша ≈ стіна z=-6', bb.min[2].toFixed(3));
  ok(near(bb.min[1], -1.2, 0.02), 'низ ≈ підлога y=-1.2', bb.min[1].toFixed(3));
  ok(bb.diag > 4 && bb.diag < 12, 'діагональ у розумних межах', bb.diag.toFixed(2));
  const col = new Uint8Array(p.count * 3);
  for (let i = 0; i < p.count * 3; i++) col[i] = (i * 37) & 255;
  const buf = Z.writePlyPoints(p.positions, col, p.count);
  const back = Z.parsePlyPoints(buf);
  ok(back.count === p.count, 'PLY: кількість точок збігається', String(back.count));
  let pe = 0, ce = 0;
  for (let i = 0; i < p.count * 3; i++) {
    pe = Math.max(pe, Math.abs(back.positions[i] - p.positions[i]));
    ce = Math.max(ce, Math.abs(back.colors[i] - col[i]));
  }
  ok(pe === 0 && ce === 0, 'PLY roundtrip побайтово точний');
  ok(new TextDecoder().decode(new Uint8Array(buf).slice(0, 40)).startsWith('ply\nformat binary_little_endian'),
    'PLY: коректний заголовок');
}

console.log('\n[8] Різкість');
{
  const w = 120, h = 90;
  const sharp = new Uint8Array(w*h*4), blur = new Uint8Array(w*h*4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y*w+x)*4;
    const s = 128 + 90*Math.sin(x*0.7)*Math.cos(y*0.5);
    const b = 128 + 5*Math.sin(x*0.03);
    sharp[i] = sharp[i+1] = sharp[i+2] = s; sharp[i+3] = 255;
    blur[i] = blur[i+1] = blur[i+2] = b; blur[i+3] = 255;
  }
  const vs = Z.laplacianVar(Z.toGray(sharp, w*h), w, h);
  const vb = Z.laplacianVar(Z.toGray(blur, w*h), w, h);
  ok(vs > 40 * vb, 'різке значно перевищує розмите', Math.round(vs) + ' vs ' + vb.toFixed(2));
}

console.log('\n══ ЯДРО ONE: ' + pass + ' ✓ / ' + fail + ' ✗ ══');
process.exit(fail ? 1 : 0);
