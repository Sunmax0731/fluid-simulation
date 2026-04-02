import * as THREE from 'three';

export class WaterSurfaceSolver {
  constructor(options = {}) {
    const resolution = options.resolution ?? 128;
    this.width = resolution;
    this.height = resolution;
    this.basinHalfSize = options.basinHalfSize.clone();
    this.sizeX = this.basinHalfSize.x * 2.0;
    this.sizeZ = this.basinHalfSize.y * 2.0;
    this.cellX = this.sizeX / (this.width - 1);
    this.cellZ = this.sizeZ / (this.height - 1);
    this.invCellX2 = 1.0 / (this.cellX * this.cellX);
    this.invCellZ2 = 1.0 / (this.cellZ * this.cellZ);
    this.count = this.width * this.height;

    this.heights = new Float32Array(this.count);
    this.velocities = new Float32Array(this.count);
    this.nextHeights = new Float32Array(this.count);
    this.nextVelocities = new Float32Array(this.count);
    this.textureData = new Float32Array(this.count * 4);

    this.texture = new THREE.DataTexture(this.textureData, this.width, this.height, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;

    this.viscosity = 0.35;
    this.baseWaveHeight = 0.02;
    this.windSpeed = 0.35;

    this.reset();
  }

  reset() {
    this.heights.fill(0);
    this.velocities.fill(0);
    this.nextHeights.fill(0);
    this.nextVelocities.fill(0);
    this.textureData.fill(0);
    this.texture.needsUpdate = true;
  }

  setParameters(params = {}) {
    if (typeof params.viscosity === 'number') this.viscosity = params.viscosity;
    if (typeof params.waveHeight === 'number') this.baseWaveHeight = params.waveHeight;
    if (typeof params.windSpeed === 'number') this.windSpeed = params.windSpeed;
  }

  addImpact(x, z, strength, radius = 0.48) {
    const sigma = Math.max(radius, 0.14);
    const sigma2 = sigma * sigma;
    const extent = sigma * 4.6;
    const min = this._worldToGrid(x - extent, z + extent);
    const max = this._worldToGrid(x + extent, z - extent);
    const waveMix = THREE.MathUtils.clamp(this.baseWaveHeight / 0.8, 0.0, 1.0);
    const viscMix = THREE.MathUtils.clamp((this.viscosity - 0.05) / 1.75, 0.0, 1.0);
    const velocityImpulse = strength * THREE.MathUtils.lerp(3.8, 6.8, waveMix) * THREE.MathUtils.lerp(1.0, 0.9, viscMix);
    const displacementImpulse = strength * THREE.MathUtils.lerp(0.038, 0.088, waveMix) * THREE.MathUtils.lerp(1.0, 0.92, viscMix);

    for (let iz = min.z; iz <= max.z; iz++) {
      const worldZ = this._gridToWorldZ(iz);
      for (let ix = min.x; ix <= max.x; ix++) {
        const worldX = this._gridToWorldX(ix);
        const dx = worldX - x;
        const dz = worldZ - z;
        const r2 = dx * dx + dz * dz;
        if (r2 > extent * extent) continue;

        const gaussian = Math.exp(-r2 / (2.0 * sigma2));
        const radiusNorm = r2 / sigma2;
        const ring = (radiusNorm - 0.92) * gaussian;
        const bowl = (1.0 - radiusNorm * 0.82) * gaussian;
        const idx = iz * this.width + ix;
        this.velocities[idx] += ring * velocityImpulse;
        this.heights[idx] -= bowl * displacementImpulse;
      }
    }
  }

  step(dt) {
    if (dt <= 0) return;

    const viscMix = THREE.MathUtils.clamp((this.viscosity - 0.05) / 1.75, 0.0, 1.0);
    const waveSpeed = THREE.MathUtils.lerp(5.8, 2.8, viscMix) + Math.min(this.windSpeed, 8.0) * 0.028;
    const damping = THREE.MathUtils.lerp(0.008, 0.05, viscMix);
    const drag = THREE.MathUtils.lerp(0.00035, 0.0022, viscMix);
    const smoothing = THREE.MathUtils.lerp(0.01, 0.045, viscMix);
    const steps = Math.max(2, Math.min(6, Math.ceil(dt / 0.0045)));
    const subDt = dt / steps;

    for (let step = 0; step < steps; step++) {
      for (let z = 0; z < this.height; z++) {
        for (let x = 0; x < this.width; x++) {
          const idx = z * this.width + x;
          const left = this.heights[z * this.width + (x > 0 ? x - 1 : x + 1)];
          const right = this.heights[z * this.width + (x < this.width - 1 ? x + 1 : x - 1)];
          const near = this.heights[(z > 0 ? z - 1 : z + 1) * this.width + x];
          const far = this.heights[(z < this.height - 1 ? z + 1 : z - 1) * this.width + x];
          const center = this.heights[idx];
          const velocity = this.velocities[idx];

          const laplacian = (left + right - 2.0 * center) * this.invCellX2
            + (near + far - 2.0 * center) * this.invCellZ2;
          const neighborhood = (left + right + near + far) * 0.25;
          const accel = waveSpeed * waveSpeed * laplacian
            + (neighborhood - center) * smoothing
            - velocity * damping;

          const nextVelocity = (velocity + accel * subDt) * (1.0 - subDt * drag);
          const nextHeight = center + nextVelocity * subDt;

          this.nextVelocities[idx] = nextVelocity;
          this.nextHeights[idx] = nextHeight;
        }
      }

      this._swapBuffers();
      this._removeMeanOffset(0.006);
      this._removeVelocityBias(0.003);
    }

    this._syncTexture();
  }

  sampleHeightAt(x, z) {
    const fx = THREE.MathUtils.clamp((x + this.basinHalfSize.x) / this.cellX, 0, this.width - 1);
    const fz = THREE.MathUtils.clamp((this.basinHalfSize.y - z) / this.cellZ, 0, this.height - 1);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, this.width - 1);
    const z1 = Math.min(z0 + 1, this.height - 1);
    const tx = fx - x0;
    const tz = fz - z0;

    const h00 = this.heights[z0 * this.width + x0];
    const h10 = this.heights[z0 * this.width + x1];
    const h01 = this.heights[z1 * this.width + x0];
    const h11 = this.heights[z1 * this.width + x1];
    const hx0 = THREE.MathUtils.lerp(h00, h10, tx);
    const hx1 = THREE.MathUtils.lerp(h01, h11, tx);
    return THREE.MathUtils.lerp(hx0, hx1, tz);
  }

  _worldToGrid(x, z) {
    return {
      x: THREE.MathUtils.clamp(Math.floor((x + this.basinHalfSize.x) / this.cellX), 0, this.width - 1),
      z: THREE.MathUtils.clamp(Math.floor((this.basinHalfSize.y - z) / this.cellZ), 0, this.height - 1),
    };
  }

  _gridToWorldX(x) {
    return -this.basinHalfSize.x + x * this.cellX;
  }

  _gridToWorldZ(z) {
    return this.basinHalfSize.y - z * this.cellZ;
  }

  _removeMeanOffset(strength = 1.0) {
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.heights[i];
    const mean = sum / this.count;
    if (Math.abs(mean) < 1e-6) return;

    const correction = mean * strength;
    for (let i = 0; i < this.count; i++) {
      this.heights[i] -= correction;
    }
  }

  _removeVelocityBias(strength = 1.0) {
    let sum = 0;
    for (let i = 0; i < this.count; i++) sum += this.velocities[i];
    const mean = sum / this.count;
    if (Math.abs(mean) < 1e-6) return;

    const correction = mean * strength;
    for (let i = 0; i < this.count; i++) {
      this.velocities[i] -= correction;
    }
  }

  _swapBuffers() {
    [this.heights, this.nextHeights] = [this.nextHeights, this.heights];
    [this.velocities, this.nextVelocities] = [this.nextVelocities, this.velocities];
  }

  _syncTexture() {
    for (let i = 0; i < this.count; i++) {
      const base = i * 4;
      this.textureData[base] = this.heights[i];
      this.textureData[base + 1] = this.velocities[i];
      this.textureData[base + 2] = 0;
      this.textureData[base + 3] = 1;
    }
    this.texture.needsUpdate = true;
  }
}
