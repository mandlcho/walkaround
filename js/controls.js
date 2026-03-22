import * as THREE from 'three';
import { MOVE_SPEED, LOOK_SENSITIVITY, PITCH_LIMIT, COLLISION_DIST, CAMERA_HEIGHT, clamp } from './utils.js';

export function setupControls(camera, wallMeshes, joystickZone) {
  const state = {
    moveX: 0,     // strafe
    moveZ: 0,     // forward/back
    yaw: 0,       // horizontal angle
    pitch: 0,     // vertical angle
    active: true
  };

  const raycaster = new THREE.Raycaster();
  const isMobile = 'ontouchstart' in window && window.innerWidth < 1024;

  // Reusable objects to avoid per-frame allocations
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _moveDir = new THREE.Vector3();
  const _origin = new THREE.Vector3();
  const _upAxis = new THREE.Vector3(0, 1, 0);

  // --- Mobile: nipple.js joystick ---
  let joystick = null;
  if (isMobile && typeof nipplejs !== 'undefined') {
    joystick = nipplejs.create({
      zone: joystickZone,
      mode: 'static',
      position: { left: '70px', bottom: '70px' },
      size: 120,
      color: 'rgba(108, 99, 255, 0.5)'
    });

    joystick.on('move', (evt, data) => {
      if (!data.vector) return;
      state.moveX = data.vector.x;
      state.moveZ = -data.vector.y; // forward = negative y in nipple
    });

    joystick.on('end', () => {
      state.moveX = 0;
      state.moveZ = 0;
    });

    // Touch look (right side of screen)
    let touchId = null;
    let lastX = 0, lastY = 0;

    document.addEventListener('touchstart', (e) => {
      for (const touch of e.changedTouches) {
        // Only handle touches on the right half
        if (touch.clientX > window.innerWidth * 0.35 && touchId === null) {
          touchId = touch.identifier;
          lastX = touch.clientX;
          lastY = touch.clientY;
        }
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          const dx = touch.clientX - lastX;
          const dy = touch.clientY - lastY;
          state.yaw -= dx * LOOK_SENSITIVITY;
          state.pitch = clamp(state.pitch - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
          lastX = touch.clientX;
          lastY = touch.clientY;
        }
      }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === touchId) {
          touchId = null;
        }
      }
    }, { passive: true });
  }

  // --- Desktop: WASD + pointer lock ---
  const keys = {};
  document.addEventListener('keydown', (e) => { keys[e.code] = true; });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });

  if (!isMobile) {
    const threeCanvas = document.getElementById('three-canvas');
    threeCanvas.addEventListener('click', () => {
      threeCanvas.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        state.yaw -= e.movementX * LOOK_SENSITIVITY;
        state.pitch = clamp(state.pitch - e.movementY * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
      }
    });
  }

  // --- Update function (called each frame) ---
  function update(dt) {
    if (!state.active) return;

    // Desktop input
    if (!isMobile) {
      state.moveZ = 0;
      state.moveX = 0;
      if (keys['KeyW'] || keys['ArrowUp']) state.moveZ = 1;
      if (keys['KeyS'] || keys['ArrowDown']) state.moveZ = -1;
      if (keys['KeyA'] || keys['ArrowLeft']) state.moveX = -1;
      if (keys['KeyD'] || keys['ArrowRight']) state.moveX = 1;
    }

    // Apply camera rotation
    _euler.set(state.pitch, state.yaw, 0);
    camera.quaternion.setFromEuler(_euler);

    // Movement direction relative to camera yaw
    const speed = MOVE_SPEED * dt;
    _forward.set(0, 0, -1).applyAxisAngle(_upAxis, state.yaw);
    _right.set(1, 0, 0).applyAxisAngle(_upAxis, state.yaw);

    _moveDir.set(0, 0, 0);
    _moveDir.addScaledVector(_forward, state.moveZ * speed);
    _moveDir.addScaledVector(_right, state.moveX * speed);

    const moveLen = _moveDir.length();
    if (moveLen < 0.0001) return;

    // Sliding collision — try full move, then each axis independently
    _origin.copy(camera.position);
    _origin.y = CAMERA_HEIGHT * 0.5;

    // Try full movement first
    if (!isBlocked(_origin, _moveDir, moveLen, wallMeshes, raycaster)) {
      camera.position.add(_moveDir);
    } else {
      // Try sliding along X axis only
      const slideX = new THREE.Vector3(_moveDir.x, 0, 0);
      const slideXLen = slideX.length();
      if (slideXLen > 0.0001 && !isBlocked(_origin, slideX, slideXLen, wallMeshes, raycaster)) {
        camera.position.add(slideX);
      }
      // Try sliding along Z axis only
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

  function destroy() {
    state.active = false;
    if (joystick) joystick.destroy();
    document.exitPointerLock?.();
  }

  return { update, destroy, state };
}
