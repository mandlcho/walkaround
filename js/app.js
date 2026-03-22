/**
 * app.js — Main application controller. Wires screens, upload, processing, walkthrough.
 */

(function () {
  'use strict';

  // Screens
  const screenUpload = document.getElementById('screen-upload');
  const screenProcessing = document.getElementById('screen-processing');
  const screenWalkthrough = document.getElementById('screen-walkthrough');

  // Upload elements
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const previewSection = document.getElementById('preview-section');
  const previewCanvas = document.getElementById('preview-canvas');
  const btnClear = document.getElementById('btn-clear');
  const btnGenerate = document.getElementById('btn-generate');
  const processingText = document.querySelector('.processing-text');

  // Walkthrough elements
  const threeCanvas = document.getElementById('three-canvas');
  const btnBack = document.getElementById('btn-back');
  const btnMinimap = document.getElementById('btn-minimap');
  const minimapCanvas = document.getElementById('minimap-canvas');

  let currentFile = null;
  let floorData = null;
  let lastTime = 0;

  // ---- Screen transitions ----

  function showScreen(screen) {
    [screenUpload, screenProcessing, screenWalkthrough].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  // ---- Upload handling ----

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    currentFile = file;

    // Show preview
    const img = new Image();
    img.onload = () => {
      const ctx = previewCanvas.getContext('2d');
      const maxW = 360;
      const scale = Math.min(maxW / img.width, maxW / img.height);
      previewCanvas.width = img.width * scale;
      previewCanvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);

    dropZone.style.display = 'none';
    previewSection.classList.remove('hidden');
  }

  btnClear.addEventListener('click', () => {
    currentFile = null;
    dropZone.style.display = 'flex';
    previewSection.classList.add('hidden');
    fileInput.value = '';
  });

  // ---- Generate walkthrough ----

  btnGenerate.addEventListener('click', async () => {
    if (!currentFile) return;

    showScreen(screenProcessing);
    processingText.textContent = 'Detecting walls\u2026';

    // Small delay to let the spinner render
    await new Promise(r => setTimeout(r, 100));

    try {
      processingText.textContent = 'Analysing floor plan\u2026';
      floorData = await FloorPlan.process(currentFile);

      processingText.textContent = 'Building 3D scene\u2026';
      await new Promise(r => setTimeout(r, 200));

      // Init Three.js scene
      WalkScene.init(threeCanvas);
      WalkScene.build(floorData);

      // Init controls
      Controls.init(WalkScene.getCamera());

      // Draw minimap
      drawMinimap();

      // Switch to walkthrough
      showScreen(screenWalkthrough);
      Controls.enable();
      WalkScene.startRenderLoop();

      // Start game loop
      lastTime = performance.now();
      requestAnimationFrame(gameLoop);
    } catch (err) {
      console.error('Processing failed:', err);
      processingText.textContent = 'Something went wrong. Tap back to retry.';
      setTimeout(() => showScreen(screenUpload), 2000);
    }
  });

  // ---- Game loop ----

  function gameLoop(time) {
    if (!screenWalkthrough.classList.contains('active')) return;

    const dt = Math.min((time - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = time;

    Controls.update(dt);
    updateMinimapDot();

    requestAnimationFrame(gameLoop);
  }

  // ---- Minimap ----

  function drawMinimap() {
    if (!floorData) return;
    const { grid, gridWidth, gridHeight } = floorData;
    const canvas = minimapCanvas;
    const size = 140;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    const scaleX = size / gridWidth;
    const scaleY = size / gridHeight;
    const s = Math.min(scaleX, scaleY);
    const offX = (size - gridWidth * s) / 2;
    const offY = (size - gridHeight * s) / 2;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, size, size);

    // Draw walls
    const imgData = ctx.createImageData(size, size);
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        if (grid[gy * gridWidth + gx] === 1) {
          const px = Math.floor(offX + gx * s);
          const py = Math.floor(offY + gy * s);
          if (px >= 0 && px < size && py >= 0 && py < size) {
            const idx = (py * size + px) * 4;
            imgData.data[idx] = 255;
            imgData.data[idx + 1] = 255;
            imgData.data[idx + 2] = 255;
            imgData.data[idx + 3] = 180;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Store for dot updates
    canvas._mmScale = s;
    canvas._mmOffX = offX;
    canvas._mmOffY = offY;
    canvas._mmImg = ctx.getImageData(0, 0, size, size);
  }

  function updateMinimapDot() {
    if (!floorData || minimapCanvas.classList.contains('hidden')) return;
    const canvas = minimapCanvas;
    const ctx = canvas.getContext('2d');
    const { gridWidth, gridHeight } = floorData;
    const SCALE = WalkScene.SCALE;

    const pos = Controls.getPosition();
    if (!pos) return;

    const offsetX = gridWidth * SCALE / 2;
    const offsetZ = gridHeight * SCALE / 2;

    // World to grid
    const gx = (pos.x + offsetX) / SCALE;
    const gz = (pos.z + offsetZ) / SCALE;

    // Grid to minimap
    const mx = canvas._mmOffX + gx * canvas._mmScale;
    const mz = canvas._mmOffY + gz * canvas._mmScale;

    // Redraw base
    ctx.putImageData(canvas._mmImg, 0, 0);

    // Draw player dot
    ctx.fillStyle = '#6c5ce7';
    ctx.beginPath();
    ctx.arc(mx, mz, 4, 0, Math.PI * 2);
    ctx.fill();

    // Draw direction indicator
    const yaw = Controls.getYaw();
    ctx.strokeStyle = '#6c5ce7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, mz);
    ctx.lineTo(mx + Math.sin(yaw) * 10, mz + Math.cos(yaw) * 10);
    ctx.stroke();
  }

  // ---- HUD buttons ----

  btnBack.addEventListener('click', () => {
    WalkScene.stopRenderLoop();
    Controls.disable();
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    showScreen(screenUpload);
  });

  btnMinimap.addEventListener('click', () => {
    minimapCanvas.classList.toggle('hidden');
  });

})();
