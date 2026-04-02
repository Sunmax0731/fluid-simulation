/**
 * Lightweight slider panel used by all demos.
 * params: { key: { label, min, max, step, value, decimals?, description? } }
 */
export class Controls {
  constructor(params, onChange, options = {}) {
    this.values = {};
    this._controls = new Map();
    this._onChange = onChange;
    this._defaultHelp = options.helpText
      || 'スライダーにカーソルを重ねると、このパラメータがシミュレーションの見た目や挙動へ与える影響を表示します。';
    this._collapsed = false;
    this._anchor = options.anchor || null;
    this._layoutPadding = options.anchorPadding ?? 18;
    this._topOffset = options.topOffset ?? 184;
    this._rightOffset = options.rightOffset ?? 18;
    this._minWidth = options.minWidth ?? 236;

    const panel = document.createElement('div');
    this.panel = panel;

    Object.assign(panel.style, {
      position: 'fixed',
      top: `${this._topOffset}px`,
      right: `${this._rightOffset}px`,
      minWidth: `${this._minWidth}px`,
      maxWidth: 'min(300px, calc(100vw - 32px))',
      maxHeight: `calc(100vh - ${this._topOffset + 18}px)`,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      scrollbarWidth: 'thin',
      padding: '14px 16px',
      borderRadius: '18px',
      border: '1px solid rgba(74, 143, 212, 0.18)',
      background: 'rgba(255, 255, 255, 0.92)',
      boxShadow: '0 14px 30px rgba(90, 74, 0, 0.16)',
      backdropFilter: 'blur(16px)',
      color: '#334155',
      fontFamily: '"Segoe UI", "Hiragino Sans", sans-serif',
      fontSize: '12px',
      zIndex: '9999',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '12px',
    });

    const title = document.createElement('div');
    title.textContent = options.title || 'Controls';
    Object.assign(title.style, {
      color: options.accent || '#2e6fbf',
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      flex: '1 1 auto',
    });
    header.appendChild(title);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Hide';
    Object.assign(toggle.style, {
      border: '1px solid rgba(74, 143, 212, 0.18)',
      background: 'rgba(255, 248, 220, 0.96)',
      color: '#2c2c2c',
      borderRadius: '999px',
      padding: '5px 10px',
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      cursor: 'pointer',
      flex: '0 0 auto',
      transition: 'background 0.18s ease, color 0.18s ease, transform 0.18s ease',
    });
    toggle.addEventListener('mouseenter', () => {
      toggle.style.background = options.accent || '#4a8fd4';
      toggle.style.color = '#ffffff';
      toggle.style.transform = 'translateY(-1px)';
    });
    toggle.addEventListener('mouseleave', () => {
      toggle.style.background = 'rgba(255, 248, 220, 0.96)';
      toggle.style.color = '#2c2c2c';
      toggle.style.transform = 'translateY(0)';
    });
    toggle.addEventListener('click', () => this.setCollapsed(!this._collapsed));
    this._toggle = toggle;
    header.appendChild(toggle);

    panel.appendChild(header);

    const body = document.createElement('div');
    this._body = body;
    body.style.display = 'block';

    const helpPanel = document.createElement('div');
    Object.assign(helpPanel.style, {
      position: 'sticky',
      bottom: '-14px',
      marginTop: '14px',
      padding: '10px 12px',
      borderRadius: '14px',
      border: '1px solid rgba(74, 143, 212, 0.14)',
      background: 'rgba(255, 248, 220, 0.96)',
      boxShadow: '0 10px 24px rgba(90, 74, 0, 0.12)',
    });

    const helpTitle = document.createElement('div');
    Object.assign(helpTitle.style, {
      marginBottom: '6px',
      color: options.accent || '#2e6fbf',
      fontSize: '10px',
      fontWeight: '800',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    });
    helpTitle.textContent = 'Parameter Help';

    const helpBody = document.createElement('div');
    Object.assign(helpBody.style, {
      color: '#5b6475',
      lineHeight: '1.55',
      fontSize: '11px',
      whiteSpace: 'normal',
    });
    helpBody.textContent = this._defaultHelp;

    helpPanel.appendChild(helpTitle);
    helpPanel.appendChild(helpBody);
    this._helpTitle = helpTitle;
    this._helpBody = helpBody;

    const sortedEntries = Object.entries(params).sort(([, a], [, b]) => {
      const sectionOrderA = a.sectionOrder ?? Number.MAX_SAFE_INTEGER;
      const sectionOrderB = b.sectionOrder ?? Number.MAX_SAFE_INTEGER;
      if (sectionOrderA !== sectionOrderB) return sectionOrderA - sectionOrderB;

      const itemOrderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const itemOrderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (itemOrderA !== itemOrderB) return itemOrderA - itemOrderB;

      return 0;
    });

    let activeSection = null;

    for (const [key, cfg] of sortedEntries) {
      if (cfg.section && cfg.section !== activeSection) {
        activeSection = cfg.section;

        const section = document.createElement('div');
        Object.assign(section.style, {
          margin: body.children.length ? '16px 0 10px' : '0 0 10px',
          paddingTop: body.children.length ? '12px' : '0',
          borderTop: body.children.length ? '1px solid rgba(240, 232, 192, 0.95)' : 'none',
        });

        const sectionLabel = document.createElement('div');
        sectionLabel.textContent = cfg.section;
        Object.assign(sectionLabel.style, {
          color: options.accent || '#2e6fbf',
          fontSize: '10px',
          fontWeight: '800',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        });

        section.appendChild(sectionLabel);
        body.appendChild(section);
      }

      const row = document.createElement('div');
      row.style.marginBottom = '10px';

      const label = document.createElement('label');
      Object.assign(label.style, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '4px',
      });

      const nameEl = document.createElement('span');
      nameEl.textContent = cfg.label || key;
      nameEl.style.color = '#415166';

      const valueEl = document.createElement('span');
      valueEl.style.color = options.accent || '#4a8fd4';
      valueEl.style.fontVariantNumeric = 'tabular-nums';
      valueEl.style.fontWeight = '700';

      label.appendChild(nameEl);
      label.appendChild(valueEl);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(cfg.min);
      input.max = String(cfg.max);
      input.step = String(cfg.step ?? 0.01);
      input.style.width = '100%';
      input.style.accentColor = options.accent || '#58c0ff';
      input.title = cfg.description || cfg.label || key;

      input.addEventListener('input', () => {
        this.setValue(key, parseFloat(input.value), true);
      });

      row.addEventListener('mouseenter', () => this._setHelp(cfg));
      row.addEventListener('mouseleave', () => {
        if (document.activeElement !== input) this._clearHelp();
      });
      input.addEventListener('focus', () => this._setHelp(cfg));
      input.addEventListener('blur', () => {
        this._clearHelp();
      });

      row.appendChild(label);
      row.appendChild(input);
      body.appendChild(row);

      this._controls.set(key, { cfg, input, valueEl });
      this.setValue(key, cfg.value, false);
    }

    body.appendChild(helpPanel);
    panel.appendChild(body);

    if (options.collapsible === false) {
      toggle.style.display = 'none';
    }

    document.body.appendChild(panel);

    this._applyLayout = this._applyLayout.bind(this);
    window.addEventListener('resize', this._applyLayout);
    window.addEventListener('scroll', this._applyLayout, { passive: true });
    this._applyLayout();
  }

  setValue(key, value, emit = false) {
    const control = this._controls.get(key);
    if (!control) return;

    this.values[key] = value;
    control.input.value = String(value);
    control.valueEl.textContent = this._formatValue(control.cfg, value);

    if (emit) this._onChange?.(key, value);
  }

  getValue(key) {
    return this.values[key];
  }

  setCollapsed(collapsed) {
    this._collapsed = collapsed;
    this._body.style.display = collapsed ? 'none' : 'block';
    this.panel.style.overflowY = collapsed ? 'hidden' : 'auto';
    this.panel.style.minWidth = collapsed ? 'auto' : `${this._minWidth}px`;
    this._toggle.textContent = collapsed ? 'Show' : 'Hide';
    this._applyLayout();
  }

  _formatValue(cfg, value) {
    if (Number.isInteger(cfg.decimals)) return value.toFixed(cfg.decimals);

    const step = String(cfg.step ?? 0.01);
    const decimals = step.includes('.') ? step.split('.')[1].length : 0;
    return value.toFixed(Math.min(decimals, 3));
  }

  _setHelp(cfg) {
    this._helpTitle.textContent = cfg.label || 'Parameter Help';
    this._helpBody.textContent = cfg.description || this._defaultHelp;
  }

  _clearHelp() {
    this._helpTitle.textContent = 'Parameter Help';
    this._helpBody.textContent = this._defaultHelp;
  }

  _applyLayout() {
    let top = this._topOffset;
    let right = this._rightOffset;
    let availableHeight = window.innerHeight - top - this._layoutPadding;

    if (this._anchor) {
      const rect = this._anchor.getBoundingClientRect();
      top = Math.max(this._layoutPadding, rect.top + this._layoutPadding);
      right = Math.max(this._rightOffset, window.innerWidth - rect.right + this._layoutPadding);
      availableHeight = Math.min(
        window.innerHeight - top - this._layoutPadding,
        rect.height - this._layoutPadding * 2,
      );
    }

    availableHeight = Math.max(180, availableHeight);

    this.panel.style.top = `${Math.round(top)}px`;
    this.panel.style.right = `${Math.round(right)}px`;
    this.panel.style.maxHeight = this._collapsed ? 'unset' : `${Math.round(availableHeight)}px`;
  }
}
