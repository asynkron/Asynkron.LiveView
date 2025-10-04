<script>
  // Simple props so the component can be rendered in isolation while we wire things up later.
  export let fileName = 'Markdown Viewer';
  export let isEditing = false;
  export let isPreviewing = false;

  // Callbacks allow the existing imperative code to hook in once this file is actually mounted.
  export let onEdit = () => {};
  export let onPreview = () => {};
  export let onSave = () => {};
  export let onCancel = () => {};
  export let onDownload = () => {};
  export let onDelete = () => {};

  $: previewTitle = isPreviewing
    ? 'Exit preview mode'
    : 'Preview the pending changes';
</script>

<header class="file-header">
  <h1 id="file-name">{fileName}</h1>

  <div class="file-actions">
    <button
      id="edit-button"
      type="button"
      class:hidden={isEditing}
      title="Edit the current file"
      on:click={onEdit}
    >
      <i class="fas fa-edit file-button-icon" aria-hidden="true"></i>
      <span class="sr-only">Edit</span>
    </button>

    <button
      id="preview-button"
      type="button"
      class:hidden={!isEditing}
      class:active={isPreviewing}
      title={previewTitle}
      aria-pressed={isPreviewing}
      on:click={onPreview}
    >
      <i class="fas fa-eye file-button-icon" aria-hidden="true"></i>
      <span class="sr-only">Preview</span>
    </button>

    <button
      id="save-button"
      type="button"
      class:hidden={!isEditing}
      title="Save your changes"
      on:click={onSave}
    >
      <i class="fas fa-save file-button-icon" aria-hidden="true"></i>
      <span class="sr-only">Save</span>
    </button>

    <button
      id="cancel-button"
      type="button"
      class:hidden={!isEditing}
      title="Cancel editing"
      on:click={onCancel}
    >
      <i class="fas fa-times file-button-icon" aria-hidden="true"></i>
      <span class="sr-only">Cancel</span>
    </button>

    <button
      id="download-button"
      type="button"
      title="Download the current file"
      on:click={onDownload}
    >
      <i class="fas fa-download file-button-icon" aria-hidden="true"></i>
      <span class="sr-only">Download</span>
    </button>

    <button
      id="delete-button"
      type="button"
      title="Delete the current file"
      on:click={onDelete}
    >
      <i class="fas fa-trash file-button-icon" aria-hidden="true"></i>
      <span class="sr-only">Delete</span>
    </button>
  </div>
</header>

<style>
  /* Keeps the component visually consistent when rendered by itself during migration. */
  .file-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
  }

  .file-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0.35rem;
    color: inherit;
    cursor: pointer;
  }

  button:focus-visible {
    outline: 2px solid var(--accent-color, #4e9cff);
    outline-offset: 2px;
  }

  .file-button-icon {
    font-size: 1rem;
  }

  .hidden {
    display: none;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
</style>
