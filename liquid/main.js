import * as THREE from 'three';
import { SmokeSolver } from './smoke-solver.js';
import { StatsPanel } from '../shared/utils/stats-panel.js';
import { Controls } from '../shared/ui/controls.js';

import volumeVertSrc from './shaders/volume.vert.glsl?raw';
import volumeFragSrc from './shaders/volume.frag.glsl?raw';

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

function createInputSize(size, maxDim = 720) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.2);
  const longest = Math.max(size.width, size.height);
  const scale = Math.min(1, maxDim / longest) * dpr;

  return {
    width: Math.max(360, Math.round(size.width * scale)),
    height: Math.max(360, Math.round(size.height * scale)),
  };
}

function createGridSize(width, height) {
  const aspect = width / Math.max(height, 1);
  const gridWidth = Math.round(THREE.MathUtils.clamp(28 + (aspect - 0.8) * 8, 28, 36));
  const gridHeight = Math.round(THREE.MathUtils.clamp(gridWidth * 1.55, 42, 58));
  const gridDepth = Math.round(THREE.MathUtils.clamp(gridWidth * 0.8, 20, 30));
  return { gridWidth, gridHeight, gridDepth };
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
if (!renderer.capabilities.isWebGL2) {
  throw new Error('WebGL2 is required for the smoke demo.');
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
const initialViewportSize = getViewportSize();
renderer.setSize(initialViewportSize.width, initialViewportSize.height, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const inputSize = createInputSize(initialViewportSize);
const gridSize = createGridSize(inputSize.width, inputSize.height);
const solver = new SmokeSolver({
  inputWidth: inputSize.width,
  inputHeight: inputSize.height,
  ...gridSize,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.062);

const camera = new THREE.PerspectiveCamera(50, initialViewportSize.width / initialViewportSize.height, 0.1, 100);
const cameraTarget = new THREE.Vector3(0, 4.2, 0);
const spherical = { theta: 0.48, phi: 1.02, radius: 12.2 };

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

updateCamera();

const stats = new StatsPanel();
const lookName = document.getElementById('lookName');
const clock = new THREE.Clock();

scene.add(new THREE.HemisphereLight(0x7f8fb4, 0x16120d, 1.45));

const rimLight = new THREE.DirectionalLight(0xa8c4ff, 1.45);
rimLight.position.set(-5.5, 9.0, 5.5);
scene.add(rimLight);

const fillLight = new THREE.DirectionalLight(0x4d5d7d, 0.45);
fillLight.position.set(4.5, 3.0, -2.0);
scene.add(fillLight);

const emitterLight = new THREE.PointLight(0xff8b47, 3.5, 16, 2);
emitterLight.position.set(0, 1.2, 0);
scene.add(emitterLight);

const emitterBaseSimY = inputSize.height * 0.08;

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x101117,
  roughness: 0.94,
  metalness: 0.05,
});

const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 64), floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01;
scene.add(floor);

const floorGlow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48),
  new THREE.MeshBasicMaterial({
    color: 0xff7b2d,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
floorGlow.rotation.x = -Math.PI / 2;
floorGlow.position.y = 0.005;
scene.add(floorGlow);

const ringMaterial = new THREE.MeshStandardMaterial({
  color: 0x342015,
  roughness: 0.7,
  metalness: 0.2,
  emissive: 0x1d0903,
  emissiveIntensity: 0.8,
});

const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.12, 18, 64), ringMaterial);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.08;
scene.add(ring);

const coreMaterial = new THREE.MeshStandardMaterial({
  color: 0x231711,
  roughness: 0.64,
  metalness: 0.18,
  emissive: 0x090402,
  emissiveIntensity: 0.35,
});

const core = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.52, 24), coreMaterial);
core.position.y = 0.25;
scene.add(core);

const plumeRig = new THREE.Group();
scene.add(plumeRig);

const plumeWidth = 6.2;
const plumeHeight = 10.0;
const baseVolumeDepth = 1.0;
const volumeBoundsMin = new THREE.Vector3(-plumeWidth * 0.5, 0, -baseVolumeDepth * 0.5);
const volumeBoundsMax = new THREE.Vector3(plumeWidth * 0.5, plumeHeight, baseVolumeDepth * 0.5);

const plumeUniforms = {
  u_volumeTex: { value: solver.volumeTexture },
  u_boundsMin: { value: volumeBoundsMin.clone() },
  u_boundsMax: { value: volumeBoundsMax.clone() },
  u_cameraPosLocal: { value: new THREE.Vector3() },
  u_lightDirLocal: { value: new THREE.Vector3(-0.42, 0.84, 0.33).normalize() },
  u_time: { value: 0 },
  u_densityGain: { value: 1.12 },
  u_shadowStrength: { value: 1.08 },
  u_warpAmount: { value: 0.09 },
  u_emissionGain: { value: 1.18 },
  u_mode: { value: 1 },
  u_fireBaseColor: { value: new THREE.Color(0x3958ff) },
  u_fireLowColor: { value: new THREE.Color(0x140401) },
  u_fireMidColor: { value: new THREE.Color(0xff6a12) },
  u_fireHighColor: { value: new THREE.Color(0xffefd1) },
  u_sootColor: { value: new THREE.Color(0x241611) },
  u_smokeLightColor: { value: new THREE.Color(0xe1e6ee) },
  u_smokeDarkColor: { value: new THREE.Color(0x1c2028) },
  u_smokeWarmColor: { value: new THREE.Color(0xc26b2f) },
};

const plumeVolume = new THREE.Mesh(
  (() => {
    const geometry = new THREE.BoxGeometry(plumeWidth, plumeHeight, baseVolumeDepth, 1, 1, 1);
    geometry.translate(0, plumeHeight * 0.5, 0);
    return geometry;
  })(),
  new THREE.ShaderMaterial({
    uniforms: plumeUniforms,
    vertexShader: volumeVertSrc,
    fragmentShader: volumeFragSrc,
    glslVersion: THREE.GLSL3,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  }),
);
plumeVolume.position.y = 0.04;
plumeVolume.scale.z = 4.4;
plumeVolume.renderOrder = 3;
plumeRig.add(plumeVolume);

const emitterDiskExtents = {
  x: plumeWidth * 0.5,
  z: plumeVolume.scale.z * 0.5,
};

function updateEmitterDiskScale(pulse = 1) {
  floorGlow.scale.set(
    emitterDiskExtents.x * pulse,
    emitterDiskExtents.z * pulse,
    1,
  );
}

updateEmitterDiskScale();

const interactionPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(plumeWidth, plumeHeight),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
interactionPlane.position.set(0, plumeHeight * 0.5, 0);
plumeRig.add(interactionPlane);

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecC = new THREE.Vector3(0, plumeHeight * 0.5, 0);
const tempVecD = new THREE.Vector3();
const tempVecE = new THREE.Vector3();
const tempVecF = new THREE.Vector3();
const inverseVolumeMatrix = new THREE.Matrix4();

function ndcFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function intersectLocalBox(rayOrigin, rayDirection, min, max) {
  const invX = 1 / rayDirection.x;
  const invY = 1 / rayDirection.y;
  const invZ = 1 / rayDirection.z;

  const tx0 = (min.x - rayOrigin.x) * invX;
  const tx1 = (max.x - rayOrigin.x) * invX;
  const ty0 = (min.y - rayOrigin.y) * invY;
  const ty1 = (max.y - rayOrigin.y) * invY;
  const tz0 = (min.z - rayOrigin.z) * invZ;
  const tz1 = (max.z - rayOrigin.z) * invZ;

  const tNear = Math.max(
    Math.min(tx0, tx1),
    Math.min(ty0, ty1),
    Math.min(tz0, tz1),
  );
  const tFar = Math.min(
    Math.max(tx0, tx1),
    Math.max(ty0, ty1),
    Math.max(tz0, tz1),
  );

  if (!Number.isFinite(tNear) || !Number.isFinite(tFar) || tFar < Math.max(tNear, 0)) {
    return null;
  }

  return { tNear: Math.max(tNear, 0), tFar };
}

function sampleEmitterPoint(clientX, clientY) {
  ndcFromClient(clientX, clientY);
  raycaster.setFromCamera(pointerNdc, camera);
  plumeRig.updateMatrixWorld(true);

  const diskHit = raycaster.intersectObject(floorGlow, false)[0];
  if (diskHit) {
    const localDisk = plumeRig.worldToLocal(diskHit.point.clone());
    const uvx = THREE.MathUtils.clamp(localDisk.x / (emitterDiskExtents.x * 2) + 0.5, 0, 1);
    const uvz = THREE.MathUtils.clamp(localDisk.z / (emitterDiskExtents.z * 2) + 0.5, 0, 1);
    return {
      x: uvx * inputSize.width,
      y: emitterBaseSimY,
      depth: uvz,
    };
  }

  plumeVolume.updateMatrixWorld(true);
  inverseVolumeMatrix.copy(plumeVolume.matrixWorld).invert();
  tempVecD.copy(raycaster.ray.origin).applyMatrix4(inverseVolumeMatrix);
  tempVecE.copy(raycaster.ray.origin).add(raycaster.ray.direction).applyMatrix4(inverseVolumeMatrix);
  tempVecF.copy(tempVecE).sub(tempVecD).normalize();

  const hit = intersectLocalBox(tempVecD, tempVecF, volumeBoundsMin, volumeBoundsMax);
  if (!hit) return null;

  const local = tempVecA.copy(tempVecD).addScaledVector(tempVecF, hit.tNear);
  const uvx = (local.x - volumeBoundsMin.x) / (volumeBoundsMax.x - volumeBoundsMin.x);
  const uvy = (local.y - volumeBoundsMin.y) / (volumeBoundsMax.y - volumeBoundsMin.y);
  const uvz = (local.z - volumeBoundsMin.z) / (volumeBoundsMax.z - volumeBoundsMin.z);
  const x = THREE.MathUtils.clamp(uvx * inputSize.width, 0, inputSize.width);
  const y = THREE.MathUtils.clamp(uvy * inputSize.height, 0, inputSize.height);
  const depth = THREE.MathUtils.clamp(uvz, 0, 1);
  return { x, y, depth };
}

const emitter = {
  radius: 28,
  force: 3.2,
  velocityAmount: 0.38,
  densityAmount: 0.95,
  temperatureAmount: 1.35,
  autoWander: 0.06,
};

let mode = 'fire';
let autoTime = 0;
let activeLookKey = 'campfire';

function handleControl(key, value) {
  if (key === 'buoyancy') solver.buoyancy = value;
  if (key === 'vorticity') solver.vortConfinement = value;
  if (key === 'dissipation') {
    solver.dissipation = value;
    solver.tempDissipation = Math.max(0.88, value - 0.018 * solver.cooling);
  }
  if (key === 'jacobiIter') solver.jacobiIter = Math.round(value);
  if (key === 'lateralSpread') solver.lateralSpread = value;
  if (key === 'verticalLift') solver.verticalLift = value;
  if (key === 'cooling') {
    solver.cooling = value;
    solver.tempDissipation = Math.max(0.88, solver.dissipation - 0.018 * value);
  }
  if (key === 'emitterRadius') emitter.radius = value;
  if (key === 'emitterForce') emitter.force = value;
  if (key === 'velocityAmount') emitter.velocityAmount = value;
  if (key === 'densityAmount') emitter.densityAmount = value;
  if (key === 'temperatureAmount') emitter.temperatureAmount = value;
  if (key === 'autoWander') emitter.autoWander = value;
  if (key === 'volumeDepth') {
    plumeVolume.scale.z = value;
    emitterDiskExtents.z = value * 0.5;
    updateEmitterDiskScale();
  }
  if (key === 'densityGain') plumeUniforms.u_densityGain.value = value;
  if (key === 'shadowing') plumeUniforms.u_shadowStrength.value = value;
  if (key === 'warpAmount') plumeUniforms.u_warpAmount.value = value;
  if (key === 'emissionGain') plumeUniforms.u_emissionGain.value = value;
  if (key === 'exposure') renderer.toneMappingExposure = value;
  if (key === 'fogDensity') scene.fog.density = value;
}

const controlSections = {
  simulation: { section: 'Simulation', sectionOrder: 1 },
  emitter: { section: 'Emitter', sectionOrder: 2 },
  volume: { section: 'Volume Look', sectionOrder: 3 },
  atmosphere: { section: 'Atmosphere', sectionOrder: 4 },
};

const controls = new Controls({
  buoyancy: {
    ...controlSections.simulation,
    order: 1,
    label: 'Buoyancy',
    min: 0,
    max: 5,
    step: 0.1,
    value: 1.8,
    description: '3D グリッド内で温度を上向き速度へ変換する強さです。大きいほど煙柱が高く伸び、立ち上がりが速くなります。',
  },
  vorticity: {
    ...controlSections.simulation,
    order: 2,
    label: 'Vorticity',
    min: 0,
    max: 30,
    step: 0.5,
    value: 16,
    description: 'ボクセル間の横渦と巻き込み量です。値を上げると奥行き方向にもねじれが出て、立体的な乱流になります。',
  },
  dissipation: {
    ...controlSections.simulation,
    order: 3,
    label: 'Dissipation',
    min: 0.95,
    max: 1.0,
    step: 0.001,
    value: 0.992,
    description: '密度と熱が 3D グリッド内でどれだけ残るかを制御します。高いほど煙が長く残り、低いほど薄く消えます。',
  },
  jacobiIter: {
    ...controlSections.simulation,
    order: 4,
    label: 'Velocity Smooth',
    min: 5,
    max: 40,
    step: 1,
    value: 20,
    decimals: 0,
    description: '速度場の平滑化量です。上げると流れが滑らかに繋がり、低いと荒く切れた乱れが出ます。',
  },
  lateralSpread: {
    ...controlSections.simulation,
    order: 5,
    label: 'Lateral Spread',
    min: 0.35,
    max: 1.8,
    step: 0.01,
    value: solver.lateralSpread,
    description: '煙や炎が左右へ広がる強さです。大きいほど横に膨らみ、低いほど細い柱のまま立ち上がります。',
  },
  verticalLift: {
    ...controlSections.simulation,
    order: 6,
    label: 'Vertical Lift',
    min: 0.45,
    max: 1.7,
    step: 0.01,
    value: solver.verticalLift,
    description: '上昇方向の持ち上がりです。高いほど立ち上がりが速くなり、低いほど横へ流れやすくなります。',
  },
  cooling: {
    ...controlSections.simulation,
    order: 7,
    label: 'Cooling',
    min: 0.6,
    max: 1.4,
    step: 0.01,
    value: solver.cooling,
    description: '熱が失われる速さです。大きいほど火は早く冷えて煙へ移り、小さいほど高温の芯が長く残ります。',
  },
  emitterRadius: {
    ...controlSections.emitter,
    order: 1,
    label: 'Emitter Radius',
    min: 10,
    max: 56,
    step: 1,
    value: emitter.radius,
    decimals: 0,
    description: '3D グリッドへ注入する範囲です。大きいほど太い煙柱や広い炎になり、小さいほど集中した噴出になります。',
  },
  emitterForce: {
    ...controlSections.emitter,
    order: 2,
    label: 'Emitter Force',
    min: 0.5,
    max: 6.5,
    step: 0.1,
    value: emitter.force,
    description: '噴出時に与える初速です。高いほど密度グリッド内で押し上げが強くなり、ジェット感が増します。',
  },
  velocityAmount: {
    ...controlSections.emitter,
    order: 3,
    label: 'Emitter Velocity',
    min: 0.1,
    max: 0.9,
    step: 0.01,
    value: emitter.velocityAmount,
    description: '注入した瞬間に与える流速の量です。上げるほど押し出しが強くなり、勢いのある炎や煙になります。',
  },
  densityAmount: {
    ...controlSections.emitter,
    order: 4,
    label: 'Emitter Density',
    min: 0.2,
    max: 1.6,
    step: 0.01,
    value: emitter.densityAmount,
    description: '1 回の噴出で加える密度の量です。高いほど煙の塊が濃くなり、ボリュームの芯が太く見えます。',
  },
  temperatureAmount: {
    ...controlSections.emitter,
    order: 5,
    label: 'Emitter Heat',
    min: 0.0,
    max: 1.8,
    step: 0.01,
    value: emitter.temperatureAmount,
    description: '噴出に含める熱量です。高いほど燃焼色が明るくなり、上昇も強くなります。低いと霧や煙に寄ります。',
  },
  autoWander: {
    ...controlSections.emitter,
    order: 6,
    label: 'Auto Wander',
    min: 0.0,
    max: 0.22,
    step: 0.005,
    value: emitter.autoWander,
    description: '自動噴出時の発生位置の揺れ幅です。上げるほど火元やミストが左右にうねり、低いと真上へ安定して立ちます。',
  },
  volumeDepth: {
    ...controlSections.volume,
    order: 1,
    label: 'Volume Depth',
    min: 2.4,
    max: 6.8,
    step: 0.1,
    value: 4.4,
    description: '3D ボリューム描画の奥行きです。大きいほど横から見たときの厚みが増え、ボクセルの立体感が強く見えます。',
  },
  densityGain: {
    ...controlSections.volume,
    order: 2,
    label: 'Density Gain',
    min: 0.55,
    max: 1.9,
    step: 0.01,
    value: 1.12,
    description: '密度グリッドの見た目の濃さです。高いほど煙は重く、炎は芯の詰まったボリュームになります。',
  },
  shadowing: {
    ...controlSections.volume,
    order: 3,
    label: 'Self Shadow',
    min: 0.0,
    max: 2.0,
    step: 0.05,
    value: 1.08,
    description: 'ボリューム内部の自己陰影です。高いほど奥が暗くなり、内部の厚みや層構造が分かりやすくなります。',
  },
  warpAmount: {
    ...controlSections.volume,
    order: 4,
    label: 'Depth Warp',
    min: 0.0,
    max: 0.18,
    step: 0.005,
    value: 0.09,
    description: '3D テクスチャ参照時の微小な歪み量です。上げると密度グリッドの格子感が減り、より自然な揺らぎになります。',
  },
  emissionGain: {
    ...controlSections.volume,
    order: 5,
    label: 'Emission',
    min: 0.5,
    max: 1.8,
    step: 0.01,
    value: 1.18,
    description: '体積発光の強さです。炎では輝度、煙では散乱の明るさに効き、熱量の印象を調整します。',
  },
  exposure: {
    ...controlSections.atmosphere,
    order: 1,
    label: 'Exposure',
    min: 0.7,
    max: 1.4,
    step: 0.01,
    value: renderer.toneMappingExposure,
    description: '画面全体の露出です。上げるほど火の明るさや霧の白さが強まり、下げると締まった暗部が残ります。',
  },
  fogDensity: {
    ...controlSections.atmosphere,
    order: 2,
    label: 'Fog Density',
    min: 0.02,
    max: 0.12,
    step: 0.001,
    value: scene.fog.density,
    description: '背景側に溜まる空気の霞みです。上げるほど奥が沈んで立体感が出て、下げると全体がクリアに見えます。',
  },
}, handleControl, {
  title: 'Volume Controls',
  accent: '#ffb56a',
  anchor: viewport,
});

const looks = {
  campfire: {
    label: 'Campfire',
    mode: 'fire',
    buoyancy: 1.8,
    vorticity: 16,
    dissipation: 0.992,
    jacobiIter: 20,
    emitterRadius: 28,
    emitterForce: 3.2,
    velocityAmount: 0.38,
    densityAmount: 0.95,
    temperatureAmount: 1.35,
    autoWander: 0.06,
    volumeDepth: 4.4,
    densityGain: 1.12,
    shadowing: 1.08,
    warpAmount: 0.09,
    emissionGain: 1.18,
    light: 0xff8b47,
    intensity: 3.5,
    exposure: 1.08,
    background: 0x05070d,
    fogDensity: 0.062,
    floorColor: 0x101117,
    glowColor: 0xff7b2d,
    glowOpacity: 0.17,
    ringColor: 0x342015,
    ringEmissive: 0x1d0903,
    ringEmissiveIntensity: 0.8,
    coreColor: 0x231711,
    coreEmissive: 0x120501,
    coreEmissiveIntensity: 0.35,
    fireBaseColor: 0x3a66ff,
    fireLowColor: 0x220401,
    fireMidColor: 0xff6518,
    fireHighColor: 0xfff2d1,
    sootColor: 0x2a1c16,
    smokeLightColor: 0xd8d2ca,
    smokeDarkColor: 0x211917,
    smokeWarmColor: 0xa76034,
    lateralSpread: 0.96,
    radialPull: 0.018,
    verticalLift: 1.06,
    cooling: 1.02,
    edgeLoss: 0.93,
    topLoss: 0.84,
    densityDiffusion: 0.036,
    temperatureDiffusion: 0.024,
  },
  mist: {
    label: 'Mist',
    mode: 'smoke',
    buoyancy: 1.0,
    vorticity: 24,
    dissipation: 0.997,
    jacobiIter: 24,
    emitterRadius: 42,
    emitterForce: 2.0,
    velocityAmount: 0.22,
    densityAmount: 0.72,
    temperatureAmount: 0.12,
    autoWander: 0.14,
    volumeDepth: 5.8,
    densityGain: 0.84,
    shadowing: 1.52,
    warpAmount: 0.12,
    emissionGain: 0.74,
    light: 0x7bb7ff,
    intensity: 1.15,
    exposure: 1.0,
    background: 0x060810,
    fogDensity: 0.075,
    floorColor: 0x12151d,
    glowColor: 0x83baff,
    glowOpacity: 0.06,
    ringColor: 0x2a313e,
    ringEmissive: 0x081018,
    ringEmissiveIntensity: 0.25,
    coreColor: 0x202833,
    coreEmissive: 0x0a131f,
    coreEmissiveIntensity: 0.12,
    fireBaseColor: 0x88b6ff,
    fireLowColor: 0x09111d,
    fireMidColor: 0x98c4ff,
    fireHighColor: 0xfbfdff,
    sootColor: 0x182130,
    smokeLightColor: 0xf5f8ff,
    smokeDarkColor: 0x6a7480,
    smokeWarmColor: 0xc8dcf6,
    lateralSpread: 1.46,
    radialPull: -0.007,
    verticalLift: 0.84,
    cooling: 1.18,
    edgeLoss: 0.968,
    topLoss: 0.91,
    densityDiffusion: 0.082,
    temperatureDiffusion: 0.052,
  },
  thruster: {
    label: 'Thruster',
    mode: 'fire',
    buoyancy: 0.55,
    vorticity: 9,
    dissipation: 0.989,
    jacobiIter: 18,
    emitterRadius: 18,
    emitterForce: 5.4,
    velocityAmount: 0.58,
    densityAmount: 1.18,
    temperatureAmount: 1.5,
    autoWander: 0.03,
    volumeDepth: 3.2,
    densityGain: 1.42,
    shadowing: 0.64,
    warpAmount: 0.045,
    emissionGain: 1.34,
    light: 0x66d6ff,
    intensity: 4.5,
    exposure: 1.16,
    background: 0x04070f,
    fogDensity: 0.052,
    floorColor: 0x0c1019,
    glowColor: 0x5ad0ff,
    glowOpacity: 0.15,
    ringColor: 0x243746,
    ringEmissive: 0x0a2030,
    ringEmissiveIntensity: 0.72,
    coreColor: 0x182736,
    coreEmissive: 0x0d2437,
    coreEmissiveIntensity: 0.42,
    fireBaseColor: 0x2f6cff,
    fireLowColor: 0x040b18,
    fireMidColor: 0x27c1ff,
    fireHighColor: 0xf4fcff,
    sootColor: 0x0d1b2d,
    smokeLightColor: 0xd2ecff,
    smokeDarkColor: 0x15283b,
    smokeWarmColor: 0x63c1ff,
    lateralSpread: 0.62,
    radialPull: 0.028,
    verticalLift: 1.22,
    cooling: 0.88,
    edgeLoss: 0.89,
    topLoss: 0.79,
    densityDiffusion: 0.026,
    temperatureDiffusion: 0.018,
  },
};

function updateLookVisuals(look) {
  mode = look.mode;
  plumeUniforms.u_mode.value = look.mode === 'fire' ? 1 : 0;

  emitterLight.color.setHex(look.light);
  emitterLight.intensity = look.intensity;
  renderer.toneMappingExposure = look.exposure;

  scene.background.setHex(look.background);
  scene.fog.color.setHex(look.background);
  scene.fog.density = look.fogDensity;

  floorMaterial.color.setHex(look.floorColor);

  floorGlow.material.color.setHex(look.glowColor);
  floorGlow.material.opacity = look.glowOpacity;

  ringMaterial.color.setHex(look.ringColor);
  ringMaterial.emissive.setHex(look.ringEmissive);
  ringMaterial.emissiveIntensity = look.ringEmissiveIntensity;

  coreMaterial.color.setHex(look.coreColor);
  coreMaterial.emissive.setHex(look.coreEmissive);
  coreMaterial.emissiveIntensity = look.coreEmissiveIntensity;

  plumeUniforms.u_fireBaseColor.value.setHex(look.fireBaseColor);
  plumeUniforms.u_fireLowColor.value.setHex(look.fireLowColor);
  plumeUniforms.u_fireMidColor.value.setHex(look.fireMidColor);
  plumeUniforms.u_fireHighColor.value.setHex(look.fireHighColor);
  plumeUniforms.u_sootColor.value.setHex(look.sootColor);
  plumeUniforms.u_smokeLightColor.value.setHex(look.smokeLightColor);
  plumeUniforms.u_smokeDarkColor.value.setHex(look.smokeDarkColor);
  plumeUniforms.u_smokeWarmColor.value.setHex(look.smokeWarmColor);

  solver.configure({
    lateralSpread: look.lateralSpread,
    radialPull: look.radialPull,
    verticalLift: look.verticalLift,
    cooling: look.cooling,
    edgeLoss: look.edgeLoss,
    topLoss: look.topLoss,
    densityDiffusion: look.densityDiffusion,
    temperatureDiffusion: look.temperatureDiffusion,
    tempDissipation: Math.max(0.88, look.dissipation - 0.018 * look.cooling),
  });
}

function applyLook(name) {
  const look = looks[name];
  if (!look) return;

  activeLookKey = name;
  lookName.textContent = look.label;

  controls.setValue('buoyancy', look.buoyancy, true);
  controls.setValue('vorticity', look.vorticity, true);
  controls.setValue('dissipation', look.dissipation, true);
  controls.setValue('jacobiIter', look.jacobiIter, true);
  controls.setValue('lateralSpread', look.lateralSpread, true);
  controls.setValue('verticalLift', look.verticalLift, true);
  controls.setValue('cooling', look.cooling, true);
  controls.setValue('emitterRadius', look.emitterRadius, true);
  controls.setValue('emitterForce', look.emitterForce, true);
  controls.setValue('velocityAmount', look.velocityAmount, true);
  controls.setValue('densityAmount', look.densityAmount, true);
  controls.setValue('temperatureAmount', look.temperatureAmount, true);
  controls.setValue('autoWander', look.autoWander, true);
  controls.setValue('volumeDepth', look.volumeDepth, true);
  controls.setValue('densityGain', look.densityGain, true);
  controls.setValue('shadowing', look.shadowing, true);
  controls.setValue('warpAmount', look.warpAmount, true);
  controls.setValue('emissionGain', look.emissionGain, true);
  controls.setValue('exposure', look.exposure, true);
  controls.setValue('fogDensity', look.fogDensity, true);

  emitter.velocityAmount = look.velocityAmount;
  emitter.densityAmount = look.densityAmount;
  emitter.temperatureAmount = look.temperatureAmount;
  emitter.autoWander = look.autoWander;

  solver.reset();
  updateLookVisuals(look);

  document.querySelectorAll('[data-look]').forEach((button) => {
    button.classList.toggle('active', button.dataset.look === name);
  });
}

applyLook(activeLookKey);

const interaction = {
  mode: null,
  previous: { x: 0, y: 0 },
  simPoint: null,
  velocity: new THREE.Vector2(),
  pointerId: null,
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

  const simPoint = sampleEmitterPoint(event.clientX, event.clientY);
  if (!simPoint) return;

  canvas.setPointerCapture(event.pointerId);
  interaction.mode = 'emit';
  interaction.pointerId = event.pointerId;
  interaction.simPoint = simPoint;
  interaction.velocity.set(0, emitter.force);
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

canvas.addEventListener('pointermove', (event) => {
  if (interaction.mode === 'orbit') {
    spherical.theta = THREE.MathUtils.clamp(
      spherical.theta - (event.clientX - interaction.previous.x) * 0.005,
      -1.2,
      1.2,
    );
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi + (event.clientY - interaction.previous.y) * 0.005,
      0.54,
      1.44,
    );
    interaction.previous = { x: event.clientX, y: event.clientY };
    updateCamera();
    return;
  }

  if (interaction.mode !== 'emit') return;

  const next = sampleEmitterPoint(event.clientX, event.clientY);
  if (!next || !interaction.simPoint) return;

  interaction.velocity.set(
    (next.x - interaction.simPoint.x) * 5.6,
    (next.y - interaction.simPoint.y) * 5.6 + emitter.force,
  );
  interaction.simPoint = next;
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  spherical.radius = THREE.MathUtils.clamp(spherical.radius + event.deltaY * 0.01, 8, 18);
  updateCamera();
}, { passive: false });

document.querySelectorAll('[data-look]').forEach((button) => {
  button.addEventListener('click', () => applyLook(button.dataset.look));
});

window.addEventListener('keydown', (event) => {
  if (event.key === '1') applyLook('campfire');
  if (event.key === '2') applyLook('mist');
  if (event.key === '3') applyLook('thruster');
  if (event.key === 'r' || event.key === 'R') solver.reset();
});

window.addEventListener('resize', resizeViewport);

function emit(x, y, depth, vx, vy) {
  solver.splat(x, y, vx, vy, mode, {
    radius: emitter.radius,
    velocityAmount: emitter.velocityAmount,
    densityAmount: emitter.densityAmount,
    temperatureAmount: emitter.temperatureAmount,
    depth,
  });
}

function updateSceneMotion(time) {
  const swayX = Math.sin(time * 0.52) * 0.11;
  const swayZ = Math.cos(time * 0.41) * 0.08;
  plumeRig.position.x = swayX;
  plumeRig.position.z = swayZ;
  plumeRig.rotation.y = Math.sin(time * 0.16) * 0.1;

  const look = looks[activeLookKey];
  const flickerBase = look.intensity;
  const flicker =
    mode === 'fire'
      ? 0.88 + Math.sin(time * 20.0) * 0.08 + Math.sin(time * 33.0) * 0.05
      : 0.96 + Math.sin(time * 4.0) * 0.03;
  emitterLight.intensity = flickerBase * flicker;

  ring.rotation.z = Math.sin(time * 0.55) * 0.04;
  updateEmitterDiskScale(1 + Math.sin(time * 2.2) * 0.03);
}

function updateVolumeUniforms(time) {
  plumeRig.updateMatrixWorld(true);
  plumeUniforms.u_time.value = time;
  plumeUniforms.u_cameraPosLocal.value.copy(plumeVolume.worldToLocal(tempVecA.copy(camera.position)));
  tempVecB.copy(rimLight.position);
  plumeUniforms.u_lightDirLocal.value
    .copy(plumeVolume.worldToLocal(tempVecB).sub(tempVecC))
    .normalize();
}

function loop() {
  requestAnimationFrame(loop);

  const delta = Math.min(clock.getDelta(), 1 / 24);
  autoTime += delta;

  if (interaction.mode === 'emit' && interaction.simPoint) {
    emit(interaction.simPoint.x, interaction.simPoint.y, interaction.simPoint.depth, interaction.velocity.x, interaction.velocity.y);
    interaction.velocity.x *= 0.84;
    interaction.velocity.y = interaction.velocity.y * 0.66 + emitter.force * 0.34;
  } else {
    const cx = inputSize.width * 0.5 + Math.sin(autoTime * 1.1) * inputSize.width * emitter.autoWander;
    const cy = inputSize.height * 0.08;
    const vx = Math.sin(autoTime * 1.8) * emitter.force * 0.55;
    emit(cx, cy, 0.5, vx, emitter.force);
  }

  stats.beginSim();
  solver.step(autoTime, delta);
  stats.endSim();

  updateSceneMotion(autoTime);
  updateVolumeUniforms(autoTime);

  renderer.render(scene, camera);
  stats.update();
}

loop();
