import * as THREE from 'three';
import { easeInOutCubic } from './utils.js';

const _lookMatrix = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class CameraAnimator {
  constructor(camera) {
    this.camera = camera;
    this.active = false;
    this.progress = 0;
    this.duration = 0.8;
    this.startPos = new THREE.Vector3();
    this.endPos = new THREE.Vector3();
    this.startQuat = new THREE.Quaternion();
    this.endQuat = new THREE.Quaternion();
    this.doRotation = false;
    this.onComplete = null;
  }

  animateTo(position, { lookTarget = null, targetQuaternion = null, duration = 0.8, onComplete = null } = {}) {
    this.startPos.copy(this.camera.position);
    this.endPos.copy(position);
    this.startQuat.copy(this.camera.quaternion);

    if (targetQuaternion) {
      this.endQuat.copy(targetQuaternion);
      this.doRotation = true;
    } else if (lookTarget) {
      // Compute quaternion from lookAt using Matrix4 for reliability
      _lookMatrix.lookAt(position, lookTarget, _up);
      this.endQuat.setFromRotationMatrix(_lookMatrix);
      this.doRotation = true;
    } else {
      this.endQuat.copy(this.camera.quaternion);
      this.doRotation = false;
    }

    // Ensure shortest-path slerp
    if (this.doRotation && this.startQuat.dot(this.endQuat) < 0) {
      this.endQuat.set(-this.endQuat.x, -this.endQuat.y, -this.endQuat.z, -this.endQuat.w);
    }

    this.duration = duration;
    this.progress = 0;
    this.active = true;
    this.onComplete = onComplete;
  }

  update(dt) {
    if (!this.active) return false;

    this.progress = Math.min(1, this.progress + dt / this.duration);
    const t = easeInOutCubic(this.progress);

    this.camera.position.lerpVectors(this.startPos, this.endPos, t);
    if (this.doRotation) {
      this.camera.quaternion.slerpQuaternions(this.startQuat, this.endQuat, t);
    }

    if (this.progress >= 1) {
      this.active = false;
      if (this.onComplete) {
        const cb = this.onComplete;
        this.onComplete = null;
        cb();
      }
    }

    return true;
  }

  isAnimating() { return this.active; }
  cancel() { this.active = false; this.onComplete = null; }
}
