import * as THREE from 'three';
import { WALL_HEIGHT, CAMERA_HEIGHT } from './utils.js';

export const MODES = {
  FIRST_PERSON: 'firstperson',
  DOLLHOUSE: 'dollhouse',
  FLOOR_PLAN: 'floorplan'
};

export class ViewMode {
  constructor({ camera, floorData, controls, navigation, cameraAnimator, orbitControls, sceneData }) {
    this.camera = camera;
    this.floorData = floorData;
    this.controls = controls;
    this.navigation = navigation;
    this.animator = cameraAnimator;
    this.orbit = orbitControls;
    this.sceneData = sceneData;
    this.currentMode = MODES.FIRST_PERSON;
    this.savedPos = camera.position.clone();
    this.savedYaw = 0;
    this.savedPitch = 0;
    this._listeners = [];
  }

  onChange(fn) { this._listeners.push(fn); }

  switchMode(mode) {
    if (mode === this.currentMode || this.animator.isAnimating()) return;
    this._exitCurrent();
    this._enter(mode);
    this.currentMode = mode;
    this._listeners.forEach(fn => fn(mode));
  }

  _exitCurrent() {
    if (this.currentMode === MODES.FIRST_PERSON) {
      this.savedPos.copy(this.camera.position);
      this.savedYaw = this.controls.state.yaw;
      this.savedPitch = this.controls.state.pitch;
      this.controls.disable();
      this.navigation.hide();
    } else {
      this.orbit.enabled = false;
      this.orbit.enableRotate = true;
    }
  }

  _enter(mode) {
    const fog = this.sceneData.scene.fog;
    const ceilings = this.sceneData.ceilingMeshes;

    if (mode === MODES.FIRST_PERSON) {
      ceilings.forEach(m => m.visible = true);
      fog.near = 10; fog.far = 40;
      // Compute target quaternion from saved yaw/pitch so rotation animates smoothly
      const euler = new THREE.Euler(this.savedPitch, this.savedYaw, 0, 'YXZ');
      const targetQuat = new THREE.Quaternion().setFromEuler(euler);
      this.animator.animateTo(this.savedPos, {
        targetQuaternion: targetQuat,
        duration: 1.0,
        onComplete: () => {
          this.controls.state.yaw = this.savedYaw;
          this.controls.state.pitch = this.savedPitch;
          this.controls.enable();
          this.navigation.show();
        }
      });
    } else if (mode === MODES.DOLLHOUSE) {
      ceilings.forEach(m => m.visible = false);
      fog.near = 100; fog.far = 200;
      const { position, target } = this._dollhouseCamera();
      this.animator.animateTo(position, {
        lookTarget: target,
        duration: 1.2,
        onComplete: () => {
          this.orbit.target.copy(target);
          this.orbit.enabled = true;
          this.orbit.minDistance = 2;
          this.orbit.maxDistance = Math.max(this.floorData.bounds.w, this.floorData.bounds.h) * 3;
          this.orbit.maxPolarAngle = Math.PI / 2 - 0.05;
          this.orbit.update();
        }
      });
    } else if (mode === MODES.FLOOR_PLAN) {
      ceilings.forEach(m => m.visible = false);
      fog.near = 100; fog.far = 200;
      const { position, target } = this._floorPlanCamera();
      this.animator.animateTo(position, {
        lookTarget: target,
        duration: 1.0,
        onComplete: () => {
          this.orbit.target.copy(target);
          this.orbit.enableRotate = false;
          this.orbit.enabled = true;
          this.orbit.update();
        }
      });
    }
  }

  _dollhouseCamera() {
    const b = this.floorData.bounds;
    const cx = b.w / 2, cz = b.h / 2;
    const maxDim = Math.max(b.w, b.h);
    const dist = maxDim * 1.2;
    return {
      position: new THREE.Vector3(cx + dist * 0.3, dist * 0.7, cz + dist * 0.5),
      target: new THREE.Vector3(cx, WALL_HEIGHT / 2, cz)
    };
  }

  _floorPlanCamera() {
    const b = this.floorData.bounds;
    const cx = b.w / 2, cz = b.h / 2;
    const maxDim = Math.max(b.w, b.h);
    return {
      position: new THREE.Vector3(cx, maxDim * 1.5, cz + 0.01),
      target: new THREE.Vector3(cx, 0, cz)
    };
  }
}
