// Loss-landscape backdrop: faint contour lines of a classic optimization test
// function (Himmelblau, Rosenbrock, six-hump camel, Beale) fill the viewport and
// slowly morph from one function into the next. Clicking any empty spot starts
// SGD, momentum, Adam and Muon from that point so they race down the surface; when
// nobody clicks for a while, a run starts on its own in a margin.
// Each surface is zoomed, flipped or shifted so its minima and valley floors
// stay clear of anything marked data-landscape-avoid (the profile photo), and a
// gentle hill under each such element keeps any run from coming to rest there.
// A caption in the bottom-left corner names the surface, shows its formula and
// explains the click, wherever there is room for it beside the text; where
// there isn't (on a phone), the page's HTML copy of it is shown instead.
// Everything is dimmed behind the main column, pauses when the tab is hidden,
// draws finished paths instead of animating under prefers-reduced-motion, and
// takes its colors from the --landscape-* custom properties, so it follows the
// site's light/dark theme.
(function () {
  "use strict";

  var canvas = document.getElementById("ambient-field");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var root = document.documentElement;
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduce = motion ? motion.matches : false;

  var TAU = Math.PI * 2;
  var HOLD = 24; // seconds on each surface
  var MORPH = 7; // seconds to morph into the next
  var LEVELS = 14; // contour levels; every fourth is drawn heavier
  var CELL = 12; // contour grid spacing, px
  var TICK = 1 / 30; // optimizer step interval, s
  var LR = [0.0007, 0.00012, 0.0028, 0.0035]; // SGD, momentum, Adam, Muon: tuned so each shows its textbook behavior
  var MUON_BETA = 0.95; // Muon's momentum
  var MUON_DECAY = 360; // ticks over which Muon's rate decays to zero (12 s)
  var MUON_SETTLE = 20; // update norm below which Muon's step shrinks with it, so it settles instead of jittering
  var MAX_STEP = 0.012; // largest step per tick, in viewport fractions
  var TRAIL = 160; // ticks of trail kept per optimizer
  var LIFE = 16; // seconds a run lasts before it fades
  var FADE = 2.5;
  var MAX_RUNS = 4; // runs (of three optimizers each) on screen at once
  var AUTO_FIRST = 1.5; // seconds before the first unprompted run
  var AUTO_GAP = 7; // seconds of an empty screen before the next one
  var TEXT_DIM = 0.3; // contour opacity kept behind the main column
  var RUN_DIM = 0.6; // run opacity kept behind the main column
  var FEATHER = 90; // px over which the column dimming blends in
  var FRAME_MS = 30; // about 30 fps is plenty for motion this slow
  var DRIFT_X = 0.03; // slow wander of the whole surface, viewport fractions
  var DRIFT_Y = 0.025;
  var IGNORE =
    'a, button, input, textarea, select, label, summary, details, img, svg, video, audio, iframe, canvas, p, li, dt, dd, h1, h2, h3, h4, h5, h6, pre, code, table, blockquote, figure, nav, [role="button"], [contenteditable], [data-landscape-avoid], .site-loader';

  // ── Surfaces and optimizers ───────────────────────────────────────────────
  // Each surface is drawn as log(1 + f − fmin), scaled to about [0, 1] over its
  // box, the way these functions are usually plotted. `mins` get a cross;
  // `rest` (filled in below) adds the local minima and flat valley floors where
  // a run can come to a stop, as fractions of the box from its top-left corner.
  var FUNCS = [
    {
      name: "himmelblau",
      formula: ["(x² + y − 11)² + (x + y² − 7)²"],
      box: [-5.5, 5.5, -5.5, 5.5],
      fmin: 0,
      f: function (x, y) {
        var a = x * x + y - 11,
          b = x + y * y - 7;
        return a * a + b * b;
      },
      mins: [
        [3, 2],
        [-2.805, 3.131],
        [-3.779, -3.283],
        [3.584, -1.848],
      ],
    },
    {
      name: "rosenbrock",
      formula: ["(1 − x)² + 100 (y − x²)²"],
      box: [-2.2, 2.2, -1.2, 3.2],
      fmin: 0,
      f: function (x, y) {
        var a = 1 - x,
          b = y - x * x;
        return a * a + 100 * b * b;
      },
      mins: [[1, 1]],
    },
    {
      name: "six-hump camel",
      formula: ["(4 − 2.1x² + x⁴/3) x² + xy", "+ (4y² − 4) y²"],
      box: [-2.2, 2.2, -1.25, 1.25],
      fmin: -1.0316,
      f: function (x, y) {
        var x2 = x * x,
          y2 = y * y;
        return (4 - 2.1 * x2 + (x2 * x2) / 3) * x2 + x * y + (4 * y2 - 4) * y2;
      },
      mins: [
        [0.0898, -0.7126],
        [-0.0898, 0.7126],
      ],
    },
    {
      name: "beale",
      formula: ["(1.5 − x + xy)² + (2.25 − x + xy²)²", "+ (2.625 − x + xy³)²"],
      box: [-4.5, 4.5, -4.5, 4.5],
      fmin: 0,
      f: function (x, y) {
        var a = 1.5 - x + x * y,
          b = 2.25 - x + x * y * y,
          c = 2.625 - x + x * y * y * y;
        return a * a + b * b + c * c;
      },
      mins: [[3, 0.5]],
    },
  ];
  FUNCS.forEach(function (F) {
    var b = F.box,
      N = 160,
      S = N + 1,
      v = new Float64Array(S * S),
      max = 0,
      i,
      j;
    for (j = 0; j <= N; j++) {
      for (i = 0; i <= N; i++) {
        v[j * S + i] = F.f(b[0] + (i / N) * (b[1] - b[0]), b[3] - (j / N) * (b[3] - b[2])) - F.fmin;
        max = Math.max(max, v[j * S + i]);
      }
    }
    F.L = Math.log(1 + max);
    F.rest = F.mins.map(function (m) {
      return [(m[0] - b[0]) / (b[1] - b[0]), (b[3] - m[1]) / (b[3] - b[2]), true];
    });
    for (j = 1; j < N; j++) {
      for (i = 1; i < N; i++) {
        var c = v[j * S + i],
          low = true;
        for (var dj = -1; dj <= 1 && low; dj++) {
          for (var di = -1; di <= 1; di++) {
            if ((di || dj) && v[(j + dj) * S + i + di] <= c) {
              low = false;
              break;
            }
          }
        }
        if (low) F.rest.push([i / N, j / N, false]);
      }
    }
    F.T = { fx: 0, fy: 0, z: 1, ox: 0, oy: 0 };
  });

  // Viewport fraction → fraction of the surface's box, through the surface's
  // own zoom, flips and offset (chosen in fit()), and back again.
  function toBox(T, px, py) {
    var sx = 0.5 + (px - 0.5) * T.z,
      sy = 0.5 + (py - 0.5) * T.z;
    return [(T.fx ? 1 - sx : sx) + T.ox, (T.fy ? 1 - sy : sy) + T.oy];
  }
  function toView(T, qx, qy) {
    var sx = qx - T.ox,
      sy = qy - T.oy;
    if (T.fx) sx = 1 - sx;
    if (T.fy) sy = 1 - sy;
    return [0.5 + (sx - 0.5) / T.z, 0.5 + (sy - 0.5) / T.z];
  }
  function surface(F, px, py) {
    var q = toBox(F.T, px, py),
      b = F.box;
    var v = F.f(b[0] + q[0] * (b[1] - b[0]), b[3] - q[1] * (b[3] - b[2])) - F.fmin;
    return Math.log(1 + Math.max(0, v)) / F.L;
  }

  // Hills under the avoided elements: (1 − r²)² inside an ellipse, so the
  // surface stays smooth and slopes away from each element's center.
  var hills = []; // { cx, cy, rx, ry, h } in viewport fractions
  function hill(px, py) {
    var h = 0;
    for (var i = 0; i < hills.length; i++) {
      var k = hills[i],
        dx = (px - k.cx) / k.rx,
        dy = (py - k.cy) / k.ry,
        r2 = dx * dx + dy * dy;
      if (r2 < 1) h += k.h * (1 - r2) * (1 - r2);
    }
    return h;
  }

  var clock = 0; // seconds of motion so far; stands still while paused
  // a: current surface, b: the one it is morphing into (or null), m: how far.
  var st = { a: 0, b: null, m: 0, phase: 0, morphAt: 0, dx: 0, dy: 0, runs: [], ripples: [], acc: 0, emptySince: 0, autoDelay: AUTO_FIRST };

  // The loss at a viewport fraction: the current surface, blended into the
  // next while it morphs and wandering a little, plus the hills.
  function loss(px, py) {
    var qx = px + st.dx,
      qy = py + st.dy,
      g = surface(FUNCS[st.a], qx, qy);
    if (st.b !== null) g = (1 - st.m) * g + st.m * surface(FUNCS[st.b], qx, qy);
    return g + hill(px, py);
  }

  function advanceSurface(t) {
    if (st.b === null && t - st.phase >= HOLD) {
      st.b = (st.a + 1) % FUNCS.length;
      st.morphAt = t;
    }
    if (st.b !== null) {
      st.m = ease((t - st.morphAt) / MORPH);
      if (t - st.morphAt >= MORPH) {
        st.a = st.b;
        st.b = null;
        st.m = 0;
        st.phase = t;
      }
    }
    st.dx = DRIFT_X * Math.sin((TAU * t) / 71);
    st.dy = DRIFT_Y * Math.sin((TAU * t) / 53 + 1);
  }

  // kind 0: SGD, 1: SGD with momentum 0.9, 2: Adam, 3: Muon. Positions are
  // viewport fractions, so a resize leaves every run where it was.
  function optimizer(kind, x, y) {
    return { kind: kind, x: x, y: y, vx: 0, vy: 0, k: 0, mx: 0, my: 0, sx: 0, sy: 0, trail: [[x, y]], still: 0, settledAt: null };
  }
  function stepOptimizer(o) {
    var e = 0.0015;
    var gx = (loss(o.x + e, o.y) - loss(o.x - e, o.y)) / (2 * e);
    var gy = (loss(o.x, o.y + e) - loss(o.x, o.y - e)) / (2 * e);
    var dx, dy;
    if (o.kind === 0) {
      dx = -LR[0] * gx;
      dy = -LR[0] * gy;
    } else if (o.kind === 1) {
      o.vx = 0.9 * o.vx - LR[1] * gx;
      o.vy = 0.9 * o.vy - LR[1] * gy;
      dx = o.vx;
      dy = o.vy;
    } else if (o.kind === 2) {
      o.k++;
      o.mx = 0.9 * o.mx + 0.1 * gx;
      o.my = 0.9 * o.my + 0.1 * gy;
      o.sx = 0.999 * o.sx + 0.001 * gx * gx;
      o.sy = 0.999 * o.sy + 0.001 * gy * gy;
      var c1 = 1 - Math.pow(0.9, o.k),
        c2 = 1 - Math.pow(0.999, o.k);
      dx = (-LR[2] * (o.mx / c1)) / (Math.sqrt(o.sx / c2) + 1e-8);
      dy = (-LR[2] * (o.my / c1)) / (Math.sqrt(o.sy / c2) + 1e-8);
    } else {
      // Muon: Nesterov momentum, then five Newton–Schulz iterations to
      // orthogonalize the update. The point is a 1×2 matrix, for which that
      // keeps the direction and brings the length close to one, so the step
      // size comes from the rate, decayed linearly as Muon is usually run.
      // A unit-length step never shrinks near a minimum, so it would hop
      // across it every tick until the decay ran out; below MUON_SETTLE the
      // step scales with the update's norm and Muon settles like the others.
      o.k++;
      o.mx = MUON_BETA * o.mx + gx;
      o.my = MUON_BETA * o.my + gy;
      var ux = gx + MUON_BETA * o.mx,
        uy = gy + MUON_BETA * o.my,
        un = Math.hypot(ux, uy) + 1e-12;
      ux /= un;
      uy /= un;
      for (var it = 0; it < 5; it++) {
        var a2 = ux * ux + uy * uy,
          s = 3.4445 - 4.775 * a2 + 2.0315 * a2 * a2;
        ux *= s;
        uy *= s;
      }
      var rate = LR[3] * Math.max(0, 1 - o.k / MUON_DECAY) * Math.min(1, un / MUON_SETTLE);
      dx = -rate * ux;
      dy = -rate * uy;
    }
    var n = Math.hypot(dx, dy);
    if (n > MAX_STEP) {
      dx *= MAX_STEP / n;
      dy *= MAX_STEP / n;
      if (o.kind === 1) {
        o.vx = dx;
        o.vy = dy;
      }
    }
    o.x = clamp(o.x + dx, -0.05, 1.05);
    o.y = clamp(o.y + dy, -0.05, 1.05);
    o.trail.push([o.x, o.y]);
    if (o.trail.length > TRAIL) o.trail.shift();
    o.still = n < 0.00035 ? o.still + 1 : 0;
    if (o.still === 20 && o.settledAt === null) o.settledAt = clock;
  }
  function stepRuns() {
    st.runs.forEach(function (run) {
      run.opt.forEach(stepOptimizer);
    });
  }

  // Signed distance from a point to a zone (negative inside), px.
  function outside(z, X, Y) {
    var dx = Math.max(z.l - X, 0, X - z.r),
      dy = Math.max(z.t - Y, 0, Y - z.b);
    if (dx || dy) return Math.hypot(dx, dy);
    return -Math.min(X - z.l, z.r - X, Y - z.t, z.b - Y);
  }

  // For each surface, the zoom, flips and offset that keep its minima clear of
  // the zones and on screen, with as few valley floors under a zone as
  // possible, preferring the plainest transform that does. `zones` are padded
  // for the drift; `top` is where the visible area starts below the navbar.
  var ZOOMS = [1, 0.9, 1.1, 1.2];
  var OFFSETS = [0, -0.05, 0.05, -0.1, 0.1, -0.15, 0.15];
  function fit(W, H, zones, top) {
    FUNCS.forEach(function (F) {
      if (!zones.length) {
        F.T = { fx: 0, fy: 0, z: 1, ox: 0, oy: 0 };
        return;
      }
      var best = null;
      for (var flip = 0; flip < 4; flip++) {
        ZOOMS.forEach(function (z) {
          OFFSETS.forEach(function (ox) {
            OFFSETS.forEach(function (oy) {
              var T = { fx: flip & 1, fy: flip >> 1, z: z, ox: ox, oy: oy },
                clear = Infinity,
                hidden = 0;
              F.rest.forEach(function (q) {
                var p = toView(T, q[0], q[1]),
                  X = p[0] * W,
                  Y = p[1] * H,
                  seen = X > 0.04 * W && X < 0.96 * W && Y > top && Y < 0.95 * H,
                  d = Infinity;
                zones.forEach(function (zone) {
                  d = Math.min(d, outside(zone, X, Y));
                });
                if (q[2]) clear = Math.min(clear, seen ? d : -1e4);
                else if (seen && d < 0) hidden++;
              });
              var cost = 15 * (T.fx + T.fy) + 200 * Math.abs(z - 1) + 150 * (Math.abs(ox) + Math.abs(oy));
              var rank = (clear > 0 ? 1e6 : 0) + Math.min(clear, 150) - 30 * hidden - cost;
              if (!best || rank > best.rank) best = { rank: rank, T: T };
            });
          });
        });
      }
      F.T = best.T;
    });
  }

  // One hill per avoided element (`rects`, unpadded, px), raised until no
  // surface has a resting point under the element at any extreme of the drift.
  function raiseHills(W, H, rects) {
    hills = rects.map(function (r) {
      return {
        cx: (r.l + r.r) / 2 / W,
        cy: (r.t + r.b) / 2 / H,
        rx: (((r.r - r.l) / 2 + 16) * 1.45) / W,
        ry: (((r.b - r.t) / 2 + 16) * 1.45) / H,
        h: 0.3,
      };
    });
    var drifts = [
      [0, 0],
      [DRIFT_X, DRIFT_Y],
      [DRIFT_X, -DRIFT_Y],
      [-DRIFT_X, DRIFT_Y],
      [-DRIFT_X, -DRIFT_Y],
    ];
    rects.forEach(function (r, i) {
      for (var tries = 0; tries < 5 && restsUnder(r, W, H, drifts); tries++) hills[i].h *= 1.7;
    });
  }
  function restsUnder(r, W, H, drifts) {
    var s = 8,
      nx = Math.ceil((r.r - r.l) / s) + 3,
      ny = Math.ceil((r.b - r.t) / s) + 3,
      v = new Float64Array(nx * ny);
    return FUNCS.some(function (F) {
      return drifts.some(function (d) {
        var i, j;
        for (j = 0; j < ny; j++) {
          for (i = 0; i < nx; i++) {
            var px = (r.l + (i - 1) * s) / W,
              py = (r.t + (j - 1) * s) / H;
            v[j * nx + i] = surface(F, px + d[0], py + d[1]) + hill(px, py);
          }
        }
        for (j = 1; j < ny - 1; j++) {
          for (i = 1; i < nx - 1; i++) {
            var c = v[j * nx + i],
              low = true;
            for (var dj = -1; dj <= 1 && low; dj++) {
              for (var di = -1; di <= 1; di++) {
                if ((di || dj) && v[(j + dj) * nx + i + di] <= c) {
                  low = false;
                  break;
                }
              }
            }
            if (low) return true;
          }
        }
        return false;
      });
    });
  }

  function ease(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  var W = 0,
    H = 0,
    DPR = 1,
    colLeft = 0,
    colRight = 0,
    top = 0;
  var zones = []; // avoided areas, padded for the drift, px
  var paths = null; // contour Path2Ds for the current frame, one per level
  var frames = 0;
  var colors = { line: "168, 100, 21", opt: ["168, 100, 21", "70, 104, 160", "38, 128, 108", "132, 84, 160"], label: "#656d76", alpha: 0.5 };

  function theme() {
    var cs = getComputedStyle(root);
    function read(name, fallback) {
      return cs.getPropertyValue(name).trim() || fallback;
    }
    colors = {
      line: read("--landscape-line", colors.line),
      opt: [
        read("--landscape-sgd", colors.opt[0]),
        read("--landscape-momentum", colors.opt[1]),
        read("--landscape-adam", colors.opt[2]),
        read("--landscape-muon", colors.opt[3]),
      ],
      label: read("--global-text-color-light", colors.label),
      alpha: parseFloat(read("--landscape-alpha", colors.alpha)) || 0.5,
    };
  }

  function isFixed(el) {
    for (; el && el !== document.body; el = el.parentElement) if (getComputedStyle(el).position === "fixed") return true;
    return false;
  }

  // Measure the viewport, the main column, the navbar and the avoided
  // elements, then fit every surface around them. An avoided element in a
  // fixed panel stays put on screen; one in the page sweeps upward as you
  // scroll, so its area runs from the top of the viewport down to where it starts.
  function layout() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);

    var main = document.querySelector('[role="main"]');
    var r = main ? main.getBoundingClientRect() : { left: W * 0.2, right: W * 0.8 };
    colLeft = r.left;
    colRight = r.right;
    var nav = document.querySelector(".navbar");
    top = (nav && isFixed(nav) ? nav.getBoundingClientRect().bottom : 0) + 24;

    var rects = [];
    document.querySelectorAll("[data-landscape-avoid]").forEach(function (el) {
      var b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      if (isFixed(el)) rects.push({ l: b.left, r: b.right, t: b.top, b: b.bottom });
      else rects.push({ l: b.left, r: b.right, t: 0, b: Math.min(H, b.bottom + window.scrollY) });
    });
    var padX = DRIFT_X * W + 24,
      padY = DRIFT_Y * H + 24;
    zones = rects.map(function (z) {
      return { l: z.l - padX, r: z.r + padX, t: z.t - padY, b: z.b + padY };
    });
    fit(W, H, zones, top);
    raiseHills(W, H, rects);
    fitCaption();
    paths = null;
    draw();
  }

  // Marching squares: for each corner pattern, which cell edges the contour
  // joins (0 top, 1 right, 2 bottom, 3 left).
  var SEG = [[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0], [3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], []];
  function edgePoint(n, x0, y0, a, b, c, d, L) {
    if (n === 0) return [x0 + (CELL * (L - a)) / (b - a), y0];
    if (n === 1) return [x0 + CELL, y0 + (CELL * (L - b)) / (c - b)];
    if (n === 2) return [x0 + (CELL * (L - d)) / (c - d), y0 + CELL];
    return [x0, y0 + (CELL * (L - a)) / (d - a)];
  }
  function contours() {
    var nx = Math.ceil(W / CELL) + 1,
      ny = Math.ceil(H / CELL) + 1,
      v = new Float32Array(nx * ny),
      i,
      j,
      k,
      e;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) v[j * nx + i] = loss((i * CELL) / W, (j * CELL) / H);
    // One pass of a 3×3 blur: a valley floor thinner than a cell (Rosenbrock's)
    // would otherwise break into a chain of tiny loops. Runs use the exact loss.
    var s = new Float32Array(nx * ny);
    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        var sum = 0,
          wsum = 0;
        for (var dj = -1; dj <= 1; dj++) {
          for (var di = -1; di <= 1; di++) {
            if (i + di < 0 || j + dj < 0 || i + di >= nx || j + dj >= ny) continue;
            var w = (di ? 1 : 2) * (dj ? 1 : 2);
            sum += w * v[(j + dj) * nx + i + di];
            wsum += w;
          }
        }
        s[j * nx + i] = sum / wsum;
      }
    }
    v = s;
    paths = [];
    for (k = 0; k < LEVELS; k++) {
      var L = 0.035 + k * 0.068,
        P = new Path2D();
      for (j = 0; j < ny - 1; j++) {
        for (i = 0; i < nx - 1; i++) {
          var a = v[j * nx + i],
            b = v[j * nx + i + 1],
            c = v[(j + 1) * nx + i + 1],
            d = v[(j + 1) * nx + i];
          var idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          for (e = 0; e < SEG[idx].length; e += 2) {
            var p = edgePoint(SEG[idx][e], i * CELL, j * CELL, a, b, c, d, L),
              q = edgePoint(SEG[idx][e + 1], i * CELL, j * CELL, a, b, c, d, L);
            P.moveTo(p[0], p[1]);
            P.lineTo(q[0], q[1]);
          }
        }
      }
      paths.push({ path: P, index: k % 4 === 0 });
    }
  }

  // Knock the contours back behind the main column by erasing part of what was
  // drawn there, with feathered edges so the dimming has no visible seam.
  function dimColumn() {
    if (colRight - colLeft < 1) return;
    var l = colLeft - FEATHER,
      r = colRight + FEATHER,
      k = 1 - TEXT_DIM,
      f = FEATHER / (r - l);
    var g = ctx.createLinearGradient(l, 0, r, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(f, "rgba(0,0,0," + k + ")");
    g.addColorStop(1 - f, "rgba(0,0,0," + k + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(l, 0, r - l, H);
    ctx.globalCompositeOperation = "source-over";
  }
  // Runs are drawn after the dimming, only a little softer behind the column.
  function columnFade(X) {
    return 1 - (1 - RUN_DIM) * ease((X - colLeft + FEATHER) / FEATHER) * ease((colRight + FEATHER - X) / FEATHER);
  }

  // SGD a dot, momentum a ring, Adam a diamond, Muon a triangle: shape as
  // well as color.
  function mark(kind, X, Y) {
    ctx.beginPath();
    if (kind === 0) {
      ctx.arc(X, Y, 3.2, 0, TAU);
      ctx.fill();
    } else if (kind === 1) {
      ctx.lineWidth = 1.6;
      ctx.arc(X, Y, 3.4, 0, TAU);
      ctx.stroke();
    } else if (kind === 2) {
      ctx.moveTo(X, Y - 4.2);
      ctx.lineTo(X + 4.2, Y);
      ctx.lineTo(X, Y + 4.2);
      ctx.lineTo(X - 4.2, Y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.moveTo(X, Y - 4.4);
      ctx.lineTo(X + 4.2, Y + 3.2);
      ctx.lineTo(X - 4.2, Y + 3.2);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawOptimizer(o, fade) {
    var rgb = "rgb(" + colors.opt[o.kind] + ")",
      A = colors.alpha,
      tr = o.trail,
      n = tr.length,
      X = o.x * W,
      Y = o.y * H,
      cf = columnFade(X);
    ctx.strokeStyle = ctx.fillStyle = rgb;
    ctx.lineWidth = 1.2;
    // The trail in chunks, older chunks fainter.
    for (var s0 = 0; s0 < n - 1; s0 += 20) {
      var s1 = Math.min(n - 1, s0 + 20);
      ctx.globalAlpha = A * 1.15 * fade * cf * (0.15 + (0.85 * s1) / n);
      ctx.beginPath();
      ctx.moveTo(tr[s0][0] * W, tr[s0][1] * H);
      for (var i = s0 + 1; i <= s1; i++) ctx.lineTo(tr[i][0] * W, tr[i][1] * H);
      ctx.stroke();
    }
    ctx.globalAlpha = Math.min(1, A * 1.8 * fade * cf);
    mark(o.kind, X, Y);
    if (o.settledAt !== null && clock - o.settledAt < 0.9) {
      var q = (clock - o.settledAt) / 0.9;
      ctx.globalAlpha = A * 1.2 * (1 - q) * fade * cf;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X, Y, 5 + 10 * ease(q), 0, TAU);
      ctx.stroke();
    }
  }

  function draw() {
    if (!W) return;
    if (!paths || reduce || !raf || frames % 2 === 0) contours();
    var A = colors.alpha;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = "rgb(" + colors.line + ")";
    paths.forEach(function (P) {
      ctx.globalAlpha = A * (P.index ? 0.42 : 0.22);
      ctx.lineWidth = P.index ? 1.3 : 1;
      ctx.stroke(P.path);
    });

    // A cross on each global minimum of the current surface (and of the next
    // one while it morphs in).
    ctx.lineWidth = 1.1;
    [
      [st.a, st.b === null ? 1 : 1 - st.m],
      [st.b, st.m],
    ].forEach(function (pair) {
      if (pair[0] === null || pair[1] <= 0.01) return;
      var F = FUNCS[pair[0]],
        b = F.box;
      ctx.globalAlpha = A * 0.8 * pair[1];
      F.mins.forEach(function (m) {
        var p = toView(F.T, (m[0] - b[0]) / (b[1] - b[0]), (b[3] - m[1]) / (b[3] - b[2]));
        var X = (p[0] - st.dx) * W,
          Y = (p[1] - st.dy) * H;
        ctx.beginPath();
        ctx.moveTo(X - 3.5, Y - 3.5);
        ctx.lineTo(X + 3.5, Y + 3.5);
        ctx.moveTo(X + 3.5, Y - 3.5);
        ctx.lineTo(X - 3.5, Y + 3.5);
        ctx.stroke();
      });
    });
    dimColumn();

    st.ripples.forEach(function (r) {
      var q = (clock - r.t) / 0.9,
        X = r.x * W,
        Y = r.y * H;
      ctx.globalAlpha = A * 1.2 * (1 - q) * columnFade(X);
      ctx.strokeStyle = "rgb(" + colors.opt[0] + ")";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(X, Y, 4 + 22 * ease(q), 0, TAU);
      ctx.stroke();
    });
    st.runs.forEach(function (run) {
      var fade = Math.min(reduce ? 1 : ease((clock - run.born) / 0.3), run.fadeAt === null ? 1 : 1 - ease((clock - run.fadeAt) / FADE));
      if (run.auto) fade *= 0.8;
      run.opt.forEach(function (o) {
        drawOptimizer(o, fade);
      });
    });
    drawCaption();
    ctx.globalAlpha = 1;
  }

  // ── Caption ───────────────────────────────────────────────────────────────
  // Bottom-left, from the top down: "the background is a loss landscape ·
  // <surface>", its formula,
  // the legend and how to start a run (the footer says it is all computed in
  // the browser). When the surface changes, its name and formula fade out
  // before the next one's fade in, so the two never overlap, and the contours
  // are cleared from behind the caption so it stays legible.
  // It is drawn only where no text can sit on it: left of the scrolling
  // content (the element marked data-landscape-content, else the main
  // column), clear of fixed panels, above a fixed footer. The formula goes on
  // one line, in a slightly smaller face if that is what it takes; shorter
  // versions (with just "loss landscape ·", then the formula broken over two
  // lines, then without it, then without the hint) are tried in turn.
  var MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
  var FONT_NAME = "500 11px " + MONO,
    FONT_PREFIX = "11px " + MONO,
    FONT_TEXT = "11px " + MONO,
    FONT_NOTE = "10.5px " + MONO;
  var PREFIX = "the background is a loss landscape · ",
    PREFIX_SHORT = "loss landscape · ";
  var LEGEND = ["sgd", "momentum", "adam", "muon"];
  var NOTES = ["click any empty spot to race them downhill"];
  var VERSIONS = [
    { prefix: PREFIX, formula: "line", notes: true },
    { prefix: PREFIX_SHORT, formula: "line", notes: true },
    { prefix: PREFIX_SHORT, formula: "wrap", notes: true },
    { prefix: PREFIX_SHORT, formula: false, notes: true },
    { prefix: PREFIX_SHORT, formula: false, notes: false },
  ];
  var FORMULA_MIN = 9.5; // px a one-line formula may shrink to
  var formulaPx = 11; // its size in the fitted caption
  var caption = null; // { x, y: baseline of the bottom line, version, w, up }
  // The HTML copy (on the about page, after the About section), shown when
  // the canvas has no room for the caption.
  var html = document.querySelector("[data-landscape-caption]"),
    htmlName = html && html.querySelector("[data-landscape-name]"),
    htmlFormula = html && html.querySelector("[data-landscape-formula]"),
    htmlShown = { k: -1, alpha: -1 };

  // The caption's lines for surface F, bottom first; `y` is each baseline's
  // offset from the bottom one.
  function captionLines(version, F) {
    var lines = [],
      y = 0,
      i;
    if (version.notes) {
      for (i = NOTES.length - 1; i >= 0; i--) {
        lines.push({ kind: "note", text: NOTES[i], y: y });
        y -= 15;
      }
      y -= 3;
    }
    lines.push({ kind: "legend", y: y });
    y -= 22;
    if (version.formula) {
      var parts = version.formula === "wrap" ? F.formula : [F.formula.join(" ")];
      for (i = parts.length - 1; i >= 0; i--) {
        lines.push({ kind: "formula", text: (i ? "    " : "f = ") + parts[i], y: y });
        y -= 15;
      }
      y -= 3;
    }
    lines.push({ kind: "name", prefix: version.prefix, text: F.name, y: y });
    return lines;
  }

  function lineFont(line) {
    if (line.kind === "note") return FONT_NOTE;
    if (line.kind === "formula") return formulaPx + "px " + MONO;
    return FONT_TEXT;
  }

  function lineWidth(line) {
    if (line.kind === "legend") {
      ctx.font = FONT_TEXT;
      return LEGEND.reduce(function (sum, name) {
        return sum + 13 + ctx.measureText(name).width + 16;
      }, -16);
    }
    if (line.kind === "name") {
      ctx.font = FONT_PREFIX;
      var w = ctx.measureText(line.prefix).width;
      ctx.font = FONT_NAME;
      return w + ctx.measureText(line.text).width;
    }
    ctx.font = lineFont(line);
    return ctx.measureText(line.text).width;
  }

  // Widest and tallest over every surface, so the caption never outgrows the
  // space it was fitted to when the surface changes.
  function captionSize(version) {
    var w = 0,
      up = 0;
    FUNCS.forEach(function (F) {
      captionLines(version, F).forEach(function (line) {
        w = Math.max(w, lineWidth(line));
        up = Math.max(up, 12 - line.y);
      });
    });
    return { w: w, up: up };
  }

  function fitCaption() {
    caption = null;
    var marked = document.querySelector("[data-landscape-content]"),
      content = marked || document.querySelector('[role="main"]');
    if (!content) return;
    var right = content.getBoundingClientRect().left + (marked ? 0 : parseFloat(getComputedStyle(content).paddingLeft) || 0);
    var foot = document.querySelector("footer"),
      bottom = (foot && isFixed(foot) ? foot.getBoundingClientRect().top : H) - 20,
      x = 22;
    VERSIONS.some(function (version) {
      var min = version.formula === "line" ? FORMULA_MIN : 11;
      for (formulaPx = 11; formulaPx >= min; formulaPx -= 0.5) {
        var size = captionSize(version),
          box = { l: x - 4, r: x + size.w + 4, t: bottom - size.up - 4, b: bottom + 6 };
        if (box.r > right - 16) continue;
        if (box.t < top || fixedUnder(box)) return false;
        caption = { x: x, y: bottom, version: version, w: size.w, up: size.up };
        return true;
      }
      return false;
    });
    if (html) {
      html.hidden = !!caption;
      htmlShown.k = -1; // fit its formula again at the new width
    }
  }

  // Keep the HTML copy on the surface being drawn, fading its name and formula
  // across a morph the way the canvas caption does.
  function updateHtmlCaption(k, shown) {
    if (!html || html.hidden) return;
    if (k !== htmlShown.k) {
      htmlShown.k = k;
      htmlName.textContent = FUNCS[k].name;
      // One line, shrunk to the column's width if it has to be.
      htmlFormula.textContent = "f = " + FUNCS[k].formula.join(" ");
      htmlFormula.style.fontSize = "";
      var over = htmlFormula.scrollWidth / htmlFormula.clientWidth;
      if (over > 1) htmlFormula.style.fontSize = Math.max(8, Math.floor(22 / over) / 2) + "px";
    }
    var alpha = Math.round(shown * 20) / 20;
    if (alpha !== htmlShown.alpha) {
      htmlShown.alpha = alpha;
      htmlName.style.opacity = htmlFormula.style.opacity = alpha;
    }
  }

  // Whether a fixed element (the profile panel, say) covers any part of `box`.
  function fixedUnder(box) {
    if (!document.elementsFromPoint) return false;
    var seen = new Map();
    for (var y = box.t; y <= box.b; y += 12) {
      for (var x = box.l; x <= box.r; x += 12) {
        var els = document.elementsFromPoint(x, y);
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (el === root || el === document.body || el === canvas || el.closest(".site-loader")) continue;
          if (!seen.has(el)) seen.set(el, isFixed(el));
          if (seen.get(el)) return true;
        }
      }
    }
    return false;
  }

  function roundedRect(l, t, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(l + r, t);
    ctx.arcTo(l + w, t, l + w, t + h, r);
    ctx.arcTo(l + w, t + h, l, t + h, r);
    ctx.arcTo(l, t + h, l, t, r);
    ctx.arcTo(l, t, l + w, t, r);
    ctx.closePath();
  }

  function drawCaption() {
    var k = st.b !== null && st.m >= 0.5 ? st.b : st.a,
      shown = st.b === null ? 1 : ease(Math.abs(st.m - 0.5) / 0.15);
    updateHtmlCaption(k, shown);
    if (!caption) return;
    var x = caption.x,
      y = caption.y,
      l = x - 10,
      t = y - caption.up - 6,
      w = caption.w + 20,
      h = caption.up + 14;

    // Clear the contours (and any run passing by) from behind the text, with
    // a soft edge so it doesn't read as a box.
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 0.2;
    for (var i = 5; i >= 1; i--) {
      roundedRect(l - i * 4, t - i * 4, w + i * 8, h + i * 8, 10 + i * 4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    roundedRect(l, t, w, h, 10);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    captionLines(caption.version, FUNCS[k]).forEach(function (line) {
      var ly = y + line.y;
      if (line.kind === "legend") {
        var lx = x;
        ctx.font = FONT_TEXT;
        ctx.globalAlpha = 1;
        LEGEND.forEach(function (name, n) {
          ctx.strokeStyle = ctx.fillStyle = "rgb(" + colors.opt[n] + ")";
          mark(n, lx + 4, ly - 4);
          ctx.fillStyle = colors.label;
          ctx.fillText(name, lx + 13, ly);
          lx += 13 + ctx.measureText(name).width + 16;
        });
      } else if (line.kind === "name") {
        ctx.font = FONT_PREFIX;
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.label;
        ctx.fillText(line.prefix, x, ly);
        var px = x + ctx.measureText(line.prefix).width;
        ctx.font = FONT_NAME;
        ctx.globalAlpha = shown;
        ctx.fillStyle = "rgb(" + colors.line + ")";
        ctx.fillText(line.text, px, ly);
      } else {
        ctx.font = lineFont(line);
        ctx.globalAlpha = line.kind === "formula" ? shown : 1;
        ctx.fillStyle = colors.label;
        ctx.fillText(line.text, x, ly);
      }
    });
  }

  // ── Interaction and timing ────────────────────────────────────────────────
  function start(x, y, auto) {
    var run = { born: clock, fadeAt: null, auto: auto, opt: [optimizer(0, x, y), optimizer(1, x, y), optimizer(2, x, y), optimizer(3, x, y)] };
    st.runs.push(run);
    var live = st.runs.filter(function (r) {
      return r.fadeAt === null;
    });
    if (live.length > MAX_RUNS) live[0].fadeAt = clock;
    if (reduce) {
      // No motion: work the whole run out now and show it as a finished path.
      for (var i = 0; i < 300; i++) run.opt.forEach(stepOptimizer);
      draw();
    } else {
      st.ripples.push({ x: x, y: y, t: clock });
    }
  }

  // Somewhere for an unprompted run to start: in a side margin if there is
  // room, clear of the avoided areas, fairly high up the surface.
  function autoStart() {
    var wide = colLeft > 60,
      best = null;
    for (var i = 0; i < 16; i++) {
      var X = wide ? (Math.random() < 0.5 ? rand(0.02 * W, colLeft - 20) : rand(colRight + 20, 0.98 * W)) : rand(0.05 * W, 0.95 * W);
      var Y = rand(top + 0.04 * H, 0.92 * H);
      var free = zones.every(function (z) {
        return outside(z, X, Y) > 0;
      });
      if (!free) continue;
      var g = loss(X / W, Y / H),
        score = g > 0.85 ? 0 : g;
      if (!best || score > best[2]) best = [X / W, Y / H, score];
    }
    if (best) start(best[0], best[1], true);
  }

  function lifecycle() {
    st.runs = st.runs.filter(function (run) {
      if (run.fadeAt === null && clock - run.born >= LIFE) run.fadeAt = clock;
      return run.fadeAt === null || clock - run.fadeAt < FADE;
    });
    st.ripples = st.ripples.filter(function (r) {
      return clock - r.t < 0.9;
    });
    if (st.runs.length) {
      st.emptySince = null;
      return;
    }
    if (st.emptySince === null) {
      st.emptySince = clock;
      st.autoDelay = AUTO_GAP;
    }
    if (clock - st.emptySince >= st.autoDelay) autoStart();
  }

  var raf = null,
    last = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (last && ts - last < FRAME_MS) return;
    var dt = last ? Math.min((ts - last) / 1000, 0.1) : 0;
    last = ts;
    clock += dt;
    advanceSurface(clock);
    st.acc += dt;
    for (var n = 0; st.acc >= TICK && n < 8; n++) {
      stepRuns();
      st.acc -= TICK;
    }
    if (st.acc >= TICK) st.acc = 0;
    lifecycle();
    frames++;
    draw();
  }
  function play() {
    if (reduce || raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  document.addEventListener("click", function (e) {
    if (e.button !== 0 || e.defaultPrevented || !W) return;
    if (!(e.target instanceof Element) || e.target.closest(IGNORE)) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed) return;
    start(e.clientX / W, e.clientY / H, false);
  });

  st.a = Math.floor(Math.random() * FUNCS.length);
  advanceSurface(0);
  theme();
  layout();
  play();

  var rt;
  function relayout() {
    clearTimeout(rt);
    rt = setTimeout(layout, 150);
  }
  window.addEventListener("resize", relayout);
  window.addEventListener("load", relayout);
  // The page loader animates the main column in with a transform, which moves
  // fixed panels inside it while it runs; measure again once its classes change.
  new MutationObserver(relayout).observe(root, { attributes: true, attributeFilter: ["class"] });
  // Text in a fixed panel can change height when its web font arrives, which
  // decides whether the caption fits, so measure again after every font load.
  // The caption's mono face is used only on the canvas, so ask for it explicitly.
  if (document.fonts) {
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", relayout);
    if (document.fonts.ready) document.fonts.ready.then(relayout);
    if (document.fonts.load) Promise.all([document.fonts.load(FONT_TEXT), document.fonts.load(FONT_NAME)]).then(relayout, function () {});
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop();
    else play();
  });
  new MutationObserver(function () {
    theme();
    draw();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  if (motion && motion.addEventListener) {
    motion.addEventListener("change", function (ev) {
      reduce = ev.matches;
      if (reduce) {
        stop();
        draw();
      } else play();
    });
  }
})();
