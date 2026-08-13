// ЗЛІПОК one · завантажувач вшитого payload.
// Кожен блок: base64 від gzip (крім fflate, який мусить бути сирим,
// бо саме він і розпаковує решту). Переписує import-специфікатори на
// blob:-URL і стартує app-модуль. Мережа не потрібна.
'use strict';
(function () {
  function b64bytes(id) {
    var el = document.getElementById(id);
    if (!el) throw new Error('нема вшитого блоку #' + id);
    var s = el.textContent.replace(/\s+/g, '');
    var bin = atob(s);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    el.textContent = '';
    return u;
  }
  function burl(data, type) { return URL.createObjectURL(new Blob([data], { type: type || 'text/javascript' })); }

  // Переписує статичні специфікатори за мапою: точний збіг або префікс
  // (ключ на '/'). Повертає { code, hits }.
  function rewriteImports(code, map) {
    var hits = 0;
    var out = code.replace(/(\b(?:import|export|from)\b\s*\(?\s*)(["'])([^"'\n]+)\2/g,
      function (m, pre, q, spec) {
        var r = map[spec];
        if (r === undefined) {
          for (var k in map) {
            if (k.charAt(k.length - 1) === '/' && spec.indexOf(k) === 0) { r = map[k] + spec.slice(k.length); break; }
          }
        }
        if (r === undefined) return m;
        hits++;
        return pre + q + r + q;
      });
    return { code: out, hits: hits };
  }

  function boot() {
    // fflate — сирий, виконуємо першим
    var ff = document.createElement('script');
    ff.textContent = new TextDecoder().decode(b64bytes('lib-fflate'));
    document.head.appendChild(ff);
    if (typeof fflate === 'undefined' || !fflate.gunzipSync) throw new Error('fflate не піднявся');

    var gz = function (id) { return fflate.gunzipSync(b64bytes(id)); };
    var txt = function (id) { return new TextDecoder().decode(gz(id)); };

    var coreU = burl(txt('lib-three-core'));
    var t = rewriteImports(txt('lib-three'), { './three.core.min.js': coreU, './three.core.js': coreU });
    if (t.hits < 1) throw new Error('three: специфікатор core не переписався');
    var threeU = burl(t.code);
    var mkEs = function (id) { return burl(rewriteImports(txt(id), { 'three': threeU }).code); };
    var orbitU = mkEs('lib-orbit');
    var gltfU = mkEs('lib-gltf');

    var modelGz = b64bytes('model-weights');
    window.__ZL_ONE = {
      ortJs: burl(txt('lib-ortjs')),
      ortMjs: burl(txt('lib-ortmjs')),
      ortWasm: burl(gz('bin-ortwasm'), 'application/wasm'),
      model: function () {          // розпаковуємо ліниво: 25 МБ у памʼяті лише коли треба
        var m = fflate.gunzipSync(modelGz);
        modelGz = null;
        window.__ZL_ONE.model = function () { return m; };
        return m;
      }
    };

    var app = rewriteImports(txt('app-module'), {
      'three': threeU,
      'three/addons/controls/OrbitControls.js': orbitU,
      'three/addons/exporters/GLTFExporter.js': gltfU
    });
    if (app.hits < 3) throw new Error('app: переписано лише ' + app.hits + ' специфікаторів із 3');
    import(burl(app.code)).catch(function (e) { setTimeout(function () { throw e; }, 0); });
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    try { boot(); } catch (e) { setTimeout(function () { throw e; }, 0); }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { rewriteImports: rewriteImports };
})();
