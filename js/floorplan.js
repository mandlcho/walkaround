import {
  MAX_IMAGE_SIZE, MIN_ROOM_RATIO,
  PX_TO_METERS, RDP_EPSILON, AXIS_SNAP_ANGLE,
  DOOR_MIN_WIDTH, DOOR_MAX_WIDTH,
  rdpSimplify, snapToAxis
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

  // Step 4: Morphological close (dilate then erode, 3x3)
  onProgress('Cleaning up walls...', 0.35);
  const dilated = morphOp(binary, w, h, 'dilate');
  const closed = morphOp(dilated, w, h, 'erode');
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

  // Step 9: Detect doors between adjacent rooms
  // Find wall pixels that separate two different rooms, then look for
  // thin/gap regions in the original binary image (before morph close)
  onProgress('Detecting doors...', 0.80);
  const doorRegions = detectDoorsBetweenRooms(binary, closed, labels, rooms, w, h);

  // Add walls for each room polygon, splitting around detected doors.
  // Deduplicate shared edges between adjacent rooms so each wall is only emitted once.
  const wallSet = new Set();
  function wallKey(s, e) {
    // Round to 3 decimals to catch near-identical edges
    const r = v => Math.round(v * 1000);
    const a = `${r(s[0])},${r(s[1])},${r(e[0])},${r(e[1])}`;
    const b = `${r(e[0])},${r(e[1])},${r(s[0])},${r(s[1])}`;
    return a < b ? a : b; // canonical order
  }
  function addWallIfNew(start, end) {
    const key = wallKey(start, end);
    if (wallSet.has(key)) return;
    wallSet.add(key);
    result.walls.push({ start, end });
  }
  const doorSet = new Set();

  for (const room of result.rooms) {
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const wallStart = poly[i];
      const wallEnd = poly[j];

      // Check if any detected doors overlap this edge
      const edgeDoors = findDoorsOnEdge(wallStart, wallEnd, doorRegions);
      if (edgeDoors.length > 0) {
        for (const door of edgeDoors) {
          const dk = wallKey(door.start, door.end);
          if (!doorSet.has(dk)) {
            doorSet.add(dk);
            result.doors.push(door);
          }
        }
        const segments = splitWallAroundDoors(wallStart, wallEnd, edgeDoors);
        for (const seg of segments) {
          addWallIfNew(seg.start, seg.end);
        }
      } else {
        addWallIfNew(wallStart, wallEnd);
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
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let found = false;
      outer:
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (data[(y + dy) * w + (x + dx)] === isWall) {
            found = true;
            break outer;
          }
        }
      }
      out[y * w + x] = found ? isWall : (1 - isWall);
    }
  }
  // Copy borders
  for (let x = 0; x < w; x++) {
    out[x] = data[x];
    out[(h - 1) * w + x] = data[(h - 1) * w + x];
  }
  for (let y = 0; y < h; y++) {
    out[y * w] = data[y * w];
    out[y * w + w - 1] = data[y * w + w - 1];
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

function detectDoorsBetweenRooms(binary, closed, labels, rooms, w, h) {
  // For each wall pixel in 'closed', check if it's adjacent to two different rooms.
  // Then check if the original 'binary' has a gap (no wall) at that location —
  // meaning the morph close sealed a door gap.
  // Also detect thin wall regions (wall thickness ≤ a few pixels) between rooms.

  const roomIds = new Set(rooms.map(r => r.id));
  const searchRadius = 8;

  // Step 1: Find all "door candidate" pixels — wall pixels in closed that
  // have no wall in binary (gap sealed by morph), OR thin wall pixels
  // adjacent to 2 different rooms
  const doorPixels = new Uint8Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (closed[idx] !== 1) continue; // not a wall pixel

      // Check if this was a gap sealed by morph close
      const wasGap = binary[idx] === 0;

      // Check if this is a thin wall between two rooms
      const neighborRooms = new Set();
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
            const lbl = labels[ny * w + nx];
            if (lbl >= 0 && roomIds.has(lbl)) {
              neighborRooms.add(lbl);
            }
          }
        }
      }

      if (neighborRooms.size >= 2 && (wasGap || isThinWall(binary, w, h, x, y))) {
        doorPixels[idx] = 1;
      }
    }
  }

  // Step 2: BFS to find connected clusters of door pixels
  const doorLabels = new Int32Array(w * h).fill(-1);
  const clusters = [];
  let clusterId = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (doorPixels[y * w + x] === 1 && doorLabels[y * w + x] === -1) {
        const pixels = [];
        const queue = [[x, y]];
        let head = 0;
        doorLabels[y * w + x] = clusterId;
        while (head < queue.length) {
          const [cx, cy] = queue[head++];
          pixels.push([cx, cy]);
          for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
            const nx2 = cx + ddx;
            const ny2 = cy + ddy;
            if (nx2 >= 0 && nx2 < w && ny2 >= 0 && ny2 < h &&
                doorPixels[ny2 * w + nx2] === 1 && doorLabels[ny2 * w + nx2] === -1) {
              doorLabels[ny2 * w + nx2] = clusterId;
              queue.push([nx2, ny2]);
            }
          }
        }
        clusters.push(pixels);
        clusterId++;
      }
    }
  }

  // Step 3: For each cluster, compute bounding line segment (PCA-lite: just use min/max projection)
  const doorRegions = [];
  for (const pixels of clusters) {
    if (pixels.length < 2) continue;

    // Centroid
    let cx = 0, cy = 0;
    for (const [px, py] of pixels) { cx += px; cy += py; }
    cx /= pixels.length;
    cy /= pixels.length;

    // Find principal axis via covariance
    let cxx = 0, cyy = 0, cxy = 0;
    for (const [px, py] of pixels) {
      const dx = px - cx;
      const dy = py - cy;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);

    // Project all pixels onto principal axis to find extent
    let minProj = Infinity, maxProj = -Infinity;
    for (const [px, py] of pixels) {
      const proj = (px - cx) * ax + (py - cy) * ay;
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }

    const lengthPx = maxProj - minProj;
    const lengthM = lengthPx * PX_TO_METERS;

    if (lengthM >= DOOR_MIN_WIDTH * 0.5 && lengthM <= DOOR_MAX_WIDTH * 1.5) {
      doorRegions.push({
        center: [cx * PX_TO_METERS, cy * PX_TO_METERS],
        start: [(cx + ax * minProj) * PX_TO_METERS, (cy + ay * minProj) * PX_TO_METERS],
        end: [(cx + ax * maxProj) * PX_TO_METERS, (cy + ay * maxProj) * PX_TO_METERS],
        width: lengthM
      });
    }
  }

  return doorRegions;
}

function isThinWall(binary, w, h, x, y) {
  // Check if wall at (x,y) is thin (≤5px) in any direction
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    let thickness = 1;
    for (let t = 1; t <= 6; t++) {
      const nx = x + dx * t;
      const ny = y + dy * t;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || binary[ny * w + nx] !== 1) break;
      thickness++;
    }
    for (let t = 1; t <= 6; t++) {
      const nx = x - dx * t;
      const ny = y - dy * t;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || binary[ny * w + nx] !== 1) break;
      thickness++;
    }
    if (thickness <= 5) return true;
  }
  return false;
}

function findDoorsOnEdge(wallStart, wallEnd, doorRegions) {
  // Find which door regions project onto this wall edge
  const edgeDx = wallEnd[0] - wallStart[0];
  const edgeDy = wallEnd[1] - wallStart[1];
  const edgeLen = Math.hypot(edgeDx, edgeDy);
  if (edgeLen < 0.01) return [];

  const ux = edgeDx / edgeLen;
  const uy = edgeDy / edgeLen;
  // Normal
  const nx = -uy;
  const ny = ux;

  const doors = [];
  const maxPerpendicularDist = 0.5; // meters — how close door center must be to wall line

  for (const region of doorRegions) {
    // Distance from door center to wall line
    const toCenterX = region.center[0] - wallStart[0];
    const toCenterY = region.center[1] - wallStart[1];
    const perpDist = Math.abs(toCenterX * nx + toCenterY * ny);

    if (perpDist > maxPerpendicularDist) continue;

    // Project door endpoints onto edge
    const projStart = (region.start[0] - wallStart[0]) * ux + (region.start[1] - wallStart[1]) * uy;
    const projEnd = (region.end[0] - wallStart[0]) * ux + (region.end[1] - wallStart[1]) * uy;

    const tMin = Math.max(0, Math.min(projStart, projEnd));
    const tMax = Math.min(edgeLen, Math.max(projStart, projEnd));

    if (tMax - tMin > DOOR_MIN_WIDTH * 0.5) {
      doors.push({
        start: [wallStart[0] + ux * tMin, wallStart[1] + uy * tMin],
        end: [wallStart[0] + ux * tMax, wallStart[1] + uy * tMax],
        width: tMax - tMin
      });
    }
  }

  return doors;
}

function splitWallAroundDoors(wallStart, wallEnd, doors) {
  // Sort doors by distance from wall start
  const edgeLen = Math.hypot(wallEnd[0] - wallStart[0], wallEnd[1] - wallStart[1]);
  const edgeDx = (wallEnd[0] - wallStart[0]) / edgeLen;
  const edgeDy = (wallEnd[1] - wallStart[1]) / edgeLen;

  const sorted = doors.slice().sort((a, b) => {
    const da = (a.start[0] - wallStart[0]) * edgeDx + (a.start[1] - wallStart[1]) * edgeDy;
    const db = (b.start[0] - wallStart[0]) * edgeDx + (b.start[1] - wallStart[1]) * edgeDy;
    return da - db;
  });

  const segments = [];
  let current = wallStart;

  for (const door of sorted) {
    // Wall segment before this door
    const segLen = Math.hypot(door.start[0] - current[0], door.start[1] - current[1]);
    if (segLen > 0.05) {
      segments.push({ start: current, end: door.start });
    }
    current = door.end;
  }

  // Wall segment after last door
  const remainLen = Math.hypot(wallEnd[0] - current[0], wallEnd[1] - current[1]);
  if (remainLen > 0.05) {
    segments.push({ start: current, end: wallEnd });
  }

  return segments;
}

function frame() {
  return new Promise(r => requestAnimationFrame(r));
}
