import * as THREE from 'three';
import { MOVE_SPEED, LOOK_SENSITIVITY, PITCH_LIMIT, COLLISION_DIST, CAMERA_HEIGHT, clamp } from './utils.js';

export function setupControls(camera, wallMeshes) {
  const state = {
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    pitch: 0,
    active: true,
    enabled: true
  };

  const raycaster = new THREE.Raycaster();
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _moveDir = new THREE.Vector3();
  const _origin = new THREE.Vector3();
  const _upAxis = new THREE.Vector3(0, 1, 0);

  const canvas = document.getElementById('three-canvas');

  // --- Drag state for click vs drag disambiguation ---
  let mouseDragDist = 0;
  let touchDragDist = 0;
  let isDragging = false;
  let lastMouseX = 0, lastMouseY = 0;

  // --- Desktop: mouse drag to look ---
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    mouseDragDist = 0;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !state.enabled) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    mouseDragDist += Math.abs(dx) + Math.abs(dy);
    state.yaw -= dx * LOOK_SENSITIVITY;
    state.pitch = clamp(state.pitch - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  // --- Desktop: WASD / Arrow keys ---
  const keys = {};
  document.addEventListener('keydown', (e) => { keys[e.code] = true; });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // --- Mobile: touch drag to look ---
  let touchId = null;
  let lastTX = 0, lastTY = 0;

  canvas.addEventListener('touchstart', (e) => {
    if (!state.enabled || touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    lastTX = t.clientX;
    lastTY = t.clientY;
    touchDragDist = 0;
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (!state.enabled) return;
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        const dx = t.clientX - lastTX;
        const dy = t.clientY - lastTY;
        touchDragDist += Math.abs(dx) + Math.abs(dy);
        state.yaw -= dx * LOOK_SENSITIVITY;
        state.pitch = clamp(state.pitch - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
        lastTX = t.clientX;
        lastTY = t.clientY;
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) touchId = null;
    }
  }, { passive: true });

  // --- Update (called each frame in first-person mode) ---
  function update(dt) {
    if (!state.active || !state.enabled) return;

    // Apply camera rotation
    _euler.set(state.pitch, state.yaw, 0);
    camera.quaternion.setFromEuler(_euler);

    // WASD input
    state.moveZ = 0;
    state.moveX = 0;
    if (keys['KeyW'] || keys['ArrowUp']) state.moveZ = 1;
    if (keys['KeyS'] || keys['ArrowDown']) state.moveZ = -1;
    if (keys['KeyA'] || keys['ArrowLeft']) state.moveX = -1;
    if (keys['KeyD'] || keys['ArrowRight']) state.moveX = 1;

    const speed = MOVE_SPEED * dt;
    _forward.set(0, 0, -1).applyAxisAngle(_upAxis, state.yaw);
    _right.set(1, 0, 0).applyAxisAngle(_upAxis, state.yaw);

    _moveDir.set(0, 0, 0);
    _moveDir.addScaledVector(_forward, state.moveZ * speed);
    _moveDir.addScaledVector(_right, state.moveX * speed);

    const moveLen = _moveDir.length();
    if (moveLen < 0.0001) return;

    // Sliding collision
    _origin.copy(camera.position);
    _origin.y = CAMERA_HEIGHT * 0.5;

    if (!isBlocked(_origin, _moveDir, moveLen, wallMeshes, raycaster)) {
      camera.position.add(_moveDir);
    } else {
      const slideX = new THREE.Vector3(_moveDir.x, 0, 0);
      const slideXLen = slideX.length();
      if (slideXLen > 0.0001 && !isBlocked(_origin, slideX, slideXLen, wallMeshes, raycaster)) {
        camera.position.add(slideX);
      }
      const slideZ = new THREE.Vector3(0, 0, _moveDir.z);
      const slideZLen = slideZ.length();
      if (slideZLen > 0.0001 && !isBlocked(_origin, slideZ, slideZLen, wallMeshes, raycaster)) {
        camera.position.add(slideZ);
      }
    }
    camera.position.y = CAMERA_HEIGHT;
  }

  function isBlocked(origin, dir, len, walls, rc) {
    const d = dir.clone().normalize();
    rc.set(origin, d);
    rc.far = COLLISION_DIST + len;
    const hits = rc.intersectObjects(walls);
    return hits.length > 0 && hits[0].distance < COLLISION_DIST + len;
  }

  function wasDrag() {
    return mouseDragDist > 5 || touchDragDist > 15;
  }

  function enable() { state.enabled = true; }
  function disable() { state.enabled = false; }
  function destroy() { state.active = false; }

  return { update, enable, disable, destroy, state, wasDrag };
}
