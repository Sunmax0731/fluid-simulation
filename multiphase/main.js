import * as THREE from 'three';
import { VOFSolver } from './vof-solver.js';
import { StatsPanel } from '../shared/utils/stats-panel.js';
import { Controls } from '../shared/ui/controls.js';

import vertSrc from './shaders/fullscreen.vert.glsl?raw';
import advectSrc from './shaders/advect.frag.glsl?raw';
import divSrc from './shaders/divergence.frag.glsl?raw';
import presSrc from './shaders/pressure.frag.glsl?raw';
import subSrc from './shaders/subtract.frag.glsl?raw';
import renderSrc from './shaders/render.frag.glsl?raw';
import splatSrc from './shaders/splat.frag.glsl?raw';
import fluidSurfaceVert from './shaders/fluid-surface.vert.glsl?raw';
import fluidSurfaceFrag from './shaders/fluid-surface.frag.glsl?raw';

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

function createSimSize(size, maxDim = 768) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.2);
  const longest = Math.max(size.width, size.height);
  const scale = Math.min(1, maxDim / longest) * dpr;

  return {
    width: Math.max(320, Math.round(size.width * scale)),
    height: Math.max(320, Math.round(size.height * scale)),
  };
}

function colorFromArray(values) {
  return new THREE.Color().setRGB(values[0], values[1], values[2]);
}

const canvas = document.getElementById('canvas');
const viewport = document.getElementById('viewport');

function getViewportSize() {
  const rect = viewport.getBoundingClientRect();
  return {
    width: Math.max(360, Math.round(rect.width || window.innerWidth)),
    height: Math.max(420, Math.round(rect.height || window.innerHeight)),
  };
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const initialViewportSize = getViewportSize();
renderer.setSize(initialViewportSize.width, initialViewportSize.height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const simCanvas = document.createElement('canvas');
const { width: W, height: H } = createSimSize(initialViewportSize);
simCanvas.width = W;
simCanvas.height = H;

const simGL = simCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
if (!simGL) {
  throw new Error('WebGL2 is required for the ink demo.');
}

const solver = new VOFSolver(simGL, W, H);
await solver.init({
  vert: vertSrc,
  advect: advectSrc,
  div: divSrc,
  pres: presSrc,
  sub: subSrc,
  render: renderSrc,
  splat: splatSrc,
});

const inkTexture = new THREE.CanvasTexture(simCanvas);
inkTexture.minFilter = THREE.LinearFilter;
inkTexture.magFilter = THREE.LinearFilter;
inkTexture.generateMipmaps = false;
inkTexture.wrapS = THREE.ClampToEdgeWrapping;
inkTexture.wrapT = THREE.ClampToEdgeWrapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060b);
scene.fog = new THREE.FogExp2(0x05060b, 0.055);

const camera = new THREE.PerspectiveCamera(48, initialViewportSize.width / initialViewportSize.height, 0.1, 100);
const cameraTarget = new THREE.Vector3(0, 1.45, 0);
const spherical = { theta: 0.46, phi: 1.02, radius: 10.4 };
let fluidUniforms = null;

function updateCamera() {
  camera.position.set(
    cameraTarget.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
    cameraTarget.y + spherical.radius * Math.cos(spherical.phi),
    cameraTarget.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta),
  );
  camera.lookAt(cameraTarget);
  fluidUniforms?.u_cameraPos.value.copy(camera.position);
}

function resizeViewport() {
  const { width, height } = getViewportSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

updateCamera();

const stats = new StatsPanel();

let brushRadius = 26;
let currentScene = 'sheet';
let currentTool = 'paint';
let currentView = 'ink';
let time = 0;

const surfaceState = {
  surfaceHeight: 0.17,
  surfaceRelief: 0.055,
  meniscus: 0.06,
  absorption: 1.75,
  refraction: 0.22,
  fresnel: 1.05,
  specular: 1.15,
  caustics: 0.42,
};

const brushState = {
  paintForce: 0.28,
  paintAmount: 1.0,
  bubbleForce: 0.42,
  bubbleCarve: 0.95,
  ambientMotion: 0.14,
};

scene.add(new THREE.HemisphereLight(0x7c8ba6, 0x11131a, 1.25));

const keyLight = new THREE.DirectionalLight(0xe6f0ff, 1.22);
keyLight.position.set(-4, 7, 5);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x7aa7ff, 1.8, 18, 2);
rimLight.position.set(3.5, 2.8, -2.2);
scene.add(rimLight);

const accentLight = new THREE.PointLight(0x5ff0ff, 1.2, 14, 2);
accentLight.position.set(-2.8, 1.8, 3.0);
scene.add(accentLight);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(18, 64),
  new THREE.MeshStandardMaterial({
    color: 0x0d0f16,
    roughness: 0.96,
    metalness: 0.04,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01;
scene.add(floor);

const stage = new THREE.Group();
scene.add(stage);

const pedestalMaterial = new THREE.MeshStandardMaterial({
  color: 0x171a27,
  roughness: 0.34,
  metalness: 0.46,
  emissive: 0x090b14,
  emissiveIntensity: 0.8,
});

const trayMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x0d111b,
  roughness: 0.18,
  metalness: 0.08,
  transmission: 0.18,
  thickness: 0.8,
  clearcoat: 1.0,
  clearcoatRoughness: 0.12,
});

const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(6.8, 0.72, 6.8),
  pedestalMaterial,
);
pedestal.position.y = 0.34;
stage.add(pedestal);

const trayBase = new THREE.Mesh(
  new THREE.BoxGeometry(6.0, 0.18, 6.0),
  trayMaterial,
);
trayBase.position.y = 0.82;
stage.add(trayBase);

const railMaterial = new THREE.MeshStandardMaterial({
  color: 0x2a2f45,
  roughness: 0.3,
  metalness: 0.56,
  emissive: 0x0c1020,
  emissiveIntensity: 0.9,
});

[
  { x: 0, y: 0.99, z: 2.76, sx: 5.62, sy: 0.24, sz: 0.16 },
  { x: 0, y: 0.99, z: -2.76, sx: 5.62, sy: 0.24, sz: 0.16 },
  { x: 2.76, y: 0.99, z: 0, sx: 0.16, sy: 0.24, sz: 5.62 },
  { x: -2.76, y: 0.99, z: 0, sx: 0.16, sy: 0.24, sz: 5.62 },
].forEach((item) => {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(item.sx, item.sy, item.sz),
    railMaterial,
  );
  rail.position.set(item.x, item.y, item.z);
  stage.add(rail);
});

const fluidSize = 5.32;
const fluidY = 1.06;

const basinFloorMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x111a24,
  roughness: 0.08,
  metalness: 0.04,
  transmission: 0.58,
  thickness: 1.25,
  clearcoat: 1.0,
  clearcoatRoughness: 0.08,
  transparent: true,
  opacity: 0.88,
  ior: 1.22,
});

const basinFloor = new THREE.Mesh(
  new THREE.BoxGeometry(fluidSize + 0.18, 0.08, fluidSize + 0.18),
  basinFloorMaterial,
);
basinFloor.position.y = 0.99;
stage.add(basinFloor);

const basinWallMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x182434,
  roughness: 0.05,
  metalness: 0.02,
  transmission: 0.74,
  thickness: 0.82,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  transparent: true,
  opacity: 0.82,
  ior: 1.24,
});

[
  { x: 0, y: 1.155, z: fluidSize * 0.5 + 0.06, sx: fluidSize + 0.1, sy: 0.34, sz: 0.08 },
  { x: 0, y: 1.155, z: -(fluidSize * 0.5 + 0.06), sx: fluidSize + 0.1, sy: 0.34, sz: 0.08 },
  { x: fluidSize * 0.5 + 0.06, y: 1.155, z: 0, sx: 0.08, sy: 0.34, sz: fluidSize + 0.1 },
  { x: -(fluidSize * 0.5 + 0.06), y: 1.155, z: 0, sx: 0.08, sy: 0.34, sz: fluidSize + 0.1 },
].forEach((item) => {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(item.sx, item.sy, item.sz),
    basinWallMaterial,
  );
  wall.position.set(item.x, item.y, item.z);
  stage.add(wall);
});

const fluidGeometry = new THREE.PlaneGeometry(fluidSize, fluidSize, 180, 180);
fluidGeometry.rotateX(-Math.PI / 2);

const flatFluidGeometry = new THREE.PlaneGeometry(fluidSize, fluidSize);
flatFluidGeometry.rotateX(-Math.PI / 2);

fluidUniforms = {
  u_inkMap: { value: inkTexture },
  u_texel: { value: new THREE.Vector2(1 / W, 1 / H) },
  u_domainSize: { value: fluidSize },
  u_cameraPos: { value: camera.position.clone() },
  u_surfaceHeight: { value: surfaceState.surfaceHeight },
  u_surfaceRelief: { value: surfaceState.surfaceRelief },
  u_meniscus: { value: surfaceState.meniscus },
  u_absorption: { value: surfaceState.absorption },
  u_refraction: { value: surfaceState.refraction },
  u_fresnel: { value: surfaceState.fresnel },
  u_specular: { value: surfaceState.specular },
  u_caustics: { value: surfaceState.caustics },
  u_time: { value: 0 },
  u_viewMode: { value: 0 },
  u_lightDir: { value: keyLight.position.clone().normalize() },
  u_lightColor: { value: keyLight.color.clone().multiplyScalar(keyLight.intensity) },
  u_rimColor: { value: new THREE.Color(0x9ce5ff) },
  u_shadowColor: { value: new THREE.Color(0x081018) },
};

const fluidMaterial = new THREE.ShaderMaterial({
  name: 'InkFlowSurface',
  uniforms: fluidUniforms,
  vertexShader: fluidSurfaceVert,
  fragmentShader: fluidSurfaceFrag,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  glslVersion: THREE.GLSL3,
  defines: {
    USE_UV: '',
  },
});

const fluidSurface = new THREE.Mesh(fluidGeometry, fluidMaterial);
fluidSurface.position.y = fluidY;
fluidSurface.renderOrder = 3;
stage.add(fluidSurface);

const depthSurface = new THREE.Mesh(
  flatFluidGeometry,
  new THREE.MeshBasicMaterial({
    map: inkTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.22,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    color: 0x0b1724,
  }),
);
depthSurface.position.y = fluidY - 0.05;
depthSurface.scale.setScalar(0.992);
depthSurface.renderOrder = 1;
stage.add(depthSurface);

const causticSurface = new THREE.Mesh(
  flatFluidGeometry,
  new THREE.MeshBasicMaterial({
    map: inkTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    color: 0xe2f5ff,
  }),
);
causticSurface.position.y = fluidY - 0.075;
causticSurface.scale.setScalar(0.968);
causticSurface.renderOrder = 0;
stage.add(causticSurface);

const interactionPlane = new THREE.Mesh(
  flatFluidGeometry,
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  }),
);
interactionPlane.position.y = fluidY + 0.015;
stage.add(interactionPlane);

const orbitBand = new THREE.Mesh(
  new THREE.TorusGeometry(4.6, 0.03, 16, 80),
  new THREE.MeshBasicMaterial({
    color: 0x30456c,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
orbitBand.rotation.x = Math.PI / 2;
orbitBand.position.y = 0.42;
scene.add(orbitBand);

const palettes = [
  {
    id: 'lagoon',
    label: 'Lagoon',
    ink: [0.1, 0.72, 0.95],
    edge: [0.86, 0.97, 1.0],
    bgA: [0.02, 0.08, 0.14],
    bgB: [0.0, 0.01, 0.03],
    accent: 0x58d7ff,
  },
  {
    id: 'ember',
    label: 'Ember',
    ink: [0.94, 0.42, 0.15],
    edge: [1.0, 0.87, 0.68],
    bgA: [0.11, 0.04, 0.03],
    bgB: [0.01, 0.0, 0.02],
    accent: 0xff8c4b,
  },
  {
    id: 'indigo',
    label: 'Indigo',
    ink: [0.47, 0.56, 1.0],
    edge: [0.83, 0.88, 1.0],
    bgA: [0.05, 0.04, 0.12],
    bgB: [0.01, 0.01, 0.03],
    accent: 0x7f90ff,
  },
  {
    id: 'mono',
    label: 'Mono',
    ink: [0.82, 0.87, 0.92],
    edge: [1.0, 1.0, 1.0],
    bgA: [0.08, 0.08, 0.09],
    bgB: [0.01, 0.01, 0.02],
    accent: 0xe5eef9,
  },
];

let currentPalette = palettes[0];

function syncViewMaterials() {
  const inkMode = currentView === 'ink';
  fluidUniforms.u_viewMode.value = inkMode ? 0 : 1;
  depthSurface.material.opacity = inkMode ? 0.18 + surfaceState.caustics * 0.14 : 0.08;
  causticSurface.material.opacity = inkMode ? 0.04 + surfaceState.caustics * 0.24 : 0.03;
}

function updatePaletteVisuals(palette) {
  const accent = new THREE.Color(palette.accent);
  const shadow = colorFromArray(palette.bgA).lerp(new THREE.Color(0x061018), 0.45);

  fluidUniforms.u_rimColor.value.copy(colorFromArray(palette.edge).lerp(accent, 0.22));
  fluidUniforms.u_shadowColor.value.copy(shadow);

  depthSurface.material.color.copy(accent.clone().multiplyScalar(0.35).lerp(new THREE.Color(0x08131b), 0.68));
  causticSurface.material.color.copy(accent.clone().lerp(new THREE.Color(0xffffff), 0.42));
  basinFloorMaterial.color.copy(shadow.clone().lerp(accent, 0.08));
  basinWallMaterial.color.copy(shadow.clone().lerp(accent, 0.16).lerp(new THREE.Color(0xffffff), 0.08));

  rimLight.color.copy(accent);
  accentLight.color.copy(accent.clone().lerp(new THREE.Color(0xffffff), 0.32));
  orbitBand.material.color.copy(accent.clone().multiplyScalar(0.55));
}

function handleControl(key, value) {
  if (key === 'gravity') solver.gravityY = -value;
  if (key === 'dt') solver.dt = value;
  if (key === 'jacobiIter') solver.jacobiIter = Math.round(value);
  if (key === 'brushRadius') brushRadius = value;
  if (key === 'paintForce') brushState.paintForce = value;
  if (key === 'paintAmount') brushState.paintAmount = value;
  if (key === 'bubbleForce') brushState.bubbleForce = value;
  if (key === 'bubbleCarve') brushState.bubbleCarve = value;
  if (key === 'ambientMotion') brushState.ambientMotion = value;
  if (key === 'velocityDamping') solver.velocityDamping = value;
  if (key === 'inkRetention') solver.inkRetention = value;

  if (key === 'surfaceHeight') {
    surfaceState.surfaceHeight = value;
    fluidUniforms.u_surfaceHeight.value = value;
  }
  if (key === 'surfaceRelief') {
    surfaceState.surfaceRelief = value;
    fluidUniforms.u_surfaceRelief.value = value;
  }
  if (key === 'meniscus') {
    surfaceState.meniscus = value;
    fluidUniforms.u_meniscus.value = value;
  }
  if (key === 'absorption') {
    surfaceState.absorption = value;
    fluidUniforms.u_absorption.value = value;
  }
  if (key === 'refraction') {
    surfaceState.refraction = value;
    fluidUniforms.u_refraction.value = value;
  }
  if (key === 'fresnel') {
    surfaceState.fresnel = value;
    fluidUniforms.u_fresnel.value = value;
  }
  if (key === 'specular') {
    surfaceState.specular = value;
    fluidUniforms.u_specular.value = value;
  }
  if (key === 'caustics') {
    surfaceState.caustics = value;
    fluidUniforms.u_caustics.value = value;
    syncViewMaterials();
  }
  if (key === 'exposure') renderer.toneMappingExposure = value;
  if (key === 'fogDensity') scene.fog.density = value;
}

const controlSections = {
  simulation: { section: 'Simulation', sectionOrder: 1 },
  brush: { section: 'Brush & Flow', sectionOrder: 2 },
  surface: { section: 'Surface Form', sectionOrder: 3 },
  optics: { section: 'Optical Look', sectionOrder: 4 },
};

const controls = new Controls({
  gravity: {
    ...controlSections.simulation,
    order: 1,
    label: 'Gravity',
    min: 0,
    max: 20,
    step: 0.5,
    value: 9.8,
    description: '液体を下方向へ引く強さです。大きいほど滴下や崩れが速くなり、壁際まで押し出された流れの戻りも強くなります。',
  },
  dt: {
    ...controlSections.simulation,
    order: 2,
    label: 'Time Step',
    min: 0.01,
    max: 0.35,
    step: 0.01,
    value: 0.12,
    description: '1 step ごとの進み量です。大きいほど変化は速く見えますが、値を上げすぎると表面が荒れて不安定になります。',
  },
  jacobiIter: {
    ...controlSections.simulation,
    order: 3,
    label: 'Pressure Iter',
    min: 5,
    max: 60,
    step: 1,
    value: 28,
    decimals: 0,
    description: '圧力解法の反復回数です。増やすほど体積保持と流線が安定し、少ないとにじみや圧縮感が残ります。',
  },
  velocityDamping: {
    ...controlSections.simulation,
    order: 4,
    label: 'Velocity Damping',
    min: 0.985,
    max: 1.0,
    step: 0.0005,
    value: 0.9985,
    description: '流速の減衰量です。下げると流れが早く失速し、上げると尾や巻き返しが長く残ります。',
  },
  inkRetention: {
    ...controlSections.simulation,
    order: 5,
    label: 'Ink Retention',
    min: 0.96,
    max: 1.0,
    step: 0.001,
    value: 1.0,
    description: 'インク量の保持率です。下げると薄く消えていき、上げると濃い塊や筋が長く残ります。',
  },
  brushRadius: {
    ...controlSections.brush,
    order: 1,
    label: 'Brush Radius',
    min: 10,
    max: 60,
    step: 1,
    value: 26,
    decimals: 0,
    description: 'クリックやドラッグで加える範囲です。大きいほど大きなインク塊になり、広い膜や波打つ境界が出やすくなります。',
  },
  paintForce: {
    ...controlSections.brush,
    order: 2,
    label: 'Paint Force',
    min: 0.05,
    max: 0.8,
    step: 0.01,
    value: brushState.paintForce,
    description: 'ペイント時に流れへ与える勢いです。高いほど引きずる尾が長くなり、激しい攪拌のような跡が残ります。',
  },
  paintAmount: {
    ...controlSections.brush,
    order: 3,
    label: 'Paint Amount',
    min: 0.2,
    max: 1.2,
    step: 0.01,
    value: brushState.paintAmount,
    description: 'ペイント時に加える液量です。高いほど厚いインクの塊になり、低いほど薄い膜を重ねる感触になります。',
  },
  bubbleForce: {
    ...controlSections.brush,
    order: 4,
    label: 'Bubble Force',
    min: 0.05,
    max: 0.9,
    step: 0.01,
    value: brushState.bubbleForce,
    description: '気泡をくり抜くときの押し広げる勢いです。高いほど周囲の液体を大きく押しのけ、縁に強い波が立ちます。',
  },
  bubbleCarve: {
    ...controlSections.brush,
    order: 5,
    label: 'Bubble Carve',
    min: 0.2,
    max: 1.2,
    step: 0.01,
    value: brushState.bubbleCarve,
    description: '気泡操作でどれだけ液体を削るかです。高いほどはっきり穴が空き、低いと柔らかくえぐるような見え方になります。',
  },
  ambientMotion: {
    ...controlSections.brush,
    order: 6,
    label: 'Ambient Motion',
    min: 0.0,
    max: 0.4,
    step: 0.01,
    value: brushState.ambientMotion,
    description: '操作していない間のゆるい流れの強さです。上げるほど表面に常時うねりが残り、下げると静かなトレイになります。',
  },
  surfaceHeight: {
    ...controlSections.surface,
    order: 1,
    label: 'Surface Height',
    min: 0.06,
    max: 0.28,
    step: 0.005,
    value: surfaceState.surfaceHeight,
    description: '液体を厚みとして持ち上げる量です。大きいほど膜の輪郭が立体的になり、インクが盛り上がって見えます。',
  },
  surfaceRelief: {
    ...controlSections.surface,
    order: 2,
    label: 'Surface Relief',
    min: 0.0,
    max: 0.12,
    step: 0.002,
    value: surfaceState.surfaceRelief,
    description: '表面の細かな凹凸量です。上げると反射が割れ、薄膜のうねりや粘る質感が強調されます。',
  },
  meniscus: {
    ...controlSections.surface,
    order: 3,
    label: 'Meniscus',
    min: 0.0,
    max: 0.14,
    step: 0.002,
    value: surfaceState.meniscus,
    description: '液体の縁が立ち上がる量です。上げるほど端で盛り上がり、容器内の濡れた膜らしさが増します。',
  },
  absorption: {
    ...controlSections.optics,
    order: 1,
    label: 'Absorption',
    min: 0.4,
    max: 3.2,
    step: 0.05,
    value: surfaceState.absorption,
    description: '液体内部で光を吸収する強さです。大きいほど中心が濃く暗くなり、深い色味と厚みが出ます。',
  },
  refraction: {
    ...controlSections.optics,
    order: 2,
    label: 'Refraction',
    min: 0.0,
    max: 0.45,
    step: 0.01,
    value: surfaceState.refraction,
    description: '表面越しに見える模様の歪み量です。上げると下層や反射が揺れて、液体らしい屈折感が強まります。',
  },
  fresnel: {
    ...controlSections.optics,
    order: 3,
    label: 'Fresnel',
    min: 0.0,
    max: 1.8,
    step: 0.05,
    value: surfaceState.fresnel,
    description: '視線角で反射が増える量です。上げると斜めから見た縁が明るくなり、濡れた薄膜の存在感が増します。',
  },
  specular: {
    ...controlSections.optics,
    order: 4,
    label: 'Specular',
    min: 0.2,
    max: 2.0,
    step: 0.05,
    value: surfaceState.specular,
    description: 'ハイライトの鋭さと強さです。上げると濡れたインク表面の照り返しが強くなります。',
  },
  caustics: {
    ...controlSections.optics,
    order: 5,
    label: 'Caustics',
    min: 0.0,
    max: 1.0,
    step: 0.02,
    value: surfaceState.caustics,
    description: '液体の下側に落ちる淡い光だまりの強さです。上げるとトレイ底面への色移りと厚み感が増します。',
  },
  exposure: {
    ...controlSections.optics,
    order: 6,
    label: 'Exposure',
    min: 0.7,
    max: 1.4,
    step: 0.01,
    value: renderer.toneMappingExposure,
    description: '画面全体の明るさです。上げるとハイライトや透明感が目立ち、下げると色の深さとコントラストが強まります。',
  },
  fogDensity: {
    ...controlSections.optics,
    order: 7,
    label: 'Fog Density',
    min: 0.02,
    max: 0.1,
    step: 0.001,
    value: scene.fog.density,
    description: '背景側の霞みの量です。上げるほど奥行きが強調され、下げるとトレイ全体がくっきり見えます。',
  },
}, handleControl, {
  title: 'Ink Controls',
  accent: '#9ea8ff',
  helpText: 'スライダーへカーソルを重ねると、シミュレーションと見た目にどのような影響を与えるかを日本語で表示します。',
  anchor: viewport,
});

const paletteRoot = document.getElementById('palette');
const toolToggle = document.getElementById('toolToggle');
const viewToggle = document.getElementById('viewToggle');
const resetButton = document.getElementById('resetButton');

palettes.forEach((palette) => {
  const button = document.createElement('button');
  button.className = 'swatch';
  button.title = palette.label;
  button.dataset.palette = palette.id;
  button.style.background = `rgb(${palette.ink.map((value) => Math.round(value * 255)).join(' ')})`;
  button.addEventListener('click', () => setPalette(palette.id));
  paletteRoot.appendChild(button);
});

function setPalette(id) {
  const palette = palettes.find((item) => item.id === id);
  if (!palette) return;
  currentPalette = palette;
  updatePaletteVisuals(palette);

  document.querySelectorAll('[data-palette]').forEach((button) => {
    button.classList.toggle('active', button.dataset.palette === id);
  });
}

function applyScene(name) {
  currentScene = name;

  if (name === 'sheet') solver.setSceneDamBreak();
  if (name === 'drop') solver.setSceneDroplet();
  if (name === 'bubble') solver.setSceneBubble();

  document.querySelectorAll('[data-scene]').forEach((button) => {
    button.classList.toggle('active', button.dataset.scene === name);
  });
}

function updateButtons() {
  toolToggle.textContent = `Tool: ${currentTool === 'paint' ? 'Paint' : 'Bubble'}`;
  viewToggle.textContent = `View: ${currentView === 'ink' ? 'Ink' : 'Velocity'}`;
}

function toggleTool() {
  currentTool = currentTool === 'paint' ? 'bubble' : 'paint';
  updateButtons();
}

function toggleView() {
  currentView = currentView === 'ink' ? 'velocity' : 'ink';
  syncViewMaterials();
  updateButtons();
}

setPalette('lagoon');
applyScene('sheet');
syncViewMaterials();
updateButtons();

document.querySelectorAll('[data-scene]').forEach((button) => {
  button.addEventListener('click', () => applyScene(button.dataset.scene));
});

toolToggle.addEventListener('click', toggleTool);
viewToggle.addEventListener('click', toggleView);
resetButton.addEventListener('click', () => applyScene(currentScene));

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

function sampleSurfacePoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObject(interactionPlane, false)[0];
  if (!hit) return null;

  const local = interactionPlane.worldToLocal(hit.point.clone());
  return {
    x: THREE.MathUtils.clamp((local.x / fluidSize + 0.5) * W, 0, W),
    y: THREE.MathUtils.clamp((-local.z / fluidSize + 0.5) * H, 0, H),
  };
}

const interaction = {
  mode: null,
  pointerId: null,
  previous: { x: 0, y: 0 },
  simPoint: null,
  velocity: new THREE.Vector2(),
};

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button === 2) {
    canvas.setPointerCapture(event.pointerId);
    interaction.mode = 'orbit';
    interaction.pointerId = event.pointerId;
    interaction.previous = { x: event.clientX, y: event.clientY };
    return;
  }

  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const simPoint = sampleSurfacePoint(event.clientX, event.clientY);
  if (!simPoint) return;

  canvas.setPointerCapture(event.pointerId);
  interaction.mode = 'paint';
  interaction.pointerId = event.pointerId;
  interaction.previous = { x: event.clientX, y: event.clientY };
  interaction.simPoint = simPoint;
  interaction.velocity.set(0, 0);
});

function stopInteraction(event) {
  if (interaction.pointerId !== null && event?.pointerId === interaction.pointerId && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  interaction.mode = null;
  interaction.pointerId = null;
  interaction.simPoint = null;
}

canvas.addEventListener('pointerup', stopInteraction);
canvas.addEventListener('pointercancel', stopInteraction);
canvas.addEventListener('pointerleave', () => {
  interaction.mode = null;
  interaction.pointerId = null;
  interaction.simPoint = null;
});

canvas.addEventListener('pointermove', (event) => {
  if (interaction.mode === 'orbit') {
    spherical.theta = THREE.MathUtils.clamp(
      spherical.theta - (event.clientX - interaction.previous.x) * 0.005,
      -1.15,
      1.15,
    );
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + (event.clientY - interaction.previous.y) * 0.005,
      0.55,
      1.42,
    );
    interaction.previous = { x: event.clientX, y: event.clientY };
    updateCamera();
    return;
  }

  if (interaction.mode !== 'paint') return;

  const next = sampleSurfacePoint(event.clientX, event.clientY);
  if (!next || !interaction.simPoint) return;

  interaction.velocity.set(
    (next.x - interaction.simPoint.x) * 5.6,
    (next.y - interaction.simPoint.y) * 5.6,
  );
  interaction.simPoint = next;
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  spherical.radius = THREE.MathUtils.clamp(spherical.radius + event.deltaY * 0.01, 7.2, 15.0);
  updateCamera();
}, { passive: false });

window.addEventListener('keydown', (event) => {
  if (event.key === '1') applyScene('sheet');
  if (event.key === '2') applyScene('drop');
  if (event.key === '3') applyScene('bubble');
  if (event.key === 'b' || event.key === 'B') toggleTool();
  if (event.key === 'v' || event.key === 'V') toggleView();
  if (event.key === 'r' || event.key === 'R') applyScene(currentScene);
});

simGL.disable(simGL.DEPTH_TEST);

function paint() {
  if (!interaction.simPoint) return;

  const erase = currentTool === 'bubble';
  solver.splat(interaction.simPoint.x, interaction.simPoint.y, interaction.velocity.x, interaction.velocity.y, {
    radius: brushRadius,
    velocityAmount: erase ? brushState.bubbleForce : brushState.paintForce,
    fluidAmount: erase ? brushState.bubbleCarve : brushState.paintAmount,
    erase,
  });

  interaction.velocity.multiplyScalar(0.82);
}

function addAmbientMotion() {
  if (currentScene !== 'sheet' || brushState.ambientMotion <= 0.0) return;

  const y = H * 0.58 + Math.sin(time * 0.9) * H * 0.02;
  solver.splat(W * 0.14, y, 0.65, 0.0, {
    radius: brushRadius * 1.8,
    velocityAmount: brushState.ambientMotion,
    fluidAmount: 0.0,
  });
}

function updateStageMotion() {
  stage.rotation.y = Math.sin(time * 0.18) * 0.04;
  orbitBand.rotation.z = Math.sin(time * 0.26) * 0.08;
  rimLight.position.x = Math.sin(time * 0.4) * 3.6;
  rimLight.position.z = Math.cos(time * 0.4) * 3.0;
}

const stepsPerFrame = 2;

function loop() {
  requestAnimationFrame(loop);
  time += 0.016;

  if (interaction.mode === 'paint') {
    paint();
  } else {
    addAmbientMotion();
  }

  stats.beginSim();
  for (let i = 0; i < stepsPerFrame; i++) solver.step();
  stats.endSim();

  solver.render(currentView, currentPalette, time);
  inkTexture.needsUpdate = true;
  fluidUniforms.u_time.value = time;

  updateStageMotion();
  renderer.render(scene, camera);
  stats.update();
}

window.addEventListener('resize', resizeViewport);

loop();
