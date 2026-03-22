import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { WALL_HEIGHT, CAMERA_HEIGHT, DOOR_HEIGHT } from './utils.js';

const isMobile = /Android|iPhone|iPad/.test(navigator.userAgent) || window.innerWidth < 768;

export function buildScene(floorData, canvas) {
  // --- Renderer ---
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x080810);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // --- Scene ---
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0a14, 0.025);

  // --- Environment map (procedural interior cubemap) ---
  scene.environment = createInteriorEnvMap();

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 150);
  camera.position.set(0, CAMERA_HEIGHT, 0);

  // --- Lighting ---
  // Hemisphere: warm floor bounce + cool sky
  const hemiLight = new THREE.HemisphereLight(0xc8d8f0, 0x8a7560, 0.35);
  scene.add(hemiLight);

  // Main point light — warm, follows camera, casts shadows
  const pointLight = new THREE.PointLight(0xffe8cc, 1.5, 30, 1.8);
  pointLight.castShadow = true;
  pointLight.shadow.mapSize.set(isMobile ? 512 : 2048, isMobile ? 512 : 2048);
  pointLight.shadow.radius = isMobile ? 3 : 6;
  pointLight.shadow.bias = -0.001;
  pointLight.shadow.normalBias = 0.02;
  pointLight.position.copy(camera.position);
  scene.add(pointLight);

  // Fill light — cool, near ceiling, softer
  const fillLight = new THREE.PointLight(0xb0c8e8, 0.4, 35);
  fillLight.position.set(0, WALL_HEIGHT - 0.2, 0);
  scene.add(fillLight);

  // Ambient fill for dark corners
  const ambLight = new THREE.AmbientLight(0x202030, 0.15);
  scene.add(ambLight);

  // Directional for dollhouse/exterior views
  const dirLight = new THREE.DirectionalLight(0xfff5e0, 0.25);
  dirLight.position.set(15, 25, 10);
  scene.add(dirLight);

  // --- Materials ---
  const floorMat = createFloorMaterial();
  const ceilingMat = createCeilingMaterial();
  const wallMat = createWallMaterial();
  const doorFrameMat = new THREE.MeshPhysicalMaterial({
    color: 0x4a2810,
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
    side: THREE.DoubleSide
  });
  const baseboardMat = new THREE.MeshStandardMaterial({
    color: 0xf5f0e8,
    roughness: 0.4,
    metalness: 0.0
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xf0ebe0,
    roughness: 0.45,
    metalness: 0.0
  });

  // --- Mesh collections ---
  const wallMeshes = [];
  const ceilingMeshes = [];

  // --- Build rooms ---
  for (const room of floorData.rooms) {
    const poly = room.polygon;
    const shape = new THREE.Shape();
    shape.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i][0], poly[i][1]);
    shape.closePath();

    // Floor
    const floorGeo = new THREE.ShapeGeometry(shape);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    // Ceiling
    const ceilGeo = new THREE.ShapeGeometry(shape);
    const ceiling = new THREE.Mesh(ceilGeo, ceilingMat);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    ceiling.receiveShadow = true;
    scene.add(ceiling);
    ceilingMeshes.push(ceiling);

    // Ceiling light fixture (emissive disc per room)
    const lightRad = Math.min(Math.sqrt(room.area) * 0.15, 0.4);
    const fixtureGeo = new THREE.CircleGeometry(lightRad, 24);
    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0xfff8f0,
      emissive: 0xfff0dd,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      side: THREE.DoubleSide
    });
    const fixture = new THREE.Mesh(fixtureGeo, fixtureMat);
    fixture.rotation.x = Math.PI / 2;
    fixture.position.set(room.center[0], WALL_HEIGHT - 0.005, room.center[1]);
    scene.add(fixture);
    ceilingMeshes.push(fixture);

    // Per-room ceiling spot light (warm downlight)
    if (!isMobile || floorData.rooms.indexOf(room) < 4) {
      const spotLight = new THREE.PointLight(0xffeedd, 0.3, 8, 2);
      spotLight.position.set(room.center[0], WALL_HEIGHT - 0.1, room.center[1]);
      scene.add(spotLight);
    }
  }

  // --- Helper ---
  function findNearestRoomCenter(mx, mz) {
    let bestDist = Infinity, bestCenter = null;
    for (const room of floorData.rooms) {
      const d = Math.hypot(room.center[0] - mx, room.center[1] - mz);
      if (d < bestDist) { bestDist = d; bestCenter = room.center; }
    }
    return bestCenter;
  }

  // --- Walls ---
  const WALL_OVERLAP = 0.02; // meters — extend each end to cover micro-gaps
  for (const wall of floorData.walls) {
    const [x1, z1] = wall.start;
    const [x2, z2] = wall.end;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.01) continue;

    // Extend the wall slightly past each endpoint to seal micro-gaps
    const ux = (x2 - x1) / length;
    const uz = (z2 - z1) / length;
    const ex1 = x1 - ux * WALL_OVERLAP;
    const ez1 = z1 - uz * WALL_OVERLAP;
    const ex2 = x2 + ux * WALL_OVERLAP;
    const ez2 = z2 + uz * WALL_OVERLAP;
    const extendedLength = length + WALL_OVERLAP * 2;

    const wallGeo = new THREE.PlaneGeometry(extendedLength, WALL_HEIGHT);
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);

    const mx = (ex1 + ex2) / 2;
    const mz = (ez1 + ez2) / 2;
    wallMesh.position.set(mx, WALL_HEIGHT / 2, mz);

    const angle = Math.atan2(ez2 - ez1, ex2 - ex1);
    wallMesh.rotation.y = -angle;

    const center = findNearestRoomCenter(mx, mz);
    if (center) {
      const nx = -(ez2 - ez1), nz = (ex2 - ex1);
      if (nx * (center[0] - mx) + nz * (center[1] - mz) < 0) {
        wallMesh.rotation.y = -angle + Math.PI;
      }
    }

    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);
    wallMeshes.push(wallMesh);

    // Baseboard (also extended to match wall)
    if (extendedLength > 0.15) {
      const bbGeo = new THREE.BoxGeometry(extendedLength, 0.1, 0.018);
      const bb = new THREE.Mesh(bbGeo, baseboardMat);
      bb.position.set(mx, 0.05, mz);
      bb.rotation.y = -angle;
      bb.castShadow = true;
      bb.receiveShadow = true;
      scene.add(bb);

      // Crown molding at ceiling (also extended)
      const cmGeo = new THREE.BoxGeometry(extendedLength, 0.06, 0.012);
      const cm = new THREE.Mesh(cmGeo, crownMat);
      cm.position.set(mx, WALL_HEIGHT - 0.03, mz);
      cm.rotation.y = -angle;
      scene.add(cm);
    }
  }

  // --- Door frames ---
  for (const door of (floorData.doors || [])) {
    const [x1, z1] = door.start;
    const [x2, z2] = door.end;
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 0.01) continue;

    const angle = Math.atan2(z2 - z1, x2 - x1);
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;

    // Transom
    const transomH = WALL_HEIGHT - DOOR_HEIGHT;
    if (transomH > 0.01) {
      const transomGeo = new THREE.PlaneGeometry(length, transomH);
      const transom = new THREE.Mesh(transomGeo, wallMat);
      transom.position.set(mx, DOOR_HEIGHT + transomH / 2, mz);
      transom.rotation.y = -angle;
      transom.castShadow = true;
      transom.receiveShadow = true;
      scene.add(transom);
      wallMeshes.push(transom);
    }

    // Frame posts
    const frameW = 0.05, frameD = 0.05;
    const postGeo = new THREE.BoxGeometry(frameW, DOOR_HEIGHT, frameD);
    const dx = Math.cos(angle), dz = Math.sin(angle);

    const leftPost = new THREE.Mesh(postGeo, doorFrameMat);
    leftPost.position.set(x1 + dx * frameW / 2, DOOR_HEIGHT / 2, z1 + dz * frameW / 2);
    leftPost.rotation.y = -angle;
    leftPost.castShadow = true;
    scene.add(leftPost);

    const rightPost = new THREE.Mesh(postGeo, doorFrameMat);
    rightPost.position.set(x2 - dx * frameW / 2, DOOR_HEIGHT / 2, z2 - dz * frameW / 2);
    rightPost.rotation.y = -angle;
    rightPost.castShadow = true;
    scene.add(rightPost);

    const headerGeo = new THREE.BoxGeometry(length + frameW * 2, frameW, frameD);
    const header = new THREE.Mesh(headerGeo, doorFrameMat);
    header.position.set(mx, DOOR_HEIGHT + frameW / 2, mz);
    header.rotation.y = -angle;
    header.castShadow = true;
    scene.add(header);
  }

  // --- Post-processing ---
  const composer = new EffectComposer(renderer);

  // 1. Base render
  composer.addPass(new RenderPass(scene, camera));

  // 2. SSAO — ambient occlusion in corners and edges
  if (!isMobile) {
    const ssao = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ssao.kernelRadius = 0.4;
    ssao.minDistance = 0.0005;
    ssao.maxDistance = 0.08;
    ssao.intensity = 1.2;
    composer.addPass(ssao);
  }

  // 3. Bloom — subtle glow on bright surfaces and light fixtures
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.12,  // strength
    0.5,   // radius
    0.82   // threshold
  );
  composer.addPass(bloom);

  // 4. Vignette + color grading
  const colorGrade = new ShaderPass(ColorGradeShader);
  composer.addPass(colorGrade);

  // 5. Output (tone mapping + color space)
  composer.addPass(new OutputPass());

  // --- Initial position ---
  if (floorData.rooms.length > 0) {
    const c = floorData.rooms[0].center;
    camera.position.set(c[0], CAMERA_HEIGHT, c[1]);
  }

  // --- Resize ---
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, pointLight, fillLight, wallMeshes, ceilingMeshes, composer, onResize };
}

// ===============================================================
// ENVIRONMENT MAP — procedural interior cubemap
// ===============================================================
function createInteriorEnvMap() {
  const size = 128;
  const faces = [];

  for (let f = 0; f < 6; f++) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    if (f === 2) {
      // +Y (ceiling) — soft warm white
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
      g.addColorStop(0, '#e8ddd0');
      g.addColorStop(1, '#b0a898');
      ctx.fillStyle = g;
    } else if (f === 3) {
      // -Y (floor bounce) — warm brown
      ctx.fillStyle = '#6a5540';
    } else {
      // Sides — warm beige walls with gradient
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, '#c8beb0');
      g.addColorStop(0.5, '#b8a898');
      g.addColorStop(1, '#907860');
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, size, size);

    // Add subtle noise
    for (let i = 0; i < 500; i++) {
      const v = Math.random() * 30;
      ctx.fillStyle = `rgba(${128 + v},${120 + v},${110 + v},0.03)`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }

    faces.push(canvas);
  }

  const tex = new THREE.CubeTexture(faces);
  tex.needsUpdate = true;
  return tex;
}

// ===============================================================
// FLOOR MATERIAL — polished wood planks (MeshPhysicalMaterial)
// ===============================================================
function createFloorMaterial() {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const plankCount = 8;
  const plankH = size / plankCount;

  // Draw each plank
  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    // Base color with natural variation
    const hue = 22 + Math.random() * 8;
    const sat = 35 + Math.random() * 15;
    const lit = 38 + Math.random() * 12;
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lit}%)`;
    ctx.fillRect(0, y0, size, plankH);

    // Wood grain — many subtle curved lines
    for (let i = 0; i < 50; i++) {
      const gy = y0 + Math.random() * plankH;
      const grainLit = lit - 8 + Math.random() * 6;
      ctx.strokeStyle = `hsla(${hue - 2}, ${sat + 5}%, ${grainLit}%, ${0.06 + Math.random() * 0.1})`;
      ctx.lineWidth = 0.3 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      let cy = gy;
      for (let x = 0; x < size; x += 8) {
        cy += (Math.random() - 0.5) * 1.5;
        ctx.lineTo(x, cy);
      }
      ctx.stroke();
    }

    // Plank gap — dark line
    ctx.fillStyle = `rgba(15, 8, 3, 0.6)`;
    ctx.fillRect(0, y0, size, 2);

    // Subtle plank-end joint (staggered)
    const jointX = (size * 0.3) + Math.random() * (size * 0.4);
    ctx.fillStyle = 'rgba(15, 8, 3, 0.3)';
    ctx.fillRect(jointX, y0 + 1, 2, plankH - 2);

    // Wood knots
    if (Math.random() > 0.5) {
      const kx = 50 + Math.random() * (size - 100);
      const ky = y0 + plankH * 0.3 + Math.random() * plankH * 0.4;
      const kr = 4 + Math.random() * 10;
      for (let ring = 0; ring < 5; ring++) {
        const r = kr - ring * (kr / 5);
        ctx.strokeStyle = `hsla(${hue - 5}, ${sat + 10}%, ${lit - 15 + ring * 3}%, ${0.15 + ring * 0.05})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(kx, ky, r, r * 0.5, Math.random() * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Subtle highlight streak (light reflection on grain)
    if (Math.random() > 0.3) {
      const sy = y0 + plankH * 0.2 + Math.random() * plankH * 0.6;
      ctx.strokeStyle = `rgba(255, 240, 220, 0.04)`;
      ctx.lineWidth = 3 + Math.random() * 5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(size, sy + (Math.random() - 0.5) * 8);
      ctx.stroke();
    }
  }

  const colorTex = new THREE.CanvasTexture(canvas);
  colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.repeat.set(2, 2);
  colorTex.anisotropy = 16;
  colorTex.colorSpace = THREE.SRGBColorSpace;

  const normalTex = generateNormalMap(canvas, 2.0);
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(2, 2);
  normalTex.anisotropy = 16;

  const roughTex = createFloorRoughnessMap(size, plankCount, plankH);
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(2, 2);

  return new THREE.MeshPhysicalMaterial({
    map: colorTex,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: roughTex,
    roughness: 0.55,
    metalness: 0.0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
    reflectivity: 0.5,
    side: THREE.DoubleSide
  });
}

function createFloorRoughnessMap(size, plankCount, plankH) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base roughness
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, size, size);

  // Planks slightly smoother
  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    ctx.fillStyle = `rgb(${100 + Math.random() * 30},${100 + Math.random() * 30},${100 + Math.random() * 30})`;
    ctx.fillRect(2, y0 + 3, size - 4, plankH - 6);
  }

  // Gaps are rougher
  for (let p = 0; p < plankCount; p++) {
    ctx.fillStyle = '#cc';
    ctx.fillRect(0, p * plankH - 1, size, 4);
  }

  // Random wear patches (smoother spots from foot traffic)
  for (let i = 0; i < 8; i++) {
    const wx = Math.random() * size;
    const wy = Math.random() * size;
    const wr = 20 + Math.random() * 40;
    const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr);
    g.addColorStop(0, 'rgba(70, 70, 70, 0.3)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// ===============================================================
// CEILING MATERIAL — smooth matte with subtle stipple
// ===============================================================
function createCeilingMaterial() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f5f2ed';
  ctx.fillRect(0, 0, size, size);

  // Fine stipple texture (roller marks)
  for (let i = 0; i < 1500; i++) {
    const v = 235 + Math.random() * 18;
    ctx.fillStyle = `rgb(${v},${v},${v - 2})`;
    const s = 0.5 + Math.random();
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;

  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.92,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
}

// ===============================================================
// WALL MATERIAL — plaster with PBR normal + roughness
// ===============================================================
function createWallMaterial() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base warm white
  ctx.fillStyle = '#ebe5da';
  ctx.fillRect(0, 0, size, size);

  // Large-scale tonal variation (patches)
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 80 + Math.random() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() > 0.5 ? 5 : -5;
    g.addColorStop(0, `rgba(${230 + v}, ${225 + v}, ${215 + v}, 0.3)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }

  // Fine plaster grain
  for (let i = 0; i < 8000; i++) {
    const v = 180 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v},${v - 3},${v - 10},${0.015 + Math.random() * 0.025})`;
    const s = 0.5 + Math.random() * 2.5;
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }

  // Trowel strokes (subtle directional texture)
  for (let i = 0; i < 25; i++) {
    const y = Math.random() * size;
    const bright = Math.random() > 0.5;
    ctx.strokeStyle = bright
      ? `rgba(245,240,232,${0.02 + Math.random() * 0.03})`
      : `rgba(200,195,185,${0.02 + Math.random() * 0.03})`;
    ctx.lineWidth = 1 + Math.random() * 6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    let cy = y;
    for (let x = 0; x < size; x += 15) {
      cy += (Math.random() - 0.5) * 4;
      ctx.lineTo(x, cy);
    }
    ctx.stroke();
  }

  const colorTex = new THREE.CanvasTexture(canvas);
  colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.repeat.set(2, 1);
  colorTex.anisotropy = 8;
  colorTex.colorSpace = THREE.SRGBColorSpace;

  const normalTex = generateNormalMap(canvas, 0.8);
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(2, 1);
  normalTex.anisotropy = 8;

  // Roughness variation
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rctx = roughCanvas.getContext('2d');
  rctx.fillStyle = '#ccc'; // base ~0.8 roughness
  rctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2000; i++) {
    const v = 180 + Math.random() * 40;
    rctx.fillStyle = `rgb(${v},${v},${v})`;
    rctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(2, 1);

  return new THREE.MeshStandardMaterial({
    map: colorTex,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: roughTex,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide
  });
}

// ===============================================================
// NORMAL MAP GENERATOR — Sobel from canvas heightmap
// ===============================================================
function generateNormalMap(sourceCanvas, strength) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, w, h).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d');
  const out = outCtx.createImageData(w, h);

  function heightAt(x, y) {
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
    const i = (y * w + x) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel operator
      const tl = heightAt(x - 1, y - 1), t = heightAt(x, y - 1), tr = heightAt(x + 1, y - 1);
      const l  = heightAt(x - 1, y),                               r  = heightAt(x + 1, y);
      const bl = heightAt(x - 1, y + 1), b = heightAt(x, y + 1), br = heightAt(x + 1, y + 1);

      let nx = (tl + 2 * l + bl) - (tr + 2 * r + br);
      let ny = (tl + 2 * t + tr) - (bl + 2 * b + br);
      nx *= strength;
      ny *= strength;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;

      const i = (y * w + x) * 4;
      out.data[i]     = (nx * 0.5 + 0.5) * 255;
      out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }

  outCtx.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(outCanvas);
  tex.needsUpdate = true;
  return tex;
}

// ===============================================================
// POST-PROCESSING — Vignette + Color Grading shader
// ===============================================================
const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignetteStrength: { value: 0.35 },
    vignetteOffset: { value: 1.1 },
    warmth: { value: 0.03 },
    contrast: { value: 1.06 },
    saturation: { value: 1.08 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float vignetteStrength;
    uniform float vignetteOffset;
    uniform float warmth;
    uniform float contrast;
    uniform float saturation;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      // Contrast
      color = (color - 0.5) * contrast + 0.5;

      // Warmth shift
      color.r += warmth;
      color.b -= warmth * 0.7;

      // Saturation
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(lum), color, saturation);

      // Vignette
      vec2 uv = (vUv - 0.5) * 2.0;
      float vig = 1.0 - dot(uv, uv) * vignetteStrength;
      vig = smoothstep(0.0, vignetteOffset, vig);
      color *= vig;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
    }
  `
};
