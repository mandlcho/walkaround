/**
 * floorplan.js — Detects walls from a B&W floor plan image and
 * produces wall segments for the 3D scene.
 */

const FloorPlan = (() => {
  /**
   * Load an image file into an ImageData on a hidden canvas.
   * Returns { imageData, width, height }.
   */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Scale down large images for performance
        const MAX = 512;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve({
          imageData: ctx.getImageData(0, 0, w, h),
          width: w,
          height: h,
          canvas,
        });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Convert imageData to a binary grid: 1 = wall (dark pixel), 0 = floor (light pixel).
   */
  function toBinaryGrid(imageData) {
    const { data, width, height } = imageData;
    const grid = new Uint8Array(width * height);
    const threshold = 128;
    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const brightness = (r + g + b) / 3;
      grid[i] = brightness < threshold ? 1 : 0;
    }
    return { grid, width, height };
  }

  /**
   * Clean up the binary grid: remove small noise, fill small gaps.
   */
  function cleanGrid(grid, width, height) {
    const cleaned = new Uint8Array(grid);

    // Morphological close then open (simple 3x3 kernel)
    function dilate(src) {
      const dst = new Uint8Array(src.length);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (src[y * width + x] ||
              src[(y-1) * width + x] || src[(y+1) * width + x] ||
              src[y * width + x-1] || src[y * width + x+1]) {
            dst[y * width + x] = 1;
          }
        }
      }
      return dst;
    }

    function erode(src) {
      const dst = new Uint8Array(src.length);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (src[y * width + x] &&
              src[(y-1) * width + x] && src[(y+1) * width + x] &&
              src[y * width + x-1] && src[y * width + x+1]) {
            dst[y * width + x] = 1;
          }
        }
      }
      return dst;
    }

    // Close: dilate then erode (fills small gaps)
    let result = dilate(cleaned);
    result = erode(result);

    // Open: erode then dilate (removes small noise)
    result = erode(result);
    result = dilate(result);

    return result;
  }

  /**
   * Extract wall segments from the binary grid.
   * Uses run-length encoding on rows and columns to find horizontal and vertical wall runs.
   * Returns array of { x1, y1, x2, y2 } in grid coordinates.
   */
  function extractWallSegments(grid, width, height) {
    const segments = [];
    const MIN_RUN = 4; // minimum pixels for a wall run

    // Horizontal runs
    for (let y = 0; y < height; y++) {
      let runStart = -1;
      for (let x = 0; x <= width; x++) {
        const isWall = x < width && grid[y * width + x] === 1;
        if (isWall && runStart === -1) {
          runStart = x;
        } else if (!isWall && runStart !== -1) {
          if (x - runStart >= MIN_RUN) {
            segments.push({ x1: runStart, y1: y, x2: x, y2: y });
          }
          runStart = -1;
        }
      }
    }

    // Vertical runs
    for (let x = 0; x < width; x++) {
      let runStart = -1;
      for (let y = 0; y <= height; y++) {
        const isWall = y < height && grid[y * width + x] === 1;
        if (isWall && runStart === -1) {
          runStart = y;
        } else if (!isWall && runStart !== -1) {
          if (y - runStart >= MIN_RUN) {
            segments.push({ x1: x, y1: runStart, x2: x, y2: y });
          }
          runStart = -1;
        }
      }
    }

    return segments;
  }

  /**
   * Merge overlapping / near segments on the same axis.
   */
  function mergeSegments(segments) {
    const MERGE_DIST = 3;
    const merged = [];

    // Separate horizontal and vertical
    const horiz = segments.filter(s => s.y1 === s.y2).sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
    const vert = segments.filter(s => s.x1 === s.x2).sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1);

    function mergeGroup(group, primary, secStart, secEnd) {
      if (group.length === 0) return;
      const result = [];
      let cur = { ...group[0] };

      for (let i = 1; i < group.length; i++) {
        const seg = group[i];
        const sameLine = Math.abs(seg[primary] - cur[primary]) <= MERGE_DIST;
        const overlaps = seg[secStart] <= cur[secEnd] + MERGE_DIST;

        if (sameLine && overlaps) {
          cur[secEnd] = Math.max(cur[secEnd], seg[secEnd]);
          cur[primary] = Math.round((cur[primary] + seg[primary]) / 2);
          if (primary === 'y1') cur.y2 = cur.y1;
          else cur.x2 = cur.x1;
        } else {
          result.push(cur);
          cur = { ...seg };
        }
      }
      result.push(cur);
      return result;
    }

    merged.push(...(mergeGroup(horiz, 'y1', 'x1', 'x2') || []));
    merged.push(...(mergeGroup(vert, 'x1', 'y1', 'y2') || []));

    return merged;
  }

  /**
   * Find a good starting position (largest open floor area).
   * Returns { x, y } in grid coordinates.
   */
  function findStartPosition(grid, width, height) {
    // Find the center of the largest open area using distance transform
    const dist = new Float32Array(width * height);

    // Initialize: floor=0, wall=large
    for (let i = 0; i < grid.length; i++) {
      dist[i] = grid[i] === 0 ? Infinity : 0;
    }

    // Two-pass distance transform (Chebyshev)
    // Forward pass
    for (let y = 1; y < height; y++) {
      for (let x = 1; x < width; x++) {
        if (dist[y * width + x] === 0) continue;
        const up = dist[(y-1) * width + x];
        const left = dist[y * width + (x-1)];
        const upLeft = dist[(y-1) * width + (x-1)];
        dist[y * width + x] = Math.min(dist[y * width + x], Math.min(up, left, upLeft) + 1);
      }
    }

    // Backward pass
    for (let y = height - 2; y >= 0; y--) {
      for (let x = width - 2; x >= 0; x--) {
        if (dist[y * width + x] === 0) continue;
        const down = dist[(y+1) * width + x];
        const right = dist[y * width + (x+1)];
        const downRight = dist[(y+1) * width + (x+1)];
        dist[y * width + x] = Math.min(dist[y * width + x], Math.min(down, right, downRight) + 1);
      }
    }

    // Find pixel with max distance (center of largest open area)
    let maxDist = 0;
    let bestX = Math.floor(width / 2);
    let bestY = Math.floor(height / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (dist[y * width + x] > maxDist) {
          maxDist = dist[y * width + x];
          bestX = x;
          bestY = y;
        }
      }
    }

    return { x: bestX, y: bestY };
  }

  /**
   * Main processing pipeline.
   * Takes an image File, returns { segments, startPos, gridWidth, gridHeight, grid }.
   */
  async function process(file) {
    const { imageData, width, height, canvas } = await loadImage(file);
    const { grid: rawGrid } = toBinaryGrid(imageData);
    const grid = cleanGrid(rawGrid, width, height);
    let segments = extractWallSegments(grid, width, height);
    segments = mergeSegments(segments);
    const startPos = findStartPosition(grid, width, height);

    return {
      segments,
      startPos,
      gridWidth: width,
      gridHeight: height,
      grid,
      previewCanvas: canvas,
    };
  }

  return { process, loadImage, toBinaryGrid };
})();
