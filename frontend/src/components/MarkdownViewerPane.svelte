<script>
  // Presents the rendered markdown area alongside an optional editor placeholder.
  export let title = 'Markdown Viewer';
  export let html = '';
  export let emptyMessage = 'Select a file to view its contents.';
  export let showContent = true;
  export let showEditor = false;
  export let editorPlaceholder = 'Editor goes here once wired up.';
</script>

<section class="viewer">
  <slot name="header">
    <header class="file-header">
      <h1>{title}</h1>
    </header>
  </slot>

  {#if showContent}
    <div class="content-area" class:hidden={!showContent}>
      {#if html}
        <article class="rendered-markdown" aria-live="polite">{@html html}</article>
      {:else}
        <p class="viewer-placeholder">{emptyMessage}</p>
      {/if}
    </div>
  {/if}

  {#if showEditor}
    <div class="editor-container visible">
      <slot name="editor">
        <div class="editor-placeholder">{editorPlaceholder}</div>
      </slot>
    </div>
  {/if}
</section>

<style>
  /* Minimal styling so the viewer stands alone while we port more logic. */
  .viewer {
    display: flex;
    flex-direction: column;
    background: #161b22;
    border: 1px solid #30363d;
    min-height: 320px;
    max-width: 960px;
  }

  .hidden {
    display: none;
  }

  .file-header {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #30363d;
    margin: 0;
  }

  .file-header h1 {
    margin: 0;
    color: #58a6ff;
    font-size: 1.5rem;
  }

  .content-area {
    flex: 1 1 auto;
    padding: 1.5rem;
    overflow: auto;
  }

  .viewer-placeholder {
    margin: 2rem 0;
    color: #8b949e;
  }

  .editor-container {
    display: none;
    min-height: 240px;
    padding: 1rem;
    background: #0d1117;
  }

  .editor-container.visible {
    display: block;
  }

  .editor-placeholder {
    border: 1px dashed #30363d;
    border-radius: 6px;
    padding: 1.5rem;
    color: #8b949e;
    text-align: center;
  }
</style>
