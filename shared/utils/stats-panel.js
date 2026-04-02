export class StatsPanel {
  constructor(options = {}) {
    this.visible = options.visible ?? true;
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      padding: '9px 12px',
      borderRadius: '14px',
      border: '1px solid rgba(160, 206, 255, 0.16)',
      background: 'rgba(6, 10, 18, 0.72)',
      boxShadow: '0 14px 30px rgba(0, 0, 0, 0.22)',
      color: '#d8f5ff',
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      fontSize: '12px',
      lineHeight: '1.6',
      letterSpacing: '0.02em',
      pointerEvents: 'none',
      zIndex: '9999',
      backdropFilter: 'blur(14px)',
      display: this.visible ? 'block' : 'none',
    });
    document.body.appendChild(this.el);

    this._frames = 0;
    this._lastTime = performance.now();
    this._fps = 0;
    this._simMs = 0;
  }

  beginSim() {
    this._simStart = performance.now();
  }

  endSim() {
    this._simMs = performance.now() - this._simStart;
  }

  update() {
    if (!this.visible) return;
    this._frames++;
    const now = performance.now();

    if (now - this._lastTime >= 500) {
      this._fps = (this._frames * 1000 / (now - this._lastTime)).toFixed(1);
      this._frames = 0;
      this._lastTime = now;
    }

    this.el.innerHTML = `FPS ${this._fps}<br>SIM ${this._simMs.toFixed(2)} ms`;
  }
}
