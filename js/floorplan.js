import {
  MAX_IMAGE_SIZE, MIN_ROOM_RATIO,
  PX_TO_METERS, RDP_EPSILON, AXIS_SNAP_ANGLE,
  DOOR_MIN_WIDTH, DOOR_MAX_WIDTH,
  rdpSimplify, snapToAxis, pointInPolygon
} from './utils.js';

export async function analyzeFloorPlan(image, progressCanvas, onProgress) {
  const ctx = progressCanvas.getContext('2d');

  // Step 1: Scale and draw
  onProgress('Scaling image...', 0.05);
  const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);
  progressCanvas.width = w;
  progressCanvas.height = h;
  ctx.drawImage(image, 0, 0, w, h);
  await frame();

  // Step 2: Convert to clean B&W floor plan
  onProgress('Converting to grayscale...', 0.10);
  const imageData = ctx.getImageData(0, 0, w, h);
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  await frame();

  // Step 2b: Enhance contrast — stretch histogram to full 0-255 range
  onProgress('Enhancing contrast...', 0.15);
  let gMin = 255, gMax = 0;
  for (let i = 0; i < w * h; i++) {
    if (gray[i] < gMin) gMin = gray[i];
    if (gray[i] > gMax) gMax = gray[i];
  }
  const gRange = gMax - gMin || 1;
  for (let i = 0; i < w * h; i++) {
    gray[i] = Math.round(((gray[i] - gMin) / gRange) * 255);
  }
  await frame();

  // Step 2c: Gaussian blur (3x3) to reduce noise before thresholding
  onProgress('Reducing noise...', 0.18);
  const blurred = new Uint8Array(w * h);
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1]; // sum=16
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0, ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += gray[(y + dy) * w + (x + dx)] * kernel[ki++];
        }
      }
      blurred[y * w + x] = (sum >> 4); // divide by 16
    }
  }
  // Copy edges
  for (let x = 0; x < w; x++) { blurred[x] = gray[x]; blurred[(h - 1) * w + x] = gray[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { blurred[y * w] = gray[y * w]; blurred[y * w + w - 1] = gray[y * w + w - 1]; }
  await frame();

  // Step 2d: Adaptive threshold — use local mean in a window to handle
  // uneven lighting, colored backgrounds, and gray-on-white plans
  onProgress('Adaptive thresholding...', 0.22);
  const blockSize = 15; // half-window
  const C = 10;         // bias — pixels must be C darker than local mean to be "wall"

  // Build integral image for fast local mean
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += blurred[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = rowSum + integral[y * (w + 1) + (x + 1)];
    }
  }

  const binary = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const y1 = Math.max(0, y - blockSize);
      const y2 = Math.min(h - 1, y + blockSize);
      const x1 = Math.max(0, x - blockSize);
      const x2 = Math.min(w - 1, x + blockSize);
      const count = (y2 - y1 + 1) * (x2 - x1 + 1);
      const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)]
                - integral[y1 * (w + 1) + (x2 + 1)]
                - integral[(y2 + 1) * (w + 1) + x1]
                + integral[y1 * (w + 1) + x1];
      const localMean = sum / count;
      // Pixel is wall if it's darker than local mean minus bias
      binary[y * w + x] = blurred[y * w + x] < (localMean - C) ? 1 : 0;
    }
  }
  await frame();

  // Show binary on canvas
  onProgress('Detecting walls...', 0.25);
  const binData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = binary[i] ? 0 : 255;
    binData.data[i * 4] = v;
    binData.data[i * 4 + 1] = v;
    binData.data[i * 4 + 2] = v;
    binData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(binData, 0, 0);
  await frame();

  // Step 4: Iterative morphological close — seal door-sized gaps
  // Each 3x3 iteration closes 2px of gap; need enough to close DOOR_MAX_WIDTH
  const closeIterations = Math.ceil(DOOR_MAX_WIDTH / PX_TO_METERS / 2);
  let morphed = new Uint8Array(binary);
  for (let i = 0; i < closeIterations; i++) {
    morphed = morphOp(morphed, w, h, 'dilate');
    if (i % 4 === 0) {
      onProgress(`Sealing door gaps (${i + 1}/${closeIterations})...`, 0.30 + 0.07 * i / closeIterations);
      await frame();
    }
  }
  for (let i = 0; i < closeIterations; i++) {
    morphed = morphOp(morphed, w, h, 'erode');
    if (i % 4 === 0) {
      onProgress(`Restoring walls (${i + 1}/${closeIterations})...`, 0.37 + 0.07 * i / closeIterations);
      await frame();
    }
  }
  const closed = morphed;
  await frame();

  // Step 5: BFS flood fill for rooms
  onProgress('Detecting rooms...', 0.5);
  const labels = new Int32Array(w * h).fill(-1);
  const rooms = [];
  let labelId = 0;
  const minArea = w * h * MIN_ROOM_RATIO;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (closed[idx] === 0 && labels[idx] === -1) {
        const pixels = bfs(closed, labels, w, h, x, y, labelId);
        if (pixels.length >= minArea) {
          rooms.push({ id: labelId, pixels });
          labelId++;
        }
      }
    }
  }
  await frame();

  // Show rooms colored
  onProgress(`Found ${rooms.length} room(s). Tracing boundaries...`, 0.6);
  const roomColors = rooms.map(() => [
    60 + Math.random() * 160 | 0,
    60 + Math.random() * 160 | 0,
    60 + Math.random() * 160 | 0
  ]);
  const vizData = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    vizData.data[i * 4 + 3] = 255;
    if (closed[i] === 1) {
      vizData.data[i * 4] = 40;
      vizData.data[i * 4 + 1] = 40;
      vizData.data[i * 4 + 2] = 40;
    } else {
      vizData.data[i * 4] = 30;
      vizData.data[i * 4 + 1] = 30;
      vizData.data[i * 4 + 2] = 30;
    }
  }
  for (let ri = 0; ri < rooms.length; ri++) {
    const c = roomColors[ri];
    for (const [px, py] of rooms[ri].pixels) {
      const idx = py * w + px;
      vizData.data[idx * 4] = c[0];
      vizData.data[idx * 4 + 1] = c[1];
      vizData.data[idx * 4 + 2] = c[2];
    }
  }
  ctx.putImageData(vizData, 0, 0);
  await frame();

  // Step 6-8: Contour tracing, simplify, snap
  onProgress('Building room polygons...', 0.70);
  const result = { rooms: [], walls: [], doors: [], bounds: { w: w * PX_TO_METERS, h: h * PX_TO_METERS } };

  for (const room of rooms) {
    const mask = new Uint8Array(w * h);
    for (const [px, py] of room.pixels) {
      mask[py * w + px] = 1;
    }

    let contour = traceContour(mask, w, h);
    if (contour.length < 4) continue;

    contour = rdpSimplify(contour, RDP_EPSILON);
    if (contour.length < 3) continue;

    contour = snapToAxis(contour, AXIS_SNAP_ANGLE);

    // Convert to world coords
    const polygon = contour.map(([x, y]) => [x * PX_TO_METERS, y * PX_TO_METERS]);

    // Center
    let cx = 0, cy = 0;
    for (const [x, y] of polygon) { cx += x; cy += y; }
    cx /= polygon.length;
    cy /= polygon.length;

    // Area (shoelace)
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      area += polygon[i][0] * polygon[j][1];
      area -= polygon[j][0] * polygon[i][1];
    }
    area = Math.abs(area) / 2;

    result.rooms.push({ polygon, center: [cx, cy], area });
  }

  // Step 9: Classify each polygon edge as wall or door by sampling the
  // original binary image. Where the binary has no wall pixels, it's a door.
  onProgress('Detecting doors...', 0.80);

  const wallSet = new Set();
  function wallKey(s, e) {
    const r = v => Math.round(v * 1000);
    const a = `${r(s[0])},${r(s[1])},${r(e[0])},${r(e[1])}`;
    const b = `${r(e[0])},${r(e[1])},${r(s[0])},${r(s[1])}`;
    return a < b ? a : b;
  }
  function addWallIfNew(start, end) {
    const key = wallKey(start, end);
    if (wallSet.has(key)) return;
    wallSet.add(key);
    result.walls.push({ start, end });
  }
  const doorSet = new Set();

  // Collect all room polygons for exterior edge detection
  const allPolygons = result.rooms.map(r => r.polygon);

  for (let ri = 0; ri < result.rooms.length; ri++) {
    const room = result.rooms[ri];
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const edgeStart = poly[i];
      const edgeEnd = poly[j];

      // --- Exterior edge detection ---
      // Compute the outward normal (away from this room's center)
      const emx = (edgeStart[0] + edgeEnd[0]) / 2;
      const emy = (edgeStart[1] + edgeEnd[1]) / 2;
      const edx = edgeEnd[0] - edgeStart[0];
      const edy = edgeEnd[1] - edgeStart[1];
      const eLen = Math.hypot(edx, edy);
      if (eLen < 0.01) continue;
      // Two candidate perpendicular directions
      let nx = -edy / eLen;
      let ny = edx / eLen;
      // Pick the direction pointing away from this room's center
      const toCenterX = room.center[0] - emx;
      const toCenterY = room.center[1] - emy;
      if (nx * toCenterX + ny * toCenterY > 0) {
        // Normal points toward center, flip it to point outward
        nx = -nx;
        ny = -ny;
      }
      // Sample a point slightly outside the edge in the outward direction
      const probeDistance = 0.15; // meters
      const probeX = emx + nx * probeDistance;
      const probeY = emy + ny * probeDistance;
      // Check if this outward point falls inside any OTHER room's polygon
      let hasNeighbor = false;
      for (let oi = 0; oi < allPolygons.length; oi++) {
        if (oi === ri) continue; // skip this room
        if (pointInPolygon(probeX, probeY, allPolygons[oi])) {
          hasNeighbor = true;
          break;
        }
      }
      // If no neighboring room on the other side, this is an exterior edge — skip it
      if (!hasNeighbor) continue;

      const segments = classifyEdge(edgeStart, edgeEnd, binary, w, h);
      for (const seg of segments) {
        if (seg.type === 'door') {
          const dk = wallKey(seg.start, seg.end);
          if (!doorSet.has(dk)) {
            doorSet.add(dk);
            result.doors.push({ start: seg.start, end: seg.end, width: seg.width });
          }
        } else {
          addWallIfNew(seg.start, seg.end);
        }
      }
    }
  }
  await frame();

  // Draw polygons and doors on canvas
  onProgress(`Done! Found ${result.doors.length} door(s).`, 1.0);
  ctx.strokeStyle = '#6c63ff';
  ctx.lineWidth = 2;
  for (const room of result.rooms) {
    ctx.beginPath();
    const poly = room.polygon;
    ctx.moveTo(poly[0][0] / PX_TO_METERS, poly[0][1] / PX_TO_METERS);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0] / PX_TO_METERS, poly[i][1] / PX_TO_METERS);
    }
    ctx.closePath();
    ctx.stroke();
    // Mark center
    ctx.fillStyle = '#48cfcb';
    ctx.beginPath();
    ctx.arc(room.center[0] / PX_TO_METERS, room.center[1] / PX_TO_METERS, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Draw doors in green
  ctx.strokeStyle = '#4cff4c';
  ctx.lineWidth = 3;
  for (const door of result.doors) {
    const sx = door.start[0] / PX_TO_METERS;
    const sy = door.start[1] / PX_TO_METERS;
    const ex = door.end[0] / PX_TO_METERS;
    const ey = door.end[1] / PX_TO_METERS;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  await frame();

  return result;
}

function morphOp(data, w, h, op) {
  const out = new Uint8Array(w * h);
  const isWall = op === 'dilate' ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (let dx = -1; dx <= 1 && !found; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w &&
              data[ny * w + nx] === isWall) {
            found = true;
          }
        }
      }
      out[y * w + x] = found ? isWall : (1 - isWall);
    }
  }
  return out;
}

function bfs(grid, labels, w, h, sx, sy, labelId) {
  const pixels = [];
  const queue = [[sx, sy]];
  let head = 0;
  labels[sy * w + sx] = labelId;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < queue.length) {
    const [cx, cy] = queue[head++];
    pixels.push([cx, cy]);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const ni = ny * w + nx;
        if (grid[ni] === 0 && labels[ni] === -1) {
          labels[ni] = labelId;
          queue.push([nx, ny]);
        }
      }
    }
  }
  return pixels;
}

function traceContour(mask, w, h) {
  // Find starting point (topmost-leftmost pixel on boundary)
  let sx = -1, sy = -1;
  outer:
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) {
        // Check if boundary (has a non-mask neighbor)
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            !mask[y * w + x - 1] || !mask[y * w + x + 1] ||
            !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x]) {
          sx = x; sy = y;
          break outer;
        }
      }
    }
  }
  if (sx === -1) return [];

  // Moore neighborhood tracing
  const dirs = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  const contour = [[sx, sy]];
  let cx = sx, cy = sy;
  let dir = 7; // start looking up-right
  const maxIter = w * h;

  for (let iter = 0; iter < maxIter; iter++) {
    // Search clockwise from opposite direction
    let startDir = (dir + 5) % 8;
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8;
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx] === 1) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (cx === sx && cy === sy) break;
    // Subsample: only add every Nth point to keep contour manageable
    if (iter % 3 === 0) {
      contour.push([cx, cy]);
    }
  }

  return contour;
}

function classifyEdge(edgeStart, edgeEnd, binary, w, h) {
  // Sample the original binary image along this polygon edge.
  // Where there are wall pixels nearby → wall segment.
  // Where there are no wall pixels nearby → door opening.
  const edgeLen = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1]);
  if (edgeLen < 0.01) return [];

  const ux = (edgeEnd[0] - edgeStart[0]) / edgeLen;
  const uy = (edgeEnd[1] - edgeStart[1]) / edgeLen;
  // Normal (perpendicular into the wall)
  const nx = -uy;
  const ny = ux;

  // Sample every pixel along the edge
  const stepM = PX_TO_METERS;
  const steps = Math.max(Math.ceil(edgeLen / stepM), 2);
  // How far perpendicular to search for wall pixels (in pixels)
  const wallSearchPx = Math.ceil(0.4 / PX_TO_METERS); // 0.4m = 8px

  const samples = []; // true = wall found, false = gap
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * edgeLen;
    const wx = edgeStart[0] + ux * t;
    const wy = edgeStart[1] + uy * t;
    const basePx = wx / PX_TO_METERS;
    const basePy = wy / PX_TO_METERS;

    // Search perpendicular to edge for wall pixels in original binary
    let foundWall = false;
    for (let d = -wallSearchPx; d <= wallSearchPx && !foundWall; d++) {
      const px = Math.round(basePx + nx * d);
      const py = Math.round(basePy + ny * d);
      if (px >= 0 && px < w && py >= 0 && py < h && binary[py * w + px] === 1) {
        foundWall = true;
      }
    }
    samples.push({ t, foundWall });
  }

  // Split into contiguous wall and gap (door) runs
  const segments = [];
  let runStart = 0;
  let runIsWall = samples[0].foundWall;

  for (let i = 1; i <= steps; i++) {
    const isWall = i > steps ? !runIsWall : samples[i].foundWall; // force flush at end
    if (isWall !== runIsWall || i > steps) {
      const tStart = samples[runStart].t;
      const tEnd = samples[i - 1].t;
      const segLen = tEnd - tStart;
      const start = [edgeStart[0] + ux * tStart, edgeStart[1] + uy * tStart];
      const end = [edgeStart[0] + ux * tEnd, edgeStart[1] + uy * tEnd];

      if (segLen > 0.05) {
        if (!runIsWall && segLen >= DOOR_MIN_WIDTH * 0.5 && segLen <= DOOR_MAX_WIDTH * 2) {
          segments.push({ type: 'door', start, end, width: segLen });
        } else {
          // If gap is too small or too large, treat as wall
          segments.push({ type: 'wall', start, end });
        }
      }

      runStart = i;
      runIsWall = isWall;
    }
  }
  // Flush final run
  if (runStart <= steps) {
    const tStart = samples[runStart].t;
    const tEnd = samples[steps].t;
    const segLen = tEnd - tStart;
    const start = [edgeStart[0] + ux * tStart, edgeStart[1] + uy * tStart];
    const end = [edgeStart[0] + ux * tEnd, edgeStart[1] + uy * tEnd];
    if (segLen > 0.05) {
      if (!runIsWall && segLen >= DOOR_MIN_WIDTH * 0.5 && segLen <= DOOR_MAX_WIDTH * 2) {
        segments.push({ type: 'door', start, end, width: segLen });
      } else {
        segments.push({ type: 'wall', start, end });
      }
    }
  }

  return segments;
}

function frame() {
  return new Promise(r => requestAnimationFrame(r));
}
