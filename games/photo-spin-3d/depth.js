// ---------- Pure, DOM/THREE-free helpers for turning a single photo into a
// silhouette-bounded volumetric shape. No dependency on any browser API
// beyond a plain {data, width, height} ImageData-like object, so all of this
// can be unit tested directly under Node.
//
// Pipeline (see README for the full rationale):
//   1. segmentSilhouette   — separate subject from background (border
//      flood-fill by color similarity + cleanup), NOT a rectangle.
//   2. computeInflationField — classic "balloon/Teddy" silhouette inflation:
//      a distance transform from the silhouette edge, remapped through a
//      quarter-circle profile, gives each foreground pixel a rounded
//      thickness that tapers to exactly 0 at the subject's outline. This
//      produces genuine volumetric curvature instead of a flat displaced
//      plane, and the taper-to-zero at the silhouette edge is what lets the
//      front/back surfaces meet cleanly at the object's rim.
//   3. buildGridField / computeCellInclusion / findRimEdges — resample the
//      per-pixel fields onto the mesh's vertex grid and work out which grid
//      cells fall inside the silhouette (so background cells are simply
//      never emitted as geometry) and which cells sit on the silhouette's
//      boundary (so a connecting rim strip can be built there).

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function boxBlur(src, width, height, radius) {
  if (radius <= 0) return src.slice();
  const clampIdx = (v, min, max) => Math.max(min, Math.min(max, v));
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const size = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * width + clampIdx(x, 0, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / size;
      sum += src[y * width + clampIdx(x + radius + 1, 0, width - 1)] - src[y * width + clampIdx(x - radius, 0, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clampIdx(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / size;
      sum += tmp[clampIdx(y + radius + 1, 0, height - 1) * width + x] - tmp[clampIdx(y - radius, 0, height - 1) * width + x];
    }
  }
  return out;
}

// ---------- Background segmentation ----------
export function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

export function computeAdaptiveThreshold(imageData, width, height) {
  const { data } = imageData;
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 64));
  for (let x = 0; x < width; x += stepX) {
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  const stepY = Math.max(1, Math.floor(height / 64));
  for (let y = 0; y < height; y += stepY) {
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  if (samples.length === 0) return 30;
  let mr = 0, mg = 0, mb = 0;
  for (const [r, g, b] of samples) { mr += r; mg += g; mb += b; }
  mr /= samples.length; mg /= samples.length; mb /= samples.length;
  let variance = 0;
  for (const [r, g, b] of samples) variance += colorDistanceSq(r, g, b, mr, mg, mb);
  variance /= samples.length;
  const std = Math.sqrt(variance);
  return clamp(20 + std * 0.5, 20, 60);
}

// BFS flood fill seeded from every border pixel: a pixel joins the
// background set if it's within `threshold` color distance of an
// already-background NEIGHBOR (chained similarity), so gradients in the
// background can be walked across while a sharp subject edge stops the fill.
export function segmentForeground(imageData, width, height, threshold) {
  const { data } = imageData;
  const n = width * height;
  const visited = new Uint8Array(n); // 1 = classified background
  const queue = new Int32Array(n);
  let qTail = 0;
  const pushSeed = (x, y) => {
    const i = y * width + x;
    if (!visited[i]) { visited[i] = 1; queue[qTail++] = i; }
  };
  for (let x = 0; x < width; x++) { pushSeed(x, 0); pushSeed(x, height - 1); }
  for (let y = 0; y < height; y++) { pushSeed(0, y); pushSeed(width - 1, y); }
  const thresholdSq = threshold * threshold;
  let qHead = 0;
  while (qHead < qTail) {
    const i = queue[qHead++];
    const x = i % width, y = (i / width) | 0;
    const r0 = data[i * 4], g0 = data[i * 4 + 1], b0 = data[i * 4 + 2];
    const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (visited[ni]) continue;
      const r1 = data[ni * 4], g1 = data[ni * 4 + 1], b1 = data[ni * 4 + 2];
      if (colorDistanceSq(r0, g0, b0, r1, g1, b1) <= thresholdSq) {
        visited[ni] = 1;
        queue[qTail++] = ni;
      }
    }
  }
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = visited[i] ? 0 : 1;
  return fg;
}

// Morphological-closing-ish cleanup: a background pixel surrounded mostly by
// foreground is very likely a small hole (e.g. a bright highlight) and gets
// flipped to foreground.
export function fillSmallHoles(fgMask, width, height) {
  const out = fgMask.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (fgMask[i]) continue;
      let count = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          total++;
          if (fgMask[ny * width + nx]) count++;
        }
      }
      if (total > 0 && count / total >= 0.75) out[i] = 1;
    }
  }
  return out;
}

// Keeps only the largest 4-connected foreground component, discarding stray
// background-misclassified islands (busy/textured backgrounds, reflections, etc).
export function keepLargestForegroundComponent(fgMask, width, height) {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let bestLabel = -1, bestSize = 0, nextLabel = 0;
  for (let start = 0; start < n; start++) {
    if (!fgMask[start] || labels[start] !== -1) continue;
    let qHead = 0, qTail = 0, size = 0;
    labels[start] = nextLabel;
    queue[qTail++] = start;
    while (qHead < qTail) {
      const i = queue[qHead++];
      size++;
      const x = i % width, y = (i / width) | 0;
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (fgMask[ni] && labels[ni] === -1) {
          labels[ni] = nextLabel;
          queue[qTail++] = ni;
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = nextLabel; }
    nextLabel++;
  }
  const out = new Uint8Array(n);
  if (bestLabel === -1) return out;
  for (let i = 0; i < n; i++) out[i] = labels[i] === bestLabel ? 1 : 0;
  return out;
}

// Top-level segmentation: threshold -> flood fill -> hole fill -> largest
// component. Falls back to "whole frame is the subject" if the result looks
// degenerate (e.g. background too similar to the subject to separate), so a
// bad segmentation never produces an empty/broken mesh — it just degrades to
// the old rectangular-taper look for that one image.
export function segmentSilhouette(imageData, width, height) {
  const threshold = computeAdaptiveThreshold(imageData, width, height);
  let fg = segmentForeground(imageData, width, height, threshold);
  fg = fillSmallHoles(fg, width, height);
  fg = keepLargestForegroundComponent(fg, width, height);
  let fgCount = 0;
  for (let i = 0; i < fg.length; i++) fgCount += fg[i];
  if (fgCount < width * height * 0.02) {
    fg = new Uint8Array(width * height).fill(1);
  }
  return fg;
}

// ---------- Silhouette inflation (distance transform + rounded profile) ----------
export function chamferDistanceTransform(fgMask, width, height) {
  const INF = 1e8;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < fgMask.length; i++) dist[i] = fgMask[i] ? INF : 0;
  const D1 = 1, D2 = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!fgMask[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + D1);
      if (y > 0) d = Math.min(d, dist[i - width] + D1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1] + D2);
      if (x < width - 1 && y > 0) d = Math.min(d, dist[i - width + 1] + D2);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!fgMask[i]) continue;
      let d = dist[i];
      if (x < width - 1) d = Math.min(d, dist[i + 1] + D1);
      if (y < height - 1) d = Math.min(d, dist[i + width] + D1);
      if (x < width - 1 && y < height - 1) d = Math.min(d, dist[i + width + 1] + D2);
      if (x > 0 && y < height - 1) d = Math.min(d, dist[i + width - 1] + D2);
      dist[i] = d;
    }
  }
  return dist;
}

export function borderDistanceTransform(width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = Math.min(x, width - 1 - x, y, height - 1 - y);
    }
  }
  return out;
}

// Remaps a distance-from-edge field into a 0..1 rounded "inflation" profile
// (the same trick sketch-based tools like Teddy use to turn a 2D outline
// into a puffy 3D volume): 0 exactly at/outside the silhouette, rising
// toward the core. Uses a quadratic ease-out (1-(1-t)^2) rather than a true
// quarter-circle (sqrt(1-(1-t)^2)): the sqrt version has an infinite slope
// at t=0, which amplifies the silhouette's own grid-discretization noise
// (the mesh boundary is a staircase approximation of a smooth outline) into
// large, spiky z-jumps between neighboring boundary vertices. The quadratic
// has a finite slope at the edge, so that same small positional noise stays
// small in z — still visibly rounded, just numerically well-behaved.
export function computeInflationField(fgMask, width, height) {
  let hasBackground = false;
  for (let i = 0; i < fgMask.length; i++) { if (!fgMask[i]) { hasBackground = true; break; } }
  const dist = hasBackground
    ? chamferDistanceTransform(fgMask, width, height)
    : borderDistanceTransform(width, height);
  let maxD = 0;
  for (let i = 0; i < dist.length; i++) {
    if (fgMask[i] && dist[i] < 1e7 && dist[i] > maxD) maxD = dist[i];
  }
  if (maxD <= 0) maxD = 1;
  const out = new Float32Array(width * height);
  for (let i = 0; i < dist.length; i++) {
    if (!fgMask[i]) { out[i] = 0; continue; }
    const t = clamp(dist[i] / maxD, 0, 1);
    out[i] = Math.max(0, 1 - (1 - t) * (1 - t));
  }
  return out;
}

export function computeSoftAlpha(fgMask, width, height, blurRadius) {
  const f = new Float32Array(fgMask.length);
  for (let i = 0; i < fgMask.length; i++) f[i] = fgMask[i];
  return boxBlur(f, width, height, blurRadius);
}

// ---------- Bilinear field/color sampling ----------
export function makeFieldSampler(field, width, height) {
  return function (u, v) {
    const x = clamp(u, 0, 1) * (width - 1);
    const y = clamp(v, 0, 1) * (height - 1);
    const x0 = Math.floor(x), x1 = Math.min(x0 + 1, width - 1);
    const y0 = Math.floor(y), y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0, fy = y - y0;
    const d00 = field[y0 * width + x0], d10 = field[y0 * width + x1];
    const d01 = field[y1 * width + x0], d11 = field[y1 * width + x1];
    return lerp(lerp(d00, d10, fx), lerp(d01, d11, fx), fy);
  };
}

export function sampleColorBilinear(imageData, width, height, u, v) {
  const { data } = imageData;
  const x = clamp(u, 0, 1) * (width - 1);
  const y = clamp(v, 0, 1) * (height - 1);
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, width - 1);
  const y0 = Math.floor(y), y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0, fy = y - y0;
  const px = (xx, yy, c) => data[(yy * width + xx) * 4 + c];
  const bilerp = (c) => {
    const v00 = px(x0, y0, c), v10 = px(x1, y0, c), v01 = px(x0, y1, c), v11 = px(x1, y1, c);
    return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy) / 255;
  };
  return { r: bilerp(0), g: bilerp(1), b: bilerp(2) };
}

// ---------- Mesh-grid resampling ----------
export function buildGridField(sampler, segments, mirrorU) {
  const n = segments + 1;
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const rowFrac = j / segments;
    for (let i = 0; i < n; i++) {
      const colFrac = i / segments;
      out[j * n + i] = sampler(mirrorU ? 1 - colFrac : colFrac, rowFrac);
    }
  }
  return out;
}

export function gridIndex(i, j, segments) { return j * (segments + 1) + i; }
export function cellIndex(i, j, segments) { return j * segments + i; }

export function computeCellInclusion(alphaGrid, segments, threshold) {
  const n = segments + 1;
  const out = new Uint8Array(segments * segments);
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = alphaGrid[j * n + i], b = alphaGrid[j * n + i + 1];
      const c = alphaGrid[(j + 1) * n + i], d = alphaGrid[(j + 1) * n + i + 1];
      out[j * segments + i] = (a + b + c + d) / 4 > threshold ? 1 : 0;
    }
  }
  return out;
}

export function isCellIncluded(cellIncluded, segments, i, j) {
  if (i < 0 || i >= segments || j < 0 || j >= segments) return false;
  return cellIncluded[cellIndex(i, j, segments)] === 1;
}

// Every grid edge that separates an included cell from an excluded one (or
// the grid's own border) is a rim edge — together they trace the mesh's
// silhouette outline at grid resolution, in whatever shape it happens to be
// (not a fixed rectangle), so a connecting strip can seal the object there.
export function findRimEdges(cellIncluded, segments) {
  const edges = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      if (!isCellIncluded(cellIncluded, segments, i, j)) continue;
      if (!isCellIncluded(cellIncluded, segments, i, j - 1)) edges.push([[i, j], [i + 1, j]]);
      if (!isCellIncluded(cellIncluded, segments, i, j + 1)) edges.push([[i, j + 1], [i + 1, j + 1]]);
      if (!isCellIncluded(cellIncluded, segments, i - 1, j)) edges.push([[i, j], [i, j + 1]]);
      if (!isCellIncluded(cellIncluded, segments, i + 1, j)) edges.push([[i + 1, j], [i + 1, j + 1]]);
    }
  }
  return edges;
}

export function buildIndices(cellIncluded, segments) {
  const n = segments + 1;
  const indices = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      if (!cellIncluded[j * segments + i]) continue;
      const a = j * n + i, b = j * n + i + 1, c = (j + 1) * n + i, d = (j + 1) * n + i + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return indices;
}
