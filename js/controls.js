/**
 * controls.js — Mobile touch joystick + look, desktop keyboard + mouse.
 */

const Controls = (() => {
  let camera;
  let enabled = false;

  // Movement state
  const move = { forward: 0, right: 0 };
  let yaw = 0;
  let pitch = 0;

  const MOVE_SPEED = 3.5;  // m/s
  const LOOK_SPEED = 0.003;
  const PITCH_LIMIT = Math.PI / 3;
  const EYE_HEIGHT = 1.6;

  // Joystick state
  let joystickActive = false;
  let joystickTouchId = null;
  let joystickCenter = { x: 0, y: 0 };
  const JOYSTICK_MAX = 50; // px

  // Look state
  let lookTouchId = null;
  let lastLookPos = { x: 0, y: 0 };

  // Keyboard state
  const keys = {};

  // Elements
  let joystickZone, joystickBase, joystickThumb, lookZone;

  // Desktop: pointer lock
  let pointerLocked = false;

  function init(cam) {
    camera = cam;
    yaw = camera.rotation.y;
    pitch = 0;

    joystickZone = document.getElementById('joystick-zone');
    joystickBase = document.getElementById('joystick-base');
    joystickThumb = document.getElementById('joystick-thumb');
    lookZone = document.getElementById('look-zone');

    // Touch: joystick
    joystickZone.addEventListener('touchstart', onJoystickStart, { passive: false });
    window.addEventListener('touchmove', onJoystickMove, { passive: false });
    window.addEventListener('touchend', onJoystickEnd, { passive: false });

    // Touch: look
    lookZone.addEventListener('touchstart', onLookStart, { passive: false });
    window.addEventListener('touchmove', onLookMove, { passive: false });
    window.addEventListener('touchend', onLookEnd, { passive: false });

    // Keyboard (desktop fallback)
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Pointer lock (desktop)
    const canvas = document.getElementById('three-canvas');
    canvas.addEventListener('click', () => {
      if (!enabled) return;
      if (!pointerLocked && window.matchMedia('(hover: hover)').matches) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      pointerLocked = document.pointerLockElement === canvas;
    });

    document.addEventListener('mousemove', onMouseMove);
  }

  // -- Joystick --

  function onJoystickStart(e) {
    e.preventDefault();
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    const rect = joystickBase.getBoundingClientRect();
    joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    joystickActive = true;
    updateJoystick(touch.clientX, touch.clientY);
  }

  function onJoystickMove(e) {
    if (!joystickActive) return;
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickTouchId) {
        e.preventDefault();
        updateJoystick(touch.clientX, touch.clientY);
        break;
      }
    }
  }

  function onJoystickEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickTouchId) {
        joystickTouchId = null;
        joystickActive = false;
        move.forward = 0;
        move.right = 0;
        joystickThumb.style.transform = 'translate(0px, 0px)';
        break;
      }
    }
  }

  function updateJoystick(touchX, touchY) {
    let dx = touchX - joystickCenter.x;
    let dy = touchY - joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > JOYSTICK_MAX) {
      dx = (dx / dist) * JOYSTICK_MAX;
      dy = (dy / dist) * JOYSTICK_MAX;
    }

    joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;

    // Normalize to -1..1
    move.right = dx / JOYSTICK_MAX;
    move.forward = -dy / JOYSTICK_MAX; // up = forward
  }

  // -- Look (touch) --

  function onLookStart(e) {
    e.preventDefault();
    if (lookTouchId !== null) return;
    const touch = e.changedTouches[0];
    lookTouchId = touch.identifier;
    lastLookPos = { x: touch.clientX, y: touch.clientY };
  }

  function onLookMove(e) {
    if (lookTouchId === null) return;
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookTouchId) {
        e.preventDefault();
        const dx = touch.clientX - lastLookPos.x;
        const dy = touch.clientY - lastLookPos.y;
        lastLookPos = { x: touch.clientX, y: touch.clientY };

        yaw -= dx * LOOK_SPEED * 1.5;
        pitch -= dy * LOOK_SPEED * 1.5;
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
        break;
      }
    }
  }

  function onLookEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === lookTouchId) {
        lookTouchId = null;
        break;
      }
    }
  }

  // -- Mouse (desktop) --

  function onMouseMove(e) {
    if (!pointerLocked || !enabled) return;
    yaw -= e.movementX * LOOK_SPEED;
    pitch -= e.movementY * LOOK_SPEED;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  // -- Keyboard --

  function onKeyDown(e) {
    keys[e.code] = true;
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function getKeyboardMove() {
    let f = 0, r = 0;
    if (keys['KeyW'] || keys['ArrowUp']) f += 1;
    if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
    if (keys['KeyA'] || keys['ArrowLeft']) r -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) r += 1;
    return { forward: f, right: r };
  }

  /**
   * Update camera position. Call every frame with delta time.
   */
  function update(dt) {
    if (!enabled || !camera) return;

    // Combine touch and keyboard input
    const kb = getKeyboardMove();
    const fwd = move.forward || kb.forward;
    const rgt = move.right || kb.right;

    // Direction vectors
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    const vx = (sinYaw * fwd + cosYaw * rgt) * MOVE_SPEED * dt;
    const vz = (cosYaw * fwd - sinYaw * rgt) * MOVE_SPEED * dt;

    // Attempt move with collision
    const newX = camera.position.x + vx;
    const newZ = camera.position.z + vz;

    // Try full move first
    if (!WalkScene.isColliding(newX, newZ)) {
      camera.position.x = newX;
      camera.position.z = newZ;
    } else if (!WalkScene.isColliding(newX, camera.position.z)) {
      // Slide along X
      camera.position.x = newX;
    } else if (!WalkScene.isColliding(camera.position.x, newZ)) {
      // Slide along Z
      camera.position.z = newZ;
    }
    // else: stuck, don't move

    camera.position.y = EYE_HEIGHT;

    // Apply rotation
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  function enable() { enabled = true; }
  function disable() { enabled = false; }

  function getYaw() { return yaw; }
  function getPosition() { return camera ? camera.position : null; }

  return { init, update, enable, disable, getYaw, getPosition };
})();
