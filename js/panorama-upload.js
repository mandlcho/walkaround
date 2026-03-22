/**
 * PanoramaUploadUI — overlay panel for uploading 360 photos per room.
 */
export class PanoramaUploadUI {
  /**
   * @param {HTMLElement} container - the walkthrough screen element
   * @param {Array} rooms - floorData.rooms array
   */
  constructor(container, rooms) {
    this.container = container;
    this.rooms = rooms;
    this.uploaded = new Map(); // roomIndex -> { file, thumbUrl }
    this._onPanoramaAdded = null;
    this._visible = false;

    this._buildDOM();
  }

  /**
   * Set the callback fired when a panorama is added.
   * @param {function(File, {x, y, z})} fn
   */
  set onPanoramaAdded(fn) {
    this._onPanoramaAdded = fn;
  }

  _buildDOM() {
    // Overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'pano-overlay';
    this.overlay.style.display = 'none';

    // Card
    const card = document.createElement('div');
    card.className = 'pano-card';

    // Header
    const header = document.createElement('div');
    header.className = 'pano-header';
    header.innerHTML = `
      <h2>Add 360 Photos</h2>
      <p>Upload equirectangular panoramas for each room</p>
    `;
    card.appendChild(header);

    // Room list
    const list = document.createElement('div');
    list.className = 'pano-room-list';

    this.rooms.forEach((room, index) => {
      const row = document.createElement('div');
      row.className = 'pano-room-row';
      row.dataset.roomIndex = index;

      const info = document.createElement('div');
      info.className = 'pano-room-info';

      const name = document.createElement('span');
      name.className = 'pano-room-name';
      name.textContent = room.label || `Room ${index + 1}`;
      info.appendChild(name);

      const thumb = document.createElement('div');
      thumb.className = 'pano-thumb';
      thumb.style.display = 'none';
      info.appendChild(thumb);

      const actions = document.createElement('div');
      actions.className = 'pano-room-actions';

      const uploadBtn = document.createElement('label');
      uploadBtn.className = 'pano-upload-btn';
      uploadBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span>Upload 360</span>
      `;

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
          this._handleUpload(index, e.target.files[0], row);
        }
      });
      uploadBtn.appendChild(fileInput);
      actions.appendChild(uploadBtn);

      // Status icon (checkmark, hidden initially)
      const status = document.createElement('span');
      status.className = 'pano-status';
      status.textContent = '';
      status.style.display = 'none';
      actions.appendChild(status);

      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    });

    card.appendChild(list);

    // Done button
    const footer = document.createElement('div');
    footer.className = 'pano-footer';
    const doneBtn = document.createElement('button');
    doneBtn.className = 'pano-done-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => this.hide());
    footer.appendChild(doneBtn);
    card.appendChild(footer);

    this.overlay.appendChild(card);
    this.container.appendChild(this.overlay);

    // Click overlay background to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  _handleUpload(roomIndex, file, row) {
    const room = this.rooms[roomIndex];
    const center = room.center; // [x, z] in world coords

    // Show thumbnail
    const thumb = row.querySelector('.pano-thumb');
    const url = URL.createObjectURL(file);

    // Revoke previous if exists
    if (this.uploaded.has(roomIndex)) {
      URL.revokeObjectURL(this.uploaded.get(roomIndex).thumbUrl);
    }

    thumb.style.display = 'block';
    thumb.style.backgroundImage = `url(${url})`;

    // Show checkmark
    const status = row.querySelector('.pano-status');
    status.textContent = '\u2713';
    status.style.display = 'inline';

    // Update button text
    const btnSpan = row.querySelector('.pano-upload-btn span');
    btnSpan.textContent = 'Replace';

    this.uploaded.set(roomIndex, { file, thumbUrl: url });

    // Fire callback
    if (this._onPanoramaAdded) {
      this._onPanoramaAdded(file, { x: center[0], y: 1.6, z: center[1] });
    }
  }

  show() {
    this._visible = true;
    this.overlay.style.display = 'flex';
  }

  hide() {
    this._visible = false;
    this.overlay.style.display = 'none';
  }

  get visible() {
    return this._visible;
  }

  destroy() {
    // Revoke object URLs
    for (const data of this.uploaded.values()) {
      URL.revokeObjectURL(data.thumbUrl);
    }
    this.overlay.remove();
  }
}
