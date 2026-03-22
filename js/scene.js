/**
 * scene.js — Builds and renders the 3D walkthrough scene using Three.js.
 */

const WalkScene = (() => {
  let renderer, scene, camera;
  let wallMeshes = [];
  let floorMesh, ceilingMesh;
  let animationId;
  let sceneData = null;

  const WALL_HEIGHT = 2.8;     // meters
  const WALL_THICKNESS = 0.15; // meters
  const SCALE = 0.05;          // grid pixels to world meters

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 8, 25);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);

    window.addEventListener('resize', onResize);
  }

  function onResize() {
    if (!renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /**
   * Build the 3D scene from floor plan data.
   */
  function build(data) {
    sceneData = data;
    const { segments, startPos, gridWidth, gridHeight, grid } = data;

    // Clear previous
    wallMeshes.forEach(m => scene.remove(m));
    wallMeshes = [];
    if (floorMesh) scene.remove(floorMesh);
    if (ceilingMesh) scene.remove(ceilingMesh);

    // Center offset: map grid center to world origin
    const offsetX = gridWidth * SCALE / 2;
    const offsetZ = gridHeight * SCALE / 2;

    // -- Floor --
    const floorGeo = new THREE.PlaneGeometry(gridWidth * SCALE + 2, gridHeight * SCALE + 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xd4c5a9,
      roughness: 0.85,
      metalness: 0.0,
    });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, 0);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // -- Ceiling --
    const ceilGeo = new THREE.PlaneGeometry(gridWidth * SCALE + 2, gridHeight * SCALE + 2);
    const ceilMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.BackSide,
    });
    ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
    ceilingMesh.rotation.x = -Math.PI / 2;
    ceilingMesh.position.set(0, WALL_HEIGHT, 0);
    scene.add(ceilingMesh);

    // -- Walls --
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf5f0e8,
      roughness: 0.7,
      metalness: 0.0,
    });

    segments.forEach(seg => {
      const x1 = seg.x1 * SCALE - offsetX;
      const z1 = seg.y1 * SCALE - offsetZ;
      const x2 = seg.x2 * SCALE - offsetX;
      const z2 = seg.y2 * SCALE - offsetZ;

      const dx = x2 - x1;
      const dz = z2 - z1;
      const length = Math.sqrt(dx * dx + dz * dz);

      if (length < SCALE * 2) return; // skip tiny fragments

      const geo = new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS);
      const mesh = new THREE.Mesh(geo, wallMat);

      mesh.position.set(
        (x1 + x2) / 2,
        WALL_HEIGHT / 2,
        (z1 + z2) / 2
      );

      const angle = Math.atan2(dz, dx);
      mesh.rotation.y = -angle;

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      scene.add(mesh);
      wallMeshes.push(mesh);
    });

    // -- Lighting --
    // Remove old lights
    scene.children
      .filter(c => c.isLight)
      .forEach(l => scene.remove(l));

    // Ambient
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    // Hemisphere
    const hemi = new THREE.HemisphereLight(0xffeedd, 0x777788, 0.3);
    scene.add(hemi);

    // Point lights scattered around the ceiling
    const numLights = Math.min(8, Math.max(3, Math.floor(segments.length / 10)));
    for (let i = 0; i < numLights; i++) {
      const angle = (i / numLights) * Math.PI * 2;
      const radius = Math.min(gridWidth, gridHeight) * SCALE * 0.3;
      const light = new THREE.PointLight(0xfff5e6, 0.6, 12);
      light.position.set(
        Math.cos(angle) * radius,
        WALL_HEIGHT - 0.3,
        Math.sin(angle) * radius
      );
      light.castShadow = true;
      light.shadow.mapSize.set(512, 512);
      scene.add(light);
    }

    // Center ceiling light
    const centerLight = new THREE.PointLight(0xffffff, 0.5, 15);
    centerLight.position.set(0, WALL_HEIGHT - 0.2, 0);
    centerLight.castShadow = true;
    scene.add(centerLight);

    // -- Camera start position --
    camera.position.set(
      startPos.x * SCALE - offsetX,
      1.6, // eye height
      startPos.y * SCALE - offsetZ
    );
    camera.rotation.set(0, 0, 0);
  }

  /**
   * Collision detection: check if a position is inside a wall.
   */
  function isColliding(x, z) {
    if (!sceneData) return false;
    const { grid, gridWidth, gridHeight } = sceneData;
    const offsetX = gridWidth * SCALE / 2;
    const offsetZ = gridHeight * SCALE / 2;

    // World coords to grid coords
    const gx = Math.round((x + offsetX) / SCALE);
    const gz = Math.round((z + offsetZ) / SCALE);

    // Check a small area around the player (collision radius)
    const RADIUS = 3; // pixels
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const px = gx + dx;
        const pz = gz + dy;
        if (px < 0 || px >= gridWidth || pz < 0 || pz >= gridHeight) continue;
        if (grid[pz * gridWidth + px] === 1) return true;
      }
    }
    return false;
  }

  function startRenderLoop() {
    function loop() {
      animationId = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    }
    loop();
  }

  function stopRenderLoop() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  function getCamera() { return camera; }
  function getScene() { return scene; }
  function getSceneData() { return sceneData; }
  function getSCALE() { return SCALE; }

  function dispose() {
    stopRenderLoop();
    window.removeEventListener('resize', onResize);
    if (renderer) renderer.dispose();
  }

  return {
    init,
    build,
    isColliding,
    startRenderLoop,
    stopRenderLoop,
    getCamera,
    getScene,
    getSceneData,
    getSCALE,
    dispose,
    WALL_HEIGHT,
    SCALE,
  };
})();
