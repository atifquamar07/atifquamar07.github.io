// Ambient "message passing" backdrop: a faint proximity mesh laid over the whole
// page. Every so often a node fires and its signal floods outward along a random
// spanning tree of edges, hop by hop, fading with distance (think BFS / message
// passing on a graph). Clicking empty space fires the nearest node.
// The mesh scrolls with the page at a slower rate, is dimmed behind the main text
// column, respects prefers-reduced-motion, pauses when the tab is hidden, and
// follows the site's light/dark theme.
(function () {
  "use strict";

  var canvas = document.getElementById("ambient-field");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var root = document.documentElement;
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduce = motion ? motion.matches : false;

  var PALETTE = {
    light: { rgb: "168, 100, 21", edge: 0.035, node: 0.075, lit: 0.16, head: 0.24 },
    dark: { rgb: "221, 179, 147", edge: 0.028, node: 0.06, lit: 0.13, head: 0.2 },
  };
  var TEXT_DIM = 0.3; // opacity multiplier for marks behind the text column
  var FRAME_MS = 1000 / 30; // ~30fps is plenty for motion this slow
  var PARALLAX = 0.35; // mesh scrolls at 35% of page speed
  var HOP_MS = 700; // time for a signal to cross one edge
  var FADE_MS = 1300; // how long a traversed edge keeps glowing
  var MAX_HOPS = 4;
  var CLICK_HOPS = 2;
  var BRANCH = 0.45; // chance a signal forwards along each outgoing edge
  var DECAY = 0.7; // per-hop strength falloff
  var MAX_NODES = 520;

  var W = 0,
    VH = 0,
    DOC = 0,
    DPR = 1;
  var nodes = []; // { bx, by, ph, x, y, adj: [node index] }
  var edges = []; // [a, b]
  var waves = []; // { t0, src, lit: [{ a, b, d }] }
  var colLeft = 0,
    colRight = 0;
  var colors = PALETTE.light;
  var raf = null,
    lastDraw = 0,
    lastWave = 0;

  function theme() {
    colors = root.getAttribute("data-theme") === "dark" ? PALETTE.dark : PALETTE.light;
  }

  function docHeight() {
    var b = document.body;
    return Math.max(b ? b.scrollHeight : 0, root.scrollHeight, window.innerHeight);
  }

  function scrollOffset() {
    return (window.pageYOffset || root.scrollTop || 0) * PARALLAX;
  }

  // Opacity multiplier for an x position: smoothly lower inside the text column.
  function dimAt(x) {
    var d = Math.max(colLeft - x, x - colRight); // < 0 inside the column
    var t = Math.min(1, Math.max(0, (d + 90) / 90));
    return TEXT_DIM + (1 - TEXT_DIM) * t;
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    VH = window.innerHeight;
    DOC = docHeight();
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(VH * DPR);

    var main = document.querySelector('[role="main"]');
    var r = main ? main.getBoundingClientRect() : { left: W * 0.2, right: W * 0.8 };
    colLeft = r.left;
    colRight = r.right;

    build();
    if (reduce || !raf) draw(performance.now());
  }

  // Jittered grid of nodes covering the span the mesh needs under parallax, each
  // linked to its (up to) three nearest neighbours.
  function build() {
    var span = VH + PARALLAX * Math.max(0, DOC - VH);
    var gap = W < 768 ? 78 : 64;
    var cols = Math.ceil(W / gap) + 1;
    var rows = Math.ceil(span / gap) + 1;
    if (cols * rows > MAX_NODES) {
      gap *= Math.sqrt((cols * rows) / MAX_NODES);
      cols = Math.ceil(W / gap) + 1;
      rows = Math.ceil(span / gap) + 1;
    }

    nodes = [];
    edges = [];
    waves = [];
    var grid = [];
    for (var j = 0; j < rows; j++) {
      grid.push([]);
      for (var i = 0; i < cols; i++) {
        if (Math.random() < 0.1) {
          grid[j].push(-1); // leave a few holes so the mesh looks organic
          continue;
        }
        grid[j].push(nodes.length);
        nodes.push({
          bx: (i + 0.5 * (j % 2) - 0.25 + (Math.random() - 0.5) * 0.6) * gap,
          by: (j + (Math.random() - 0.5) * 0.6) * gap,
          ph: Math.random() * 6.2832,
          x: 0,
          y: 0,
          adj: [],
        });
      }
    }

    var seen = {};
    var reach = gap * 1.75;
    for (j = 0; j < rows; j++) {
      for (i = 0; i < cols; i++) {
        var a = grid[j][i];
        if (a < 0) continue;
        var near = [];
        for (var dj = -2; dj <= 2; dj++) {
          for (var di = -2; di <= 2; di++) {
            var row = grid[j + dj];
            var b = row ? row[i + di] : undefined;
            if (b === undefined || b < 0 || b === a) continue;
            var dx = nodes[a].bx - nodes[b].bx,
              dy = nodes[a].by - nodes[b].by;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < reach) near.push({ b: b, d: d });
          }
        }
        near.sort(function (p, q) {
          return p.d - q.d;
        });
        for (var n = 0; n < Math.min(3, near.length); n++) {
          var lo = Math.min(a, near[n].b),
            hi = Math.max(a, near[n].b);
          if (seen[lo + "," + hi]) continue;
          seen[lo + "," + hi] = true;
          edges.push([lo, hi]);
          nodes[lo].adj.push(hi);
          nodes[hi].adj.push(lo);
        }
      }
    }
  }

  // Randomised breadth-first flood from `src`: each reached node forwards the
  // signal along a random subset of its untouched edges, up to `maxHops` away.
  function fire(src, ts, maxHops) {
    if (src < 0 || !nodes[src]) return;
    var depth = {};
    depth[src] = 0;
    var queue = [src],
      lit = [];
    while (queue.length) {
      var n = queue.shift();
      if (depth[n] >= maxHops) continue;
      var adj = nodes[n].adj.slice().sort(function () {
        return Math.random() - 0.5;
      });
      for (var k = 0; k < adj.length; k++) {
        var m = adj[k];
        if (depth[m] !== undefined) continue;
        if (depth[n] > 0 && Math.random() > BRANCH) continue;
        depth[m] = depth[n] + 1;
        lit.push({ a: n, b: m, d: depth[n] });
        queue.push(m);
      }
    }
    waves.push({ t0: ts, src: src, lit: lit });
  }

  function nearestNode(x, y, maxD) {
    var best = -1,
      bestD = maxD * maxD;
    for (var n = 0; n < nodes.length; n++) {
      var dx = nodes[n].x - x,
        dy = nodes[n].y - y;
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  function randomVisibleNode(off) {
    for (var tries = 0; tries < 12; tries++) {
      var n = Math.floor(Math.random() * nodes.length);
      if (nodes[n] && nodes[n].by > off && nodes[n].by < off + VH) return n;
    }
    return -1;
  }

  function draw(ts) {
    var s = ts / 1000;
    var c = colors;
    var off = scrollOffset();
    var top = off - 80,
      bot = off + VH + 80;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, VH);
    ctx.setTransform(DPR, 0, 0, DPR, 0, -off * DPR);

    for (var n = 0; n < nodes.length; n++) {
      var p = nodes[n];
      p.x = reduce ? p.bx : p.bx + Math.sin(s * 0.21 + p.ph) * 2.5;
      p.y = reduce ? p.by : p.by + Math.cos(s * 0.18 + p.ph) * 2.5;
    }

    var stroke = "rgb(" + c.rgb + ")";
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;

    // Base mesh.
    ctx.lineWidth = 1;
    for (var e = 0; e < edges.length; e++) {
      var A = nodes[edges[e][0]],
        B = nodes[edges[e][1]];
      if ((A.by < top && B.by < top) || (A.by > bot && B.by > bot)) continue;
      ctx.globalAlpha = c.edge * dimAt((A.x + B.x) / 2);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }

    // Signal floods: per-node flash amount, then traversed edges and moving heads.
    var flash = {};
    var heads = [];
    ctx.lineWidth = 1.4;
    for (var w = 0; w < waves.length; w++) {
      var wave = waves[w];
      var hops = (ts - wave.t0) / HOP_MS;
      flash[wave.src] = Math.max(flash[wave.src] || 0, Math.exp(-hops * 1.2));
      for (var k = 0; k < wave.lit.length; k++) {
        var l = wave.lit[k];
        var local = hops - l.d; // 0..1 while the signal is on this edge
        if (local <= 0) continue;
        var strength = Math.pow(DECAY, l.d);
        var prog = Math.min(1, local);
        var fade = local <= 1 ? 1 : Math.max(0, 1 - ((local - 1) * HOP_MS) / FADE_MS);
        if (fade <= 0) continue;
        var a = nodes[l.a],
          b = nodes[l.b];
        var hx = a.x + (b.x - a.x) * prog,
          hy = a.y + (b.y - a.y) * prog;
        ctx.globalAlpha = c.lit * strength * fade * dimAt((a.x + hx) / 2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        if (local < 1) heads.push(hx, hy, strength);
        else flash[l.b] = Math.max(flash[l.b] || 0, strength * Math.exp(-(local - 1) * 1.2));
      }
    }

    // Nodes, swelling briefly when a signal reaches them.
    for (n = 0; n < nodes.length; n++) {
      p = nodes[n];
      if (p.by < top || p.by > bot) continue;
      var f = flash[n] || 0;
      ctx.globalAlpha = (c.node + (c.head - c.node) * f) * dimAt(p.x);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.3 + 0.8 * f, 0, 6.2832);
      ctx.fill();
    }

    // Soft glow on each signal front.
    for (var h = 0; h < heads.length; h += 3) {
      var gx = heads[h],
        gy = heads[h + 1];
      var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 4);
      g.addColorStop(0, "rgba(" + c.rgb + "," + c.head * heads[h + 2] * dimAt(gx) + ")");
      g.addColorStop(1, "rgba(" + c.rgb + ",0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, gy, 4, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (ts - lastDraw < FRAME_MS) return;
    lastDraw = ts;

    var life = (MAX_HOPS + 1) * HOP_MS + FADE_MS;
    for (var w = waves.length - 1; w >= 0; w--) {
      if (ts - waves[w].t0 > life) waves.splice(w, 1);
    }
    if (ts - lastWave > 4000 && waves.length < 1) {
      lastWave = ts;
      if (Math.random() < 0.6) fire(randomVisibleNode(scrollOffset()), ts, MAX_HOPS);
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
  if (!reduce) start();

  var rt;
  function scheduleResize() {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  }
  window.addEventListener("resize", scheduleResize);
  window.addEventListener("load", resize);
  window.addEventListener(
    "scroll",
    function () {
      // Rebuild if lazy content grew the page past what the mesh covers.
      if (Math.abs(docHeight() - DOC) > VH) scheduleResize();
      else if (reduce) draw(0);
    },
    { passive: true }
  );
  // Clicks on empty page areas fire the nearest node. `click` (not pointerdown)
  // so touch scrolling never triggers it; interactive elements and text
  // selections are left alone.
  document.addEventListener("click", function (ev) {
    if (reduce || !raf) return;
    if (ev.target.closest && ev.target.closest("a, button, input, textarea, select, label, summary, [role='button']")) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (waves.length >= 2) waves.shift();
    fire(nearestNode(ev.clientX, ev.clientY + scrollOffset(), 140), performance.now(), CLICK_HOPS);
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
