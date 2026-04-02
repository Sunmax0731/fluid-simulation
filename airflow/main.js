import * as THREE from 'three';
import { StatsPanel } from '../shared/utils/stats-panel.js';
import { Controls } from '../shared/ui/controls.js';

import oceanVert from './shaders/ocean.vert.glsl?raw';
import oceanFrag from './shaders/ocean.frag.glsl?raw';
import skyVert from './shaders/sky.vert.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';
import { WaterSurfaceSolver } from './water-surface-solver.js';

const MAX_VISIBLE_IMPACTS = 32;
const MAX_IMPACT_HISTORY = 128;

function showFatalError(message) {
  let panel = document.getElementById('fatal-error');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'fatal-error';
    Object.assign(panel.style, {
      position: 'fixed',
      left: '16px',
      right: '16px',
      bottom: '16px',
      padding: '14px 16px',
      borderRadius: '16px',
      border: '1px solid rgba(255, 110, 110, 0.35)',
      background: 'rgba(40, 8, 12, 0.9)',
      color: '#ffd7d7',
      fontFamily: 'Consolas, monospace',
      fontSize: '12px',
      lineHeight: '1.5',
      zIndex: '10000',
      whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(panel);
  }
  panel.textContent = message;
}

window.addEventListener('error', (event) => {
  if (event.message) showFatalError(event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message || String(event.reason || 'Unknown promise rejection');
  showFatalError(reason);
});

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function copyColorToVector(color, vector) {
  vector.set(color.r, color.g, color.b);
}

const canvas = document.getElementById('canvas');
const viewport = document.getElementById('viewport');
const controlsMount = document.getElementById('controlsMount');

function getViewportSize() {
  const rect = viewport.getBoundingClientRect();
  return {
    width: Math.max(360, Math.round(rect.width || window.innerWidth)),
    height: Math.max(420, Math.round(rect.height || window.innerHeight)),
  };
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const initialViewportSize = getViewportSize();
renderer.setSize(initialViewportSize.width, initialViewportSize.height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
  const vertexLog = gl.getShaderInfoLog(vertexShader) || 'No vertex log';
  const fragmentLog = gl.getShaderInfoLog(fragmentShader) || 'No fragment log';
  const programLog = gl.getProgramInfoLog(program) || 'No program log';
  showFatalError(`Shader compile failed\n\nVertex:\n${vertexLog}\n\nFragment:\n${fragmentLog}\n\nProgram:\n${programLog}`);
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, initialViewportSize.width / initialViewportSize.height, 0.1, 1000);
const cameraTarget = new THREE.Vector3(0, 0.2, 0);
const spherical = { theta: 0.26, phi: 1.04, radius: 14 };

function updateCamera() {
  camera.position.set(
    cameraTarget.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
    cameraTarget.y + spherical.radius * Math.cos(spherical.phi),
    cameraTarget.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta),
  );
  camera.lookAt(cameraTarget);
}

function resizeViewport() {
  const { width, height } = getViewportSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

const BASE_BASIN_HALF_SIZE = new THREE.Vector2(6.2, 6.2);
const BASE_BASIN_DEPTH = 1.2;
const WALL_HEIGHT = 1.85;
const WALL_THICKNESS = 0.03;
const BASE_DROP_MARGIN = 0.95;
const basinHalfSize = BASE_BASIN_HALF_SIZE.clone();
let tankScale = 1.0;
let tankDepthScale = 1.0;
let basinDepth = BASE_BASIN_DEPTH;
let waterDepthSetting = BASE_BASIN_DEPTH;
let waterDepth = BASE_BASIN_DEPTH;
let waterSurfaceY = 0.0;
let glassThickness = WALL_THICKNESS;
let solverResolution = 128;
let activeImpactHistoryCount = MAX_IMPACT_HISTORY;
let localWaveSeconds = 120.0;
const dropControlState = {
  size: 0.72,
  mass: 0.76,
};
const rainState = {
  enabled: false,
  rate: 12,
  intensity: 0.22,
  accumulator: 0,
};
let simulationReady = false;
let waterSolver = new WaterSurfaceSolver({ resolution: solverResolution, basinHalfSize });
let controls;

const oceanGeometry = new THREE.PlaneGeometry(
  BASE_BASIN_HALF_SIZE.x * 2.0,
  BASE_BASIN_HALF_SIZE.y * 2.0,
  192,
  192,
);
oceanGeometry.rotateX(-Math.PI / 2);

const sunDir = new THREE.Vector3(0.5, 0.74, -0.8).normalize();
const sunColor = new THREE.Vector3(1.0, 0.98, 0.9);
const shallowColor = new THREE.Vector3(0.1, 0.55, 0.7);
const deepColor = new THREE.Vector3(0.02, 0.08, 0.2);
const subsurfaceColor = new THREE.Vector3(0.03, 0.42, 0.38);
const foamTint = new THREE.Vector3(0.95, 0.97, 1.0);
const impactUniforms = Array.from({ length: MAX_VISIBLE_IMPACTS }, () => new THREE.Vector4(0, 0, -100, 0));
const impactHistory = Array.from({ length: MAX_IMPACT_HISTORY }, () => new THREE.Vector4(0, 0, -100, 0));
let impactCursor = 0;
let impactHistoryCursor = 0;
let impactGain = 1.0;
let viscosity = 0.35;
let wallReflectivity = 0.76;

const oceanUniforms = {
  u_time: { value: 0 },
  u_waveHeight: { value: 0.02 },
  u_windDir: { value: 0.18 },
  u_windSpeed: { value: 0.35 },
  u_viscosity: { value: viscosity },
  u_basinHalfSize: { value: basinHalfSize },
  u_wallReflectivity: { value: wallReflectivity },
  u_dynamicHeight: { value: waterSolver.texture },
  u_dynamicTexel: { value: new THREE.Vector2(1 / waterSolver.width, 1 / waterSolver.height) },
  u_dynamicCellSize: { value: new THREE.Vector2(waterSolver.cellX, waterSolver.cellZ) },
  u_dynamicGain: { value: 1.9 },
  u_localWaveSeconds: { value: localWaveSeconds },
  u_basinDepth: { value: basinDepth },
  u_waterSurfaceY: { value: waterSurfaceY },
  u_waterClarity: { value: 0.72 },
  u_absorption: { value: 0.88 },
  u_cameraPos: { value: camera.position.clone() },
  u_sunDir: { value: sunDir },
  u_sunColor: { value: sunColor },
  u_shallowColor: { value: shallowColor },
  u_deepColor: { value: deepColor },
  u_subsurfaceColor: { value: subsurfaceColor },
  u_foamTint: { value: foamTint },
  u_foamAmount: { value: 0.16 },
  u_reflectionMix: { value: 1.08 },
  u_impacts: { value: impactUniforms },
};

const skyUniforms = {
  u_sunDir: { value: sunDir },
  u_sunColor: { value: sunColor },
};

const oceanMaterial = new THREE.RawShaderMaterial({
  name: 'OceanSurface',
  vertexShader: oceanVert,
  fragmentShader: oceanFrag,
  uniforms: oceanUniforms,
  transparent: true,
  depthWrite: false,
  glslVersion: THREE.GLSL3,
});

const oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
oceanMesh.renderOrder = 1;
scene.add(oceanMesh);

const basinFloorMaterial = new THREE.MeshStandardMaterial({
  color: 0x102033,
  roughness: 0.24,
  metalness: 0.08,
  emissive: 0x08111b,
  emissiveIntensity: 0.45,
});

const basinBaseMaterial = new THREE.MeshStandardMaterial({
  color: 0x0d1219,
  roughness: 0.78,
  metalness: 0.12,
  emissive: 0x060a12,
  emissiveIntensity: 0.35,
});

const wallMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xd6ebff,
  roughness: 0.04,
  metalness: 0.04,
  transmission: 0.92,
  transparent: true,
  opacity: 0.24,
  thickness: 0.18,
  ior: 1.12,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
});
wallMaterial.depthWrite = false;

const rimMaterial = new THREE.MeshStandardMaterial({
  color: 0x223041,
  roughness: 0.22,
  metalness: 0.72,
  emissive: 0x0a1320,
  emissiveIntensity: 0.8,
});

const basinGroup = new THREE.Group();
scene.add(basinGroup);

const basinBase = new THREE.Mesh(
  new THREE.BoxGeometry(BASE_BASIN_HALF_SIZE.x * 2.0 + 1.2, 0.56, BASE_BASIN_HALF_SIZE.y * 2.0 + 1.2),
  basinBaseMaterial,
);
basinBase.position.y = -BASE_BASIN_DEPTH - 0.32;
basinGroup.add(basinBase);

const basinFloor = new THREE.Mesh(
  new THREE.BoxGeometry(BASE_BASIN_HALF_SIZE.x * 2.0, 0.08, BASE_BASIN_HALF_SIZE.y * 2.0),
  basinFloorMaterial,
);
basinFloor.position.y = -BASE_BASIN_DEPTH - 0.04;
basinGroup.add(basinFloor);

const wallCenterY = -BASE_BASIN_DEPTH + WALL_HEIGHT * 0.5;
const wallConfigs = [
  {
    axis: 'x',
    sign: 1,
    sx: WALL_THICKNESS,
    sy: WALL_HEIGHT,
    sz: BASE_BASIN_HALF_SIZE.y * 2.0 + WALL_THICKNESS,
  },
  {
    axis: 'x',
    sign: -1,
    sx: WALL_THICKNESS,
    sy: WALL_HEIGHT,
    sz: BASE_BASIN_HALF_SIZE.y * 2.0 + WALL_THICKNESS,
  },
  {
    axis: 'z',
    sign: 1,
    sx: BASE_BASIN_HALF_SIZE.x * 2.0 + WALL_THICKNESS,
    sy: WALL_HEIGHT,
    sz: WALL_THICKNESS,
  },
  {
    axis: 'z',
    sign: -1,
    sx: BASE_BASIN_HALF_SIZE.x * 2.0 + WALL_THICKNESS,
    sy: WALL_HEIGHT,
    sz: WALL_THICKNESS,
  },
];
const wallMeshes = wallConfigs.map((cfg) => {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(cfg.sx, cfg.sy, cfg.sz), wallMaterial);
  wall.renderOrder = 2;
  basinGroup.add(wall);
  return { mesh: wall, cfg };
});

const rimY = -BASE_BASIN_DEPTH + WALL_HEIGHT + 0.06;
const rimConfigs = [
  {
    axis: 'z',
    sign: 1,
    sx: BASE_BASIN_HALF_SIZE.x * 2.0 + WALL_THICKNESS * 2.4,
    sy: 0.1,
    sz: WALL_THICKNESS * 2.2,
  },
  {
    axis: 'z',
    sign: -1,
    sx: BASE_BASIN_HALF_SIZE.x * 2.0 + WALL_THICKNESS * 2.4,
    sy: 0.1,
    sz: WALL_THICKNESS * 2.2,
  },
  {
    axis: 'x',
    sign: 1,
    sx: WALL_THICKNESS * 2.2,
    sy: 0.1,
    sz: BASE_BASIN_HALF_SIZE.y * 2.0 + WALL_THICKNESS * 2.4,
  },
  {
    axis: 'x',
    sign: -1,
    sx: WALL_THICKNESS * 2.2,
    sy: 0.1,
    sz: BASE_BASIN_HALF_SIZE.y * 2.0 + WALL_THICKNESS * 2.4,
  },
];
const rimMeshes = rimConfigs.map((cfg) => {
  const rim = new THREE.Mesh(new THREE.BoxGeometry(cfg.sx, cfg.sy, cfg.sz), rimMaterial);
  basinGroup.add(rim);
  return { mesh: rim, cfg };
});

const skyGeometry = new THREE.SphereGeometry(400, 32, 16);
const skyMaterial = new THREE.RawShaderMaterial({
  name: 'SkyDome',
  vertexShader: skyVert,
  fragmentShader: skyFrag,
  uniforms: skyUniforms,
  side: THREE.BackSide,
  glslVersion: THREE.GLSL3,
});
scene.add(new THREE.Mesh(skyGeometry, skyMaterial));

scene.add(new THREE.HemisphereLight(0x7fa0c8, 0x10131b, 0.82));

const sunLight = new THREE.DirectionalLight(0xffffff, 0.95);
sunLight.position.copy(sunDir).multiplyScalar(18.0);
scene.add(sunLight);
scene.add(sunLight.target);

const fillLight = new THREE.PointLight(0x9bdcff, 0.8, 24, 2);
fillLight.position.set(-6, 4, 5);
scene.add(fillLight);

const dropGroup = new THREE.Group();
scene.add(dropGroup);

const splashGroup = new THREE.Group();
scene.add(splashGroup);

const sheetGroup = new THREE.Group();
scene.add(sheetGroup);

const sprayGroup = new THREE.Group();
scene.add(sprayGroup);

const crownGroup = new THREE.Group();
scene.add(crownGroup);

const stats = new StatsPanel({ visible: false });

const lookState = {
  waterHue: 0.53,
  waterSaturation: 0.64,
  waterLightness: 0.28,
  sunHue: 0.12,
  sunSaturation: 0.18,
  sunIntensity: 1.05,
  foamAmount: 0.16,
  reflectionMix: 1.08,
  exposure: 1.22,
  impactGain: 1.0,
  viscosity: 0.35,
  wallReflectivity: 0.76,
};

const waterSurfaceColor = new THREE.Color();
const waterDeepColor = new THREE.Color();
const waterSubsurfaceColor = new THREE.Color();
const foamSurfaceColor = new THREE.Color();
const sunDisplayColor = new THREE.Color();
const fillDisplayColor = new THREE.Color();
const calmSurfaceState = {
  waveHeight: 0.0,
  windSpeed: 0.05,
};
const surfaceControlState = {
  waveHeight: oceanUniforms.u_waveHeight.value,
  windSpeed: oceanUniforms.u_windSpeed.value,
  windDir: oceanUniforms.u_windDir.value,
};
const surfaceMotionState = {
  waveHeight: oceanUniforms.u_waveHeight.value,
  windSpeed: oceanUniforms.u_windSpeed.value,
  windDir: oceanUniforms.u_windDir.value,
  waveHalfLife: 3.2,
  windHalfLife: 2.8,
};

function getDropMargin() {
  return Math.min(BASE_DROP_MARGIN * tankScale, basinHalfSize.x - 0.34, basinHalfSize.y - 0.34);
}

function syncBasinScale() {
  basinHalfSize.copy(BASE_BASIN_HALF_SIZE).multiplyScalar(tankScale);
  basinDepth = BASE_BASIN_DEPTH * tankDepthScale;
  waterDepth = Math.min(Math.max(waterDepthSetting, 0.08), basinDepth);
  waterSurfaceY = waterDepth - basinDepth;
  oceanMesh.scale.set(tankScale, 1.0, tankScale);
  oceanMesh.position.y = waterSurfaceY;
  basinGroup.scale.set(1.0, tankDepthScale, 1.0);
  basinBase.scale.set(tankScale, 1.0, tankScale);
  basinFloor.scale.set(tankScale, 1.0, tankScale);

  wallMaterial.thickness = glassThickness * 6.0;
  wallMaterial.opacity = THREE.MathUtils.clamp(0.18 + glassThickness * 1.8, 0.16, 0.3);

  for (const { mesh, cfg } of wallMeshes) {
    if (cfg.axis === 'x') {
      mesh.scale.set(
        glassThickness / WALL_THICKNESS,
        1.0,
        (basinHalfSize.y * 2.0 + glassThickness) / cfg.sz,
      );
      mesh.position.set(cfg.sign * (basinHalfSize.x + glassThickness * 0.5), wallCenterY, 0);
    } else {
      mesh.scale.set(
        (basinHalfSize.x * 2.0 + glassThickness) / cfg.sx,
        1.0,
        glassThickness / WALL_THICKNESS,
      );
      mesh.position.set(0, wallCenterY, cfg.sign * (basinHalfSize.y + glassThickness * 0.5));
    }
  }

  for (const { mesh, cfg } of rimMeshes) {
    if (cfg.axis === 'x') {
      mesh.scale.set(
        glassThickness / WALL_THICKNESS,
        1.0,
        (basinHalfSize.y * 2.0 + glassThickness * 2.4) / cfg.sz,
      );
      mesh.position.set(cfg.sign * (basinHalfSize.x + glassThickness * 0.5), rimY, 0);
    } else {
      mesh.scale.set(
        (basinHalfSize.x * 2.0 + glassThickness * 2.4) / cfg.sx,
        1.0,
        glassThickness / WALL_THICKNESS,
      );
      mesh.position.set(0, rimY, cfg.sign * (basinHalfSize.y + glassThickness * 0.5));
    }
  }

  oceanUniforms.u_basinHalfSize.value.copy(basinHalfSize);
  oceanUniforms.u_basinDepth.value = waterDepth;
  oceanUniforms.u_waterSurfaceY.value = waterSurfaceY;
  cameraTarget.y = waterSurfaceY * 0.35 + 0.2;
  updateCamera();

  if (controls && Math.abs(controls.getValue('waterDepth') - waterDepth) > 1e-6) {
    controls.setValue('waterDepth', waterDepth, false);
  }
}

function syncSolverUniforms() {
  oceanUniforms.u_dynamicHeight.value = waterSolver.texture;
  oceanUniforms.u_dynamicTexel.value.set(1 / waterSolver.width, 1 / waterSolver.height);
  oceanUniforms.u_dynamicCellSize.value.set(waterSolver.cellX, waterSolver.cellZ);
  oceanUniforms.u_localWaveSeconds.value = localWaveSeconds;
}

function recreateWaterSolver() {
  waterSolver.texture.dispose();
  waterSolver = new WaterSurfaceSolver({ resolution: solverResolution, basinHalfSize });
  syncSolverUniforms();
  syncSurfaceState();
}

function syncSurfaceState() {
  oceanUniforms.u_waveHeight.value = surfaceMotionState.waveHeight;
  oceanUniforms.u_windSpeed.value = surfaceMotionState.windSpeed;
  oceanUniforms.u_windDir.value = surfaceMotionState.windDir;
  waterSolver.setParameters({
    viscosity,
    waveHeight: surfaceMotionState.waveHeight,
    windSpeed: surfaceMotionState.windSpeed,
  });
}

function seedWindWaveBurst(waveHeight, windSpeed, windDir) {
  const waveMix = THREE.MathUtils.clamp(waveHeight / 1.35, 0.0, 1.0);
  const windMix = THREE.MathUtils.clamp(windSpeed / 8.8, 0.0, 1.0);
  const intensity = THREE.MathUtils.clamp(waveMix * 0.62 + windMix * 0.38, 0.0, 1.0);
  if (intensity <= 0.015) return;

  const marginX = basinHalfSize.x - 0.8;
  const marginZ = basinHalfSize.y - 0.8;
  const direction = new THREE.Vector2(Math.cos(windDir), Math.sin(windDir)).normalize();
  const lateral = new THREE.Vector2(-direction.y, direction.x);
  const alongExtent = Math.abs(direction.x) * marginX + Math.abs(direction.y) * marginZ;
  const lateralExtent = Math.abs(lateral.x) * marginX + Math.abs(lateral.y) * marginZ;
  const lineCount = Math.round(THREE.MathUtils.lerp(5, 10, intensity));
  const rowCount = Math.round(THREE.MathUtils.lerp(2, 4, intensity));
  const radius = THREE.MathUtils.lerp(0.6, 1.35, intensity);
  const baseStrength = THREE.MathUtils.lerp(0.16, 0.58, intensity);
  const frontOffset = alongExtent * 0.72;

  for (let row = 0; row < rowCount; row++) {
    const rowT = rowCount === 1 ? 0.0 : row / (rowCount - 1);
    const rowWeight = 1.0 - rowT * 0.3;
    const alongOffset = -frontOffset + row * radius * 1.6;
    for (let i = 0; i < lineCount; i++) {
      const t = lineCount === 1 ? 0.5 : i / (lineCount - 1);
      const lateralOffset = THREE.MathUtils.lerp(-lateralExtent * 0.94, lateralExtent * 0.94, t);
      const jitter = (Math.sin((i + 1) * 1.91 + row * 2.37) * 0.5 + 0.5) * radius * 0.18;
      const x = THREE.MathUtils.clamp(
        direction.x * alongOffset + lateral.x * lateralOffset + direction.x * jitter,
        -marginX,
        marginX,
      );
      const z = THREE.MathUtils.clamp(
        direction.y * alongOffset + lateral.y * lateralOffset + direction.y * jitter,
        -marginZ,
        marginZ,
      );
      waterSolver.addImpact(x, z, baseStrength * rowWeight, radius);
    }
  }
}

function triggerSurfaceExcitation(options = {}) {
  const waveHeight = options.waveHeight ?? surfaceControlState.waveHeight;
  const windSpeed = options.windSpeed ?? surfaceControlState.windSpeed;
  const windDir = options.windDir ?? surfaceControlState.windDir;
  const intensity = THREE.MathUtils.clamp(
    (waveHeight / 1.35) * 0.6 + (windSpeed / 8.8) * 0.4,
    0.0,
    1.0,
  );

  surfaceMotionState.waveHeight = waveHeight;
  surfaceMotionState.windSpeed = windSpeed;
  surfaceMotionState.windDir = windDir;
  surfaceMotionState.waveHalfLife = THREE.MathUtils.lerp(2.8, 8.6, intensity);
  surfaceMotionState.windHalfLife = THREE.MathUtils.lerp(2.2, 6.6, intensity);
  syncSurfaceState();

  if (options.seedSolver !== false) {
    seedWindWaveBurst(waveHeight, windSpeed, windDir);
  }
}

function settleSurfaceMotion(dt) {
  const waveDecay = Math.exp((-Math.LN2 * dt) / Math.max(surfaceMotionState.waveHalfLife, 0.001));
  const windDecay = Math.exp((-Math.LN2 * dt) / Math.max(surfaceMotionState.windHalfLife, 0.001));
  surfaceMotionState.waveHeight = calmSurfaceState.waveHeight
    + (surfaceMotionState.waveHeight - calmSurfaceState.waveHeight) * waveDecay;
  surfaceMotionState.windSpeed = calmSurfaceState.windSpeed
    + (surfaceMotionState.windSpeed - calmSurfaceState.windSpeed) * windDecay;

  if (Math.abs(surfaceMotionState.waveHeight - calmSurfaceState.waveHeight) < 0.0002) {
    surfaceMotionState.waveHeight = calmSurfaceState.waveHeight;
  }
  if (Math.abs(surfaceMotionState.windSpeed - calmSurfaceState.windSpeed) < 0.0005) {
    surfaceMotionState.windSpeed = calmSurfaceState.windSpeed;
  }

  syncSurfaceState();
}

function updateOceanPalette() {
  waterSurfaceColor.setHSL(
    lookState.waterHue,
    clamp01(lookState.waterSaturation),
    clamp01(lookState.waterLightness + 0.16),
  );
  waterDeepColor.setHSL(
    lookState.waterHue,
    clamp01(lookState.waterSaturation * 0.96),
    clamp01(lookState.waterLightness * 0.34 + 0.02),
  );
  waterSubsurfaceColor.setHSL(
    (lookState.waterHue + 0.03) % 1,
    clamp01(lookState.waterSaturation * 0.82),
    clamp01(lookState.waterLightness * 0.56 + 0.05),
  );
  foamSurfaceColor.setHSL(
    lookState.waterHue,
    clamp01(lookState.waterSaturation * 0.12),
    0.95,
  );
  sunDisplayColor.setHSL(
    lookState.sunHue,
    clamp01(lookState.sunSaturation),
    0.72,
  ).multiplyScalar(lookState.sunIntensity);

  fillDisplayColor.copy(sunDisplayColor).lerp(new THREE.Color(0x9bdcff), 0.55);

  copyColorToVector(waterSurfaceColor, shallowColor);
  copyColorToVector(waterDeepColor, deepColor);
  copyColorToVector(waterSubsurfaceColor, subsurfaceColor);
  copyColorToVector(foamSurfaceColor, foamTint);
  copyColorToVector(sunDisplayColor, sunColor);

  sunLight.color.copy(sunDisplayColor);
  fillLight.color.copy(fillDisplayColor);
  basinFloorMaterial.color.copy(waterDeepColor).multiplyScalar(0.72).lerp(new THREE.Color(0x0d141c), 0.42);
  basinFloorMaterial.emissive.copy(waterSurfaceColor).multiplyScalar(0.08);
  basinBaseMaterial.emissive.copy(waterDeepColor).multiplyScalar(0.16);
  rimMaterial.emissive.copy(waterSurfaceColor).multiplyScalar(0.14);
  oceanUniforms.u_foamAmount.value = lookState.foamAmount;
  oceanUniforms.u_reflectionMix.value = lookState.reflectionMix;
  renderer.toneMappingExposure = lookState.exposure;
  impactGain = lookState.impactGain;
  viscosity = lookState.viscosity;
  oceanUniforms.u_viscosity.value = viscosity;
  wallReflectivity = lookState.wallReflectivity;
  oceanUniforms.u_wallReflectivity.value = wallReflectivity;
  syncSurfaceState();
}

function syncUniform(key, value) {
  if (key === 'waveHeight') surfaceControlState.waveHeight = value;
  if (key === 'windSpeed') surfaceControlState.windSpeed = value;
  if (key === 'windDir') {
    surfaceControlState.windDir = value;
    surfaceMotionState.windDir = value;
  }
  if (key === 'impactHistoryCount') activeImpactHistoryCount = Math.round(value);
  if (key === 'localWaveSeconds') {
    localWaveSeconds = value;
    oceanUniforms.u_localWaveSeconds.value = value;
  }
  if (key === 'waterDepth') {
    waterDepthSetting = value;
    syncBasinScale();
    if (simulationReady) clearActions();
    return;
  }
  if (key === 'tankScale') {
    if (Math.abs(tankScale - value) < 1e-6) return;
    tankScale = value;
    syncBasinScale();
    recreateWaterSolver();
    if (simulationReady) clearActions();
    return;
  }
  if (key === 'tankDepthScale') {
    if (Math.abs(tankDepthScale - value) < 1e-6) return;
    tankDepthScale = value;
    syncBasinScale();
    if (simulationReady) clearActions();
    return;
  }
  if (key === 'glassThickness') {
    if (Math.abs(glassThickness - value) < 1e-6) return;
    glassThickness = value;
    syncBasinScale();
    return;
  }
  if (key === 'gridResolution') {
    const nextResolution = Math.round(value);
    if (solverResolution !== nextResolution) {
      solverResolution = nextResolution;
      recreateWaterSolver();
      if (simulationReady) clearActions();
    }
    return;
  }
  if (key === 'dropSize') dropControlState.size = value;
  if (key === 'dropMass') dropControlState.mass = value;
  if (key === 'rainRate') rainState.rate = value;
  if (key === 'rainStrength') rainState.intensity = value;
  if (key === 'sunAngle') sunDir.set(0.5, value, -0.8).normalize();
  if (key === 'viscosity') oceanUniforms.u_viscosity.value = value;
  if (key === 'wallReflectivity') oceanUniforms.u_wallReflectivity.value = value;

  if (key in lookState) {
    lookState[key] = value;
    updateOceanPalette();
  }

  if (key === 'waveHeight' || key === 'windSpeed' || key === 'windDir') {
    triggerSurfaceExcitation({
      waveHeight: surfaceControlState.waveHeight,
      windSpeed: surfaceControlState.windSpeed,
      windDir: surfaceControlState.windDir,
      seedSolver: false,
    });
    return;
  }

  syncSurfaceState();
}

const controlSections = {
  surface: { section: 'Surface', sectionOrder: 1 },
  tank: { section: 'Tank', sectionOrder: 2 },
  impacts: { section: 'Impacts & Rain', sectionOrder: 3 },
  water: { section: 'Water Look', sectionOrder: 4 },
  light: { section: 'Light', sectionOrder: 5 },
};

controls = new Controls({
  waveHeight: {
    ...controlSections.surface,
    order: 1,
    label: 'Wave Height',
    min: 0.0,
    max: 2.4,
    step: 0.02,
    value: 0.02,
    description: '基礎波の高さです。大きくすると常時うねりが強くなり、静かな水面よりも荒れた海面の表情になります。',
  },
  windSpeed: {
    ...controlSections.surface,
    order: 2,
    label: 'Wind Speed',
    min: 0.05,
    max: 14,
    step: 0.05,
    value: 0.35,
    description: '風で駆動される波の速さと細かさです。上げるほど水面の動きが忙しくなり、落下インパクトが背景の波に埋もれやすくなります。',
  },
  windDir: {
    ...controlSections.surface,
    order: 3,
    label: 'Wind Dir',
    min: 0,
    max: Math.PI * 2,
    step: 0.05,
    value: 0.18,
    description: '基礎波が流れる向きです。波筋の方向が変わるので、ハイライトや波頭の見え方も変化します。',
  },
  localWaveSeconds: {
    ...controlSections.surface,
    order: 4,
    label: 'Local Seconds',
    min: 4,
    max: 120,
    step: 1,
    value: localWaveSeconds,
    description: '着水点のまわりで解析的に残す局所波の秒数です。長くすると余韻が続きますが、履歴参照の負荷も増えます。',
  },
  impactHistoryCount: {
    ...controlSections.surface,
    order: 5,
    label: 'History Count',
    min: 8,
    max: 128,
    step: 1,
    value: activeImpactHistoryCount,
    description: '水面計算で参照する impact 履歴の件数です。増やすほど連続着水の影響が残りますが、CPU の計算量も増えます。',
  },
  sunAngle: {
    ...controlSections.light,
    order: 1,
    label: 'Sun Angle',
    min: -0.2,
    max: 1.1,
    step: 0.01,
    value: 0.74,
    description: '太陽の高さです。低くすると横からの光になり、反射と陰影が強くなって波の凹凸が目立ちます。',
  },
  viscosity: {
    ...controlSections.surface,
    order: 6,
    label: 'Viscosity',
    min: 0.05,
    max: 1.8,
    step: 0.01,
    value: lookState.viscosity,
    description: '擬似粘度です。高いほど着水後の波紋が早く減衰して広がりも遅くなり、低いほど軽い液体のように長く広がります。',
  },
  wallReflectivity: {
    ...controlSections.tank,
    order: 4,
    label: 'Wall Reflect',
    min: 0.0,
    max: 1.2,
    step: 0.01,
    value: lookState.wallReflectivity,
    description: '壁面での反射の強さです。高いほど波が槽の端で返ってきて往復し、低いほど壁で吸収されて静かに減衰します。',
  },
  tankScale: {
    ...controlSections.tank,
    order: 1,
    label: 'Tank Width',
    min: 0.6,
    max: 1.8,
    step: 0.05,
    value: tankScale,
    description: '水槽の広さです。大きいほど波が長く伝わり、小さいほど壁反射が早く返ります。変更時はシミュレーションを再初期化します。',
  },
  tankDepthScale: {
    ...controlSections.tank,
    order: 2,
    label: 'Tank Depth',
    min: 0.6,
    max: 1.8,
    step: 0.05,
    value: tankDepthScale,
    description: '水槽の深さです。深くすると底までの距離が伸び、浅くすると底面の存在感が強くなります。変更時はシミュレーションを再初期化します。',
  },
  waterDepth: {
    ...controlSections.tank,
    order: 3,
    label: 'Water Depth',
    min: 0.08,
    max: 2.2,
    step: 0.01,
    value: waterDepth,
    description: '実際に水を張る深さです。水槽の深さとは独立に調整でき、槽より深くした場合は槽の深さまでに制限されます。',
  },
  glassThickness: {
    ...controlSections.tank,
    order: 4,
    label: 'Glass Thick',
    min: 0.01,
    max: 0.12,
    step: 0.005,
    value: glassThickness,
    description: 'ガラス壁の厚みです。水槽の広さとは独立に調整でき、値はそのままメートル相当で扱っています。',
  },
  gridResolution: {
    ...controlSections.tank,
    order: 5,
    label: 'Grid Res',
    min: 64,
    max: 256,
    step: 16,
    value: solverResolution,
    description: '水面 solver のグリッド解像度です。高いほど細かい波を保持できますが、負荷が上がり、変更時にシミュレーションを再初期化します。',
  },
  dropSize: {
    ...controlSections.impacts,
    order: 1,
    label: 'Drop Size',
    min: 0.4,
    max: 1.2,
    step: 0.01,
    value: dropControlState.size,
    description: '落下物の見た目サイズです。大きいほど接水面が広がり、波の立ち上がりも広く見えます。',
  },
  dropMass: {
    ...controlSections.impacts,
    order: 2,
    label: 'Drop Mass',
    min: 0.35,
    max: 1.4,
    step: 0.01,
    value: dropControlState.mass,
    description: '落下物の質量スケールです。重いほど同じサイズでも強い impact を与えます。',
  },
  rainRate: {
    ...controlSections.impacts,
    order: 4,
    label: 'Rain Rate',
    min: 1,
    max: 40,
    step: 1,
    value: rainState.rate,
    description: '雨モードで 1 秒あたりに落とす雨粒の数です。高いほど水面へ連続的な刺激が入ります。',
  },
  rainStrength: {
    ...controlSections.impacts,
    order: 5,
    label: 'Rain Power',
    min: 0.08,
    max: 0.5,
    step: 0.01,
    value: rainState.intensity,
    description: '雨粒 1 粒ごとの強さです。上げるほど小さな波紋ではなく、はっきりした連続波になります。',
  },
  waterHue: {
    ...controlSections.water,
    order: 1,
    label: 'Water Hue',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    value: lookState.waterHue,
    description: '水の色相です。透過色と反射色の基調が変わり、海水、湖水、着色液体のような印象を作れます。',
  },
  waterSaturation: {
    ...controlSections.water,
    order: 2,
    label: 'Water Sat',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    value: lookState.waterSaturation,
    description: '水の彩度です。高いほど色味が濃くなり、低いほど透明感のある無彩色寄りの表現になります。',
  },
  waterLightness: {
    ...controlSections.water,
    order: 3,
    label: 'Water Light',
    min: 0.05,
    max: 0.55,
    step: 0.01,
    value: lookState.waterLightness,
    description: '水の明るさです。上げると浅瀬や透過光が強く見え、下げると深く重い液体の印象になります。',
  },
  sunHue: {
    ...controlSections.light,
    order: 2,
    label: 'Sun Hue',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    value: lookState.sunHue,
    description: '太陽光の色相です。暖色に寄せると夕景、寒色に寄せると曇天や月光寄りの雰囲気になります。',
  },
  sunSaturation: {
    ...controlSections.light,
    order: 3,
    label: 'Sun Sat',
    min: 0.0,
    max: 1.0,
    step: 0.01,
    value: lookState.sunSaturation,
    description: '太陽光の色味の強さです。上げるほどハイライトに色が乗り、下げると白色光に近づきます。',
  },
  sunIntensity: {
    ...controlSections.light,
    order: 4,
    label: 'Sun Intensity',
    min: 0.3,
    max: 2.0,
    step: 0.01,
    value: lookState.sunIntensity,
    description: '太陽光の強度です。上げると鏡面反射と水面のきらめきが強くなり、下げると柔らかい照明になります。',
  },
  foamAmount: {
    ...controlSections.water,
    order: 4,
    label: 'Foam Amount',
    min: 0.0,
    max: 1.5,
    step: 0.01,
    value: lookState.foamAmount,
    description: '白波の出やすさです。高いほど勾配の強い場所に泡の縁取りが出て、荒れた表情になります。',
  },
  reflectionMix: {
    ...controlSections.water,
    order: 5,
    label: 'Reflection',
    min: 0.3,
    max: 1.3,
    step: 0.01,
    value: lookState.reflectionMix,
    description: '空の映り込みの強さです。上げると鏡面寄り、下げると水の内部色が見えやすくなります。',
  },
  impactGain: {
    ...controlSections.impacts,
    order: 3,
    label: 'Impact Gain',
    min: 0.2,
    max: 2.5,
    step: 0.01,
    value: lookState.impactGain,
    description: '落下物が作る波紋の初期振幅です。大きいほど着水時の反応が強く、スプラッシュも目立ちます。',
  },
  exposure: {
    ...controlSections.light,
    order: 5,
    label: 'Exposure',
    min: 0.6,
    max: 1.8,
    step: 0.01,
    value: lookState.exposure,
    description: '全体露出です。高いほど水面と空の明部が持ち上がり、低いほどコントラストの強い引き締まった画になります。',
  },
}, syncUniform, {
  title: 'Ocean Tuning',
  accent: '#4a8fd4',
  helpText: '各スライダーにカーソルを合わせると、その値がシミュレーションの見た目や挙動に与える影響を日本語で表示します。',
  mount: controlsMount,
});

Object.entries(controls.values).forEach(([key, value]) => syncUniform(key, value));

const presets = {
  nagi: {
    label: 'Nagi',
    waveHeight: 0.02,
    windSpeed: 0.35,
    windDir: 0.18,
    sunAngle: 0.74,
    waterHue: 0.53,
    waterSaturation: 0.64,
    waterLightness: 0.28,
    sunHue: 0.12,
    sunSaturation: 0.18,
    sunIntensity: 1.05,
    foamAmount: 0.16,
    reflectionMix: 1.08,
    impactGain: 1.0,
    viscosity: 0.35,
    wallReflectivity: 0.92,
    exposure: 1.22,
    idleOrbit: 0.00008,
  },
  glass: {
    label: 'Glass',
    waveHeight: 0.16,
    windSpeed: 1.1,
    windDir: 0.22,
    sunAngle: 0.66,
    waterHue: 0.54,
    waterSaturation: 0.42,
    waterLightness: 0.35,
    sunHue: 0.11,
    sunSaturation: 0.12,
    sunIntensity: 1.12,
    foamAmount: 0.12,
    reflectionMix: 1.2,
    impactGain: 0.9,
    viscosity: 0.28,
    wallReflectivity: 0.84,
    exposure: 1.28,
    idleOrbit: 0.00018,
  },
  swell: {
    label: 'Swell',
    waveHeight: 0.55,
    windSpeed: 4.2,
    windDir: 0.32,
    sunAngle: 0.4,
    waterHue: 0.55,
    waterSaturation: 0.7,
    waterLightness: 0.24,
    sunHue: 0.12,
    sunSaturation: 0.36,
    sunIntensity: 1.2,
    foamAmount: 0.72,
    reflectionMix: 0.98,
    impactGain: 1.08,
    viscosity: 0.42,
    wallReflectivity: 0.68,
    exposure: 1.18,
    idleOrbit: 0.00032,
  },
  storm: {
    label: 'Storm',
    waveHeight: 1.35,
    windSpeed: 8.8,
    windDir: 0.5,
    sunAngle: 0.15,
    waterHue: 0.59,
    waterSaturation: 0.52,
    waterLightness: 0.18,
    sunHue: 0.58,
    sunSaturation: 0.22,
    sunIntensity: 1.18,
    foamAmount: 1.18,
    reflectionMix: 0.88,
    impactGain: 1.3,
    viscosity: 0.2,
    wallReflectivity: 0.58,
    exposure: 0.96,
    idleOrbit: 0.00055,
  },
  sunset: {
    label: 'Sunset',
    waveHeight: 0.7,
    windSpeed: 3.0,
    windDir: 5.9,
    sunAngle: 0.22,
    waterHue: 0.57,
    waterSaturation: 0.62,
    waterLightness: 0.23,
    sunHue: 0.07,
    sunSaturation: 0.66,
    sunIntensity: 1.26,
    foamAmount: 0.48,
    reflectionMix: 1.04,
    impactGain: 1.12,
    viscosity: 0.5,
    wallReflectivity: 0.78,
    exposure: 1.08,
    idleOrbit: 0.00026,
  },
};

let idleOrbitSpeed = presets.nagi.idleOrbit;
let isDragging = false;
let previousPointer = { x: 0, y: 0 };

syncBasinScale();
syncSolverUniforms();
updateCamera();

function applyPreset(name, options = {}) {
  const preset = presets[name];
  if (!preset) return;

  Object.entries(preset).forEach(([key, value]) => {
    if (key === 'label' || key === 'idleOrbit') return;
    controls.setValue(key, value, true);
  });

  idleOrbitSpeed = preset.idleOrbit;
  triggerSurfaceExcitation({
    waveHeight: preset.waveHeight,
    windSpeed: preset.windSpeed,
    windDir: preset.windDir,
    seedSolver: options.seedSolver !== false,
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === name);
  });
}

applyPreset('nagi', { seedSolver: false });

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 2) return;
  canvas.setPointerCapture(event.pointerId);
  isDragging = true;
  previousPointer = { x: event.clientX, y: event.clientY };
});

function stopDrag(event) {
  if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  isDragging = false;
}

canvas.addEventListener('pointerup', stopDrag);
canvas.addEventListener('pointercancel', stopDrag);
canvas.addEventListener('pointerleave', () => {
  isDragging = false;
});

canvas.addEventListener('pointermove', (event) => {
  if (!isDragging) return;

  spherical.theta -= (event.clientX - previousPointer.x) * 0.005;
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi + (event.clientY - previousPointer.y) * 0.005,
    0.2,
    1.42,
  );

  previousPointer = { x: event.clientX, y: event.clientY };
  updateCamera();
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  spherical.radius = THREE.MathUtils.clamp(spherical.radius + event.deltaY * 0.05, 3.5, 40);
  updateCamera();
}, { passive: false });

window.addEventListener('resize', resizeViewport);

document.querySelectorAll('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => applyPreset(button.dataset.preset));
});

const dropSpecs = {
  droplet: {
    makeGeometry: (sizeScale) => new THREE.SphereGeometry(0.13 * sizeScale, 16, 16),
    makeMaterial: (sizeScale) => new THREE.MeshPhysicalMaterial({
      color: waterSurfaceColor.clone().lerp(new THREE.Color(0xffffff), 0.42),
      roughness: 0.08,
      metalness: 0.0,
      transmission: 0.78,
      transparent: true,
      opacity: 0.92,
      thickness: 0.85 + sizeScale * 0.4,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    }),
    spawnY: 4.45,
    impactStrength: 0.24,
    opacity: 0.92,
    reboundScale: 0.86,
    fadeRate: 0.5,
    spinScale: 0.9,
  },
  sphere: {
    makeGeometry: (sizeScale) => new THREE.SphereGeometry(0.34 * sizeScale, 26, 26),
    makeMaterial: () => new THREE.MeshStandardMaterial({
      color: 0xc3cedd,
      roughness: 0.18,
      metalness: 0.86,
      transparent: true,
      opacity: 0.96,
    }),
    spawnY: 4.95,
    impactStrength: 0.4,
    opacity: 0.96,
    reboundScale: 0.78,
    fadeRate: 0.42,
    spinScale: 1.0,
  },
  crate: {
    makeGeometry: (sizeScale) => new THREE.BoxGeometry(0.56 * sizeScale, 0.56 * sizeScale, 0.56 * sizeScale),
    makeMaterial: () => new THREE.MeshStandardMaterial({
      color: 0x7a5135,
      roughness: 0.76,
      metalness: 0.08,
      transparent: true,
      opacity: 0.96,
    }),
    spawnY: 5.05,
    impactStrength: 0.48,
    opacity: 0.96,
    reboundScale: 0.72,
    fadeRate: 0.4,
    spinScale: 1.08,
  },
};

const drops = [];
const splashes = [];
const sheets = [];
const sprayParticles = [];
const crowns = [];

function buildDropInstance(type, options = {}) {
  const spec = dropSpecs[type];
  if (!spec) return null;

  const sizeScale = (options.sizeScale ?? 1.0) * dropControlState.size;
  const massScale = (options.massScale ?? 1.0) * dropControlState.mass;
  const mesh = new THREE.Mesh(spec.makeGeometry(sizeScale), spec.makeMaterial(sizeScale));

  return {
    mesh,
    spawnY: options.spawnY ?? (spec.spawnY + sizeScale * 0.45),
    opacity: options.opacity ?? spec.opacity,
    impactStrength: spec.impactStrength * Math.max(0.16, massScale) * Math.pow(sizeScale, 1.08),
    reboundScale: options.reboundScale ?? spec.reboundScale,
    fadeRate: options.fadeRate ?? spec.fadeRate,
    spinScale: options.spinScale ?? spec.spinScale,
    impactOptions: options.impactOptions ?? {},
  };
}

function waveHeightAt(x, z, time) {
  const windDir = oceanUniforms.u_windDir.value;
  const windSpeed = Math.max(oceanUniforms.u_windSpeed.value, 0.5);
  const waveHeight = oceanUniforms.u_waveHeight.value;

  const d0x = Math.cos(windDir);
  const d0z = Math.sin(windDir);
  const d1x = Math.cos(windDir + 0.55);
  const d1z = Math.sin(windDir + 0.55);
  const d2x = Math.cos(windDir - 0.75);
  const d2z = Math.sin(windDir - 0.75);
  const d3x = Math.cos(windDir + 1.25);
  const d3z = Math.sin(windDir + 1.25);

  const f0 = 0.22 / windSpeed;
  const f1 = 0.46 / windSpeed;
  const f2 = 0.78 / windSpeed;
  const f3 = 1.12 / windSpeed;

  const p0 = (x * d0x + z * d0z) * f0 * 14.0 - time * 1.1;
  const p1 = (x * d1x + z * d1z) * f1 * 11.0 - time * 1.5;
  const p2 = (x * d2x + z * d2z) * f2 * 8.0 - time * 1.8;
  const p3 = (x * d3x + z * d3z) * f3 * 6.0 - time * 2.4;

  return Math.sin(p0) * waveHeight * 0.85
    + Math.sin(p1) * waveHeight * 0.35
    + Math.sin(p2) * waveHeight * 0.18
    + Math.sin(p3) * waveHeight * 0.1;
}

function rippleContribution(x, z, sourceX, sourceZ, strength, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age) {
  const dx = x - sourceX;
  const dz = z - sourceZ;
  const dist = Math.max(Math.hypot(dx, dz), 0.0001);
  const phase = dist * spatialFreq - age * rippleSpeed;
  const envelope = Math.exp(-dist * radialDecay)
    * Math.exp(-age * temporalDecay)
    * THREE.MathUtils.smoothstep(age, 0.0, rampTime);
  return strength * envelope * Math.sin(phase);
}

function impactHeightAt(x, z, time) {
  let height = 0;
  const viscMix = THREE.MathUtils.clamp((viscosity - 0.05) / 1.75, 0, 1);
  const rippleSpeed = THREE.MathUtils.lerp(10.4, 6.2, viscMix);
  const spatialFreq = THREE.MathUtils.lerp(7.4, 5.8, viscMix * 0.9);
  const radialDecay = THREE.MathUtils.lerp(0.24, 0.54, viscMix);
  const temporalDecay = THREE.MathUtils.lerp(0.026, 0.075, viscMix);
  const rampTime = THREE.MathUtils.lerp(0.06, 0.14, viscMix);
  const singleReflectionGain = wallReflectivity * 0.78;
  const cornerReflectionGain = wallReflectivity * wallReflectivity * 0.62;
  const maxAge = localWaveSeconds;
  const historyCount = Math.max(1, Math.min(MAX_IMPACT_HISTORY, Math.round(activeImpactHistoryCount)));

  for (let i = 0; i < historyCount; i++) {
    const historyIndex = (impactHistoryCursor - 1 - i + MAX_IMPACT_HISTORY) % MAX_IMPACT_HISTORY;
    const impact = impactHistory[historyIndex];
    const age = time - impact.z;
    if (age <= 0 || age >= maxAge || impact.w <= 0.001) continue;

    const leftX = -2.0 * basinHalfSize.x - impact.x;
    const rightX = 2.0 * basinHalfSize.x - impact.x;
    const nearZ = -2.0 * basinHalfSize.y - impact.y;
    const farZ = 2.0 * basinHalfSize.y - impact.y;

    height += rippleContribution(x, z, impact.x, impact.y, impact.w, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, leftX, impact.y, impact.w * singleReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, rightX, impact.y, impact.w * singleReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, impact.x, nearZ, impact.w * singleReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, impact.x, farZ, impact.w * singleReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, leftX, nearZ, impact.w * cornerReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, leftX, farZ, impact.w * cornerReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, rightX, nearZ, impact.w * cornerReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
    height += rippleContribution(x, z, rightX, farZ, impact.w * cornerReflectionGain, spatialFreq, rippleSpeed, radialDecay, temporalDecay, rampTime, age);
  }
  return height;
}

function sampleWaterHeight(x, z, time) {
  return waterSurfaceY
    + waveHeightAt(x, z, time)
    + waterSolver.sampleHeightAt(x, z) * oceanUniforms.u_dynamicGain.value
    + impactHeightAt(x, z, time);
}

function addSplash(x, z, y, scale = 1.0) {
  const material = new THREE.MeshBasicMaterial({
    color: foamSurfaceColor,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const innerRadius = 0.14 * scale;
  const outerRadius = innerRadius + 0.04 * (0.75 + scale * 0.25);
  const mesh = new THREE.Mesh(new THREE.RingGeometry(innerRadius, outerRadius, 48), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y + 0.02, z);
  splashGroup.add(mesh);

  splashes.push({
    mesh,
    age: 0,
    expansion: 4.4 * (0.8 + scale * 0.28),
    fade: 0.62 * (0.82 + scale * 0.18),
  });
}

function createSprayMaterial(opacity = 0.82) {
  return new THREE.MeshPhysicalMaterial({
    color: waterSurfaceColor.clone().lerp(new THREE.Color(0xffffff), 0.5),
    roughness: 0.08,
    metalness: 0.0,
    transmission: 0.76,
    transparent: true,
    opacity,
    thickness: 0.8,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    depthWrite: false,
  });
}

function spawnWaterSheet(x, z, y, strength, generation = 0) {
  const normalized = THREE.MathUtils.clamp(strength / 0.8, 0.18, 1.28);
  const generationScale = Math.max(0.34, 1.0 - generation * 0.26);
  const baseRadius = THREE.MathUtils.lerp(0.26, 0.82, normalized) * generationScale;
  const baseHeight = THREE.MathUtils.lerp(0.18, 0.76, normalized) * generationScale;

  const geometry = new THREE.CylinderGeometry(baseRadius * 0.7, baseRadius * 1.12, baseHeight, 48, 4, true);
  const mesh = new THREE.Mesh(geometry, createSprayMaterial(0.22 + normalized * 0.08));
  mesh.position.set(x, y + baseHeight * 0.36, z);
  mesh.renderOrder = 3;
  mesh.rotation.y = Math.random() * Math.PI * 2.0;
  sheetGroup.add(mesh);

  sheets.push({
    mesh,
    age: 0,
    lifetime: THREE.MathUtils.lerp(0.24, 0.56, normalized) * (1.0 + generation * 0.08),
    baseHeight,
    radialSpeed: THREE.MathUtils.lerp(1.2, 3.2, normalized) * generationScale,
    verticalLift: THREE.MathUtils.lerp(0.18, 0.6, normalized) * generationScale,
    wobble: THREE.MathUtils.lerp(0.12, 0.36, normalized),
  });
}

function spawnCrownSplash(x, z, y, strength, generation = 0) {
  const normalized = THREE.MathUtils.clamp(strength / 0.8, 0.25, 1.3);
  const generationScale = Math.max(0.38, 1.0 - generation * 0.24);
  const baseRadius = THREE.MathUtils.lerp(0.22, 0.58, normalized);
  const baseHeight = THREE.MathUtils.lerp(0.2, 0.78, normalized);

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(baseRadius * 0.42 * generationScale, baseRadius * generationScale, baseHeight * generationScale, 28, 1, true),
    createSprayMaterial(0.46 * generationScale + 0.08),
  );
  mesh.position.set(x, y + baseHeight * 0.46 * generationScale, z);
  mesh.renderOrder = 3;
  crownGroup.add(mesh);

  crowns.push({
    mesh,
    age: 0,
    lifetime: THREE.MathUtils.lerp(0.34, 0.72, normalized) * generationScale,
    baseRadius: baseRadius * generationScale,
    baseHeight: baseHeight * generationScale,
    lift: THREE.MathUtils.lerp(0.42, 0.76, normalized) * generationScale,
  });
}

function sampleSprayParticleProfile(normalized, generation) {
  const bucket = Math.random();
  const generationScale = Math.max(0.4, 1.0 - generation * 0.22);

  if (bucket < 0.68) {
    return {
      radius: THREE.MathUtils.lerp(0.012, 0.03, Math.pow(Math.random(), 0.6)) * generationScale,
      radialMultiplier: THREE.MathUtils.lerp(1.0, 1.65, Math.random()),
      liftMultiplier: THREE.MathUtils.lerp(0.9, 1.35, Math.random()),
      drag: THREE.MathUtils.lerp(1.35, 1.8, Math.random()),
      gravityScale: THREE.MathUtils.lerp(0.72, 0.9, Math.random()),
      impactScale: THREE.MathUtils.lerp(0.45, 0.82, Math.random()),
      chainBudget: generation < 1 ? 1 : 0,
    };
  }

  if (bucket < 0.93) {
    return {
      radius: THREE.MathUtils.lerp(0.03, 0.058, Math.pow(Math.random(), 0.82)) * generationScale,
      radialMultiplier: THREE.MathUtils.lerp(0.8, 1.25, Math.random()),
      liftMultiplier: THREE.MathUtils.lerp(0.72, 1.0, Math.random()),
      drag: THREE.MathUtils.lerp(0.85, 1.15, Math.random()),
      gravityScale: THREE.MathUtils.lerp(0.9, 1.05, Math.random()),
      impactScale: THREE.MathUtils.lerp(0.8, 1.05, Math.random()),
      chainBudget: generation < 2 ? 1 : 0,
    };
  }

  return {
    radius: THREE.MathUtils.lerp(0.058, 0.11, Math.random()) * generationScale,
    radialMultiplier: THREE.MathUtils.lerp(0.56, 0.9, Math.random()),
    liftMultiplier: THREE.MathUtils.lerp(0.58, 0.84, Math.random()),
    drag: THREE.MathUtils.lerp(0.5, 0.8, Math.random()),
    gravityScale: THREE.MathUtils.lerp(1.0, 1.18, Math.random()),
    impactScale: THREE.MathUtils.lerp(1.0, 1.25, Math.random()),
    chainBudget: generation < 2 ? 2 : 0,
  };
}

function spawnSprayBurst(x, z, y, strength, generation = 0) {
  const normalized = THREE.MathUtils.clamp(strength / 0.8, 0.22, 1.3);
  const generationScale = Math.max(0.42, 1.0 - generation * 0.26);
  const particleCount = Math.round(THREE.MathUtils.lerp(10, 26, normalized) * generationScale);

  for (let i = 0; i < particleCount; i++) {
    const profile = sampleSprayParticleProfile(normalized, generation);
    const radius = profile.radius;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 12),
      createSprayMaterial(THREE.MathUtils.lerp(0.68, 0.92, THREE.MathUtils.clamp(radius / 0.11, 0.0, 1.0))),
    );

    const angle = Math.random() * Math.PI * 2.0;
    const radialSpeed = THREE.MathUtils.lerp(0.8, 3.1, Math.random()) * normalized * generationScale * profile.radialMultiplier;
    const upwardSpeed = (THREE.MathUtils.lerp(1.8, 5.4, Math.random()) * normalized + 0.4) * generationScale * profile.liftMultiplier;
    const liftBias = Math.random() < 0.25 ? 1.45 : 1.0;

    mesh.position.set(
      x + Math.cos(angle) * radius * 0.45,
      y + 0.04 + Math.random() * 0.08,
      z + Math.sin(angle) * radius * 0.45,
    );
    mesh.renderOrder = 4;
    sprayGroup.add(mesh);

    sprayParticles.push({
      mesh,
      radius,
      age: 0,
      lifetime: THREE.MathUtils.lerp(0.55, 1.15, Math.random()) * THREE.MathUtils.lerp(0.78, 1.15, radius / 0.11),
      velocity: new THREE.Vector3(
        Math.cos(angle) * radialSpeed,
        upwardSpeed * liftBias,
        Math.sin(angle) * radialSpeed,
      ),
      gravityScale: profile.gravityScale,
      drag: profile.drag,
      remainingReentries: profile.chainBudget,
      generation,
      secondaryStrength: strength * THREE.MathUtils.lerp(0.05, 0.12, Math.random()) * profile.impactScale,
    });
  }
}

function registerImpact(x, z, time, strength, options = {}) {
  const waterY = sampleWaterHeight(x, z, time);
  const visualScale = options.visualScale ?? 1.0;
  const generation = options.generation ?? 0;
  const totalStrength = strength * impactGain;
  const localStrength = totalStrength * 0.34;
  const solverRadius = THREE.MathUtils.lerp(0.48, 1.2, THREE.MathUtils.clamp(totalStrength / 0.95, 0.0, 1.0))
    * THREE.MathUtils.clamp(0.8 + visualScale * 0.28, 0.65, 1.18);

  impactHistory[impactHistoryCursor].set(x, z, time, totalStrength);
  impactHistoryCursor = (impactHistoryCursor + 1) % MAX_IMPACT_HISTORY;
  impactUniforms[impactCursor].set(x, z, time, localStrength);
  impactCursor = (impactCursor + 1) % MAX_VISIBLE_IMPACTS;
  waterSolver.addImpact(x, z, totalStrength * 1.92, solverRadius);

  if (options.surfaceRing === true) addSplash(x, z, waterY, visualScale);
  if (options.spray !== false) {
    spawnWaterSheet(x, z, waterY, totalStrength * visualScale, generation);
    spawnCrownSplash(x, z, waterY, totalStrength * visualScale, generation);
    spawnSprayBurst(x, z, waterY, totalStrength * visualScale, generation);
  }
}

function disposeObject(mesh) {
  mesh.geometry.dispose();
  mesh.material.dispose();
}

function clearActions() {
  while (drops.length) {
    const drop = drops.pop();
    dropGroup.remove(drop.mesh);
    disposeObject(drop.mesh);
  }

  while (splashes.length) {
    const splash = splashes.pop();
    splashGroup.remove(splash.mesh);
    disposeObject(splash.mesh);
  }

  while (sheets.length) {
    const sheet = sheets.pop();
    sheetGroup.remove(sheet.mesh);
    disposeObject(sheet.mesh);
  }

  while (sprayParticles.length) {
    const particle = sprayParticles.pop();
    sprayGroup.remove(particle.mesh);
    disposeObject(particle.mesh);
  }

  while (crowns.length) {
    const crown = crowns.pop();
    crownGroup.remove(crown.mesh);
    disposeObject(crown.mesh);
  }

  impactUniforms.forEach((impact) => impact.set(0, 0, -100, 0));
  impactHistory.forEach((impact) => impact.set(0, 0, -100, 0));
  impactCursor = 0;
  impactHistoryCursor = 0;
  setRainEnabled(false);
  waterSolver.reset();
  surfaceMotionState.waveHeight = calmSurfaceState.waveHeight;
  surfaceMotionState.windSpeed = calmSurfaceState.windSpeed;
  surfaceMotionState.windDir = surfaceControlState.windDir;
  syncSurfaceState();
}

function randomSpawnPosition(edgeInset = getDropMargin()) {
  return {
    x: THREE.MathUtils.randFloat(-basinHalfSize.x + edgeInset, basinHalfSize.x - edgeInset),
    z: THREE.MathUtils.randFloat(-basinHalfSize.y + edgeInset, basinHalfSize.y - edgeInset),
  };
}

function spawnDrop(type, options = {}) {
  const instance = buildDropInstance(type, options);
  if (!instance) return;

  const spawn = options.position ?? randomSpawnPosition(options.edgeInset);
  instance.mesh.position.set(
    spawn.x,
    instance.spawnY,
    spawn.z,
  );
  instance.mesh.rotation.set(
    Math.random() * Math.PI * instance.spinScale,
    Math.random() * Math.PI * instance.spinScale,
    Math.random() * Math.PI * instance.spinScale,
  );
  dropGroup.add(instance.mesh);

  drops.push({
    mesh: instance.mesh,
    velocityY: 0,
    spin: new THREE.Vector3(
      THREE.MathUtils.randFloat(0.4, 1.1) * instance.spinScale,
      THREE.MathUtils.randFloat(0.5, 1.4) * instance.spinScale,
      THREE.MathUtils.randFloat(0.3, 1.0) * instance.spinScale,
    ),
    impacted: false,
    opacity: instance.opacity,
    impactStrength: instance.impactStrength,
    reboundScale: instance.reboundScale,
    fadeRate: instance.fadeRate,
    impactOptions: instance.impactOptions,
  });
}

const rainButton = document.querySelector('[data-drop="rain"]');

function updateRainButton() {
  if (!rainButton) return;
  rainButton.textContent = rainState.enabled ? 'Rain Stop' : 'Rain Start';
  rainButton.classList.toggle('active', rainState.enabled);
}

function setRainEnabled(enabled) {
  rainState.enabled = enabled;
  rainState.accumulator = 0;
  updateRainButton();
}

function toggleRain() {
  setRainEnabled(!rainState.enabled);
}

function spawnRainDrop() {
  const normalized = THREE.MathUtils.clamp((rainState.intensity - 0.08) / 0.42, 0.0, 1.0);
  spawnDrop('droplet', {
    sizeScale: THREE.MathUtils.lerp(0.4, 0.72, normalized),
    massScale: THREE.MathUtils.lerp(0.35, 0.78, normalized),
    spawnY: THREE.MathUtils.lerp(5.2, 6.4, normalized),
    edgeInset: Math.max(0.24, getDropMargin() * 0.45),
    fadeRate: 0.88,
    reboundScale: 0.18,
    spinScale: 0.45,
    impactOptions: {
      spray: false,
      surfaceRing: false,
      visualScale: THREE.MathUtils.lerp(0.22, 0.42, normalized),
    },
  });
}

function updateRain(dt) {
  if (!rainState.enabled) return;

  rainState.accumulator += dt * rainState.rate;
  let spawnBudget = 0;
  while (rainState.accumulator >= 1.0 && spawnBudget < 10) {
    rainState.accumulator -= 1.0;
    spawnRainDrop();
    spawnBudget += 1;
  }
}

updateRainButton();
simulationReady = true;

document.querySelectorAll('[data-drop]').forEach((button) => {
  button.addEventListener('click', () => {
    const type = button.dataset.drop;
    if (type === 'clear') {
      clearActions();
      return;
    }
    if (type === 'rain') {
      toggleRain();
      return;
    }
    spawnDrop(type);
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === '1') applyPreset('nagi');
  if (event.key === '2') applyPreset('glass');
  if (event.key === '3') applyPreset('swell');
  if (event.key === '4') applyPreset('storm');
  if (event.key === '5') applyPreset('sunset');
  if (event.key === 'q' || event.key === 'Q') spawnDrop('droplet');
  if (event.key === 'w' || event.key === 'W') spawnDrop('sphere');
  if (event.key === 'e' || event.key === 'E') spawnDrop('crate');
  if (event.key === 't' || event.key === 'T') toggleRain();
  if (event.key === 'r' || event.key === 'R') clearActions();
});

function updateDrops(time, dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const drop = drops[i];
    drop.mesh.rotation.x += drop.spin.x * dt;
    drop.mesh.rotation.y += drop.spin.y * dt;
    drop.mesh.rotation.z += drop.spin.z * dt;

    if (!drop.impacted) {
      drop.velocityY -= 9.8 * dt;
      drop.mesh.position.y += drop.velocityY * dt;
      const waterHeight = sampleWaterHeight(drop.mesh.position.x, drop.mesh.position.z, time);
      if (drop.mesh.position.y <= waterHeight + 0.04) {
        drop.impacted = true;
        registerImpact(drop.mesh.position.x, drop.mesh.position.z, time, drop.impactStrength, drop.impactOptions);
        drop.mesh.position.y = waterHeight - 0.02;
        drop.velocityY = (-0.38 - drop.impactStrength * 0.68) * drop.reboundScale;
      }
      continue;
    }

    drop.mesh.position.y += drop.velocityY * dt;
    drop.velocityY -= 1.2 * dt;
    drop.opacity = Math.max(0, drop.opacity - dt * drop.fadeRate);
    drop.mesh.material.opacity = drop.opacity;
    if (drop.opacity <= 0.02 || drop.mesh.position.y < -basinDepth - 1.4) {
      dropGroup.remove(drop.mesh);
      disposeObject(drop.mesh);
      drops.splice(i, 1);
    }
  }
}

function updateSplashes(dt) {
  for (let i = splashes.length - 1; i >= 0; i--) {
    const splash = splashes[i];
    splash.age += dt;
    const scale = 1 + splash.age * splash.expansion;
    splash.mesh.scale.set(scale, scale, scale);
    splash.mesh.material.opacity = Math.max(0, 0.54 - splash.age * splash.fade);
    if (splash.mesh.material.opacity <= 0.01) {
      splashGroup.remove(splash.mesh);
      disposeObject(splash.mesh);
      splashes.splice(i, 1);
    }
  }
}

function updateSheets(dt) {
  for (let i = sheets.length - 1; i >= 0; i--) {
    const sheet = sheets[i];
    sheet.age += dt;
    const t = sheet.age / sheet.lifetime;
    const radialScale = 1.0 + t * (2.2 + sheet.radialSpeed * 0.35);
    const verticalScale = 1.0 - t * 0.42;

    sheet.mesh.scale.set(radialScale, Math.max(0.1, verticalScale), radialScale);
    sheet.mesh.position.y += dt * (sheet.verticalLift - t * 1.25);
    sheet.mesh.rotation.y += dt * (0.45 + sheet.wobble);
    sheet.mesh.material.opacity = Math.max(0.0, (0.28 + sheet.wobble * 0.08) * (1.0 - t * 1.18));

    if (t >= 1.0 || sheet.mesh.material.opacity <= 0.01) {
      sheetGroup.remove(sheet.mesh);
      disposeObject(sheet.mesh);
      sheets.splice(i, 1);
    }
  }
}

function updateCrowns(dt) {
  for (let i = crowns.length - 1; i >= 0; i--) {
    const crown = crowns[i];
    crown.age += dt;
    const t = crown.age / crown.lifetime;

    const radiusScale = 1.0 + t * 2.9;
    const heightScale = 1.0 + t * 0.45;
    crown.mesh.scale.set(radiusScale, heightScale, radiusScale);
    crown.mesh.position.y += dt * (crown.lift - t * 0.9);
    crown.mesh.material.opacity = Math.max(0.0, 0.46 * (1.0 - t * 1.08));

    if (t >= 1.0 || crown.mesh.material.opacity <= 0.01) {
      crownGroup.remove(crown.mesh);
      disposeObject(crown.mesh);
      crowns.splice(i, 1);
    }
  }
}

function updateSprayParticles(time, dt) {
  const wallX = basinHalfSize.x - 0.06;
  const wallZ = basinHalfSize.y - 0.06;

  for (let i = sprayParticles.length - 1; i >= 0; i--) {
    const particle = sprayParticles[i];
    particle.age += dt;

    particle.velocity.x *= Math.max(0.0, 1.0 - dt * particle.drag);
    particle.velocity.z *= Math.max(0.0, 1.0 - dt * particle.drag);
    particle.velocity.y -= 9.8 * dt * particle.gravityScale;
    particle.velocity.y *= 1.0 - dt * 0.12;

    particle.mesh.position.x += particle.velocity.x * dt;
    particle.mesh.position.y += particle.velocity.y * dt;
    particle.mesh.position.z += particle.velocity.z * dt;

    if (particle.mesh.position.x < -wallX || particle.mesh.position.x > wallX) {
      particle.mesh.position.x = THREE.MathUtils.clamp(particle.mesh.position.x, -wallX, wallX);
      particle.velocity.x *= -0.24;
    }

    if (particle.mesh.position.z < -wallZ || particle.mesh.position.z > wallZ) {
      particle.mesh.position.z = THREE.MathUtils.clamp(particle.mesh.position.z, -wallZ, wallZ);
      particle.velocity.z *= -0.24;
    }

    const fade = 1.0 - particle.age / particle.lifetime;
    particle.mesh.material.opacity = Math.max(0.0, 0.84 * fade);

    if (particle.remainingReentries > 0 && particle.velocity.y < 0.0) {
      const waterY = sampleWaterHeight(particle.mesh.position.x, particle.mesh.position.z, time);
      if (particle.mesh.position.y <= waterY + particle.radius * 0.35) {
        const nextGeneration = particle.generation + 1;
        const spawnNextSpray = particle.secondaryStrength > 0.06 && nextGeneration <= 2;
        const visualScale = THREE.MathUtils.clamp(0.32 + particle.radius * 7.5, 0.28, 0.82);
        registerImpact(
          particle.mesh.position.x,
          particle.mesh.position.z,
          time,
          particle.secondaryStrength,
          {
            spray: spawnNextSpray,
            surfaceRing: false,
            visualScale,
            generation: nextGeneration,
          },
        );
        particle.remainingReentries -= 1;
        particle.secondaryStrength *= 0.42;
        particle.mesh.position.y = waterY + particle.radius * 0.4;
        particle.velocity.y = Math.abs(particle.velocity.y) * 0.14;
        particle.velocity.x *= 0.32;
        particle.velocity.z *= 0.32;
      }
    }

    if (particle.remainingReentries <= 0 || fade <= 0.0 || particle.mesh.position.y < -basinDepth - 0.8) {
      sprayGroup.remove(particle.mesh);
      disposeObject(particle.mesh);
      sprayParticles.splice(i, 1);
    }
  }
}

const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);

  const dt = Math.min(clock.getDelta(), 0.033);
  const elapsed = clock.elapsedTime;

  if (!isDragging) {
    spherical.theta += idleOrbitSpeed;
    updateCamera();
  }

  settleSurfaceMotion(dt);
  oceanUniforms.u_time.value = elapsed;
  oceanUniforms.u_cameraPos.value.copy(camera.position);
  sunLight.position.copy(sunDir).multiplyScalar(18.0);
  sunLight.target.position.copy(cameraTarget);

  updateRain(dt);
  updateDrops(elapsed, dt);
  updateSplashes(dt);
  updateSheets(dt);
  updateCrowns(dt);
  updateSprayParticles(elapsed, dt);
  waterSolver.step(dt);

  renderer.render(scene, camera);
  stats.update();
}

loop();
