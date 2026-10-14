// Ambient "message passing" backdrop: a faint planar mesh laid over the whole
// page (a Delaunay triangulation of evenly spread points, with some triangle
// pairs merged into quads so the polygons vary in size without edges crossing).
// Every so often a node fires and its signal floods outward along a random
// spanning tree of edges at a steady speed, fading with distance (think BFS /
// message passing on a graph). Clicking empty space fires the nearest node
// through the same flood, easing in and out so it blends with the ambient
// motion instead of interrupting it. Now and then a faint "comet" glides in a
// long straight line between two nodes, trailing a fading tail; where it
// starts, which way it heads, how far, how fast and how bright are all random.
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
    light: { rgb: "168, 100, 21", edge: 0.035, node: 0.075, lit: 0.16, head: 0.24, comet: 0.24 },
    dark: { rgb: "221, 179, 147", edge: 0.028, node: 0.06, lit: 0.13, head: 0.2, comet: 0.2 },
  };
  var TEXT_DIM = 0.3; // opacity multiplier for marks behind the text column
  var FRAME_MS = 1000 / 30; // ~30fps is plenty while only the slow drift runs
  var FRAME_MS_ACTIVE = 1000 / 60; // full rate while a signal is travelling
  var PARALLAX = 0.35; // mesh scrolls at 35% of page speed
  var SPACING = 96; // minimum distance between mesh nodes, px
  var MERGE = 0.6; // chance a triangle pair sharing a longest edge becomes a quad
  var SIGNAL_SPEED = 130; // px per second a signal travels along an edge
  var ATTACK_MS = 320; // floods ease in rather than popping on
  var FADE_MS = 1600; // how long a traversed edge / reached node keeps glowing
  var RETIRE_MS = 700; // a flood cut short by newer clicks fades out over this
  var MAX_HOPS = 4;
  var CLICK_HOPS = 3;
  var MAX_WAVES = 3; // live floods at once; the oldest retires beyond this
  var BRANCH = 0.45; // chance a signal forwards along each outgoing edge
  var DECAY = 0.7; // per-hop strength falloff
  var MAX_NODES = 520;
  var COMET_SPEED = 38; // typical px per second; each comet varies around these
  var COMET_TAIL = 380; // typical tail length in px
  var COMET_MIN_LEN = 320; // length range of a comet's straight path
  var COMET_MAX_LEN = 820;
  var COMET_FADE_IN = 1500;
  var COMET_REST_MS = 7000; // typical pause before the next comet

  var W = 0,
    VH = 0,
    DOC = 0,
    DPR = 1,
    reach = SPACING;
  var nodes = []; // { bx, by, ph, x, y, adj: [node index] }
  var edges = []; // [a, b]
  var waves = []; // { t0, src, lit: [{ a, b, at, dur, s }], kill, life }
  var comets = []; // { a, b, born, speed, tail, glow, len, d } — flies from node a to node b
  var colLeft = 0,
    colRight = 0;
  var colors = PALETTE.light;
  var raf = null,
    lastDraw = 0,
    lastWave = 0,
    nextComet = 2500; // let the page settle before the first comet

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

  // Smoothstep on [0, 1], clamped.
  function ease(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
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

  // Bridson's Poisson-disc sampling: evenly spread points, none closer than r.
  function poisson(x0, y0, w, h, r) {
    var cell = r / Math.SQRT2,
      gw = Math.ceil(w / cell),
      gh = Math.ceil(h / cell);
    var grid = new Array(gw * gh),
      pts = [],
      active = [];

    function place(x, y) {
      grid[Math.floor((y - y0) / cell) * gw + Math.floor((x - x0) / cell)] = pts.length;
      active.push(pts.length);
      pts.push({ x: x, y: y });
    }

    function free(x, y) {
      var gx = Math.floor((x - x0) / cell),
        gy = Math.floor((y - y0) / cell);
      for (var j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
        for (var i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
          var q = grid[j * gw + i];
          if (q === undefined) continue;
          var dx = pts[q].x - x,
            dy = pts[q].y - y;
          if (dx * dx + dy * dy < r * r) return false;
        }
      }
      return true;
    }

    place(x0 + Math.random() * w, y0 + Math.random() * h);
    while (active.length) {
      var ai = Math.floor(Math.random() * active.length),
        p = pts[active[ai]],
        ok = false;
      for (var t = 0; t < 30 && !ok; t++) {
        var ang = Math.random() * 6.2832,
          rad = r * (1 + Math.random());
        var x = p.x + Math.cos(ang) * rad,
          y = p.y + Math.sin(ang) * rad;
        if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h && free(x, y)) {
          place(x, y);
          ok = true;
        }
      }
      if (!ok) {
        active[ai] = active[active.length - 1];
        active.pop();
      }
    }
    return pts;
  }

  // Bowyer–Watson Delaunay triangulation; returns [i, j, k] index triples.
  function triangulate(pts) {
    var n = pts.length;
    if (n < 3) return [];
    var minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (var i = 0; i < n; i++) {
      minX = Math.min(minX, pts[i].x);
      minY = Math.min(minY, pts[i].y);
      maxX = Math.max(maxX, pts[i].x);
      maxY = Math.max(maxY, pts[i].y);
    }
    var d = Math.max(maxX - minX, maxY - minY),
      mx = (minX + maxX) / 2,
      my = (minY + maxY) / 2;
    var P = pts.concat([
      { x: mx - 20 * d, y: my - d },
      { x: mx, y: my + 20 * d },
      { x: mx + 20 * d, y: my - d },
    ]);

    function tri(a, b, c) {
      var A = P[a];
      var bx = P[b].x - A.x,
        by = P[b].y - A.y,
        cx = P[c].x - A.x,
        cy = P[c].y - A.y;
      var D = 2 * (bx * cy - by * cx) || 1e-9;
      var b2 = bx * bx + by * by,
        c2 = cx * cx + cy * cy;
      var ux = (cy * b2 - by * c2) / D,
        uy = (bx * c2 - cx * b2) / D;
      return { v: [a, b, c], x: A.x + ux, y: A.y + uy, r2: ux * ux + uy * uy };
    }

    var tris = [tri(n, n + 1, n + 2)];
    for (i = 0; i < n; i++) {
      var p = P[i],
        keep = [],
        open = {};
      for (var t = 0; t < tris.length; t++) {
        var T = tris[t],
          dx = p.x - T.x,
          dy = p.y - T.y;
        if (dx * dx + dy * dy >= T.r2) {
          keep.push(T);
          continue;
        }
        // Edges of the cavity's triangles; shared ones cancel out.
        for (var s = 0; s < 3; s++) {
          var a = T.v[s],
            b = T.v[(s + 1) % 3];
          var k = a < b ? a + "," + b : b + "," + a;
          open[k] = open[k] ? 0 : [a, b];
        }
      }
      for (k in open) if (open[k]) keep.push(tri(open[k][0], open[k][1], i));
      tris = keep;
    }

    var out = [];
    for (t = 0; t < tris.length; t++) {
      var v = tris[t].v;
      if (v[0] < n && v[1] < n && v[2] < n) out.push(v);
    }
    return out;
  }

  // Evenly spread nodes covering the span the mesh needs under parallax, joined
  // by a Delaunay triangulation (planar: no crossing edges, no slivers). Some
  // triangle pairs lose their shared long edge and become quads, which thins
  // the line work and mixes polygon sizes.
  function build() {
    var span = VH + PARALLAX * Math.max(0, DOC - VH);
    var r = W < 768 ? SPACING * 0.85 : SPACING;
    // Poisson-disc packing lands ~0.7 points per r²; widen r on very long pages.
    r = Math.max(r, Math.sqrt((0.7 * (W + 2 * r) * (span + 2 * r)) / MAX_NODES));
    reach = r * 2;

    var pts = poisson(-r, -r, W + 2 * r, span + 2 * r, r);
    nodes = [];
    edges = [];
    waves = [];
    comets = [];
    for (var i = 0; i < pts.length; i++) {
      nodes.push({ bx: pts[i].x, by: pts[i].y, ph: Math.random() * 6.2832, x: 0, y: 0, adj: [] });
    }

    var tris = triangulate(pts);
    var byKey = {},
      list = [],
      deg = [];
    for (var t = 0; t < tris.length; t++) {
      var longest = null;
      for (var s = 0; s < 3; s++) {
        var a = Math.min(tris[t][s], tris[t][(s + 1) % 3]),
          b = Math.max(tris[t][s], tris[t][(s + 1) % 3]);
        var e = byKey[a + "," + b];
        if (!e) {
          var dx = pts[a].x - pts[b].x,
            dy = pts[a].y - pts[b].y;
          e = byKey[a + "," + b] = { a: a, b: b, len: Math.sqrt(dx * dx + dy * dy), tris: 0, longest: 0 };
          list.push(e);
          deg[a] = (deg[a] || 0) + 1;
          deg[b] = (deg[b] || 0) + 1;
        }
        e.tris++;
        if (!longest || e.len > longest.len) longest = e;
      }
      longest.longest++;
    }

    for (i = 0; i < list.length; i++) {
      e = list[i];
      // Long edges only occur along the hull, which sits just off-screen.
      if (e.len > r * 2.5) continue;
      // An edge that is the longest side of both its triangles is the diagonal
      // of a well-shaped quad; each triangle has one longest side, so merges
      // never chain into large concave shapes.
      if (e.tris === 2 && e.longest === 2 && deg[e.a] > 3 && deg[e.b] > 3 && Math.random() < MERGE) {
        deg[e.a]--;
        deg[e.b]--;
        continue;
      }
      edges.push([e.a, e.b]);
      nodes[e.a].adj.push(e.b);
      nodes[e.b].adj.push(e.a);
    }
  }

  // Randomised breadth-first flood from `src`: each reached node forwards the
  // signal along a random subset of its untouched edges, up to `maxHops` away.
  // Signals move at a constant speed, so each edge's timing follows its length.
  function fire(src, ts, maxHops) {
    if (src < 0 || !nodes[src]) return;
    var depth = {},
      at = {};
    depth[src] = 0;
    at[src] = 0;
    var queue = [src],
      lit = [],
      end = 0;
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
        var dx = nodes[m].bx - nodes[n].bx,
          dy = nodes[m].by - nodes[n].by;
        var dur = (Math.sqrt(dx * dx + dy * dy) / SIGNAL_SPEED) * 1000;
        depth[m] = depth[n] + 1;
        at[m] = at[n] + dur;
        end = Math.max(end, at[m]);
        lit.push({ a: n, b: m, at: at[n], dur: dur, s: Math.pow(DECAY, depth[n]) });
        queue.push(m);
      }
    }
    waves.push({
      t0: ts,
      src: src,
      lit: lit,
      kill: 0,
      life: end + FADE_MS,
    });
  }

  // Overall opacity of a flood: eases in at birth, eases out once retired.
  function waveEnv(wave, ts) {
    var e = ease((ts - wave.t0) / ATTACK_MS);
    if (wave.kill) e *= 1 - ease((ts - wave.kill) / RETIRE_MS);
    return e;
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

  // Two at most on wide screens, one on narrow ones.
  function maxComets() {
    return W >= 1000 ? 2 : 1;
  }

  // Wait a random while after a comet launches or retires, so they appear only
  // now and then, never on a beat.
  function restComets(ts) {
    nextComet = Math.max(nextComet, ts + COMET_REST_MS * (0.6 + Math.random() * 1.4));
  }

  // A comet starts at a random node (in a side margin when there is room, so
  // it is not born behind the text) and heads off at a random angle for a
  // random distance, landing on whichever node lies there. Each one also gets
  // its own speed, tail length and brightness, so no two look alike.
  function spawnComet(ts) {
    var off = scrollOffset();
    var margins = colLeft > 140 || W - colRight > 140;
    function onScreen(p) {
      return p.bx > -60 && p.bx < W + 60 && p.by > off - 60 && p.by < off + VH + 60;
    }
    var src = -1;
    for (var tries = 0; tries < 40 && src < 0; tries++) {
      var n = Math.floor(Math.random() * nodes.length);
      if (nodes[n] && onScreen(nodes[n]) && (!margins || dimAt(nodes[n].bx) > 0.95)) src = n;
    }
    if (src < 0) return;
    var S = nodes[src];
    for (tries = 0; tries < 16; tries++) {
      var ang = Math.random() * 6.2832,
        len = COMET_MIN_LEN + Math.random() * (COMET_MAX_LEN - COMET_MIN_LEN);
      var dst = nearestNode(S.bx + Math.cos(ang) * len, S.by + Math.sin(ang) * len, reach);
      if (dst < 0 || dst === src || !onScreen(nodes[dst])) continue;
      comets.push({
        a: src,
        b: dst,
        born: ts,
        speed: COMET_SPEED * (0.75 + Math.random() * 0.55),
        tail: COMET_TAIL * (0.65 + Math.random() * 0.45),
        glow: 0.65 + Math.random() * 0.35,
      });
      return;
    }
  }

  // Head position along each comet's line; a comet retires once its tail has
  // caught up with the far node, which glows as the head arrives.
  function updateComets(ts, flash) {
    for (var i = comets.length - 1; i >= 0; i--) {
      var cm = comets[i];
      var A = nodes[cm.a],
        B = nodes[cm.b];
      var dx = B.x - A.x,
        dy = B.y - A.y;
      cm.len = Math.sqrt(dx * dx + dy * dy) || 1;
      cm.d = ((ts - cm.born) / 1000) * cm.speed;
      if (cm.d > cm.len + cm.tail) {
        comets.splice(i, 1);
        restComets(ts);
        continue;
      }
      var past = cm.d - cm.len; // < 0 while approaching B
      var f = past < 0 ? ease(1 + past / 40) : 1 - ease(past / (cm.speed * 1.8));
      if (f > 0) flash[cm.b] = Math.max(flash[cm.b] || 0, 0.4 * cm.glow * f);
    }
  }

  // Each comet: a faint track ahead of the tail, a long gradient tail with a
  // brighter core near the head so it tapers, and a soft head.
  function drawComets(ts) {
    var c = colors;
    ctx.lineCap = "round";
    for (var i = 0; i < comets.length; i++) {
      var cm = comets[i];
      var A = nodes[cm.a],
        B = nodes[cm.b];
      var ux = (B.x - A.x) / cm.len,
        uy = (B.y - A.y) / cm.len;
      var T = cm.tail;
      var env = Math.min(1, (ts - cm.born) / COMET_FADE_IN, (cm.len + T - cm.d) / T);
      var head = Math.min(cm.d, cm.len),
        tail = Math.max(0, cm.d - T);
      var hx = A.x + ux * head,
        hy = A.y + uy * head,
        tx = A.x + ux * tail,
        ty = A.y + uy * tail;
      // Dims smoothly as the head passes behind the text column.
      var dim = dimAt(hx);
      var alpha = c.comet * cm.glow * env * dim;

      ctx.globalAlpha = c.edge * env * dim;
      ctx.strokeStyle = "rgb(" + c.rgb + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();

      ctx.globalAlpha = 1;
      if (head - tail > 1) {
        // Fade toward the tail end in proportion to how much of a full tail is
        // drawn; the extra stops keep it visible for most of its length.
        var g = ctx.createLinearGradient(hx - ux * T, hy - uy * T, hx, hy);
        g.addColorStop(0, "rgba(" + c.rgb + ",0)");
        g.addColorStop(0.3, "rgba(" + c.rgb + "," + alpha * 0.3 + ")");
        g.addColorStop(0.7, "rgba(" + c.rgb + "," + alpha * 0.65 + ")");
        g.addColorStop(1, "rgba(" + c.rgb + "," + alpha + ")");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        var core = Math.min(head - tail, T * 0.3);
        var g2 = ctx.createLinearGradient(hx - ux * T * 0.3, hy - uy * T * 0.3, hx, hy);
        g2.addColorStop(0, "rgba(" + c.rgb + ",0)");
        g2.addColorStop(1, "rgba(" + c.rgb + "," + alpha * 0.6 + ")");
        ctx.strokeStyle = g2;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx - ux * core, hy - uy * core);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }

      // The head dims out after arriving while the node glow takes over.
      var glow = 1 - ease((cm.d - cm.len) / (cm.speed * 0.8));
      if (glow > 0) {
        var rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 5);
        rg.addColorStop(0, "rgba(" + c.rgb + "," + alpha * 1.2 * glow + ")");
        rg.addColorStop(1, "rgba(" + c.rgb + ",0)");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.lineCap = "butt";
    ctx.globalAlpha = 1;
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

    // Signal floods: per-node flash amount, then traversed edges and moving
    // heads. Everything ramps up and fades out smoothly; nothing pops.
    var flash = {};
    var heads = [];
    for (var w = 0; w < waves.length; w++) {
      var wave = waves[w];
      var age = ts - wave.t0;
      var env = waveEnv(wave, ts);
      var srcFade = 1 - age / FADE_MS;
      if (srcFade > 0) flash[wave.src] = Math.max(flash[wave.src] || 0, env * srcFade * srcFade);

      ctx.lineWidth = 1.4;
      for (var k = 0; k < wave.lit.length; k++) {
        var l = wave.lit[k];
        var lt = age - l.at; // time since the signal left node a
        if (lt <= 0) continue;
        var prog = Math.min(1, lt / l.dur);
        var after = lt - l.dur; // time since it reached node b
        var fade = after <= 0 ? 1 : 1 - after / FADE_MS;
        if (fade <= 0) continue;
        fade *= fade;
        var str = l.s * env;
        var a = nodes[l.a],
          b = nodes[l.b];
        var hx = a.x + (b.x - a.x) * prog,
          hy = a.y + (b.y - a.y) * prog;
        ctx.globalAlpha = c.lit * str * fade * dimAt((a.x + hx) / 2);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        // Node b starts to glow as the signal closes in, then fades with the edge.
        var f = prog < 1 ? ease((prog - 0.75) / 0.25) : fade;
        flash[l.b] = Math.max(flash[l.b] || 0, str * f);
        if (prog < 1) heads.push(hx, hy, str);
      }
    }

    if (!reduce) updateComets(ts, flash);

    // Nodes, swelling briefly when a signal or comet reaches them.
    for (n = 0; n < nodes.length; n++) {
      p = nodes[n];
      if (p.by < top || p.by > bot) continue;
      var fl = flash[n] || 0;
      ctx.globalAlpha = (c.node + (c.head - c.node) * fl) * dimAt(p.x);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.3 + 0.8 * fl, 0, 6.2832);
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

    if (!reduce) drawComets(ts);
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    // A few ms of slack so display jitter never skips a whole frame.
    if (ts - lastDraw < (waves.length ? FRAME_MS_ACTIVE : FRAME_MS) - 4) return;
    lastDraw = ts;

    for (var w = waves.length - 1; w >= 0; w--) {
      var wave = waves[w];
      if (ts - wave.t0 > wave.life || (wave.kill && ts - wave.kill > RETIRE_MS)) waves.splice(w, 1);
    }
    if (ts - lastWave > 4000 && waves.length < 1) {
      lastWave = ts;
      if (Math.random() < 0.6) fire(randomVisibleNode(scrollOffset()), ts, MAX_HOPS);
    }
    if (comets.length < maxComets() && ts >= nextComet) {
      spawnComet(ts);
      restComets(ts);
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
    var now = performance.now();
    var src = nearestNode(ev.clientX, ev.clientY + scrollOffset(), reach);
    if (src < 0) return;
    // Too many floods at once: let the oldest fade out instead of vanishing.
    var live = waves.filter(function (wave) {
      return !wave.kill;
    });
    if (live.length >= MAX_WAVES) live[0].kill = now;
    fire(src, now, CLICK_HOPS);
    lastWave = now; // hold off the next ambient flood so the two don't pile up
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
