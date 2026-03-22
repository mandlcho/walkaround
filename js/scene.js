import * as THREE from 'three';
import { WALL_HEIGHT, CAMERA_HEIGHT, DOOR_HEIGHT } from './utils.js';

export function buildScene(floorData, canvas) {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x111122);

  // Scene
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x111122, 10, 40);

  // Camera
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, CAMERA_HEIGHT, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const pointLight = new THREE.PointLight(0xffffff, 0.8, 20);
  pointLight.position.copy(camera.position);
  scene.add(pointLight);

  // Materials
  const floorMat = createFloorMaterial();
  const ceilingMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, side: THREE.DoubleSide });
  const wallMat = createWallMaterial();
  const doorFrameMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, side: THREE.DoubleSide });

  // Collect meshes
  const wallMeshes = [];
  const ceilingMeshes = [];

  // Build geometry per room
  for (const room of floorData.rooms) {
    const poly = room.polygon;

    // Create Three.js shape from polygon
    const shape = new THREE.Shape();
    shape.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      shape.lineTo(poly[i][0], poly[i][1]);
    }
    shape.closePath();

    // Floor at y=0
    const floorGeo = new THREE.ShapeGeometry(shape);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    // Ceiling at y=WALL_HEIGHT
    const ceilGeo = new THREE.ShapeGeometry(shape);
    const ceiling = new THREE.Mesh(ceilGeo, ceilingMat);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    scene.add(ceiling);
    ceilingMeshes.push(ceiling);
  }

  // Helper to find nearest room center for inward-facing calculation
  function findNearestRoomCenter(mx, mz) {
    let bestDist = Infinity, bestCenter = null;
    for (const room of floorData.rooms) {
      const d = Math.hypot(room.center[0] - mx, room.center[1] - mz);
      if (d < bestDist) { bestDist = d; bestCenter = room.center; }
    }
    return bestCenter;
  }

  // Build solid walls (doors already excluded from floorData.walls)
  for (const wall of floorData.walls) {
    const [x1, z1] = wall.start;
    const [x2, z2] = wall.end;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.01) continue;

    const wallGeo = new THREE.PlaneGeometry(length, WALL_HEIGHT);
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);

    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    wallMesh.position.set(mx, WALL_HEIGHT / 2, mz);

    const angle = Math.atan2(z2 - z1, x2 - x1);
    wallMesh.rotation.y = -angle;

    // Face inward toward nearest room center
    const center = findNearestRoomCenter(mx, mz);
    if (center) {
      const nx = -(z2 - z1);
      const nz = (x2 - x1);
      const toCenterX = center[0] - mx;
      const toCenterZ = center[1] - mz;
      if (nx * toCenterX + nz * toCenterZ < 0) {
        wallMesh.rotation.y = -angle + Math.PI;
      }
    }

    scene.add(wallMesh);
    wallMeshes.push(wallMesh);
  }

  // Build door frames (openings you can walk through)
  for (const door of (floorData.doors || [])) {
    const [x1, z1] = door.start;
    const [x2, z2] = door.end;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.01) continue;

    const angle = Math.atan2(z2 - z1, x2 - x1);
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;

    // Transom (wall above door opening, from DOOR_HEIGHT to WALL_HEIGHT)
    const transomH = WALL_HEIGHT - DOOR_HEIGHT;
    if (transomH > 0.01) {
      const transomGeo = new THREE.PlaneGeometry(length, transomH);
      const transom = new THREE.Mesh(transomGeo, wallMat);
      transom.position.set(mx, DOOR_HEIGHT + transomH / 2, mz);
      transom.rotation.y = -angle;
      scene.add(transom);
      wallMeshes.push(transom); // block above door
    }

    // Door frame posts (two thin pillars on each side)
    const frameW = 0.04; // 4cm frame width
    const frameD = 0.04;
    const postGeo = new THREE.BoxGeometry(frameW, DOOR_HEIGHT, frameD);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);

    // Left post
    const leftPost = new THREE.Mesh(postGeo, doorFrameMat);
    leftPost.position.set(x1 + dx * frameW / 2, DOOR_HEIGHT / 2, z1 + dz * frameW / 2);
    leftPost.rotation.y = -angle;
    scene.add(leftPost);

    // Right post
    const rightPost = new THREE.Mesh(postGeo, doorFrameMat);
    rightPost.position.set(x2 - dx * frameW / 2, DOOR_HEIGHT / 2, z2 - dz * frameW / 2);
    rightPost.rotation.y = -angle;
    scene.add(rightPost);

    // Top frame (header)
    const headerGeo = new THREE.BoxGeometry(length, frameW, frameD);
    const header = new THREE.Mesh(headerGeo, doorFrameMat);
    header.position.set(mx, DOOR_HEIGHT, mz);
    header.rotation.y = -angle;
    scene.add(header);
  }

  // Set initial camera position to first room center
  if (floorData.rooms.length > 0) {
    const c = floorData.rooms[0].center;
    camera.position.set(c[0], CAMERA_HEIGHT, c[1]);
  }

  // Handle resize
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, pointLight, wallMeshes, ceilingMeshes, onResize };
}

function createFloorMaterial() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Wood-like pattern
  ctx.fillStyle = '#8B7355';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 20; i++) {
    ctx.strokeStyle = `rgba(60,40,20,${0.1 + Math.random() * 0.15})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    const y = Math.random() * size;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * 0.3, y + (Math.random() - 0.5) * 8,
                       size * 0.7, y + (Math.random() - 0.5) * 8, size, y);
    ctx.stroke();
  }
  // Plank lines
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  for (let x = 0; x < size; x += size / 4) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
}

function createWallMaterial() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#d4cfc4';
  ctx.fillRect(0, 0, size, size);
  // Subtle texture
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `rgba(180,170,155,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
}
