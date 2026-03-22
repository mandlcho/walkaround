import * as THREE from 'three';
import { analyzeFloorPlan } from './floorplan.js';
import { buildScene } from './scene.js';
import { setupControls } from './controls.js';
import { WALL_HEIGHT } from './utils.js';
import { CameraAnimator } from './camera-animator.js';
import { Navigation } from './navigation.js';
import { ViewMode, MODES } from './viewmode.js';
import { Toolbar } from './toolbar.js';
import { PanoramaViewer } from './panorama.js';
import { PanoramaUploadUI } from './panorama-upload.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- DOM ---
const screens = {
  upload: document.getElementById('screen-upload'),
  processing: document.getElementById('screen-processing'),
  walkthrough: document.getElementById('screen-walkthrough')
};
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const procCanvas = document.getElementById('processing-canvas');
const procText = document.getElementById('processing-text');
const progressBar = document.getElementById('progress-bar');
const threeCanvas = document.getElementById('three-canvas');
const minimapCanvas = document.getElementById('minimap-canvas');
const btnExit = document.getElementById('btn-exit');

// --- State ---
let sceneData = null;
let controls = null;
let floorData = null;
let animId = null;
let cameraAnimator = null;
let navigation = null;
let viewMode = null;
let toolbar = null;
let orbitControls = null;
let panoramaViewer = null;
let panoramaUploadUI = null;

// --- Screen transitions ---
function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('active', key === name);
  }
}

// --- Upload handlers ---
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

dropZone.addEventListener('click', () => {
  fileInput.click();
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }
  const img = new Image();
  const objUrl = URL.createObjectURL(file);
  img.onload = () => { URL.revokeObjectURL(objUrl); startProcessing(img); };
  img.onerror = () => { URL.revokeObjectURL(objUrl); alert('Failed to load image.'); };
  img.src = objUrl;
}

// --- Processing ---
async function startProcessing(image) {
  showScreen('processing');

  function onProgress(text, pct) {
    procText.textContent = text;
    progressBar.style.width = (pct * 100) + '%';
  }

  try {
    floorData = await analyzeFloorPlan(image, procCanvas, onProgress);

    if (floorData.rooms.length === 0) {
      alert('No rooms detected. Try a cleaner floor plan image with clear walls.');
      showScreen('upload');
      return;
    }

    await new Promise(r => setTimeout(r, 800));
    startWalkthrough();
  } catch (err) {
    console.error('Processing error:', err);
    alert('Error processing floor plan: ' + err.message);
    showScreen('upload');
  }
}

// --- Walkthrough ---
function startWalkthrough() {
  showScreen('walkthrough');

  sceneData = buildScene(floorData, threeCanvas);
  cameraAnimator = new CameraAnimator(sceneData.camera);
  controls = setupControls(sceneData.camera, sceneData.wallMeshes);

  orbitControls = new OrbitControls(sceneData.camera, threeCanvas);
  orbitControls.enabled = false;
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;

  navigation = new Navigation(sceneData.scene, sceneData.camera, floorData, cameraAnimator, controls);

  viewMode = new ViewMode({
    camera: sceneData.camera,
    floorData,
    controls,
    navigation,
    cameraAnimator,
    orbitControls,
    sceneData
  });

  toolbar = new Toolbar(screens.walkthrough, viewMode);

  // --- Panorama system ---
  panoramaViewer = new PanoramaViewer(sceneData.scene, sceneData.camera);
  panoramaUploadUI = new PanoramaUploadUI(screens.walkthrough, floorData.rooms);

  panoramaUploadUI.onPanoramaAdded = async (file, pos) => {
    const position = new THREE.Vector3(pos.x, pos.y, pos.z);
    const index = await panoramaViewer.addPanorama(file, position);
    // If this is the first panorama, enable and show it
    if (panoramaViewer.panoramas.length === 1 && viewMode.currentMode === MODES.FIRST_PERSON) {
      panoramaViewer.enable();
      panoramaViewer.goTo(0);
    }
  };

  // Wire toolbar 360 button to open upload panel
  toolbar.onPanoramaClick = () => {
    panoramaUploadUI.show();
  };

  // When navigating, transition to nearest panorama
  navigation.onNavigate = (targetPos) => {
    if (panoramaViewer.hasPanoramas()) {
      const nearest = panoramaViewer.findNearest(targetPos);
      if (nearest >= 0) {
        panoramaViewer.goTo(nearest);
      }
    }
  };

  // Toggle minimap visibility with view mode, and panorama visibility
  viewMode.onChange((mode) => {
    minimapCanvas.style.display = mode === MODES.FIRST_PERSON ? 'block' : 'none';
    if (panoramaViewer.hasPanoramas()) {
      if (mode === MODES.FIRST_PERSON) {
        panoramaViewer.enable();
      } else {
        panoramaViewer.disable();
      }
    }
  });

  // Render loop
  let lastTime = performance.now();
  function animate(time) {
    animId = requestAnimationFrame(animate);
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    if (cameraAnimator.isAnimating()) {
      cameraAnimator.update(dt);
    } else if (viewMode.currentMode === MODES.FIRST_PERSON) {
      controls.update(dt);
    } else {
      orbitControls.update();
    }

    // Keep lights with camera
    sceneData.pointLight.position.copy(sceneData.camera.position);
    sceneData.fillLight.position.set(
      sceneData.camera.position.x,
      WALL_HEIGHT - 0.3,
      sceneData.camera.position.z
    );
    // Update panorama crossfade
    if (panoramaViewer) {
      panoramaViewer.update(dt);
    }

    sceneData.composer.render();

    // Minimap and nav dot updates only in first person
    if (viewMode.currentMode === MODES.FIRST_PERSON) {
      navigation.update(dt);
      drawMinimap();
    }
  }
  animId = requestAnimationFrame(animate);
}

// --- Minimap ---
const minimapSize = 120;
minimapCanvas.width = minimapSize;
minimapCanvas.height = minimapSize;
const minimapCtx = minimapCanvas.getContext('2d');

function drawMinimap() {
  if (!floorData || !sceneData || !controls) return;
  const size = minimapSize;
  const ctx = minimapCtx;

  const bounds = floorData.bounds;
  const maxDim = Math.max(bounds.w, bounds.h);
  const scale = (size - 16) / maxDim;
  const offX = (size - bounds.w * scale) / 2;
  const offY = (size - bounds.h * scale) / 2;

  ctx.clearRect(0, 0, size, size);

  // Draw rooms
  ctx.fillStyle = 'rgba(108, 99, 255, 0.15)';
  ctx.strokeStyle = 'rgba(108, 99, 255, 0.6)';
  ctx.lineWidth = 1;
  for (const room of floorData.rooms) {
    ctx.beginPath();
    const poly = room.polygon;
    ctx.moveTo(offX + poly[0][0] * scale, offY + poly[0][1] * scale);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(offX + poly[i][0] * scale, offY + poly[i][1] * scale);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Draw doors
  if (floorData.doors) {
    ctx.strokeStyle = 'rgba(76, 255, 76, 0.8)';
    ctx.lineWidth = 2;
    for (const door of floorData.doors) {
      ctx.beginPath();
      ctx.moveTo(offX + door.start[0] * scale, offY + door.start[1] * scale);
      ctx.lineTo(offX + door.end[0] * scale, offY + door.end[1] * scale);
      ctx.stroke();
    }
  }

  // Player position
  const cam = sceneData.camera.position;
  const px = offX + cam.x * scale;
  const py = offY + cam.z * scale;

  // Direction indicator
  const dir = controls.state;
  const dx = Math.sin(dir.yaw);
  const dz = Math.cos(dir.yaw);
  ctx.strokeStyle = '#48cfcb';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px - dx * 8, py - dz * 8);
  ctx.stroke();

  // Player dot
  ctx.fillStyle = '#48cfcb';
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fill();
}

// --- Exit ---
btnExit.addEventListener('click', () => {
  if (animId) cancelAnimationFrame(animId);
  if (controls) controls.destroy();
  if (navigation) navigation.destroy();
  if (toolbar) toolbar.destroy();
  if (panoramaViewer) panoramaViewer.destroy();
  if (panoramaUploadUI) panoramaUploadUI.destroy();
  if (orbitControls) orbitControls.dispose();
  if (sceneData) {
    sceneData.renderer.dispose();
    window.removeEventListener('resize', sceneData.onResize);
  }
  sceneData = null;
  controls = null;
  floorData = null;
  animId = null;
  cameraAnimator = null;
  navigation = null;
  viewMode = null;
  toolbar = null;
  panoramaViewer = null;
  panoramaUploadUI = null;
  orbitControls = null;
  fileInput.value = '';
  showScreen('upload');
});
