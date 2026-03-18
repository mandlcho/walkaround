// Constants
export const WALL_HEIGHT = 2.7;          // meters
export const PX_TO_METERS = 0.05;        // 1 pixel = 5cm
export const MOVE_SPEED = 3.0;           // m/s
export const LOOK_SENSITIVITY = 0.003;   // rad/px
export const PITCH_LIMIT = Math.PI * (80 / 180); // ±80°
export const COLLISION_DIST = 0.3;       // meters
export const CAMERA_HEIGHT = 1.6;        // meters (eye level)
export const MAX_IMAGE_SIZE = 800;       // px
export const MIN_ROOM_RATIO = 0.01;      // min room area as fraction of image
export const RDP_EPSILON = 2.0;          // Ramer-Douglas-Peucker tolerance in pixels
export const AXIS_SNAP_ANGLE = 10;       // degrees — snap near-axis edges
export const DOOR_MIN_WIDTH = 0.4;       // meters — minimum door opening
export const DOOR_MAX_WIDTH = 1.5;       // meters — maximum door opening
export const DOOR_HEIGHT = 2.2;          // meters

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
