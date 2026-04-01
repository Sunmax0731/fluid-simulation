export class VOFSolver {
  constructor(gl, width, height) {
    this.gl = gl;
    this.W = width;
    this.H = height;
    this.dt = 0.12;
    this.gravityY = -9.8;
    this.rhoLiquid = 1000.0;
    this.rhoGas = 1.0;
    this.jacobiIter = 28;
    this.velocityDamping = 0.9985;
    this.inkRetention = 1.0;
    this._uniformTypes = new WeakMap();
    this._ready = false;
  }

  async init(shaders) {
    const gl = this.gl;
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) {
      throw new Error('EXT_color_buffer_float is required for the ink demo.');
    }

    const { vert, advect, div, pres, sub, render, splat } = shaders;
    this._progAdvect = this._build(vert, advect);
    this._progDiv = this._build(vert, div);
    this._progPres = this._build(vert, pres);
    this._progSub = this._build(vert, sub);
    this._progRender = this._build(vert, render);
    this._progSplat = this._build(vert, splat);

    this._vel = [this._makeFBO(gl.NEAREST), this._makeFBO(gl.NEAREST)];
    this._pres = [this._makeFBO(gl.NEAREST), this._makeFBO(gl.NEAREST)];
    this._vof = [this._makeFBO(gl.NEAREST), this._makeFBO(gl.NEAREST)];
    this._div = this._makeFBO(gl.NEAREST);

    this._quadVAO = this._makeQuad();
    this._rv = 0;
    this._ready = true;
    this._clearFields();
  }

  _makeFBO(filter) {
    const gl = this.gl;
    const tex = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.W, this.H, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Ink framebuffer is incomplete.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fbo, tex };
  }

  _makeQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    return vao;
  }

  _build(vertSrc, fragSrc) {
    const gl = this.gl;
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertex, vertSrc);
    gl.compileShader(vertex);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(vertex) || 'Vertex shader compilation failed.');
    }

    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragment, fragSrc);
    gl.compileShader(fragment);
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(fragment) || 'Fragment shader compilation failed.');
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Program link failed.');
    }

    const uniformTypes = new Map();
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < uniformCount; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      uniformTypes.set(info.name, info.type);
      if (info.name.endsWith('[0]')) {
        uniformTypes.set(info.name.slice(0, -3), info.type);
      }
    }
    this._uniformTypes.set(program, uniformTypes);

    return program;
  }

  _uniform(program, name, value) {
    const gl = this.gl;
    const location = gl.getUniformLocation(program, name);
    if (location === null) return;

    const uniformType = this._uniformTypes.get(program)?.get(name);

    if (Array.isArray(value)) {
      if (uniformType === gl.INT_VEC2 || uniformType === gl.BOOL_VEC2) {
        gl.uniform2i(location, value[0], value[1]);
        return;
      }
      if (uniformType === gl.INT_VEC3 || uniformType === gl.BOOL_VEC3) {
        gl.uniform3i(location, value[0], value[1], value[2]);
        return;
      }
      if (uniformType === gl.INT_VEC4 || uniformType === gl.BOOL_VEC4) {
        gl.uniform4i(location, value[0], value[1], value[2], value[3]);
        return;
      }

      if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
      if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
      if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3]);
      return;
    }

    if (uniformType === gl.INT || uniformType === gl.BOOL || uniformType === gl.SAMPLER_2D) {
      gl.uniform1i(location, value);
      return;
    }

    if (typeof value === 'number') {
      gl.uniform1f(location, value);
    }
  }

  _bindTex(program, name, unit, tex) {
    const gl = this.gl;
    const location = gl.getUniformLocation(program, name);
    if (location === null) return;

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(location, unit);
  }

  _blit(program, dst, uniforms = {}) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(program);

    for (const [name, value] of Object.entries(uniforms)) {
      this._uniform(program, name, value);
    }

    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _draw(program, dst, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(program);
    setup();
    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _clearFields() {
    const gl = this.gl;
    const zerosRGBA = new Float32Array(this.W * this.H * 4);

    this._vel.forEach((buffer) => {
      gl.bindTexture(gl.TEXTURE_2D, buffer.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, zerosRGBA);
    });

    this._pres.forEach((buffer) => {
      gl.bindTexture(gl.TEXTURE_2D, buffer.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, zerosRGBA);
    });

    this._vof.forEach((buffer) => {
      gl.bindTexture(gl.TEXTURE_2D, buffer.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, zerosRGBA);
    });

    gl.bindTexture(gl.TEXTURE_2D, this._div.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, zerosRGBA);
    this._rv = 0;
  }

  _seedScene(fillFn) {
    if (!this._ready) return;

    const gl = this.gl;
    const data = new Float32Array(this.W * this.H * 4);

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        data[(y * this.W + x) * 4] = fillFn(x, y, this.W, this.H);
      }
    }

    this._clearFields();

    this._vof.forEach((buffer) => {
      gl.bindTexture(gl.TEXTURE_2D, buffer.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, data);
    });
  }

  setSceneDamBreak() {
    this._seedScene((x, y, width, height) => (
      x < width * 0.34 && y < height * 0.62 ? 1.0 : 0.0
    ));
  }

  setSceneDroplet() {
    this._seedScene((x, y, width, height) => {
      const pool = y < height * 0.16;
      const cx = width * 0.54;
      const cy = height * 0.78;
      const radius = height * 0.085;
      const drop = (x - cx) * (x - cx) + (y - cy) * (y - cy) < radius * radius;
      return pool || drop ? 1.0 : 0.0;
    });
  }

  setSceneBubble() {
    this._seedScene((x, y, width, height) => {
      const cx = width * 0.5;
      const cy = height * 0.16;
      const radius = height * 0.09;
      const bubble = (x - cx) * (x - cx) + (y - cy) * (y - cy) < radius * radius;
      return bubble ? 0.0 : 1.0;
    });
  }

  splat(x, y, vx, vy, options = {}) {
    if (!this._ready) return;

    const gl = this.gl;
    const read = this._rv;
    const write = 1 - read;

    const radius = options.radius ?? 24.0;
    const velocityAmount = options.velocityAmount ?? 0.3;
    const fluidAmount = options.fluidAmount ?? 1.0;
    const erase = options.erase ?? false;

    this._draw(this._progSplat, this._vel[write].fbo, () => {
      this._bindTex(this._progSplat, 'u_target', 0, this._vel[read].tex);
      this._uniform(this._progSplat, 'u_resolution', [this.W, this.H]);
      this._uniform(this._progSplat, 'u_center', [x, y]);
      this._uniform(this._progSplat, 'u_velocity', [vx, vy]);
      this._uniform(this._progSplat, 'u_radius', radius);
      this._uniform(this._progSplat, 'u_amount', velocityAmount);
      this._uniform(this._progSplat, 'u_mode', 0);
    });

    this._draw(this._progSplat, this._vof[write].fbo, () => {
      this._bindTex(this._progSplat, 'u_target', 0, this._vof[read].tex);
      this._uniform(this._progSplat, 'u_resolution', [this.W, this.H]);
      this._uniform(this._progSplat, 'u_center', [x, y]);
      this._uniform(this._progSplat, 'u_velocity', [0, 0]);
      this._uniform(this._progSplat, 'u_radius', radius * 0.9);
      this._uniform(this._progSplat, 'u_amount', fluidAmount);
      this._uniform(this._progSplat, 'u_mode', erase ? 2 : 1);
    });

    this._rv = write;
  }

  step() {
    if (!this._ready) return;

    const gl = this.gl;
    const read = this._rv;
    const write = 1 - read;
    const resolution = [this.W, this.H];
    const dx = 1.0 / Math.min(this.W, this.H);
    const halfRdx = 0.5 / dx;

    gl.useProgram(this._progAdvect);
    this._bindTex(this._progAdvect, 'u_field', 0, this._vof[read].tex);
    this._bindTex(this._progAdvect, 'u_velocity', 1, this._vel[read].tex);
    this._blit(this._progAdvect, this._vof[write].fbo, {
      u_resolution: resolution,
      u_dt: this.dt,
      u_dissipation: this.inkRetention,
    });

    gl.useProgram(this._progAdvect);
    this._bindTex(this._progAdvect, 'u_field', 0, this._vel[read].tex);
    this._bindTex(this._progAdvect, 'u_velocity', 1, this._vel[read].tex);
    this._blit(this._progAdvect, this._vel[write].fbo, {
      u_resolution: resolution,
      u_dt: this.dt,
      u_dissipation: this.velocityDamping,
    });

    this._rv = write;
    const projectedRead = this._rv;
    const projectedWrite = 1 - projectedRead;

    gl.useProgram(this._progDiv);
    this._bindTex(this._progDiv, 'u_velocity', 0, this._vel[projectedRead].tex);
    this._blit(this._progDiv, this._div.fbo, {
      u_resolution: resolution,
      u_halfRdx: halfRdx,
    });

    const alpha = -dx * dx;
    for (let i = 0; i < this.jacobiIter; i++) {
      const pressureRead = i % 2;
      const pressureWrite = 1 - pressureRead;
      gl.useProgram(this._progPres);
      this._bindTex(this._progPres, 'u_pressure', 0, this._pres[pressureRead].tex);
      this._bindTex(this._progPres, 'u_divergence', 1, this._div.tex);
      this._blit(this._progPres, this._pres[pressureWrite].fbo, {
        u_resolution: resolution,
        u_alpha: alpha,
        u_rBeta: 0.25,
      });
    }

    gl.useProgram(this._progSub);
    this._bindTex(this._progSub, 'u_velocity', 0, this._vel[projectedRead].tex);
    this._bindTex(this._progSub, 'u_pressure', 1, this._pres[this.jacobiIter % 2].tex);
    this._bindTex(this._progSub, 'u_vof', 2, this._vof[projectedRead].tex);
    this._blit(this._progSub, this._vel[projectedWrite].fbo, {
      u_resolution: resolution,
      u_halfRdx: halfRdx,
      u_dt: this.dt,
      u_gravityY: this.gravityY,
      u_rho_liquid: this.rhoLiquid,
      u_rho_gas: this.rhoGas,
    });

    this._rv = projectedWrite;
  }

  render(viewMode, palette, time) {
    if (!this._ready) return;

    const gl = this.gl;
    gl.useProgram(this._progRender);
    this._bindTex(this._progRender, 'u_vof', 0, this._vof[this._rv].tex);
    this._bindTex(this._progRender, 'u_velocity', 1, this._vel[this._rv].tex);
    this._blit(this._progRender, null, {
      u_resolution: [this.W, this.H],
      u_mode: viewMode === 'velocity' ? 1 : 0,
      u_time: time,
      u_inkColor: palette.ink,
      u_edgeColor: palette.edge,
      u_bgA: palette.bgA,
      u_bgB: palette.bgB,
    });
  }
}
