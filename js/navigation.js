import * as THREE from 'three';
import { CAMERA_HEIGHT, NAV_POINT_SPACING, pointInPolygon } from './utils.js';

export class Navigation {
  constructor(scene, camera, floorData, animator, controls) {
    this.scene = scene;
    this.camera = camera;
    this.floorData = floorData;
    this.animator = animator;
    this.controls = controls;
    this.group = new THREE.Group();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hoveredDot = null;
    this.enabled = true;

    this._generateDots();
    scene.add(this.group);
    this._setupEvents();
  }

  _generateDots() {
    const points = [];

    // Room centers
    for (const room of this.floorData.rooms) {
      points.push([room.center[0], room.center[1]]);
    }

    // Door midpoints
    for (const door of (this.floorData.doors || [])) {
      points.push([
        (door.start[0] + door.end[0]) / 2,
        (door.start[1] + door.end[1]) / 2
      ]);
    }

    // Grid fill within rooms
    for (const room of this.floorData.rooms) {
      const poly = room.polygon;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of poly) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      for (let x = minX + 0.6; x < maxX; x += NAV_POINT_SPACING) {
        for (let z = minZ + 0.6; z < maxZ; z += NAV_POINT_SPACING) {
          if (!pointInPolygon(x, z, poly)) continue;
          if (points.some(p => Math.hypot(p[0] - x, p[1] - z) < 0.8)) continue;
          points.push([x, z]);
        }
      }
    }

    // Shared geometries
    const ringGeo = new THREE.RingGeometry(0.1, 0.18, 24);
    const fillGeo = new THREE.CircleGeometry(0.18, 24);

    for (const [px, pz] of points) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.4,
        depthWrite: false, side: THREE.DoubleSide
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(px, 0.02, pz);
      ring.userData = { navPoint: [px, pz], isNavDot: true };

      const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide
      }));
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(px, 0.015, pz);
      ring.userData.fill = fill;

      this.group.add(ring);
      this.group.add(fill);
    }

    this.dots = this.group.children.filter(c => c.userData.isNavDot);
  }

  _setupEvents() {
    const canvas = document.getElementById('three-canvas');

    canvas.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this._updateHover();
    });

    canvas.addEventListener('click', (e) => {
      if (!this.enabled || this.animator.isAnimating()) return;
      if (this.controls.wasDrag()) return;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      this._handleClick();
    });

    canvas.addEventListener('touchend', (e) => {
      if (!this.enabled || this.animator.isAnimating()) return;
      if (this.controls.wasDrag()) return;
      const t = e.changedTouches[0];
      if (!t) return;
      this.mouse.x = (t.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(t.clientY / window.innerHeight) * 2 + 1;
      this._handleClick();
    });
  }

  _updateHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.dots);

    // Reset previous
    if (this.hoveredDot) {
      this.hoveredDot.material.opacity = 0.4;
      this.hoveredDot.scale.setScalar(1);
      if (this.hoveredDot.userData.fill) {
        this.hoveredDot.userData.fill.material.opacity = 0;
        this.hoveredDot.userData.fill.scale.setScalar(1);
      }
    }

    if (hits.length > 0) {
      const dot = hits[0].object;
      dot.material.opacity = 0.9;
      dot.scale.setScalar(1.4);
      if (dot.userData.fill) {
        dot.userData.fill.material.opacity = 0.4;
        dot.userData.fill.scale.setScalar(1.4);
      }
      this.hoveredDot = dot;
      document.getElementById('three-canvas').style.cursor = 'pointer';
    } else {
      this.hoveredDot = null;
      document.getElementById('three-canvas').style.cursor = '';
    }
  }

  _handleClick() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.dots);
    if (hits.length === 0) return;

    const [px, pz] = hits[0].object.userData.navPoint;
    this.animator.animateTo(
      new THREE.Vector3(px, CAMERA_HEIGHT, pz),
      { duration: 0.8 }
    );
  }

  show() { this.group.visible = true; this.enabled = true; }
  hide() { this.group.visible = false; this.enabled = false; }
  destroy() { this.scene.remove(this.group); }
}
