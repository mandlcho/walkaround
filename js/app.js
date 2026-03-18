import { analyzeFloorPlan } from './floorplan.js';
import { buildScene } from './scene.js';
import { setupControls } from './controls.js';
import { PX_TO_METERS } from './utils.js';

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
const joystickZone = document.getElementById('joystick-zone');
const minimapCanvas = document.getElementById('minimap-canvas');
const btnExit = document.getElementById('btn-exit');

// --- State ---
let sceneData = null;
let controls = null;
let floorData = null;
let animId = null;

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

    // Brief delay so user can see the result
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
  controls = setupControls(sceneData.camera, sceneData.wallMeshes, joystickZone);

  // Start render loop
  let lastTime = performance.now();
  function animate(time) {
    animId = requestAnimationFrame(animate);
    const dt = Math.min((time - lastTime) / 1000, 0.1); // cap delta
    lastTime = time;

    controls.update(dt);

    // Keep point light with camera
    sceneData.pointLight.position.copy(sceneData.camera.position);

    sceneData.renderer.render(sceneData.scene, sceneData.camera);

    // Update minimap
    drawMinimap();
  }
  animId = requestAnimationFrame(animate);
}

// --- Minimap ---
// Set minimap canvas size once
const minimapSize = 120;
minimapCanvas.width = minimapSize;
minimapCanvas.height = minimapSize;
const minimapCtx = minimapCanvas.getContext('2d');

function drawMinimap() {
  if (!floorData || !sceneData) return;
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

  // Draw player position
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
  if (sceneData) {
    sceneData.renderer.dispose();
    window.removeEventListener('resize', sceneData.onResize);
  }
  sceneData = null;
  controls = null;
  floorData = null;
  animId = null;
  fileInput.value = '';
  showScreen('upload');
});
