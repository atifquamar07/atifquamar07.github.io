// Ambient "activation map" backdrop: a fine lattice of dots over which slow waves of
// activation drift, with occasional sparse clusters lighting up and fading out.
// Dots are dimmed behind the main text column so reading is never disturbed.
// Respects prefers-reduced-motion, pauses when the tab is hidden, and follows the
// site's light/dark theme.
(function () {
  "use strict";

  var canvas = document.getElementById("ambient-field");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var root = document.documentElement;
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduce = motion ? motion.matches : false;

  var PALETTE = {
    light: { rgb: "168, 100, 21", base: 0.09, peak: 0.28, spike: 0.55 },
    dark: { rgb: "221, 179, 147", base: 0.06, peak: 0.2, spike: 0.42 },
  };
  var TEXT_DIM = 0.45; // opacity multiplier for dots behind the text column
  var FRAME_MS = 1000 / 30; // ~30fps is plenty for motion this slow

  var W = 0,
    H = 0,
    DPR = 1,
    gap = 26,
    cols = 0,
    rows = 0,
    ox = 0,
    oy = 0;
  var dim = []; // per-column readability mask
  var spikes = []; // { i, j, life }
  var ripples = []; // { x, y, t0 } click ripples, in viewport px
  var RIPPLE = { speed: 240, width: 22, life: 1500, push: 1.2, strength: 0.3 };
  var colors = PALETTE.light;
  var raf = null,
    lastDraw = 0,
    lastSpike = 0;

  function theme() {
    colors = root.getAttribute("data-theme") === "dark" ? PALETTE.dark : PALETTE.light;
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    gap = W < 768 ? 30 : 26;
    cols = Math.ceil(W / gap) + 1;
    rows = Math.ceil(H / gap) + 1;
    ox = (W - (cols - 1) * gap) / 2;
    oy = (H - (rows - 1) * gap) / 2;

    // Smoothly fade dots down inside the main content column.
    var main = document.querySelector('[role="main"]');
    var r = main ? main.getBoundingClientRect() : { left: W * 0.2, right: W * 0.8 };
    var feather = 90;
    dim = [];
    for (var i = 0; i < cols; i++) {
      var x = ox + i * gap;
      var d = Math.max(r.left - x, x - r.right); // < 0 inside the column
      var t = Math.min(1, Math.max(0, (d + feather) / feather));
      dim.push(TEXT_DIM + (1 - TEXT_DIM) * t);
    }
    spikes = [];
    if (reduce || !raf) draw(0);
  }

  // Two slow, interfering travelling waves; cubed so only the crests light up.
  function field(x, y, s) {
    var a = Math.sin(x * 0.006 + s * 0.23 + Math.sin(y * 0.004 - s * 0.11) * 1.8);
    var b = Math.sin(y * 0.007 - s * 0.17 + Math.cos(x * 0.003 + s * 0.07) * 1.4);
    var v = (a + b + 2) / 4; // 0..1
    return v * v * v;
  }

  function spawnSpike() {
    spikes.push({ i: Math.floor(Math.random() * cols), j: Math.floor(Math.random() * rows), life: 1 });
  }

  function draw(ts) {
    var s = ts / 1000;
    var c = colors;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Collect spike intensity per dot (center + 4 neighbours at half strength).
    var boost = {};
    for (var k = 0; k < spikes.length; k++) {
      var sp = spikes[k];
      var e = Math.sin(Math.PI * (1 - sp.life)); // ease in, then out
      var pts = [
        [0, 0, 1],
        [1, 0, 0.45],
        [-1, 0, 0.45],
        [0, 1, 0.45],
        [0, -1, 0.45],
      ];
      for (var p = 0; p < pts.length; p++) {
        var key = sp.i + pts[p][0] + "," + (sp.j + pts[p][1]);
        boost[key] = Math.max(boost[key] || 0, e * pts[p][2]);
      }
    }

    // Expanding ring front and fade for each live click ripple.
    var rings = [];
    for (var q = ripples.length - 1; q >= 0; q--) {
      var age = ts - ripples[q].t0;
      if (age < 0 || age > RIPPLE.life) {
        ripples.splice(q, 1);
        continue;
      }
      rings.push({ x: ripples[q].x, y: ripples[q].y, r: (RIPPLE.speed * age) / 1000, f: Math.pow(1 - age / RIPPLE.life, 1.5) });
    }

    ctx.fillStyle = "rgb(" + c.rgb + ")";
    for (var i = 0; i < cols; i++) {
      var x = ox + i * gap;
      for (var j = 0; j < rows; j++) {
        var y = oy + j * gap;
        var v = reduce ? 0 : field(x, y, s);
        var b = boost[i + "," + j] || 0;
        var dx = 0,
          dy = 0,
          ring = 0;
        for (var n = 0; n < rings.length; n++) {
          var rx = x - rings[n].x,
            ry = y - rings[n].y;
          var d = Math.sqrt(rx * rx + ry * ry) || 1;
          var o = (d - rings[n].r) / RIPPLE.width;
          var w = Math.exp(-o * o) * rings[n].f * RIPPLE.strength;
          if (w < 0.01) continue;
          ring = Math.max(ring, w);
          dx += (rx / d) * w * RIPPLE.push;
          dy += (ry / d) * w * RIPPLE.push;
        }
        var m = dim[i];
        var hit = Math.max(b, ring);
        var alpha = (c.base + (c.peak - c.base) * v + (c.spike - c.base) * hit) * m;
        var rad = 0.9 + 0.6 * v + 1.1 * hit;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, rad, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    var dt = ts - lastDraw;
    if (dt < FRAME_MS) return;
    lastDraw = ts;

    if (ts - lastSpike > 700 && spikes.length < 6) {
      lastSpike = ts;
      if (Math.random() < 0.6) spawnSpike();
    }
    for (var k = spikes.length - 1; k >= 0; k--) {
      spikes[k].life -= Math.min(dt, 100) / 3200;
      if (spikes[k].life <= 0) spikes.splice(k, 1);
    }
    draw(ts);
  }

  function start() {
    if (reduce || raf) return;
    lastDraw = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  theme();
  resize();
  if (reduce) draw(0);
  else start();

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  });
  window.addEventListener("load", resize);
  // Clicks on empty page areas send a ripple through the lattice. `click` (not
  // pointerdown) so touch scrolling never triggers it; interactive elements and
  // text selections are left alone.
  document.addEventListener("click", function (ev) {
    if (reduce || !raf) return;
    if (ev.target.closest && ev.target.closest("a, button, input, textarea, select, label, summary, [role='button']")) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (ripples.length >= 4) ripples.shift();
    ripples.push({ x: ev.clientX, y: ev.clientY, t0: performance.now() });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });
  new MutationObserver(function () {
    theme();
    if (reduce) draw(0);
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (motion && motion.addEventListener) {
    motion.addEventListener("change", function (ev) {
      reduce = ev.matches;
      stop();
      if (reduce) draw(0);
      else start();
    });
  }
})();
