<script>
  // Toggle visibility so the dialog can be mounted once and reused.
  export let visible = false;

  // Copy is configurable to keep the component flexible for other prompts.
  export let title = 'Unsaved changes';
  export let message = 'You have unsaved changes in';
  export let filename = '';
  export let detail = 'What would you like to do?';

  // Consumers can pass their own handlers to wire up real behavior later.
  export let onSave = () => {};
  export let onDiscard = () => {};
  export let onCancel = () => {};

  // Emit focus back to the host when the dialog closes.
  export let onClose = () => {};

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }
</script>

<div
  id="unsaved-changes-modal"
  class="dialog-overlay"
  class:hidden={!visible}
  role="dialog"
  aria-modal="true"
  aria-labelledby="unsaved-changes-title"
  aria-describedby="unsaved-changes-message"
  tabindex="-1"
  on:click={handleBackdropClick}
>
  <div class="dialog-window">
    <h3 id="unsaved-changes-title">{title}</h3>
    <p id="unsaved-changes-message">
      {message}
      {#if filename}
        <span class="dialog-filename">{filename}</span>
      {/if}.
    </p>
    <p id="unsaved-changes-detail" class="dialog-detail">{detail}</p>
    <div class="dialog-actions">
      <button type="button" class="primary" on:click={onSave}>Save changes</button>
      <button type="button" class="secondary" on:click={onDiscard}>Discard</button>
      <button type="button" class="secondary" on:click={onCancel}>Cancel</button>
    </div>
  </div>
</div>

<style>
  /* Keep parity with the existing modal styles for a painless drop-in later. */
  .dialog-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.75);
    z-index: 2100;
  }

  .dialog-window {
    width: min(28rem, 90vw);
    background: #1f2937;
    color: #f9fafb;
    border-radius: 0.75rem;
    padding: 2rem;
    box-shadow: 0 2rem 4rem rgba(0, 0, 0, 0.4);
  }

  h3 {
    margin: 0 0 1rem;
    font-size: 1.4rem;
    font-weight: 600;
  }

  p {
    margin: 0 0 0.75rem;
    line-height: 1.5;
  }

  .dialog-filename {
    font-weight: 600;
    color: #60a5fa;
  }

  .dialog-detail {
    color: rgba(249, 250, 251, 0.75);
  }

  .dialog-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-top: 1.5rem;
  }

  button {
    padding: 0.5rem 1rem;
    border-radius: 9999px;
    border: none;
    font-weight: 600;
    cursor: pointer;
  }

  .primary {
    background: #3b82f6;
    color: #0b1120;
  }

  .secondary {
    background: rgba(148, 163, 184, 0.15);
    color: #e5e7eb;
  }

  button:focus-visible {
    outline: 3px solid rgba(96, 165, 250, 0.75);
    outline-offset: 2px;
  }

  .hidden {
    display: none;
  }
</style>
