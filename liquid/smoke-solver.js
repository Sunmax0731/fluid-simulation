import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class SmokeSolver {
  constructor(options = {}) {
    this.inputWidth = options.inputWidth ?? 512;
    this.inputHeight = options.inputHeight ?? 512;

    this.W = options.gridWidth ?? 30;
    this.H = options.gridHeight ?? 48;
    this.D = options.gridDepth ?? 24;
    this.count = this.W * this.H * this.D;

    this.dt = 1 / 60;
    this.advection = 0.72;
    this.jacobiIter = 20;
    this.buoyancy = 1.5;
    this.weight = 0.05;
    this.vortConfinement = 15.0;
    this.dissipation = 0.994;
    this.tempDissipation = 0.97;
    this.velocityDamping = 0.986;
    this.baseRise = 0.06;
    this.lateralSpread = 1.0;
    this.radialPull = 0.014;
    this.verticalLift = 1.0;
    this.cooling = 1.0;
    this.edgeLoss = 0.92;
    this.topLoss = 0.82;
    this.densityDiffusion = 0.04;
    this.temperatureDiffusion = 0.03;

    this.density = new Float32Array(this.count);
    this.densityNext = new Float32Array(this.count);
    this.temperature = new Float32Array(this.count);
    this.temperatureNext = new Float32Array(this.count);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);
    this.velZ = new Float32Array(this.count);
    this.velXNext = new Float32Array(this.count);
    this.velYNext = new Float32Array(this.count);
    this.velZNext = new Float32Array(this.count);

    this.volumeData = new Uint8Array(this.count * 4);
    this.volumeTexture = new THREE.Data3DTexture(this.volumeData, this.W, this.H, this.D);
    this.volumeTexture.format = THREE.RGBAFormat;
    this.volumeTexture.type = THREE.UnsignedByteType;
    this.volumeTexture.minFilter = THREE.LinearFilter;
    this.volumeTexture.magFilter = THREE.LinearFilter;
    this.volumeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.volumeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.volumeTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.volumeTexture.unpackAlignment = 1;
    this.volumeTexture.needsUpdate = true;

    this.reset();
  }

  configure(params = {}) {
    const keys = [
      'buoyancy',
      'vortConfinement',
      'dissipation',
      'tempDissipation',
      'jacobiIter',
      'lateralSpread',
      'radialPull',
      'verticalLift',
      'cooling',
      'edgeLoss',
      'topLoss',
      'densityDiffusion',
      'temperatureDiffusion',
    ];

    keys.forEach((key) => {
      if (params[key] !== undefined) this[key] = params[key];
    });
  }

  reset() {
    this.density.fill(0);
    this.densityNext.fill(0);
    this.temperature.fill(0);
    this.temperatureNext.fill(0);
    this.velX.fill(0);
    this.velY.fill(0);
    this.velZ.fill(0);
    this.velXNext.fill(0);
    this.velYNext.fill(0);
    this.velZNext.fill(0);
    this.volumeData.fill(0);
    this.volumeTexture.needsUpdate = true;
  }

  splat(x, y, vx, vy, mode, options = {}) {
    const gx = clamp((x / this.inputWidth) * (this.W - 1), 0, this.W - 1);
    const gy = clamp((y / this.inputHeight) * (this.H - 1), 0, this.H - 1);
    const gz = clamp((options.depth ?? 0.5) * (this.D - 1), 0, this.D - 1);

    const radius = options.radius ?? 24;
    const velocityAmount = options.velocityAmount ?? 0.35;
    const densityAmount = options.densityAmount ?? (mode === 'fire' ? 0.95 : 0.72);
    const temperatureAmount = options.temperatureAmount ?? (mode === 'fire' ? 1.25 : 0.18);

    const radiusX = Math.max(1.8, (radius / this.inputWidth) * this.W * 1.8);
    const radiusY = Math.max(2.2, (radius / this.inputHeight) * this.H * 2.4);
    const radiusZ = Math.max(1.4, radiusX * 0.7);

    const velScaleX = (vx / this.inputWidth) * this.W * 0.44 * velocityAmount;
    const velScaleY = (vy / this.inputHeight) * this.H * 0.52 * velocityAmount;
    const velScaleZ = velScaleX * 0.28;
    const fireBias = mode === 'fire' ? 1.0 : 0.38;

    const x0 = Math.max(0, Math.floor(gx - radiusX * 1.5));
    const x1 = Math.min(this.W - 1, Math.ceil(gx + radiusX * 1.5));
    const y0 = Math.max(0, Math.floor(gy - radiusY * 1.35));
    const y1 = Math.min(this.H - 1, Math.ceil(gy + radiusY * 1.35));
    const z0 = Math.max(0, Math.floor(gz - radiusZ * 1.5));
    const z1 = Math.min(this.D - 1, Math.ceil(gz + radiusZ * 1.5));

    for (let z = z0; z <= z1; z++) {
      const dz = (z - gz) / radiusZ;
      const dz2 = dz * dz;
      for (let yIndex = y0; yIndex <= y1; yIndex++) {
        const dy = (yIndex - gy) / radiusY;
        const dy2 = dy * dy;
        for (let xIndex = x0; xIndex <= x1; xIndex++) {
          const dx = (xIndex - gx) / radiusX;
          const dist2 = dx * dx + dy2 + dz2;
          if (dist2 > 1.0) continue;

          const falloff = Math.exp(-dist2 * 2.6);
          const idx = this._index(xIndex, yIndex, z);
          const swirl = dx * 0.45 - dz * 0.4;

          this.density[idx] = Math.min(1.45, this.density[idx] + densityAmount * falloff);
          this.temperature[idx] = Math.min(1.55, this.temperature[idx] + temperatureAmount * falloff);

          this.velX[idx] += (velScaleX * this.lateralSpread + swirl * 0.95 * fireBias) * falloff;
          this.velY[idx] += (Math.max(0.7, velScaleY + 1.0) + (1.0 - Math.abs(dx)) * 0.5) * falloff * (0.72 + fireBias * 0.22) * this.verticalLift;
          this.velZ[idx] += (-velScaleZ * this.lateralSpread + dz * 0.95 - dx * 0.28) * falloff * (0.52 + fireBias * 0.45);
        }
      }
    }
  }

  step(time, delta = 1 / 60) {
    this.dt = clamp(delta, 1 / 120, 1 / 24);

    this._applyForces(time);
    this._smoothVelocity();
    this._advectScalars();
    this._updateTexture();
  }

  _applyForces(time) {
    const widthMax = this.W - 1;
    const heightMax = this.H - 1;
    const depthMax = this.D - 1;
    const vortScale = this.vortConfinement * 0.0022;
    const liftScale = this.buoyancy * 0.042;
    const weightScale = this.weight * 0.018;
    const frame = this.dt * 60;

    let idx = 0;
    for (let z = 0; z < this.D; z++) {
      const nz = z / depthMax - 0.5;
      for (let y = 0; y < this.H; y++) {
        const ny = y / heightMax;
        const yFade = 1.0 - ny;
        for (let x = 0; x < this.W; x++, idx++) {
          const nx = x / widthMax - 0.5;
          const density = this.density[idx];
          const temperature = this.temperature[idx];

          let vx = this.velX[idx];
          let vy = this.velY[idx];
          let vz = this.velZ[idx];

          const radial = Math.hypot(nx * 1.35, nz * 1.12);
          const core = Math.max(0.0, 1.0 - radial * 1.32);
          const plumeInfluence = 0.18 + density * 0.82;

          const phaseA = ny * 7.8 + time * 1.75 + nx * 5.6 - nz * 4.8;
          const phaseB = ny * 5.1 - time * 1.2 + nz * 6.0 + nx * 3.2;
          const swirlX = Math.sin(phaseA) * 0.65 + Math.cos(phaseB * 0.55) * 0.35;
          const swirlZ = Math.cos(phaseB) * 0.65 - Math.sin(phaseA * 0.7) * 0.35;

          vx += (swirlX - nz * 0.58 - nx * core * 0.22) * vortScale * plumeInfluence * yFade * frame * this.lateralSpread;
          vz += (swirlZ + nx * 0.58 - nz * core * 0.22) * vortScale * plumeInfluence * yFade * frame * this.lateralSpread;
          vy += (this.baseRise * (0.58 + core * 0.42) + temperature * liftScale - density * weightScale) * frame * this.verticalLift;

          vx += -nx * this.radialPull * core * yFade * frame;
          vz += -nz * this.radialPull * core * yFade * frame;

          const damping = this.velocityDamping - Math.max(0, ny - 0.8) * 0.012;
          this.velXNext[idx] = vx * damping;
          this.velYNext[idx] = vy * (damping - 0.002);
          this.velZNext[idx] = vz * damping;
        }
      }
    }
  }

  _smoothVelocity() {
    const blend = 0.035 + Math.min(0.16, this.jacobiIter * 0.003);

    for (let z = 0; z < this.D; z++) {
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) {
          const idx = this._index(x, y, z);
          if (x === 0 || y === 0 || z === 0 || x === this.W - 1 || y === this.H - 1 || z === this.D - 1) {
            this.velX[idx] = this.velXNext[idx] * 0.68;
            this.velY[idx] = Math.max(0, this.velYNext[idx] * 0.68);
            this.velZ[idx] = this.velZNext[idx] * 0.68;
            continue;
          }

          const px = this._index(x + 1, y, z);
          const nx = this._index(x - 1, y, z);
          const py = this._index(x, y + 1, z);
          const ny = this._index(x, y - 1, z);
          const pz = this._index(x, y, z + 1);
          const nz = this._index(x, y, z - 1);

          const avgX = (this.velXNext[px] + this.velXNext[nx] + this.velXNext[py] + this.velXNext[ny] + this.velXNext[pz] + this.velXNext[nz]) / 6;
          const avgY = (this.velYNext[px] + this.velYNext[nx] + this.velYNext[py] + this.velYNext[ny] + this.velYNext[pz] + this.velYNext[nz]) / 6;
          const avgZ = (this.velZNext[px] + this.velZNext[nx] + this.velZNext[py] + this.velZNext[ny] + this.velZNext[pz] + this.velZNext[nz]) / 6;

          this.velX[idx] = lerp(this.velXNext[idx], avgX, blend);
          this.velY[idx] = Math.max(0, lerp(this.velYNext[idx], avgY, blend));
          this.velZ[idx] = lerp(this.velZNext[idx], avgZ, blend);
        }
      }
    }
  }

  _advectScalars() {
    const advectScale = this.advection * this.dt * 60;
    const widthMax = this.W - 1;
    const heightMax = this.H - 1;
    const depthMax = this.D - 1;

    let idx = 0;
    for (let z = 0; z < this.D; z++) {
      for (let y = 0; y < this.H; y++) {
        const ny = y / heightMax;
        for (let x = 0; x < this.W; x++, idx++) {
          const backX = x - this.velX[idx] * advectScale;
          const backY = y - this.velY[idx] * advectScale;
          const backZ = z - this.velZ[idx] * advectScale;

          let density = this._sample(this.density, backX, backY, backZ) * this.dissipation;
          let temperature = this._sample(this.temperature, backX, backY, backZ) * this.tempDissipation;

          density *= 1.0 - Math.max(0, ny - 0.84) * 0.05;
          temperature *= Math.max(0.88, 1.0 - (0.004 + ny * 0.01) * this.cooling);

          if (x === 0 || x === widthMax || z === 0 || z === depthMax) {
            density *= this.edgeLoss;
            temperature *= Math.max(0.82, this.edgeLoss - 0.02 * this.cooling);
          }

          if (y === heightMax) {
            density *= this.topLoss;
            temperature *= Math.max(0.72, this.topLoss - 0.06 * this.cooling);
          }

          this.densityNext[idx] = clamp(density, 0, 1.45);
          this.temperatureNext[idx] = clamp(temperature, 0, 1.55);
        }
      }
    }

    const densityBlend = this.densityDiffusion;
    const tempBlend = this.temperatureDiffusion;
    for (let z = 1; z < this.D - 1; z++) {
      for (let y = 1; y < this.H - 1; y++) {
        for (let x = 1; x < this.W - 1; x++) {
          const center = this._index(x, y, z);
          const px = this._index(x + 1, y, z);
          const nx = this._index(x - 1, y, z);
          const py = this._index(x, y + 1, z);
          const ny = this._index(x, y - 1, z);
          const pz = this._index(x, y, z + 1);
          const nz = this._index(x, y, z - 1);

          const densityAvg = (this.densityNext[px] + this.densityNext[nx] + this.densityNext[py] + this.densityNext[ny] + this.densityNext[pz] + this.densityNext[nz]) / 6;
          const tempAvg = (this.temperatureNext[px] + this.temperatureNext[nx] + this.temperatureNext[py] + this.temperatureNext[ny] + this.temperatureNext[pz] + this.temperatureNext[nz]) / 6;

          this.density[center] = lerp(this.densityNext[center], densityAvg, densityBlend);
          this.temperature[center] = lerp(this.temperatureNext[center], tempAvg, tempBlend);
        }
      }
    }

    for (let z = 0; z < this.D; z++) {
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) {
          if (x > 0 && x < this.W - 1 && y > 0 && y < this.H - 1 && z > 0 && z < this.D - 1) continue;
          const edge = this._index(x, y, z);
          this.density[edge] = this.densityNext[edge];
          this.temperature[edge] = this.temperatureNext[edge];
        }
      }
    }
  }

  _updateTexture() {
    let dataIndex = 0;
    for (let i = 0; i < this.count; i++) {
      const density = clamp(this.density[i], 0, 1);
      const temperature = clamp(this.temperature[i], 0, 1);
      const speed = Math.min(1, Math.hypot(this.velX[i], this.velY[i], this.velZ[i]) * 0.18);
      const opacity = clamp(Math.max(density, temperature * 0.84), 0, 1);

      this.volumeData[dataIndex++] = Math.round(density * 255);
      this.volumeData[dataIndex++] = Math.round(temperature * 255);
      this.volumeData[dataIndex++] = Math.round(speed * 255);
      this.volumeData[dataIndex++] = Math.round(opacity * 255);
    }

    this.volumeTexture.needsUpdate = true;
  }

  _sample(field, x, y, z) {
    const x0 = clamp(Math.floor(x), 0, this.W - 1);
    const y0 = clamp(Math.floor(y), 0, this.H - 1);
    const z0 = clamp(Math.floor(z), 0, this.D - 1);
    const x1 = Math.min(x0 + 1, this.W - 1);
    const y1 = Math.min(y0 + 1, this.H - 1);
    const z1 = Math.min(z0 + 1, this.D - 1);

    const tx = clamp(x - x0, 0, 1);
    const ty = clamp(y - y0, 0, 1);
    const tz = clamp(z - z0, 0, 1);

    const c000 = field[this._index(x0, y0, z0)];
    const c100 = field[this._index(x1, y0, z0)];
    const c010 = field[this._index(x0, y1, z0)];
    const c110 = field[this._index(x1, y1, z0)];
    const c001 = field[this._index(x0, y0, z1)];
    const c101 = field[this._index(x1, y0, z1)];
    const c011 = field[this._index(x0, y1, z1)];
    const c111 = field[this._index(x1, y1, z1)];

    const c00 = lerp(c000, c100, tx);
    const c10 = lerp(c010, c110, tx);
    const c01 = lerp(c001, c101, tx);
    const c11 = lerp(c011, c111, tx);

    const c0 = lerp(c00, c10, ty);
    const c1 = lerp(c01, c11, ty);
    return lerp(c0, c1, tz);
  }

  _index(x, y, z) {
    return x + this.W * (y + this.H * z);
  }
}
