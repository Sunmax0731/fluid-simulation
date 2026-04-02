/**
 * Lightweight slider panel used by all demos.
 * params: { key: { label, min, max, step, value, decimals?, description? } }
 */
export class Controls {
  constructor(params, onChange, options = {}) {
    this.values = {};
    this._controls = new Map();
    this._onChange = onChange;
    this._defaultHelp = options.helpText || 'スライダーにマウスを合わせると、そのパラメータが見た目と挙動へ与える影響を表示します。';
    this._collapsed = false;

    const panel = document.createElement('div');
    this.panel = panel;

    Object.assign(panel.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      minWidth: '220px',
      maxWidth: 'min(280px, calc(100vw - 32px))',
      maxHeight: 'calc(100vh - 32px)',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      scrollbarWidth: 'thin',
      padding: '14px 16px',
      borderRadius: '16px',
      border: '1px solid rgba(140, 170, 255, 0.18)',
      background: 'rgba(9, 13, 24, 0.82)',
      boxShadow: '0 18px 50px rgba(0, 0, 0, 0.28)',
      backdropFilter: 'blur(18px)',
      color: '#dbe7ff',
      fontFamily: '"Aptos", "Segoe UI Variable Text", "Yu Gothic UI", sans-serif',
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
      color: '#eef4ff',
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      flex: '1 1 auto',
    });
    header.appendChild(title);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Hide';
    Object.assign(toggle.style, {
      border: '1px solid rgba(140, 170, 255, 0.18)',
      background: 'rgba(17, 26, 44, 0.86)',
      color: '#dbe7ff',
      borderRadius: '999px',
      padding: '5px 10px',
      fontSize: '10px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      cursor: 'pointer',
      flex: '0 0 auto',
    });
    toggle.addEventListener('click', () => this.setCollapsed(!this._collapsed));
    this._toggle = toggle;
    header.appendChild(toggle);

    panel.appendChild(header);

    const body = document.createElement('div');
    this._body = body;
    Object.assign(body.style, {
      display: 'block',
    });

    const helpPanel = document.createElement('div');
    Object.assign(helpPanel.style, {
      position: 'sticky',
      bottom: '-14px',
      marginTop: '14px',
      padding: '10px 12px',
      borderRadius: '12px',
      border: '1px solid rgba(140, 170, 255, 0.14)',
      background: 'rgba(14, 20, 34, 0.92)',
      boxShadow: '0 10px 24px rgba(0, 0, 0, 0.18)',
    });

    const helpTitle = document.createElement('div');
    Object.assign(helpTitle.style, {
      marginBottom: '6px',
      color: '#eef4ff',
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
    });
    helpTitle.textContent = 'Parameter Help';

    const helpBody = document.createElement('div');
    Object.assign(helpBody.style, {
      color: '#afbddf',
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
          borderTop: body.children.length ? '1px solid rgba(140, 170, 255, 0.12)' : 'none',
        });

        const sectionLabel = document.createElement('div');
        sectionLabel.textContent = cfg.section;
        Object.assign(sectionLabel.style, {
          color: '#eef4ff',
          fontSize: '10px',
          fontWeight: '700',
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
      nameEl.style.color = '#b3c2e8';

      const valueEl = document.createElement('span');
      valueEl.style.color = '#8bc8ff';
      valueEl.style.fontVariantNumeric = 'tabular-nums';

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
    this.panel.style.maxHeight = collapsed ? 'unset' : 'calc(100vh - 32px)';
    this.panel.style.minWidth = collapsed ? 'auto' : '220px';
    this._toggle.textContent = collapsed ? 'Show' : 'Hide';
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
}
