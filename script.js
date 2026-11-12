"use strict";

(() => {
  const DURATION = 21;
  const TAU = Math.PI * 2;
  const BOTTOM = -1.42;
  const STEM_HEIGHT = 2.45;
  const CAMERA_DISTANCE = 5.5;
  const LEVELS = 12;
  const PETAL_GLYPHS = [".,:", ".,:;", ":;~", "~:=", "~=+", "+=*"];
  const LEAF_GLYPHS = [".,:", ",:;", ";|v", "/|v", "|/+", "+*#"];
  const POLLEN_GLYPHS = [".o", ":o", "o+", "o*", "*0", "*#"];

  const art = document.getElementById("art");
  const glow = document.getElementById("glow");
  const ctx = art.getContext("2d", { alpha: false });
  const gctx = glow.getContext("2d");
  const phaseLabel = document.getElementById("phase");
  const percentLabel = document.getElementById("percent");
  const timeline = document.getElementById("timeline");
  const pauseButton = document.getElementById("pauseButton");
  const pauseLabel = document.getElementById("pauseLabel");
  const replayButton = document.getElementById("replayButton");
  const saveButton = document.getElementById("saveButton");
  const speedButton = document.getElementById("speedButton");
  const SPEEDS = [1, 3, 8];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smooth(a, b, value) {
    const t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function hexRgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function makeRamp(stops, count) {
    const colors = stops.map(hexRgb);
    return Array.from({ length: count }, (_, index) => {
      const p = index / (count - 1) * (colors.length - 1);
      const a = Math.floor(p);
      const b = Math.min(colors.length - 1, a + 1);
      const f = p - a;
      const r = Math.round(mix(colors[a][0], colors[b][0], f));
      const g = Math.round(mix(colors[a][1], colors[b][1], f));
      const blue = Math.round(mix(colors[a][2], colors[b][2], f));
      return "rgb(" + r + "," + g + "," + blue + ")";
    });
  }

  const PALETTES = [
    makeRamp(["#17372f", "#387455", "#a9be7c"], LEVELS),
    makeRamp(["#183731", "#3b795a", "#b3ca8a"], LEVELS),
    makeRamp(["#65445e", "#a96880", "#dba1ad", "#f4d2d2", "#fff2df"], LEVELS),
    makeRamp(["#462b49", "#984865", "#cb6782", "#e590a5", "#ffe4df"], LEVELS),
    makeRamp(["#78502f", "#bb8040", "#e5ac56", "#ffe2a0"], LEVELS),
    makeRamp(["#955a2e", "#d99143", "#f4c36e", "#fff0ad"], LEVELS),
    makeRamp(["#665044", "#a78073", "#ddbd94", "#f5e3bd"], LEVELS)
  ];

  const model = {
    time: 0,
    motion: 0,
    spin: 0,
    running: true,
    speedIndex: 0,
    yaw: 0.62,
    pitch: 0.82,
    dragging: false,
    dragX: 0,
    dragY: 0,
    frameInterval: 1000 / 30,
    cellWidth: 8.8,
    cellHeight: 15.3,
    fontSize: 13,
    width: 0,
    height: 0,
    dpr: 1,
    cols: 0,
    rows: 0,
    focal: 0,
    slow: false,
    dropTimer: 6,
    randomSeed: 23119
  };

  function random() {
    model.randomSeed = (model.randomSeed * 1664525 + 1013904223) >>> 0;
    return model.randomSeed / 4294967296;
  }

  const skyStars = Array.from({ length: 92 }, () => ({
    x: random(),
    y: random(),
    alpha: 0.12 + random() * 0.24,
    glyph: random() > 0.91 ? "+" : "."
  }));

  let meshCount = 0;
  function makeMesh(uSegments, vSegments) {
    const count = (uSegments + 1) * (vSegments + 1);
    return {
      uSegments,
      vSegments,
      id: ++meshCount,
      positions: new Float32Array(count * 3),
      projected: new Float32Array(count * 8)
    };
  }

  const stemMesh = makeMesh(42, 8);
  const leaves = [
    { mesh: makeMesh(27, 10), at: 0.28, angle: 2.62, length: 1.18, width: 0.17, delay: 0.0, bend: 0.11 },
    { mesh: makeMesh(27, 10), at: 0.52, angle: 0.48, length: 1.08, width: 0.16, delay: 0.27, bend: 0.07 },
    { mesh: makeMesh(22, 9), at: 0.72, angle: 3.22, length: 0.86, width: 0.14, delay: 0.46, bend: 0.1 }
  ];
  const petals = Array.from({ length: 6 }, (_, index) => ({
    mesh: makeMesh(34, 12),
    index,
    outer: index % 2 === 0
  }));
  const filaments = Array.from({ length: 6 }, () => makeMesh(14, 7));
  const anthers = Array.from({ length: 6 }, () => makeMesh(10, 8));
  const styleMesh = makeMesh(17, 7);
  const stigmaMesh = makeMesh(10, 10);
  const coreMesh = makeMesh(12, 12);

  let depthBuffer = new Float32Array(0);
  let ownerBuffer = new Uint8Array(0);
  let materialBuffer = new Uint8Array(0);
  let shadeBuffer = new Uint8Array(0);
  let variantBuffer = new Uint8Array(0);
  let uvBuffer = new Float32Array(0);
  let glintBuffer = new Uint8Array(0);
  let spotBuffer = new Uint8Array(0);
  let overrideBuffer = new Uint8Array(0);

  const dust = [];
  const fallingDrops = [];
  const splashes = [];
  let lastFrame = 0;
  let lastDraw = 0;

  function setupSize() {
    model.width = Math.max(1, window.innerWidth);
    model.height = Math.max(1, window.innerHeight);
    const memory = navigator.deviceMemory || 8;
    const cores = navigator.hardwareConcurrency || 8;
    model.slow = model.width < 620 || model.height < 520 || memory <= 4 || cores <= 4;
    model.dpr = Math.min(model.slow ? 1.15 : 1.55, window.devicePixelRatio || 1);
    model.frameInterval = 1000 / (model.slow ? 24 : 30);
    model.cols = clamp(
      Math.floor(model.width / (model.slow ? 9.5 : 7.35)),
      38,
      model.slow ? 116 : 212
    );
    model.cellWidth = model.width / model.cols;
    model.cellHeight = model.cellWidth * 1.68;
    model.fontSize = model.cellWidth * 1.48;
    model.rows = Math.ceil(model.height / model.cellHeight);
    model.focal = Math.min(model.width * 1.32, model.height * 1.32);

    art.width = Math.round(model.width * model.dpr);
    art.height = Math.round(model.height * model.dpr);
    ctx.setTransform(model.dpr, 0, 0, model.dpr, 0, 0);
    ctx.font = model.fontSize + "px 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    glow.width = Math.max(1, Math.ceil(model.width / 3));
    glow.height = Math.max(1, Math.ceil(model.height / 3));

    const cellCount = model.cols * model.rows;
    depthBuffer = new Float32Array(cellCount);
    ownerBuffer = new Uint8Array(cellCount);
    materialBuffer = new Uint8Array(cellCount);
    shadeBuffer = new Uint8Array(cellCount);
    variantBuffer = new Uint8Array(cellCount);
    uvBuffer = new Float32Array(cellCount * 2);
    glintBuffer = new Uint8Array(cellCount);
    spotBuffer = new Uint8Array(cellCount);
    overrideBuffer = new Uint8Array(cellCount);

    const wantedDust = model.slow ? 42 : 78;
    dust.length = 0;
    for (let i = 0; i < wantedDust; i += 1) dust.push(makeDust(true));
    drawScene(0);
  }

  function makeDust(anywhere) {
    return {
      x: random() * model.width,
      y: anywhere ? random() * model.height : model.height + random() * 18,
      speed: 5 + random() * 15,
      drift: 3 + random() * 10,
      phase: random() * TAU,
      glyph: random() > 0.82 ? "*" : "."
    };
  }

  function stemPoint(t, motion) {
    const sway = Math.sin(motion * 0.53) * 0.052;
    return {
      x: sway * t * t + Math.sin(t * 2.15 + motion * 0.26) * 0.025 * t,
      y: BOTTOM + STEM_HEIGHT * t,
      z: Math.sin(t * 1.72 + motion * 0.34) * 0.034 * t
    };
  }

  function bloomState(time, motion) {
    const growth = smooth(0.12, 4.85, time);
    const flowerGrowth = smooth(1.45, 4.9, time);
    const center = stemPoint(growth, motion);
    const open = petals.map((petal) => {
      const amount = petal.outer
        ? smooth(4.65, 11.1, time)
        : smooth(7.35, 16.05, time);
      return amount * flowerGrowth;
    });
    const mean = open.reduce((sum, value) => sum + value, 0) / open.length;
    const angles = petals.map((petal) =>
      petal.index * TAU / 6 + 0.16 + (petal.index % 2 ? 0.045 : -0.035) + model.spin
    );
    return { growth, flowerGrowth, center, open, mean, max: Math.max.apply(null, open), angles };
  }

  function cameraValues() {
    const yaw = model.yaw;
    const pitch = clamp(model.pitch, -0.15, 1.18);
    return {
      cy: Math.cos(yaw),
      sy: Math.sin(yaw),
      cp: Math.cos(pitch),
      sp: Math.sin(pitch),
      distance: CAMERA_DISTANCE
    };
  }

  function projectPoint(x, y, z) {
    const camera = cameraValues();
    const x1 = camera.cy * x + camera.sy * z;
    const z1 = -camera.sy * x + camera.cy * z;
    const y2 = camera.cp * y - camera.sp * z1;
    const z2 = camera.sp * y + camera.cp * z1 + camera.distance;
    const safeZ = Math.max(0.3, z2);
    return [
      model.width * 0.5 + x1 / safeZ * model.focal,
      model.height * 0.58 - y2 / safeZ * model.focal,
      safeZ
    ];
  }

  function projectVertex(x, y, z, nx, ny, nz, u, v, output, offset, camera) {
    const x1 = camera.cy * x + camera.sy * z;
    const z1 = -camera.sy * x + camera.cy * z;
    const y2 = camera.cp * y - camera.sp * z1;
    const z2 = camera.sp * y + camera.cp * z1 + camera.distance;
    const safeZ = Math.max(0.3, z2);
    output[offset] = model.width * 0.5 + x1 / safeZ * model.focal;
    output[offset + 1] = model.height * 0.58 - y2 / safeZ * model.focal;
    output[offset + 2] = safeZ;

    const nx1 = camera.cy * nx + camera.sy * nz;
    const nz1 = -camera.sy * nx + camera.cy * nz;
    output[offset + 3] = nx1;
    output[offset + 4] = camera.cp * ny - camera.sp * nz1;
    output[offset + 5] = camera.sp * ny + camera.cp * nz1;
    output[offset + 6] = u;
    output[offset + 7] = v;
  }

  function rasterTriangle(projected, a, b, c, material, owner, variant) {
    const ax = projected[a], ay = projected[a + 1], az = projected[a + 2];
    const bx = projected[b], by = projected[b + 1], bz = projected[b + 2];
    const cx = projected[c], cy = projected[c + 1], cz = projected[c + 2];
    if (az <= 0.3 || bz <= 0.3 || cz <= 0.3) return;

    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(area) < 0.015) return;
    const minCol = clamp(Math.floor(Math.min(ax, bx, cx) / model.cellWidth), 0, model.cols - 1);
    const maxCol = clamp(Math.floor(Math.max(ax, bx, cx) / model.cellWidth), 0, model.cols - 1);
    const minRow = clamp(Math.floor(Math.min(ay, by, cy) / model.cellHeight), 0, model.rows - 1);
    const maxRow = clamp(Math.floor(Math.max(ay, by, cy) / model.cellHeight), 0, model.rows - 1);
    if (minCol > maxCol || minRow > maxRow) return;

    const lx = -0.42;
    const ly = 0.7;
    const lz = -0.57;
    const ll = Math.hypot(lx, ly, lz);
    const lightX = lx / ll, lightY = ly / ll, lightZ = lz / ll;
    const hx = lightX, hy = lightY, hz = lightZ - 1;
    const hl = Math.hypot(hx, hy, hz);
    const halfX = hx / hl, halfY = hy / hl, halfZ = hz / hl;

    for (let row = minRow; row <= maxRow; row += 1) {
      const py = (row + 0.5) * model.cellHeight;
      for (let col = minCol; col <= maxCol; col += 1) {
        const px = (col + 0.5) * model.cellWidth;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / area;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.002 || w1 < -0.002 || w2 < -0.002) continue;

        const q0 = w0 / az, q1 = w1 / bz, q2 = w2 / cz;
        const q = q0 + q1 + q2;
        if (q <= 0) continue;
        const z = 1 / q;
        const cell = row * model.cols + col;
        if (z >= depthBuffer[cell]) continue;

        let nx = (q0 * projected[a + 3] + q1 * projected[b + 3] + q2 * projected[c + 3]) / q;
        let ny = (q0 * projected[a + 4] + q1 * projected[b + 4] + q2 * projected[c + 4]) / q;
        let nz = (q0 * projected[a + 5] + q1 * projected[b + 5] + q2 * projected[c + 5]) / q;
        const nlen = Math.hypot(nx, ny, nz) || 1;
        nx /= nlen; ny /= nlen; nz /= nlen;
        const u = (q0 * projected[a + 6] + q1 * projected[b + 6] + q2 * projected[c + 6]) / q;
        const v = (q0 * projected[a + 7] + q1 * projected[b + 7] + q2 * projected[c + 7]) / q;

        const diffuse = Math.abs(nx * lightX + ny * lightY + nz * lightZ);
        const specular = Math.pow(Math.max(0, Math.abs(nx * halfX + ny * halfY + nz * halfZ)), 18);
        let brightness = 0.4 + diffuse * 0.42 + specular * 0.15;
        let ridge = 0;
        if (material === 2 || material === 3) {
          ridge = Math.exp(-Math.pow(v / 0.15, 2));
          brightness += ridge * 0.12 + u * 0.055 - Math.abs(v) * 0.065;
        } else if (material === 0 || material === 1) {
          ridge = Math.exp(-Math.pow(v / 0.055, 2));
          brightness += ridge * 0.13;
        } else if (material === 4 || material === 5 || material === 6) {
          brightness += 0.055;
        }
        brightness = clamp(brightness, 0.06, 1);

        depthBuffer[cell] = z;
        ownerBuffer[cell] = owner;
        materialBuffer[cell] = material;
        shadeBuffer[cell] = Math.round(brightness * (LEVELS - 1));
        variantBuffer[cell] = variant;
        uvBuffer[cell * 2] = u;
        uvBuffer[cell * 2 + 1] = v;
        glintBuffer[cell] = specular > 0.72 || (ridge > 0.97 && brightness > 0.77) ? 1 : 0;
        const pattern = Math.sin((u * 163 + variant * 17) * (v * 77 + 1.3));
        spotBuffer[cell] = (material === 2 || material === 3) &&
          u > 0.14 && u < 0.64 && Math.abs(v) > 0.48 && pattern > 0.8 ? 1 : 0;
        if (spotBuffer[cell]) shadeBuffer[cell] = Math.max(1, shadeBuffer[cell] - 3);
      }
    }
  }

  function drawMesh(mesh, material, variant, pointAt) {
    const nu = mesh.uSegments;
    const nv = mesh.vSegments;
    const stride = nv + 1;
    const positions = mesh.positions;
    const projected = mesh.projected;

    for (let i = 0; i <= nu; i += 1) {
      const u = i / nu;
      for (let j = 0; j <= nv; j += 1) {
        const v = j / nv * 2 - 1;
        const point = pointAt(u, v);
        const offset = (i * stride + j) * 3;
        positions[offset] = point[0];
        positions[offset + 1] = point[1];
        positions[offset + 2] = point[2];
      }
    }

    const camera = cameraValues();
    for (let i = 0; i <= nu; i += 1) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(nu, i + 1);
      for (let j = 0; j <= nv; j += 1) {
        const j0 = Math.max(0, j - 1);
        const j1 = Math.min(nv, j + 1);
        const here = (i * stride + j) * 3;
        const beforeU = (i0 * stride + j) * 3;
        const afterU = (i1 * stride + j) * 3;
        const beforeV = (i * stride + j0) * 3;
        const afterV = (i * stride + j1) * 3;
        const ux = positions[afterU] - positions[beforeU];
        const uy = positions[afterU + 1] - positions[beforeU + 1];
        const uz = positions[afterU + 2] - positions[beforeU + 2];
        const vx = positions[afterV] - positions[beforeV];
        const vy = positions[afterV + 1] - positions[beforeV + 1];
        const vz = positions[afterV + 2] - positions[beforeV + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz);
        if (length < 0.000001) {
          nx = 0; ny = 1; nz = 0;
        } else {
          nx /= length; ny /= length; nz /= length;
        }
        const u = i / nu;
        const v = j / nv * 2 - 1;
        projectVertex(
          positions[here], positions[here + 1], positions[here + 2],
          nx, ny, nz, u, v, projected, (i * stride + j) * 8, camera
        );
      }
    }

    for (let i = 0; i < nu; i += 1) {
      for (let j = 0; j < nv; j += 1) {
        const a = (i * stride + j) * 8;
        const b = ((i + 1) * stride + j) * 8;
        const c = ((i + 1) * stride + j + 1) * 8;
        const d = (i * stride + j + 1) * 8;
        rasterTriangle(projected, a, b, c, material, mesh.id, variant);
        rasterTriangle(projected, a, c, d, material, mesh.id, variant);
      }
    }
  }

  function tubePoint(start, end, u, v, radius) {
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let dz = end[2] - start[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length; dy /= length; dz /= length;
    let rx = 0, ry = 1, rz = 0;
    if (Math.abs(dy) > 0.91) { rx = 1; ry = 0; rz = 0; }
    let sx = dy * rz - dz * ry;
    let sy = dz * rx - dx * rz;
    let sz = dx * ry - dy * rx;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const tx = dy * sz - dz * sy;
    const ty = dz * sx - dx * sz;
    const tz = dx * sy - dy * sx;
    const angle = (v + 1) * Math.PI;
    const taper = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.34);
    const r = radius * (0.28 + 0.72 * taper);
    const wave = Math.sin(u * Math.PI) * 0.012;
    return [
      mix(start[0], end[0], u) + sx * Math.cos(angle) * r + tx * Math.sin(angle) * r,
      mix(start[1], end[1], u) + sy * Math.cos(angle) * r + ty * Math.sin(angle) * r + wave,
      mix(start[2], end[2], u) + sz * Math.cos(angle) * r + tz * Math.sin(angle) * r
    ];
  }

  function lineGlyph(start, end) {
    const a = projectPoint(start[0], start[1], start[2]);
    const b = projectPoint(end[0], end[1], end[2]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.abs(dy) > Math.abs(dx) * 1.55) return "|";
    if (Math.abs(dx) > Math.abs(dy) * 1.55) return "-";
    return dx * dy > 0 ? "\\" : "/";
  }

  function stampPoint(point, material, owner, variant, glyph, brightness) {
    const projected = projectPoint(point[0], point[1], point[2]);
    const col = Math.floor(projected[0] / model.cellWidth);
    const row = Math.floor(projected[1] / model.cellHeight);
    if (col < 0 || col >= model.cols || row < 0 || row >= model.rows) return;
    const cell = row * model.cols + col;
    if (projected[2] > depthBuffer[cell] + 0.72) return;
    depthBuffer[cell] = Math.min(depthBuffer[cell], projected[2] - 0.004);
    ownerBuffer[cell] = owner;
    materialBuffer[cell] = material;
    shadeBuffer[cell] = Math.round(clamp(brightness, 0, 1) * (LEVELS - 1));
    variantBuffer[cell] = variant;
    overrideBuffer[cell] = glyph.charCodeAt(0);
    glintBuffer[cell] = glyph === "*" ? 1 : 0;
    spotBuffer[cell] = 0;
  }

  function stampSegment(start, end, material, owner, variant, glyph, brightness) {
    const a = projectPoint(start[0], start[1], start[2]);
    const b = projectPoint(end[0], end[1], end[2]);
    const steps = Math.max(2, Math.ceil(Math.max(
      Math.abs(b[0] - a[0]) / model.cellWidth,
      Math.abs(b[1] - a[1]) / model.cellHeight
    ) * 3));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      stampPoint([
        mix(start[0], end[0], t),
        mix(start[1], end[1], t),
        mix(start[2], end[2], t)
      ], material, owner, variant, glyph, brightness);
    }
  }

  function drawPlant(time, motion) {
    const bloom = bloomState(time, motion);
    const growth = bloom.growth;
    if (growth > 0.003) {
      drawMesh(stemMesh, 0, 0, (u, v) => {
        const t = u * growth;
        const center = stemPoint(t, motion);
        const angle = (v + 1) * Math.PI;
        const radius = 0.04 * (1 - 0.32 * t);
        return [
          center.x + Math.cos(angle) * radius,
          center.y,
          center.z + Math.sin(angle) * radius
        ];
      });
    }

    leaves.forEach((leaf, index) => {
      const leafGrowth = smooth(0.72 + leaf.delay, 3.7 + leaf.delay, time) * growth;
      if (leafGrowth < 0.015) return;
      const origin = stemPoint(leaf.at * growth, motion);
      const dx = Math.cos(leaf.angle);
      const dz = Math.sin(leaf.angle);
      const sx = -dz;
      const sz = dx;
      drawMesh(leaf.mesh, 1, index, (u, v) => {
        const q = u * leafGrowth;
        const profile = Math.pow(Math.max(0, Math.sin(Math.PI * q)), 0.72) * (0.8 + 0.2 * q);
        const halfWidth = leaf.width * profile;
        const centerX = origin.x + dx * leaf.length * q;
        const centerY = origin.y + 0.19 * Math.sin(Math.PI * q) + 0.13 * q;
        const centerZ = origin.z + dz * leaf.length * q;
        const curl = v * halfWidth;
        return [
          centerX + sx * curl,
          centerY + 0.06 * (v * v) * profile + leaf.bend * Math.sin(Math.PI * q) * v * v,
          centerZ + sz * curl
        ];
      });
    });

    if (bloom.flowerGrowth < 0.018) return bloom;

    petals.forEach((petal, index) => {
      const opening = bloom.open[index];
      const angle = bloom.angles[index] + Math.sin(motion * 0.48) * 0.018;
      const rx = Math.cos(angle);
      const rz = Math.sin(angle);
      const sx = -rz;
      const sz = rx;
      const outer = petal.outer;
      drawMesh(petal.mesh, outer ? 2 : 3, index, (u, v) => {
        const profile = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.67) * (0.57 + 0.43 * u);
        const width = (0.045 * (1 - opening) + (outer ? 0.405 : 0.355) * opening) * profile;
        const length = 0.035 + (outer ? 1.3 : 1.16) * opening;
        const across = v * width;
        const centerX = bloom.center.x + rx * length * u;
        const centerY = bloom.center.y + 0.69 * (1 - opening) * u +
          opening * (0.24 * Math.sin(Math.PI * u) + (outer ? -0.16 : 0.09) * u);
        const centerZ = bloom.center.z + rz * length * u;
        const cup = opening * (0.22 * v * v * profile + 0.045 * Math.sin(u * Math.PI * 2 + index) * v * v);
        const rim = opening * 0.03 * Math.sin(u * Math.PI * 3 + index * 1.7) * Math.abs(v) * Math.abs(v);
        return [
          centerX + sx * across,
          centerY + cup + rim,
          centerZ + sz * across
        ];
      });
    });

    drawMesh(coreMesh, 1, 0, (u, v) => {
      const latitude = u * Math.PI;
      const longitude = (v + 1) * Math.PI;
      const open = bloom.mean;
      const rx = 0.085 * (1 - open * 0.4);
      const ry = 0.15 * (1 - open * 0.45);
      const rz = 0.085 * (1 - open * 0.4);
      return [
        bloom.center.x + Math.sin(latitude) * Math.cos(longitude) * rx,
        bloom.center.y + 0.13 + Math.cos(latitude) * ry,
        bloom.center.z + Math.sin(latitude) * Math.sin(longitude) * rz
      ];
    });

    const stamenOpen = smooth(0.18, 0.78, bloom.mean);
    if (stamenOpen > 0.012) {
      for (let i = 0; i < 6; i += 1) {
        const angle = bloom.angles[i];
        const radial = 0.49 * stamenOpen;
        const start = [
          bloom.center.x + Math.cos(angle) * 0.025,
          bloom.center.y + 0.13 * stamenOpen,
          bloom.center.z + Math.sin(angle) * 0.025
        ];
        const end = [
          bloom.center.x + Math.cos(angle) * radial,
          bloom.center.y + 0.43 * stamenOpen + Math.sin(angle * 2) * 0.045 * stamenOpen,
          bloom.center.z + Math.sin(angle) * radial
        ];
        const filament = filaments[i];
        drawMesh(filament, 4, i, (u, v) => tubePoint(start, end, u, v, 0.012));

        const axisLength = 0.14 * stamenOpen;
        const ax = Math.cos(angle + 0.24);
        const az = Math.sin(angle + 0.24);
        const antherStart = [end[0] - ax * axisLength * 0.5, end[1] + 0.012, end[2] - az * axisLength * 0.5];
        const antherEnd = [end[0] + ax * axisLength * 0.5, end[1] - 0.012, end[2] + az * axisLength * 0.5];
        drawMesh(anthers[i], 5, i, (u, v) => tubePoint(antherStart, antherEnd, u, v, 0.036 * stamenOpen));
        stampSegment(start, end, 4, filament.id, i, lineGlyph(start, end), 0.84);
        const antherMid = [
          (antherStart[0] + antherEnd[0]) * 0.5,
          (antherStart[1] + antherEnd[1]) * 0.5,
          (antherStart[2] + antherEnd[2]) * 0.5
        ];
        stampSegment(antherStart, antherEnd, 5, anthers[i].id, i, "o", 0.94);
        stampPoint(antherMid, 5, anthers[i].id, i, "*", 1);
      }

      const styleStart = [bloom.center.x, bloom.center.y + 0.1 * stamenOpen, bloom.center.z];
      const styleEnd = [bloom.center.x + 0.025, bloom.center.y + 0.76 * stamenOpen, bloom.center.z - 0.012];
      drawMesh(styleMesh, 6, 0, (u, v) => tubePoint(styleStart, styleEnd, u, v, 0.013));
      drawMesh(stigmaMesh, 5, 7, (u, v) => {
        const latitude = u * Math.PI;
        const longitude = (v + 1) * Math.PI;
        return [
          styleEnd[0] + Math.sin(latitude) * Math.cos(longitude) * 0.042 * stamenOpen,
          styleEnd[1] + Math.cos(latitude) * 0.052 * stamenOpen,
          styleEnd[2] + Math.sin(latitude) * Math.sin(longitude) * 0.042 * stamenOpen
        ];
      });
      stampSegment(styleStart, styleEnd, 6, styleMesh.id, 0, "|", 0.88);
      stampPoint(styleEnd, 5, stigmaMesh.id, 7, "*", 1);
    }
    return bloom;
  }

  function clearBuffers() {
    depthBuffer.fill(1e6);
    ownerBuffer.fill(0);
    materialBuffer.fill(0);
    shadeBuffer.fill(0);
    variantBuffer.fill(0);
    uvBuffer.fill(0);
    glintBuffer.fill(0);
    spotBuffer.fill(0);
    overrideBuffer.fill(0);
  }

  function drawBackground() {
    ctx.fillStyle = "#100e17";
    ctx.fillRect(0, 0, model.width, model.height);
    const centerX = model.width * 0.52;
    const centerY = model.height * 0.55;
    const radius = Math.max(model.width, model.height) * 0.69;
    const light = 1;
    const glowGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    glowGradient.addColorStop(0, "rgba(71, 48, 72, " + (0.27 * light) + ")");
    glowGradient.addColorStop(0.42, "rgba(39, 34, 54, 0.12)");
    glowGradient.addColorStop(1, "rgba(16, 14, 23, 0)");
    ctx.fillStyle = glowGradient;
    ctx.fillRect(0, 0, model.width, model.height);

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "11px 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
    for (const star of skyStars) {
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = star.glyph === "+" ? "#eed8e4" : "#c8c0d6";
      ctx.fillText(star.glyph, star.x * model.width, star.y * model.height);
    }
    ctx.globalAlpha = 1;

    const moonX = model.width * 0.79;
    const moonY = model.height * 0.245;
    const moonRadius = clamp(Math.min(model.width, model.height) * 0.078, 24, 84);
    const moonAura = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, moonRadius * 3.2);
    moonAura.addColorStop(0, "rgba(208, 167, 194, 0.075)");
    moonAura.addColorStop(1, "rgba(208, 167, 194, 0)");
    ctx.fillStyle = moonAura;
    ctx.fillRect(moonX - moonRadius * 3.2, moonY - moonRadius * 3.2, moonRadius * 6.4, moonRadius * 6.4);

    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, TAU);
    ctx.arc(moonX + moonRadius * 0.4, moonY - moonRadius * 0.06, moonRadius * 0.84, 0, TAU, true);
    ctx.fillStyle = "rgba(232, 209, 221, 0.095)";
    ctx.fill("evenodd");
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius, 0, TAU);
    ctx.strokeStyle = "rgba(234, 208, 223, 0.16)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonRadius * 1.2, Math.PI * 0.12, Math.PI * 0.82);
    ctx.strokeStyle = "rgba(219, 190, 213, 0.1)";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();

    const base = projectPoint(0, BOTTOM, 0);
    const ground = ctx.createRadialGradient(base[0], base[1], 1, base[0], base[1], Math.min(model.width * 0.34, 320));
    ground.addColorStop(0, "rgba(55, 91, 65, 0.14)");
    ground.addColorStop(1, "rgba(55, 91, 65, 0)");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, model.width, model.height);

    ctx.save();
    ctx.lineCap = "round";
    const reedHeight = Math.min(model.width, model.height);
    const reeds = [
      [0.025, 0.15, 0.018, 0.16], [0.085, 0.105, -0.012, 0.13],
      [0.155, 0.19, 0.022, 0.19], [0.235, 0.095, -0.016, 0.11],
      [0.765, 0.11, 0.016, 0.13], [0.845, 0.18, -0.022, 0.18],
      [0.925, 0.12, 0.014, 0.14], [0.985, 0.17, -0.018, 0.16]
    ];
    for (let i = 0; i < reeds.length; i += 1) {
      const [xRatio, heightRatio, leanRatio, opacity] = reeds[i];
      const x0 = model.width * xRatio;
      const y0 = model.height + 8;
      const tipX = x0 + model.width * leanRatio;
      const tipY = model.height * (1 - heightRatio);
      const bendX = x0 + model.width * leanRatio * 0.22;
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = i % 2 ? "#9bb59a" : "#78977f";
      ctx.lineWidth = i % 3 === 0 ? 1.35 : 0.9;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(bendX, model.height * (1 - heightRatio * 0.42), tipX, tipY);
      ctx.stroke();

      for (let leaf = 0; leaf < 3; leaf += 1) {
        const t = 0.28 + leaf * 0.2;
        const px = mix(x0, tipX, t * 0.72);
        const py = mix(y0, tipY, t * 0.72);
        const side = ((leaf + i) % 2 ? -1 : 1) * (xRatio < 0.5 ? 1 : -1);
        const reach = reedHeight * (0.035 + leaf * 0.006);
        ctx.globalAlpha = opacity * 0.74;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(
          px + side * reach * 0.45,
          py - reach * 0.46,
          px + side * reach,
          py - reach * 0.82
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function edgeGlyph(cell) {
    const row = Math.floor(cell / model.cols);
    const col = cell % model.cols;
    const id = ownerBuffer[cell];
    const mat = materialBuffer[cell];
    const boundary = (r, c) => {
      if (r < 0 || c < 0 || r >= model.rows || c >= model.cols) return true;
      const neighbor = r * model.cols + c;
      return ownerBuffer[neighbor] === 0 || materialBuffer[neighbor] !== mat;
    };
    const left = boundary(row, col - 1);
    const right = boundary(row, col + 1);
    const top = boundary(row - 1, col);
    const bottom = boundary(row + 1, col);
    if (!left && !right && !top && !bottom) return "";
    if ((left || right) && !(top || bottom)) return "|";
    if ((top || bottom) && !(left || right)) return bottom ? "_" : "-";
    if ((left || right) && (top || bottom)) {
      const slash = (left && top) || (right && bottom);
      return slash ? "/" : "\\";
    }
    return id && mat ? "|" : "";
  }

  function drawCharacters() {
    let lastColor = "";
    for (let row = 0; row < model.rows; row += 1) {
      for (let col = 0; col < model.cols; col += 1) {
        const cell = row * model.cols + col;
        const owner = ownerBuffer[cell];
        if (!owner) continue;
        const material = materialBuffer[cell];
        const level = shadeBuffer[cell];
        const variant = variantBuffer[cell];
        const u = uvBuffer[cell * 2];
        const v = uvBuffer[cell * 2 + 1];
        let glyph = overrideBuffer[cell] ? String.fromCharCode(overrideBuffer[cell]) : edgeGlyph(cell);

        if (!glyph && !overrideBuffer[cell]) {
          if (spotBuffer[cell]) {
            glyph = "'";
          } else if ((material === 2 || material === 3) && u > 0.16 && u < 0.9 &&
                     Math.abs(Math.abs(v) - (0.22 + 0.075 * Math.sin(u * 6 + variant))) < 0.04) {
            glyph = v < 0 ? "/" : "\\";
          } else if ((material === 1 && Math.abs(v) < 0.06) ||
                     ((material === 2 || material === 3) && Math.abs(v) < 0.032 && u > 0.12)) {
            glyph = "|";
          } else if (glintBuffer[cell] && level >= 7) {
            glyph = "*";
          } else {
            const pools = material === 0 || material === 1
              ? LEAF_GLYPHS
              : material === 2 || material === 3
                ? PETAL_GLYPHS
                : POLLEN_GLYPHS;
            const poolIndex = clamp(Math.floor(level / 2), 0, pools.length - 1);
            const pool = pools[poolIndex];
            const pick = (row * 19 + col * 73 + variantBuffer[cell] * 11) % pool.length;
            glyph = pool[pick];
          }
        }

        const color = PALETTES[material][level];
        if (color !== lastColor) {
          ctx.fillStyle = color;
          lastColor = color;
        }
        ctx.fillText(glyph, (col + 0.5) * model.cellWidth, (row + 0.51) * model.cellHeight);
      }
    }
  }

  function spawnDust() {
    return {
      x: random() * model.width,
      y: model.height + random() * 20,
      speed: 5 + random() * 15,
      drift: 3 + random() * 10,
      phase: random() * TAU,
      glyph: random() > 0.82 ? "*" : "."
    };
  }

  function updateEffects(dt, bloom) {
    for (let i = 0; i < dust.length; i += 1) {
      const particle = dust[i];
      particle.y -= particle.speed * dt;
      particle.x += Math.sin(model.motion * 0.38 + particle.phase) * particle.drift * dt;
      if (particle.y < -12) dust[i] = spawnDust();
      if (particle.x < -10) particle.x = model.width + 10;
      if (particle.x > model.width + 10) particle.x = -10;
    }

    if (bloom.mean > 0.92 && model.running) {
      model.dropTimer -= dt;
      if (model.dropTimer <= 0) {
        const index = Math.floor(random() * 6);
        const angle = bloom.angles[index];
        const direction = 0.57 + random() * 0.2;
        const origin = projectPoint(
          bloom.center.x + Math.cos(angle) * direction,
          bloom.center.y + 0.08,
          bloom.center.z + Math.sin(angle) * direction
        );
        fallingDrops.push({ x: origin[0], y: origin[1], vx: (random() - 0.5) * 10, vy: 9, age: 0 });
        model.dropTimer = 8 + random() * 8;
      }
    }

    const ground = projectPoint(0, BOTTOM, 0)[1] - 4;
    for (let i = fallingDrops.length - 1; i >= 0; i -= 1) {
      const drop = fallingDrops[i];
      drop.age += dt;
      drop.vy += 160 * dt;
      drop.x += drop.vx * dt;
      drop.y += drop.vy * dt;
      if (drop.y >= ground) {
        splashes.push({ x: drop.x, y: ground, age: 0 });
        fallingDrops.splice(i, 1);
      }
    }
    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      splashes[i].age += dt;
      if (splashes[i].age > 0.62) splashes.splice(i, 1);
    }
  }

  function drawEffects() {
    ctx.save();
    ctx.font = (model.fontSize + 1) + "px 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
    for (const particle of dust) {
      const alpha = 0.24 + 0.42 * (0.5 + 0.5 * Math.sin(model.motion * 1.4 + particle.phase));
      ctx.fillStyle = "rgba(232, 213, 232, " + alpha + ")";
      ctx.fillText(particle.glyph, particle.x, particle.y);
    }
    for (const drop of fallingDrops) {
      ctx.fillStyle = "#d4eee5";
      ctx.shadowColor = "rgba(179, 235, 218, 0.75)";
      ctx.shadowBlur = 9;
      ctx.fillText("o", drop.x, drop.y);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(198, 235, 223, 0.72)";
      ctx.fillText("|", drop.x, drop.y - 8);
    }
    for (const splash of splashes) {
      const radius = 3 + splash.age * 31;
      const alpha = 1 - splash.age / 0.62;
      ctx.fillStyle = "rgba(186, 228, 216, " + alpha + ")";
      ctx.fillText(".", splash.x - radius, splash.y - splash.age * 9);
      ctx.fillText("~", splash.x, splash.y - splash.age * 13);
      ctx.fillText(".", splash.x + radius, splash.y - splash.age * 9);
      if (splash.age < 0.25) {
        ctx.fillText("'", splash.x - radius * 0.5, splash.y - 7 - splash.age * 17);
        ctx.fillText("'", splash.x + radius * 0.5, splash.y - 7 - splash.age * 17);
      }
    }
    ctx.restore();
  }

  function updateReadout(bloom) {
    if (!model.running) phaseLabel.textContent = "Paused in time";
    else if (model.time < 1.5) phaseLabel.textContent = "A quiet beginning";
    else if (model.time < 4.7) phaseLabel.textContent = "The bud rises";
    else if (bloom.open.some((value, index) => index % 2 === 0 && value < 0.98)) {
      phaseLabel.textContent = "Outer tepals opening";
    } else if (bloom.mean < 0.98) phaseLabel.textContent = "The heart unfolds";
    else phaseLabel.textContent = "A lily in full bloom";
    percentLabel.textContent = Math.round(bloom.mean * 100) + "% OPEN";
    timeline.value = String(Math.round(model.time / DURATION * 1000));
  }

  function drawGlow() {
    gctx.clearRect(0, 0, glow.width, glow.height);
    gctx.drawImage(art, 0, 0, glow.width, glow.height);
  }

  function drawScene(dt) {
    drawBackground();
    clearBuffers();
    const bloom = drawPlant(model.time, model.motion);
    drawCharacters();
    updateEffects(dt || 0, bloom);
    drawEffects();
    drawGlow();
    updateReadout(bloom);
  }

  function setPaused(paused) {
    model.running = !paused;
    pauseLabel.textContent = model.running ? "Pause" : "Resume";
    pauseButton.setAttribute("aria-label", model.running ? "Pause animation" : "Resume animation");
  }

  function replay() {
    model.time = 0;
    model.motion = 0;
    model.spin = 0;
    model.dropTimer = 6;
    fallingDrops.length = 0;
    splashes.length = 0;
    setPaused(false);
    drawScene(0);
  }

  function setSpeed(index) {
    model.speedIndex = index;
    const speed = SPEEDS[index];
    speedButton.textContent = speed + "×";
    speedButton.setAttribute("aria-label", "Animation speed " + speed + " times");
  }

  function saveScreenshot() {
    const output = document.createElement("canvas");
    output.width = art.width;
    output.height = art.height;
    const out = output.getContext("2d");
    out.drawImage(art, 0, 0);
    out.globalCompositeOperation = "screen";
    out.globalAlpha = 0.46;
    out.drawImage(glow, 0, 0, output.width, output.height);
    const link = document.createElement("a");
    link.download = "night_lily_ascii.png";
    link.href = output.toDataURL("image/png");
    link.click();
  }

  pauseButton.addEventListener("click", () => setPaused(model.running));
  replayButton.addEventListener("click", replay);
  saveButton.addEventListener("click", saveScreenshot);
  speedButton.addEventListener("click", () => setSpeed((model.speedIndex + 1) % SPEEDS.length));
  timeline.addEventListener("input", () => {
    model.time = Number(timeline.value) / 1000 * DURATION;
    setPaused(true);
    drawScene(0);
  });

  art.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    model.dragging = true;
    model.dragX = event.clientX;
    model.dragY = event.clientY;
    if (art.setPointerCapture) art.setPointerCapture(event.pointerId);
  });
  art.addEventListener("pointermove", (event) => {
    if (!model.dragging) return;
    const dx = event.clientX - model.dragX;
    const dy = event.clientY - model.dragY;
    model.yaw += dx * 0.006;
    model.pitch = clamp(model.pitch + dy * 0.0038, -0.12, 1.16);
    model.dragX = event.clientX;
    model.dragY = event.clientY;
  });
  art.addEventListener("pointerup", () => { model.dragging = false; });
  art.addEventListener("pointercancel", () => { model.dragging = false; });

  window.addEventListener("resize", setupSize, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "BUTTON" || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      setPaused(model.running);
    } else if (key === "r") {
      replay();
    } else if (key === "s") {
      saveScreenshot();
    } else if (key === "1" || key === "2" || key === "3") {
      setSpeed(Number(key) - 1);
    }
  });
  document.addEventListener("visibilitychange", () => {
    lastFrame = 0;
    lastDraw = 0;
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastDraw < model.frameInterval) return;
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    lastDraw = now;
    if (model.running) {
      model.time = Math.min(DURATION, model.time + dt * SPEEDS[model.speedIndex]);
      model.motion += dt;
      const bloom = bloomState(model.time, model.motion);
      model.spin += dt * 0.24 * smooth(0.28, 0.88, bloom.mean);
    }
    drawScene(model.running ? dt : 0);
  }

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setPaused(true);
  }
  setupSize();
  requestAnimationFrame(frame);
})();
