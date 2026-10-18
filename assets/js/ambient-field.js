// Ambient comet backdrop: a handful of very faint comets drift across the
// viewport, each trailing a long tapered tail. A comet flies in from the left or
// the right, slanting gently up or down (never steep or vertical, which reads
// as visual noise next to text). Each one fades in, glides a random distance
// and fades out, so none of them pop in at the edges.
// Speed, tail length and brightness vary per comet. Everything is dimmed behind
// the main text column, respects prefers-reduced-motion (a still frame instead),
// pauses when the tab is hidden, and follows the site's light/dark theme.
(function () {
  "use strict";

  var canvas = document.getElementById("ambient-field");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var root = document.documentElement;
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduce = motion ? motion.matches : false;

  var PALETTE = {
    light: { rgb: "168, 100, 21", alpha: 0.5 },
    dark: { rgb: "221, 179, 147", alpha: 0.26 },
  };
  var TEXT_DIM = 0.3; // opacity multiplier for comets behind the text column
  var FEATHER = 90; // px over which the column dimming blends in
  var SLANT_MIN = (15 * Math.PI) / 180; // tilt from horizontal, up or down
  var SLANT_MAX = (30 * Math.PI) / 180;
  var SPEED_MIN = 45; // px per second
  var SPEED_MAX = 85;
  var TAIL_MIN = 320; // tail length in px
  var TAIL_MAX = 680;
  var PATH_MIN = 700; // distance a comet travels while visible
  var PATH_MAX = 1500;
  var FADE_IN = 0.2; // fraction of the path spent fading in
  var FADE_OUT = 0.35; // fraction of the path spent fading out
  var REST_MIN = 1000; // pause range between launches, ms (~7 clearly visible at once)
  var REST_MAX = 2600;
  var SPREAD_TRIES = 24; // candidate positions tried per comet to keep them apart

  var W = 0,
    H = 0,
    DPR = 1,
    scale = 1;
  var comets = []; // { sx, sy, ux, uy, born, speed, tail, path, glow }
  var colLeft = 0,
    colRight = 0;
  var colors = PALETTE.light;
  var raf = null,
    nextComet = 800,
    hiddenAt = 0;

  function theme() {
    colors = root.getAttribute("data-theme") === "dark" ? PALETTE.dark : PALETTE.light;
  }

  // Smoothstep on [0, 1], clamped.
  function ease(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    // Shorter paths and tails on small screens so comets still fit.
    scale = W < 768 ? 0.65 : 1;

    var main = document.querySelector('[role="main"]');
    var r = main ? main.getBoundingClientRect() : { left: W * 0.2, right: W * 0.8 };
    colLeft = r.left;
    colRight = r.right;

    if (reduce) still();
  }

  function onScreen(x, y) {
    return x > 20 && x < W - 20 && y > 20 && y < H - 20;
  }

  // Where a comet's head is at time ts.
  function headAt(cm, ts) {
    var d = ((ts - cm.born) / 1000) * cm.speed;
    return { x: cm.sx + cm.ux * d, y: cm.sy + cm.uy * d };
  }

  // A comet's path is centred on a point in the viewport, so it always crosses
  // the visible area; `progress` lets a comet start part-way along. Of a few
  // random candidates, the one whose head (at its brightest, mid-path) lands
  // farthest from the existing heads wins, so comets spread across the screen.
  function spawn(ts, progress) {
    var slant = rand(SLANT_MIN, SLANT_MAX);
    var ux = Math.cos(slant) * (Math.random() < 0.5 ? 1 : -1), // rightward or leftward
      uy = Math.sin(slant) * (Math.random() < 0.5 ? 1 : -1); // slanting down or up
    var path = rand(PATH_MIN, PATH_MAX) * scale;
    var at = path * (Math.max(progress || 0, 0.45) - 0.5); // reference point, relative to the midpoint
    var heads = comets.map(function (cm) {
      return headAt(cm, ts);
    });
    var mx = 0,
      my = 0,
      best = -1;
    for (var t = 0; t < SPREAD_TRIES; t++) {
      var cx = rand(0, W),
        cy = rand(0, H);
      // The bright middle stretch of the path should stay on screen, so the
      // head is not off the edge while the comet is at full strength.
      if (best >= 0 && !(onScreen(cx - ux * path * 0.2, cy - uy * path * 0.2) && onScreen(cx + ux * path * 0.2, cy + uy * path * 0.2))) continue;
      var px = cx + ux * at,
        py = cy + uy * at,
        near = Infinity;
      for (var i = 0; i < heads.length; i++) {
        var dx = heads[i].x - px,
          dy = heads[i].y - py;
        near = Math.min(near, dx * dx + dy * dy);
      }
      if (near > best) {
        best = near;
        mx = cx;
        my = cy;
      }
    }
    var speed = rand(SPEED_MIN, SPEED_MAX);
    comets.push({
      sx: mx - (ux * path) / 2,
      sy: my - (uy * path) / 2,
      ux: ux,
      uy: uy,
      born: ts - ((progress || 0) * path * 1000) / speed,
      speed: speed,
      tail: rand(TAIL_MIN, TAIL_MAX) * scale,
      path: path,
      glow: rand(0.6, 1),
    });
  }

  function maxComets() {
    return W >= 1000 ? 9 : 4;
  }

  // Tapered wedge for the tail, a thin brighter core near the head, and a soft
  // glowing head. The tail grows out from the start point as the comet leaves.
  function drawComet(cm, ts) {
    var d = ((ts - cm.born) / 1000) * cm.speed;
    var env = ease(d / (cm.path * FADE_IN)) * ease((cm.path - d) / (cm.path * FADE_OUT));
    if (env <= 0) return;
    var a = colors.alpha * cm.glow * env;
    var rgb = colors.rgb;

    var hx = cm.sx + cm.ux * d,
      hy = cm.sy + cm.uy * d;
    var len = Math.min(d, cm.tail);
    var tx = hx - cm.ux * len,
      ty = hy - cm.uy * len;
    var nx = -cm.uy,
      ny = cm.ux;
    var half = 1.1;

    if (len > 1) {
      // Gradient spans the full tail length so a young, short tail is already
      // bright at the head and faint at its end.
      var g = ctx.createLinearGradient(hx - cm.ux * cm.tail, hy - cm.uy * cm.tail, hx, hy);
      g.addColorStop(0, "rgba(" + rgb + ",0)");
      g.addColorStop(0.25, "rgba(" + rgb + "," + a * 0.12 + ")");
      g.addColorStop(0.6, "rgba(" + rgb + "," + a * 0.36 + ")");
      g.addColorStop(1, "rgba(" + rgb + "," + a * 0.9 + ")");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(hx + nx * half, hy + ny * half);
      ctx.lineTo(hx - nx * half, hy - ny * half);
      ctx.lineTo(tx, ty);
      ctx.closePath();
      ctx.fill();

      var core = Math.min(len, cm.tail * 0.35);
      var g2 = ctx.createLinearGradient(hx - cm.ux * cm.tail * 0.35, hy - cm.uy * cm.tail * 0.35, hx, hy);
      g2.addColorStop(0, "rgba(" + rgb + ",0)");
      g2.addColorStop(1, "rgba(" + rgb + "," + a + ")");
      ctx.strokeStyle = g2;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(hx - cm.ux * core, hy - cm.uy * core);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }

    var rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 6);
    rg.addColorStop(0, "rgba(" + rgb + "," + a * 1.1 + ")");
    rg.addColorStop(0.35, "rgba(" + rgb + "," + a * 0.45 + ")");
    rg.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, 6.2832);
    ctx.fill();
  }

  // Knock comets back behind the text column by erasing part of what was drawn
  // there, with feathered edges so the dimming has no visible seam.
  function dimColumn() {
    if (colRight - colLeft < 1) return;
    var l = colLeft - FEATHER,
      r = colRight + FEATHER;
    var g = ctx.createLinearGradient(l, 0, r, 0);
    var k = 1 - TEXT_DIM,
      f = FEATHER / (r - l);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(f, "rgba(0,0,0," + k + ")");
    g.addColorStop(1 - f, "rgba(0,0,0," + k + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = g;
    ctx.fillRect(l, 0, r - l, H);
    ctx.globalCompositeOperation = "source-over";
  }

  function draw(ts) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round";
    for (var i = 0; i < comets.length; i++) drawComet(comets[i], ts);
    dimColumn();
  }

  // Reduced motion: a single still frame with the sky's worth of comets mid-flight.
  function still() {
    comets = [];
    var now = performance.now();
    for (var i = 0; i < maxComets() - 1; i++) spawn(now, rand(0.35, 0.55));
    draw(now);
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    for (var i = comets.length - 1; i >= 0; i--) {
      var cm = comets[i];
      if (((ts - cm.born) / 1000) * cm.speed > cm.path) comets.splice(i, 1);
    }
    if (comets.length < maxComets() && ts >= nextComet) {
      spawn(ts, 0);
      nextComet = ts + rand(REST_MIN, REST_MAX);
    }
    draw(ts);
  }

  function start() {
    if (reduce || raf) return;
    // Resume where we left off instead of jumping ahead by the hidden time.
    if (hiddenAt) {
      var gap = performance.now() - hiddenAt;
      for (var i = 0; i < comets.length; i++) comets[i].born += gap;
      nextComet += gap;
      hiddenAt = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) {
      cancelAnimationFrame(raf);
      hiddenAt = performance.now();
    }
    raf = null;
  }

  theme();
  resize();
  if (!reduce) {
    // Most of the sky already in flight, at staggered points along their paths,
    // so the page never opens empty or with every comet fading in together.
    var now = performance.now();
    for (var i = 0; i < maxComets() - 2; i++) spawn(now, rand(0.2, 0.65));
    start();
  }

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  });
  window.addEventListener("load", resize);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else start();
  });
  new MutationObserver(function () {
    theme();
    if (reduce) draw(performance.now());
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (motion && motion.addEventListener) {
    motion.addEventListener("change", function (ev) {
      reduce = ev.matches;
      stop();
      hiddenAt = 0;
      if (reduce) still();
      else start();
    });
  }
})();
