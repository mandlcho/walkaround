import * as THREE from 'three';

/**
 * PanoramaViewer — manages 360 equirectangular panorama viewpoints
 * rendered as inside-out spheres with crossfade transitions.
 */
export class PanoramaViewer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.panoramas = []; // { texture, position: THREE.Vector3 }
    this.currentIndex = -1;
    this.enabled = false;

    // Crossfade state
    this._transitioning = false;
    this._transitionProgress = 0;
    this._transitionDuration = 0.5;

    // Shared geometry for both spheres
    const geometry = new THREE.SphereGeometry(50, 64, 32);

    // Current panorama sphere
    this._currentMaterial = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    this._currentSphere = new THREE.Mesh(geometry, this._currentMaterial);
    this._currentSphere.visible = false;
    this._currentSphere.renderOrder = -1;
    scene.add(this._currentSphere);

    // Next panorama sphere (used during crossfade)
    this._nextMaterial = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this._nextSphere = new THREE.Mesh(geometry, this._nextMaterial);
    this._nextSphere.visible = false;
    this._nextSphere.renderOrder = -1;
    scene.add(this._nextSphere);
  }

  /**
   * Add a panorama viewpoint.
   * @param {File} imageFile - equirectangular image file
   * @param {THREE.Vector3} position - world position of the viewpoint
   * @returns {Promise<number>} index of the added panorama
   */
  addPanorama(imageFile, position) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(imageFile);
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.mapping = THREE.EquirectangularReflectionMapping;
          const index = this.panoramas.length;
          this.panoramas.push({
            texture,
            position: position.clone(),
          });
          URL.revokeObjectURL(url);
          resolve(index);
        },
        undefined,
        (err) => {
          URL.revokeObjectURL(url);
          reject(err);
        }
      );
    });
  }

  /**
   * Crossfade to the panorama at the given index.
   */
  goTo(index) {
    if (index < 0 || index >= this.panoramas.length) return;
    if (this._transitioning) return;

    const pano = this.panoramas[index];

    if (this.currentIndex === -1 || !this.enabled) {
      // First panorama — show immediately, no crossfade
      this._currentMaterial.map = pano.texture;
      this._currentMaterial.needsUpdate = true;
      this._currentMaterial.opacity = 1;
      this._currentSphere.position.copy(this.camera.position);
      this._currentSphere.visible = this.enabled;
      this.currentIndex = index;
      return;
    }

    if (index === this.currentIndex) return;

    // Set up crossfade: next sphere gets the new texture
    this._nextMaterial.map = pano.texture;
    this._nextMaterial.needsUpdate = true;
    this._nextMaterial.opacity = 0;
    this._nextSphere.position.copy(this.camera.position);
    this._nextSphere.visible = true;

    this._transitioning = true;
    this._transitionProgress = 0;
    this._targetIndex = index;
  }

  /**
   * Find the index of the nearest panorama to a world position.
   * Returns -1 if no panoramas exist.
   */
  findNearest(position) {
    if (this.panoramas.length === 0) return -1;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.panoramas.length; i++) {
      const d = position.distanceTo(this.panoramas[i].position);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Enable the panorama viewer (show spheres, used in first-person mode).
   */
  enable() {
    this.enabled = true;
    if (this.currentIndex >= 0) {
      this._currentSphere.visible = true;
      this._currentSphere.position.copy(this.camera.position);
    }
  }

  /**
   * Disable the panorama viewer (hide spheres, used in dollhouse/floorplan modes).
   */
  disable() {
    this.enabled = false;
    this._currentSphere.visible = false;
    this._nextSphere.visible = false;
    this._transitioning = false;
  }

  /**
   * Update crossfade animation. Call every frame.
   * @param {number} dt - delta time in seconds
   */
  update(dt) {
    // Keep spheres centered on camera so the viewer feels immersed
    if (this.enabled && this.currentIndex >= 0) {
      this._currentSphere.position.copy(this.camera.position);
      this._nextSphere.position.copy(this.camera.position);
    }

    if (!this._transitioning) return;

    this._transitionProgress += dt / this._transitionDuration;

    if (this._transitionProgress >= 1) {
      // Transition complete — swap spheres
      this._transitionProgress = 1;
      this._transitioning = false;

      // The next sphere becomes the current
      this._currentMaterial.map = this._nextMaterial.map;
      this._currentMaterial.needsUpdate = true;
      this._currentMaterial.opacity = 1;
      this._currentSphere.visible = true;

      this._nextMaterial.opacity = 0;
      this._nextSphere.visible = false;

      this.currentIndex = this._targetIndex;
    } else {
      // Interpolate opacities
      const t = this._transitionProgress;
      this._currentMaterial.opacity = 1 - t;
      this._nextMaterial.opacity = t;
    }
  }

  /**
   * Whether any panoramas have been loaded.
   */
  hasPanoramas() {
    return this.panoramas.length > 0;
  }

  /**
   * Clean up resources.
   */
  destroy() {
    this.scene.remove(this._currentSphere);
    this.scene.remove(this._nextSphere);
    this._currentMaterial.dispose();
    this._nextMaterial.dispose();
    for (const p of this.panoramas) {
      p.texture.dispose();
    }
    this.panoramas = [];
  }
}
