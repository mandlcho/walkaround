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
    this.dots = [];
    this._pulseTime = 0;
    this._hoverBeam = null;
    this._onNavigate = null;

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

    // Single shared circle geometry — subtle Matterport-style dot
    const circleGeo = new THREE.CircleGeometry(0.15, 24);

    // Hover beam geometry (thin vertical cylinder)
    this._beamGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8);
    this._beamMat = new THREE.MeshBasicMaterial({
      color: 0xd0e8ff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });

    for (const [px, pz] of points) {
      const dot = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({
        color: 0xd0e8ff,       // white with subtle blue tint
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(px, 0.02, pz);
      dot.userData = { navPoint: [px, pz], isNavDot: true, baseOpacity: 0.2 };

      this.group.add(dot);
      this.dots.push(dot);
    }
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

    // Reset previous hover
    if (this.hoveredDot && this.hoveredDot !== (hits.length > 0 ? hits[0].object : null)) {
      this.hoveredDot.scale.setScalar(1);
      // Remove beam
      if (this._hoverBeam) {
        this.group.remove(this._hoverBeam);
        this._hoverBeam = null;
      }
    }

    if (hits.length > 0) {
      const dot = hits[0].object;
      dot.material.opacity = 0.6;
      dot.scale.setScalar(1.3);

      // Add hover beam if not already present for this dot
      if (this.hoveredDot !== dot) {
        if (this._hoverBeam) {
          this.group.remove(this._hoverBeam);
        }
        const beam = new THREE.Mesh(this._beamGeo, this._beamMat);
        const [px, pz] = dot.userData.navPoint;
        beam.position.set(px, 0.02 + 0.15, pz); // sits on floor, extends 0.3m up
        this.group.add(beam);
        this._hoverBeam = beam;
      }

      this.hoveredDot = dot;
      document.getElementById('three-canvas').style.cursor = 'pointer';
    } else {
      if (this._hoverBeam) {
        this.group.remove(this._hoverBeam);
        this._hoverBeam = null;
      }
      this.hoveredDot = null;
      document.getElementById('three-canvas').style.cursor = '';
    }
  }

  _handleClick() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.dots);
    if (hits.length === 0) return;

    const [px, pz] = hits[0].object.userData.navPoint;
    const targetPos = new THREE.Vector3(px, CAMERA_HEIGHT, pz);
    this.animator.animateTo(targetPos, { duration: 0.8 });

    if (this._onNavigate) {
      this._onNavigate(targetPos);
    }
  }

  set onNavigate(fn) {
    this._onNavigate = fn;
  }

  /**
   * Call every frame with delta time.
   * Handles pulse animation and distance-based opacity fading.
   */
  update(dt) {
    if (!this.group.visible) return;

    this._pulseTime += dt;

    const camPos = this.camera.position;
    // Pulse: oscillate between 0.15 and 0.35
    const pulse = 0.25 + 0.1 * Math.sin(this._pulseTime * 2.5);

    for (const dot of this.dots) {
      // Skip hovered dot — it has its own opacity
      if (dot === this.hoveredDot) continue;

      const [px, pz] = dot.userData.navPoint;
      const dist = Math.hypot(camPos.x - px, camPos.z - pz);

      // Distance-based fade: full brightness within 3m, fade to 0 at 8m+
      let distFactor;
      if (dist <= 3) {
        distFactor = 1;
      } else if (dist >= 8) {
        distFactor = 0;
      } else {
        distFactor = 1 - (dist - 3) / 5;
      }

      dot.material.opacity = pulse * distFactor;
      dot.userData.baseOpacity = pulse * distFactor;
    }
  }

  show() { this.group.visible = true; this.enabled = true; }
  hide() { this.group.visible = false; this.enabled = false; }
  destroy() { this.scene.remove(this.group); }
}
