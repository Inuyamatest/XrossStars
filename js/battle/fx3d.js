/* Xross Stars 対戦UI — Three.js による一瞬の3D演出（アタックの着弾・覚醒・ダウン）
 *
 * 盤面そのものはこれまでどおりHTML。演出のときだけ、画面全体に重ねた透明なキャンバスに描く。
 * - three.js は対戦開始時に1回だけ読み込む（メニューやデッキビルダーでは読み込まない）
 * - 演出中だけ描画ループを回し、終わったら止める（電池・発熱対策）
 * - WebGL が使えない端末・「視差効果を減らす」設定では何もしない（従来の2D演出だけになる）
 * 座標は画面のピクセル（rect = getBoundingClientRect の値）で受け取り、z=0 の面が画面と一致するカメラで描く。
 */
(function (root) {
  'use strict';

  var reduceMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // オン／オフ（対戦画面の「✨」ボタン）。端末に記憶し、既定はオン
  var PREF = 'xs-battle-fx3d';
  var enabled = (function () { try { return localStorage.getItem(PREF) !== 'off'; } catch (e) { return true; } })();
  var THREE = null, loading = null, failed = false;
  var renderer, scene, camera, canvas, W = 0, H = 0;
  var effects = [];   // { update(t) -> 生きていれば true, dispose() }
  var running = false, last = 0;
  var tex = {};       // 使い回すテクスチャ

  function preload() {
    if (THREE || loading || failed || reduceMotion || !enabled) return loading;
    var url = new URL('js/vendor/three.module.min.js', document.baseURI).href;
    loading = import(url).then(function (mod) { THREE = mod; setup(); }).catch(function () { failed = true; });
    return loading;
  }

  function setup() {
    try {
      canvas = document.createElement('canvas');
      canvas.className = 'fx3d-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.5));
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
      resize();
      root.addEventListener('resize', resize);
      tex.glow = radialTexture();
      tex.beam = beamTexture();
    } catch (e) { failed = true; THREE = null; }
  }

  function resize() {
    if (!renderer) return;
    W = root.innerWidth; H = root.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    var dist = (H / 2) / Math.tan(camera.fov * Math.PI / 360); // z=0 の面が画面ピクセルと一致する距離
    camera.position.set(W / 2, -H / 2, dist);
    camera.lookAt(W / 2, -H / 2, 0);
    camera.updateProjectionMatrix();
  }

  function radialTexture() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  function beamTexture() {
    var c = document.createElement('canvas'); c.width = 4; c.height = 128;
    var g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.35, 'rgba(255,255,255,.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(c);
  }

  function ensureCanvas() {
    if (!canvas.parentNode) document.body.appendChild(canvas);
  }
  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    effects = effects.filter(function (e) { var alive = e.update(dt); if (!alive) e.dispose(); return alive; });
    renderer.render(scene, camera);
    if (effects.length) requestAnimationFrame(loop);
    else { running = false; renderer.clear(); if (canvas.parentNode) canvas.parentNode.removeChild(canvas); }
  }
  function start(effect) {
    effects.push(effect);
    ensureCanvas();
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
  }
  function ready() { return !!(enabled && THREE && renderer && !failed && !reduceMotion); }
  function setEnabled(on) {
    enabled = !!on;
    try { localStorage.setItem(PREF, enabled ? 'on' : 'off'); } catch (e) { /* noop */ }
    if (enabled) preload();
  }

  // ---------- 部品 ----------
  var add = function () { return THREE.AdditiveBlending; };
  function center(rect) { return { x: rect.left + rect.width / 2, y: -(rect.top + rect.height / 2) }; }
  function glowSprite(color, size) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: color, blending: add(), transparent: true, depthWrite: false }));
    s.scale.set(size, size, 1); return s;
  }
  function ring(color, r0, r1) {
    return new THREE.Mesh(new THREE.RingGeometry(r0, r1, 64), new THREE.MeshBasicMaterial({ color: color, blending: add(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  }
  // 粒子：位置・速度を毎フレーム更新する Points
  function particles(n, color, size, init) {
    var pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) init(i, pos, vel);
    var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ map: tex.glow, color: color, size: size, blending: add(), transparent: true, depthWrite: false, sizeAttenuation: true });
    var pts = new THREE.Points(geo, mat); pts.userData.vel = vel; return pts;
  }
  function stepParticles(pts, dt, gravity, drag) {
    var p = pts.geometry.attributes.position.array, v = pts.userData.vel;
    for (var i = 0; i < p.length; i += 3) {
      v[i] *= drag; v[i + 1] = v[i + 1] * drag - gravity * dt; v[i + 2] *= drag;
      p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] += v[i + 2] * dt;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }
  function group(objs) { var g = new THREE.Group(); objs.forEach(function (o) { g.add(o); }); scene.add(g); return g; }
  function disposeGroup(g) {
    scene.remove(g);
    g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  var rand = function (a, b) { return a + Math.random() * (b - a); };

  // ---------- 演出：アタックの着弾 ----------
  // side: アタックした側（色）。big: 大ダメージ
  function hit(rect, big, side) {
    if (!ready() || !rect) return;
    var c = center(rect), s = Math.max(60, rect.width);
    var col = side === 'playerB' ? 0xff5c9d : 0x62c5ee, white = 0xffffff;
    var flash = glowSprite(white, s * (big ? 2.6 : 1.9));
    var wave = ring(col, 0.82, 1); wave.scale.setScalar(s * 0.3);
    var floorWave = ring(col, 0.9, 1); floorWave.rotation.x = -1.15; floorWave.scale.setScalar(s * 0.3);
    var n = big ? 120 : 64;
    var sparks = particles(n, col, big ? 24 : 18, function (i, p, v) {
      p[i * 3] = c.x; p[i * 3 + 1] = c.y; p[i * 3 + 2] = 0;
      var a = Math.random() * Math.PI * 2, el = rand(-0.6, 1.1), sp = rand(260, big ? 900 : 620);
      v[i * 3] = Math.cos(a) * Math.cos(el) * sp; v[i * 3 + 1] = Math.sin(a) * Math.cos(el) * sp + 140; v[i * 3 + 2] = Math.sin(el) * sp * 0.9;
    });
    var core = particles(Math.round(n / 3), white, 14, function (i, p, v) {
      p[i * 3] = c.x; p[i * 3 + 1] = c.y; p[i * 3 + 2] = 10;
      var a = Math.random() * Math.PI * 2, sp = rand(120, 380);
      v[i * 3] = Math.cos(a) * sp; v[i * 3 + 1] = Math.sin(a) * sp; v[i * 3 + 2] = rand(80, 300);
    });
    // 破片（手前に飛び出して回転する三角）
    var shards = [];
    for (var k = 0; k < (big ? 14 : 8); k++) {
      var m = new THREE.Mesh(new THREE.TetrahedronGeometry(rand(5, big ? 13 : 9)), new THREE.MeshBasicMaterial({ color: k % 3 ? col : white, transparent: true, blending: add(), depthWrite: false }));
      var a2 = Math.random() * Math.PI * 2, sp2 = rand(300, big ? 820 : 560);
      m.position.set(c.x, c.y, 20); m.userData.v = new THREE.Vector3(Math.cos(a2) * sp2, Math.sin(a2) * sp2 + 200, rand(150, 600)); m.userData.r = new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      shards.push(m);
    }
    flash.position.set(c.x, c.y, 30); wave.position.set(c.x, c.y, 5); floorWave.position.set(c.x, c.y - rect.height * 0.35, 0);
    var g = group([flash, wave, floorWave, sparks, core].concat(shards));
    var t = 0, life = big ? 0.95 : 0.75;
    start({
      update: function (dt) {
        t += dt; var k = t / life;
        flash.material.opacity = Math.max(0, 1 - t / 0.22); flash.scale.setScalar(s * (big ? 2.6 : 1.9) * (1 + t * 1.5));
        wave.scale.setScalar(s * (0.3 + k * (big ? 2.4 : 1.7))); wave.material.opacity = Math.max(0, 1 - k * 1.2);
        floorWave.scale.setScalar(s * (0.3 + k * (big ? 3 : 2.2))); floorWave.material.opacity = Math.max(0, 0.8 - k);
        stepParticles(sparks, dt, 900, 0.95); sparks.material.opacity = Math.max(0, 1 - k);
        stepParticles(core, dt, 300, 0.9); core.material.opacity = Math.max(0, 1 - k * 1.4);
        shards.forEach(function (m) {
          m.userData.v.y -= 1100 * dt; m.position.addScaledVector(m.userData.v, dt);
          m.rotation.x += m.userData.r.x * dt; m.rotation.y += m.userData.r.y * dt; m.rotation.z += m.userData.r.z * dt;
          m.material.opacity = Math.max(0, 1 - k);
        });
        return t < life;
      },
      dispose: function () { disposeGroup(g); },
    });
  }

  // ---------- 演出：覚醒（光の柱＋せり上がるリング＋らせんの粒） ----------
  function awaken(rect) {
    if (!ready() || !rect) return;
    var c = center(rect), w = Math.max(60, rect.width), h = Math.max(80, rect.height);
    var gold = 0xffd36b, white = 0xffffff;
    var pillar = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.34, w * 0.46, h * 2.6, 40, 1, true),
      new THREE.MeshBasicMaterial({ map: tex.beam, color: gold, blending: add(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    pillar.position.set(c.x, c.y + h * 0.35, -w * 0.3); pillar.rotation.x = 0.12;
    var rings = [0, 1, 2].map(function (i) {
      var r = new THREE.Mesh(new THREE.TorusGeometry(w * 0.6, i === 1 ? 3 : 2, 8, 72), new THREE.MeshBasicMaterial({ color: i === 1 ? white : gold, blending: add(), transparent: true, depthWrite: false }));
      r.rotation.x = Math.PI / 2 - 0.35; r.userData.delay = i * 0.18; return r;
    });
    var n = 110;
    var spiral = particles(n, gold, 18, function (i, p, v) {
      var a = (i / n) * Math.PI * 8, rr = w * rand(0.45, 0.7);
      p[i * 3] = c.x + Math.cos(a) * rr; p[i * 3 + 1] = c.y - h * 0.5 - (i / n) * h * 0.4; p[i * 3 + 2] = Math.sin(a) * rr;
      v[i * 3] = a; v[i * 3 + 1] = rr; v[i * 3 + 2] = rand(260, 520); // 角度・半径・上昇速度として使う
    });
    var star = glowSprite(white, w * 0.2);
    star.position.set(c.x, c.y, 40);
    var g = group([pillar, spiral, star].concat(rings));
    var t = 0, life = 1.35;
    start({
      update: function (dt) {
        t += dt; var k = t / life;
        var grow = Math.min(1, t / 0.25);
        pillar.scale.set(1 + k * 0.25, grow, 1 + k * 0.25); pillar.rotation.y += dt * 2.5;
        pillar.material.opacity = k < 0.6 ? 0.5 : Math.max(0, 0.5 * (1 - (k - 0.6) / 0.4));
        rings.forEach(function (r) {
          var tt = Math.max(0, t - r.userData.delay), kk = Math.min(1, tt / 0.9);
          r.position.set(c.x, c.y - h * 0.5 + kk * h * 1.3, 0);
          r.scale.setScalar(0.6 + kk * 0.9); r.material.opacity = tt <= 0 ? 0 : Math.max(0, 1 - kk);
        });
        var p = spiral.geometry.attributes.position.array, v = spiral.userData.vel;
        for (var i = 0; i < n; i++) {
          v[i * 3] += dt * 6; var rr = v[i * 3 + 1] * (1 - k * 0.5);
          p[i * 3] = c.x + Math.cos(v[i * 3]) * rr; p[i * 3 + 2] = Math.sin(v[i * 3]) * rr; p[i * 3 + 1] += v[i * 3 + 2] * dt;
        }
        spiral.geometry.attributes.position.needsUpdate = true; spiral.material.opacity = Math.max(0, 1 - k * 1.1);
        // 最後に星がはじける
        var sk = Math.max(0, (t - 0.55) / 0.5);
        star.scale.setScalar(w * (0.2 + sk * 3.2)); star.material.opacity = t < 0.55 ? 0.5 : Math.max(0, 1 - sk);
        return t < life;
      },
      dispose: function () { disposeGroup(g); },
    });
  }

  // ---------- 演出：ダウン（カードが砕けて落ちる） ----------
  function ko(rect) {
    if (!ready() || !rect) return;
    var c = center(rect), w = Math.max(60, rect.width), h = Math.max(80, rect.height);
    var cols = [0xff458e, 0x8fa3c4, 0xffffff];
    var shards = [];
    for (var i = 0; i < 22; i++) {
      var sz = rand(6, 16);
      var m = new THREE.Mesh(new THREE.TetrahedronGeometry(sz), new THREE.MeshBasicMaterial({ color: cols[i % 3], transparent: true, depthWrite: false }));
      m.position.set(c.x + rand(-w / 2, w / 2), c.y + rand(-h / 2, h / 2), rand(0, 30));
      m.userData.v = new THREE.Vector3(rand(-260, 260), rand(80, 420), rand(100, 520)); m.userData.r = new THREE.Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10));
      shards.push(m);
    }
    var dark = ring(0xff458e, 0.85, 1); dark.position.set(c.x, c.y, 5); dark.scale.setScalar(w * 0.4);
    var g = group([dark].concat(shards));
    var t = 0, life = 1.1;
    start({
      update: function (dt) {
        t += dt; var k = t / life;
        shards.forEach(function (m) {
          m.userData.v.y -= 1400 * dt; m.position.addScaledVector(m.userData.v, dt);
          m.rotation.x += m.userData.r.x * dt; m.rotation.y += m.userData.r.y * dt;
          m.material.opacity = Math.max(0, 1 - k * k);
        });
        dark.scale.setScalar(w * (0.4 + k * 1.6)); dark.material.opacity = Math.max(0, 0.9 - k);
        return t < life;
      },
      dispose: function () { disposeGroup(g); },
    });
  }

  root.XS_BATTLE_FX3D = {
    preload: preload, hit: hit, awaken: awaken, ko: ko, ready: ready, setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    available: function () { return !reduceMotion && !failed && 'WebGLRenderingContext' in root; },
  };
}(typeof self !== 'undefined' ? self : this));
