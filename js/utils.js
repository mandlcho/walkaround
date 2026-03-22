// Constants
export const WALL_HEIGHT = 2.7;          // meters
export const PX_TO_METERS = 0.05;        // 1 pixel = 5cm
export const MOVE_SPEED = 3.0;           // m/s
export const LOOK_SENSITIVITY = 0.003;   // rad/px
export const PITCH_LIMIT = Math.PI * (80 / 180); // ±80°
export const COLLISION_DIST = 0.2;       // meters
export const CAMERA_HEIGHT = 1.6;        // meters (eye level)
export const MAX_IMAGE_SIZE = 800;       // px
export const MIN_ROOM_RATIO = 0.01;      // min room area as fraction of image
export const RDP_EPSILON = 2.0;          // Ramer-Douglas-Peucker tolerance in pixels
export const AXIS_SNAP_ANGLE = 10;       // degrees — snap near-axis edges
export const DOOR_MIN_WIDTH = 0.4;       // meters — minimum door opening
export const DOOR_MAX_WIDTH = 1.5;       // meters — maximum door opening
export const DOOR_HEIGHT = 2.2;          // meters
export const NAV_POINT_SPACING = 1.2;   // meters between nav dots
export const TRANSITION_DURATION = 0.8; // seconds for click-to-move
export const MODE_TRANSITION_DURATION = 1.2; // seconds for mode switches

// Helpers
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function perpendicularDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, x1, y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

export function rdpSimplify(points, epsilon) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i][0], points[i][1], first[0], first[1], last[0], last[1]);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function snapToAxis(points, angleDeg) {
  const threshold = angleDeg * Math.PI / 180;
  const result = [...points];
  for (let i = 0; i < result.length; i++) {
    const j = (i + 1) % result.length;
    const dx = result[j][0] - result[i][0];
    const dy = result[j][1] - result[i][1];
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
    if (angle < threshold) {
      // Nearly horizontal — snap y
      result[j] = [result[j][0], result[i][1]];
    } else if (angle > Math.PI / 2 - threshold) {
      // Nearly vertical — snap x
      result[j] = [result[i][0], result[j][1]];
    }
  }
  return result;
}
