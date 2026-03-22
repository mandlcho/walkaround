export class Toolbar {
  constructor(container, viewMode) {
    this.viewMode = viewMode;
    this.el = document.createElement('div');
    this.el.className = 'tour-toolbar';
    this.el.innerHTML = `
      <button class="toolbar-btn active" data-mode="firstperson" title="Walk (1)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="5" r="2"/>
          <path d="M10 22V18L7 15V11L10 9H14L17 11V15L14 18V22"/>
        </svg>
        <span>Walk</span>
      </button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" data-mode="dollhouse" title="Dollhouse (2)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9L12 2L21 9V20C21 21 20 22 19 22H5C4 22 3 21 3 20V9Z"/>
          <path d="M9 22V12H15V22"/>
        </svg>
        <span>Dollhouse</span>
      </button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" data-mode="floorplan" title="Floor Plan (3)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
        <span>Floor Plan</span>
      </button>
      <div class="toolbar-divider"></div>
      <button class="toolbar-btn" data-action="panorama" title="360 Photos (4)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <ellipse cx="12" cy="12" rx="10" ry="4"/>
          <line x1="12" y1="2" x2="12" y2="22"/>
        </svg>
        <span>360&deg;</span>
      </button>
    `;
    container.appendChild(this.el);

    this._onPanoramaClick = null;

    this.el.querySelectorAll('.toolbar-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.action === 'panorama') {
          if (this._onPanoramaClick) this._onPanoramaClick();
          return;
        }
        viewMode.switchMode(btn.dataset.mode);
      });
    });

    viewMode.onChange((mode) => {
      this.el.querySelectorAll('.toolbar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
      });
    });

    this._keyHandler = (e) => {
      if (e.code === 'Digit1') viewMode.switchMode('firstperson');
      if (e.code === 'Digit2') viewMode.switchMode('dollhouse');
      if (e.code === 'Digit3') viewMode.switchMode('floorplan');
      if (e.code === 'Digit4' && this._onPanoramaClick) this._onPanoramaClick();
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  set onPanoramaClick(fn) {
    this._onPanoramaClick = fn;
  }

  destroy() {
    this.el.remove();
    document.removeEventListener('keydown', this._keyHandler);
  }
}
