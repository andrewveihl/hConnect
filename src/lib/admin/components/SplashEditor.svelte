<script lang="ts">
  import type { SplashConfig, CachedSplashGif } from '$lib/admin/customization';
  import { uploadSplashGif, deleteSplashGif } from '$lib/admin/customization';
  import type { User } from 'firebase/auth';

  interface Props {
    config: SplashConfig;
    cachedGifs: CachedSplashGif[];
    user: User;
    onSave: (config: Partial<SplashConfig>) => Promise<void>;
    onReset: () => Promise<void>;
    onGifUploaded: () => void;
    onGifDeleted: () => void;
  }

  let { config, cachedGifs, user, onSave, onReset, onGifUploaded, onGifDeleted }: Props = $props();
  
  let saving = $state(false);
  let uploading = $state(false);
  let showPreview = $state(false);
  let previewKey = $state(0);
  let showGifLibrary = $state(false);
  let dragOver = $state(false);
  let uploadError = $state<string | null>(null);

  // Editable values
  let gifUrl = $state(config.gifUrl);
  let gifDuration = $state(config.gifDuration);
  let backgroundColor = $state(config.backgroundColor);
  let enabled = $state(config.enabled);

  // Sync with prop changes
  $effect(() => {
    gifUrl = config.gifUrl;
    gifDuration = config.gifDuration;
    backgroundColor = config.backgroundColor;
    enabled = config.enabled;
  });

  // Track modifications
  const hasChanges = $derived(
    gifUrl !== config.gifUrl ||
    gifDuration !== config.gifDuration ||
    backgroundColor !== config.backgroundColor ||
    enabled !== config.enabled
  );

  async function handleSave() {
    saving = true;
    try {
      await onSave({
        gifUrl,
        gifDuration,
        backgroundColor,
        enabled
      });
    } finally {
      saving = false;
    }
  }

  async function handleReset() {
    saving = true;
    try {
      await onReset();
    } finally {
      saving = false;
    }
  }

  function playPreview() {
    showPreview = true;
    previewKey++;
    setTimeout(() => {
      showPreview = false;
    }, gifDuration + 500);
  }

  function openFullPreview() {
    window.open('/splash', '_blank', 'noopener');
  }

  // GIF Upload handling
  async function handleFileUpload(file: File) {
    uploadError = null;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      uploadError = 'Please upload an image file (GIF, PNG, JPG)';
      return;
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      uploadError = 'File size must be under 10MB';
      return;
    }

    uploading = true;
    try {
      const uploaded = await uploadSplashGif(file, user);
      gifUrl = uploaded.url;
      onGifUploaded();
    } catch (err) {
      console.error('Upload failed:', err);
      uploadError = 'Failed to upload file. Please try again.';
    } finally {
      uploading = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) handleFileUpload(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFileUpload(file);
    input.value = ''; // Reset for re-upload
  }

  function selectCachedGif(gif: CachedSplashGif) {
    gifUrl = gif.url;
    showGifLibrary = false;
  }

  async function handleDeleteGif(gif: CachedSplashGif, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete "${gif.name}"? This cannot be undone.`)) return;
    
    try {
      await deleteSplashGif(gif.id, user);
      onGifDeleted();
      // If currently using this gif, clear the url
      if (gifUrl === gif.url) {
        gifUrl = config.gifUrl;
      }
    } catch (err) {
      console.error('Delete failed:', err);
      uploadError = 'Failed to delete GIF';
    }
  }
</script>

<div class="splash-editor">
  <div class="editor-content">
    <!-- Preview area -->
    <div class="preview-container" style="background: {backgroundColor}">
      {#if showPreview}
        {#key previewKey}
          <img
            src={gifUrl}
            alt="Splash preview"
            class="preview-gif"
          />
        {/key}
      {:else}
        <div class="preview-placeholder">
          <i class='bx bx-play-circle'></i>
          <span>Click to preview animation</span>
        </div>
      {/if}
      <button class="play-overlay" onclick={playPreview} aria-label="Play splash animation">
        {#if !showPreview}
          <i class='bx bx-play'></i>
        {/if}
      </button>
      {#if !enabled}
        <div class="disabled-badge">
          <i class='bx bx-hide'></i>
          Disabled
        </div>
      {/if}
    </div>

    <!-- GIF Source Section -->
    <div class="gif-source-section">
      <div class="section-header">
        <span class="section-label">GIF Source</span>
        <button 
          class="library-btn"
          onclick={() => (showGifLibrary = !showGifLibrary)}
          class:active={showGifLibrary}
        >
          <i class='bx bx-folder-open'></i>
          {cachedGifs.length > 0 ? `Library (${cachedGifs.length})` : 'Library'}
        </button>
      </div>

      {#if showGifLibrary && cachedGifs.length > 0}
        <div class="gif-library">
          {#each cachedGifs as gif (gif.id)}
            <div class="gif-item" class:active={gifUrl === gif.url}>
              <button 
                class="gif-select-btn"
                onclick={() => selectCachedGif(gif)}
                aria-label="Select {gif.name}"
              >
                <img src={gif.url} alt={gif.name} class="gif-thumb" />
                <span class="gif-name">{gif.name}</span>
              </button>
              <button 
                class="delete-gif-btn"
                onclick={(e) => handleDeleteGif(gif, e)}
                title="Delete GIF"
                aria-label="Delete {gif.name}"
              >
                <i class='bx bx-trash'></i>
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Upload Zone -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="upload-zone"
        class:drag-over={dragOver}
        class:uploading
        ondrop={handleDrop}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        role="region"
        aria-label="Upload splash GIF"
      >
        {#if uploading}
          <i class='bx bx-loader-alt bx-spin'></i>
          <span>Uploading...</span>
        {:else}
          <i class='bx bx-cloud-upload'></i>
          <span>Drop a GIF here or <label class="upload-label">browse<input type="file" accept="image/*" onchange={handleFileSelect} /></label></span>
          <span class="upload-hint">Max 10MB • GIF, PNG, JPG</span>
        {/if}
      </div>

      {#if uploadError}
        <div class="upload-error">
          <i class='bx bx-error-circle'></i>
          {uploadError}
        </div>
      {/if}

      <!-- Manual URL Input -->
      <label class="setting-field url-field">
        <span class="setting-label">Or enter URL directly</span>
        <input
          type="text"
          bind:value={gifUrl}
          placeholder="/HS_splash_reveal.gif"
          class="text-input"
        />
      </label>
    </div>

    <!-- Settings -->
    <div class="settings-grid">
      <div class="setting-field toggle-field">
        <div class="setting-info">
          <span class="setting-label">Enable Splash</span>
          <span class="setting-desc">Show splash animation on app load</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" bind:checked={enabled} />
          <span class="toggle-track"></span>
        </label>
      </div>

      <div class="setting-row">
        <label class="setting-field compact">
          <span class="setting-label">Duration</span>
          <div class="number-input-wrapper">
            <input
              type="number"
              bind:value={gifDuration}
              min="500"
              max="10000"
              step="100"
              class="text-input"
            />
            <span class="unit">ms</span>
          </div>
        </label>

        <label class="setting-field compact">
          <span class="setting-label">Background</span>
          <div class="color-input-wrapper">
            <input
              type="color"
              bind:value={backgroundColor}
              class="color-picker"
            />
            <input
              type="text"
              bind:value={backgroundColor}
              placeholder="#0a0f14"
              class="text-input color-text"
            />
          </div>
        </label>
      </div>
    </div>
  </div>

  <div class="editor-actions">
    <button class="btn-reset" onclick={handleReset} disabled={saving}>
      <i class='bx bx-reset'></i>
      Reset
    </button>
    <button class="btn-save" onclick={handleSave} disabled={saving || !hasChanges}>
      {#if saving}
        <i class='bx bx-loader-alt bx-spin'></i>
      {:else}
        <i class='bx bx-check'></i>
      {/if}
      Deploy Splash
    </button>
  </div>
</div>

<style>
  .splash-editor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .editor-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Preview */
  .preview-container {
    position: relative;
    aspect-ratio: 16/9;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  .preview-gif {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .preview-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.8125rem;
  }

  .preview-placeholder i {
    font-size: 2.5rem;
  }

  .play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.2s;
  }

  .play-overlay:hover {
    background: rgba(0, 0, 0, 0.3);
  }

  .play-overlay i {
    font-size: 3.5rem;
    color: white;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .play-overlay:hover i {
    opacity: 1;
  }

  .disabled-badge {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: rgba(239, 68, 68, 0.9);
    border-radius: 6px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: white;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .disabled-badge i {
    font-size: 0.75rem;
  }

  /* GIF Source Section */
  .gif-source-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-secondary);
  }

  .library-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 0.6875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .library-btn:hover,
  .library-btn.active {
    background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 10%, transparent);
    border-color: var(--accent-primary, var(--color-accent));
    color: var(--accent-primary, var(--color-accent));
  }

  .library-btn i {
    font-size: 0.875rem;
  }

  /* GIF Library */
  .gif-library {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 0.5rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
    border-radius: 10px;
    max-height: 200px;
    overflow-y: auto;
  }

  .gif-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
    border: 2px solid transparent;
    border-radius: 8px;
    transition: all 0.2s;
  }

  .gif-item:hover {
    background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
  }

  .gif-item.active {
    border-color: var(--accent-primary, var(--color-accent));
    background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 10%, transparent);
  }

  .gif-select-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem;
    width: 100%;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .gif-thumb {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: 6px;
    background: #000;
  }

  .gif-name {
    font-size: 0.625rem;
    color: var(--color-text-secondary);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    max-width: 100%;
    text-align: center;
  }

  .delete-gif-btn {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.9);
    color: white;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .gif-item:hover .delete-gif-btn {
    opacity: 1;
  }

  .delete-gif-btn:hover {
    background: #dc2626;
  }

  /* Upload Zone */
  .upload-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    border: 2px dashed color-mix(in srgb, var(--color-text-primary) 20%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
    transition: all 0.2s;
  }

  .upload-zone.drag-over {
    border-color: var(--accent-primary, var(--color-accent));
    background: color-mix(in srgb, var(--accent-primary, var(--color-accent)) 10%, transparent);
  }

  .upload-zone.uploading {
    pointer-events: none;
    opacity: 0.7;
  }

  .upload-zone i {
    font-size: 1.75rem;
    color: var(--color-text-secondary);
  }

  .upload-zone span {
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
  }

  .upload-label {
    color: var(--accent-primary, var(--color-accent));
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  .upload-label input {
    display: none;
  }

  .upload-hint {
    font-size: 0.6875rem !important;
    opacity: 0.7;
  }

  .upload-error {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: color-mix(in srgb, #ef4444 15%, transparent);
    border-radius: 8px;
    font-size: 0.75rem;
    color: #ef4444;
  }

  .upload-error i {
    font-size: 1rem;
  }

  /* Settings */
  .settings-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .setting-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
    border-radius: 10px;
  }

  .setting-field.url-field {
    padding: 0.625rem 0.75rem;
  }

  .setting-field.toggle-field {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .setting-field.compact {
    flex: 1;
    padding: 0.625rem 0.75rem;
  }

  .setting-row {
    display: flex;
    gap: 0.5rem;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
  }

  .setting-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .setting-desc {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }

  .text-input {
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
    background: transparent;
    color: var(--color-text-primary);
    font-size: 0.8125rem;
  }

  .text-input:focus {
    outline: none;
    border-color: var(--accent-primary, var(--color-accent));
  }

  .text-input.color-text {
    flex: 1;
    font-family: monospace;
    text-transform: uppercase;
    font-size: 0.75rem;
  }

  .number-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .number-input-wrapper .text-input {
    flex: 1;
  }

  .unit {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .color-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .color-picker {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 2px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
    border-radius: 6px;
    cursor: pointer;
    overflow: hidden;
    flex-shrink: 0;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .color-picker::-webkit-color-swatch {
    border: none;
    border-radius: 4px;
  }

  /* Toggle */
  .toggle-switch {
    position: relative;
    width: 2.75rem;
    height: 1.5rem;
    flex-shrink: 0;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-track {
    position: absolute;
    inset: 0;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-text-primary) 20%, transparent);
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle-track::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: transform 0.2s;
  }

  .toggle-switch input:checked + .toggle-track {
    background: #10b981;
  }

  .toggle-switch input:checked + .toggle-track::before {
    transform: translateX(1.25rem);
  }

  /* Actions */
  .editor-actions {
    display: flex;
    gap: 0.625rem;
  }

  .btn-reset,
  .btn-save {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-reset {
    border: 1px solid color-mix(in srgb, var(--color-text-primary) 15%, transparent);
    background: transparent;
    color: var(--color-text-secondary);
  }

  .btn-reset:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
    color: var(--color-text-primary);
  }

  .btn-save {
    border: none;
    background: linear-gradient(135deg, var(--accent-primary, var(--color-accent)), color-mix(in srgb, var(--accent-primary, var(--color-accent)) 80%, #10b981));
    color: white;
  }

  .btn-save:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-reset:disabled,
  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .setting-row {
      flex-direction: column;
    }

    .gif-library {
      grid-template-columns: repeat(3, 1fr);
    }
  }
</style>
