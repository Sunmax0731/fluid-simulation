/**
 * SPH (Smoothed Particle Hydrodynamics) ソルバー
 * CPU実装 — 高速化のためにWorkerを使用
 * パーティクル数: ~2000
 */

export class SPHSolver {
  constructor(numParticles, domainW, domainH) {
    this.N = numParticles;
    this.W = domainW;
    this.H = domainH;

    // SPHパラメータ
    this.h = domainH * 0.045;    // 平滑化長さ
    this.mass = 1.0;
    this.restDensity = 1000.0;
    this.k = 200.0;              // 状態方程式の剛性
    this.mu = 0.1;               // 粘性係数
    this.gravity = [0, -9.8];
    this.dt = 0.004;

    // バッファ
    this.pos = new Float32Array(numParticles * 2);
    this.vel = new Float32Array(numParticles * 2);
    this.acc = new Float32Array(numParticles * 2);
    this.density  = new Float32Array(numParticles);
    this.pressure = new Float32Array(numParticles);

    this._initParticles();
    this._buildGrid();
  }

  _initParticles() {
    let idx = 0;
    const cols = Math.ceil(Math.sqrt(this.N * 0.5));
    const spacing = this.h * 0.8;
    const startX = this.W * 0.1;
    const startY = this.H * 0.1;
    for (let j = 0; j < this.N; j++) {
      const row = Math.floor(j / cols);
      const col = j % cols;
      this.pos[j*2]   = startX + col * spacing + (row % 2) * spacing * 0.5;
      this.pos[j*2+1] = startY + row * spacing;
      this.vel[j*2]   = 0;
      this.vel[j*2+1] = 0;
    }
  }

  _buildGrid() {
    const cellSize = this.h;
    this._cellSize = cellSize;
    this._gridW = Math.ceil(this.W / cellSize) + 1;
    this._gridH = Math.ceil(this.H / cellSize) + 1;
    this._gridCount = new Int32Array(this._gridW * this._gridH);
    this._gridIdx   = new Int32Array(this._gridW * this._gridH);
    this._sortedIdx = new Int32Array(this.N);
  }

  _spatialHash() {
    const { N, _gridW: GW, _gridH: GH, _cellSize: cs } = this;
    this._gridCount.fill(0);

    // セルに属するパーティクル数をカウント
    const cellOf = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const cx = Math.floor(this.pos[i*2]   / cs);
      const cy = Math.floor(this.pos[i*2+1] / cs);
      const cell = Math.min(Math.max(cx, 0), GW-1) + Math.min(Math.max(cy, 0), GH-1) * GW;
      cellOf[i] = cell;
      this._gridCount[cell]++;
    }

    // プレフィックスサム
    let sum = 0;
    for (let c = 0; c < GW*GH; c++) {
      this._gridIdx[c] = sum;
      sum += this._gridCount[c];
    }

    // ソート
    const fill = new Int32Array(GW*GH);
    for (let i = 0; i < N; i++) {
      const c = cellOf[i];
      this._sortedIdx[this._gridIdx[c] + fill[c]] = i;
      fill[c]++;
    }
  }

  _forEachNeighbor(i, callback) {
    const { _cellSize: cs, _gridW: GW, _gridH: GH } = this;
    const xi = Math.floor(this.pos[i*2]   / cs);
    const yi = Math.floor(this.pos[i*2+1] / cs);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi+dx, cy = yi+dy;
        if (cx < 0 || cx >= GW || cy < 0 || cy >= GH) continue;
        const cell = cx + cy*GW;
        const start = this._gridIdx[cell];
        const end   = start + this._gridCount[cell];
        for (let s = start; s < end; s++) callback(this._sortedIdx[s]);
      }
  }

  // Poly6 カーネル
  _W(r, h) {
    if (r >= h) return 0;
    const t = h*h - r*r;
    return (315.0 / (64.0 * Math.PI * h**9)) * t * t * t;
  }

  // Spiky 勾配
  _gradWspiky(rx, ry, r, h) {
    if (r >= h || r < 1e-6) return [0, 0];
    const t = h - r;
    const c = -(45.0 / (Math.PI * h**6)) * t * t / r;
    return [c * rx, c * ry];
  }

  // Viscosity ラプラシアン
  _lapWvisc(r, h) {
    if (r >= h) return 0;
    return (45.0 / (Math.PI * h**6)) * (h - r);
  }

  step() {
    const { N, h, mass, restDensity, k, mu, dt } = this;
    const [gx, gy] = this.gravity;

    this._spatialHash();

    // 密度・圧力計算
    for (let i = 0; i < N; i++) {
      let rho = 0;
      this._forEachNeighbor(i, j => {
        const dx = this.pos[i*2]-this.pos[j*2];
        const dy = this.pos[i*2+1]-this.pos[j*2+1];
        rho += mass * this._W(Math.hypot(dx, dy), h);
      });
      this.density[i]  = rho;
      this.pressure[i] = Math.max(k * (rho - restDensity), 0);
    }

    // 力の計算
    this.acc.fill(0);
    for (let i = 0; i < N; i++) {
      let fx = 0, fy = 0;
      const ri = this.density[i];
      const pi = this.pressure[i];

      this._forEachNeighbor(i, j => {
        if (i === j) return;
        const dx = this.pos[i*2]   - this.pos[j*2];
        const dy = this.pos[i*2+1] - this.pos[j*2+1];
        const r  = Math.hypot(dx, dy);
        if (r >= h || r < 1e-6) return;
        const rj = this.density[j];
        const pj = this.pressure[j];

        // 圧力勾配
        const [gx2, gy2] = this._gradWspiky(dx, dy, r, h);
        const pCoeff = -mass * (pi + pj) / (2 * rj);
        fx += pCoeff * gx2;
        fy += pCoeff * gy2;

        // 粘性
        const lap = this._lapWvisc(r, h);
        const vCoeff = mu * mass / rj * lap;
        fx += vCoeff * (this.vel[j*2]   - this.vel[i*2]);
        fy += vCoeff * (this.vel[j*2+1] - this.vel[i*2+1]);
      });

      const invRi = 1.0 / Math.max(ri, 1e-6);
      this.acc[i*2]   = fx * invRi + gx;
      this.acc[i*2+1] = fy * invRi + gy;
    }

    // 積分 + 境界処理
    const margin = h * 0.3;
    const damping = 0.4;
    for (let i = 0; i < N; i++) {
      this.vel[i*2]   += this.acc[i*2]   * dt;
      this.vel[i*2+1] += this.acc[i*2+1] * dt;
      this.pos[i*2]   += this.vel[i*2]   * dt;
      this.pos[i*2+1] += this.vel[i*2+1] * dt;

      // 壁反射
      if (this.pos[i*2] < margin)           { this.pos[i*2] = margin;        this.vel[i*2]   *= -damping; }
      if (this.pos[i*2] > this.W - margin)  { this.pos[i*2] = this.W-margin; this.vel[i*2]   *= -damping; }
      if (this.pos[i*2+1] < margin)         { this.pos[i*2+1] = margin;      this.vel[i*2+1] *= -damping; }
      if (this.pos[i*2+1] > this.H - margin){ this.pos[i*2+1] = this.H-margin; this.vel[i*2+1] *= -damping; }
    }
  }

  addParticles(x, y, count) {
    // 空きスロットを探してパーティクルを追加（位置をランダムに散らす）
    let added = 0;
    for (let i = 0; i < this.N && added < count; i++) {
      if (this.pos[i*2] < 0 || this.pos[i*2] > this.W) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * this.h;
        this.pos[i*2]   = x + Math.cos(angle) * r;
        this.pos[i*2+1] = y + Math.sin(angle) * r;
        this.vel[i*2]   = 0;
        this.vel[i*2+1] = 0;
        added++;
      }
    }
  }

  reset() {
    this._initParticles();
    this.vel.fill(0);
    this.acc.fill(0);
  }
}
