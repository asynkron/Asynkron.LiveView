<script>
  import { createEventDispatcher } from 'svelte';

  /**
   * Panels mirror the legacy data attributes so the imperative bootstrap code can
   * discover them later on. We keep the shape simple so tests or stories can feed
   * mocked toggles while we migrate piecemeal.
   */
  export let panels = [
    { id: 'toc', label: 'Table of contents', active: true },
    { id: 'files', label: 'Files', active: true },
    { id: 'terminal', label: 'Terminal', active: true }
  ];

  const dispatch = createEventDispatcher();

  function handleToggle(panel) {
    if (panel.disabled) {
      return;
    }

    const nextActive = !panel.active;
    dispatch('toggle', { id: panel.id, active: nextActive, panel });
  }
</script>

<nav class="panel-toggle-rail" aria-label="Toggle panels">
  {#each panels as panel (panel.id)}
    <button
      type="button"
      class="panel-toggle"
      class:active={panel.active}
      class:disabled={panel.disabled}
      data-panel-toggle={panel.id}
      aria-pressed={panel.active}
      aria-controls={panel.controls}
      disabled={panel.disabled}
      on:click={() => handleToggle(panel)}
    >
      {#if panel.icon}
        <i class={`panel-toggle-icon ${panel.icon}`} aria-hidden="true"></i>
      {/if}
      <span class="panel-toggle-label">{panel.shortLabel ?? panel.label}</span>
    </button>
  {/each}
</nav>

<style>
  /* Compact strip that matches the dock/legacy toggle button layout. */
  .panel-toggle-rail {
    display: inline-flex;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 0.5rem;
    background: rgba(56, 63, 79, 0.35);
    border: 1px solid rgba(99, 110, 139, 0.35);
  }

  .panel-toggle {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.65rem;
    border: 1px solid transparent;
    border-radius: 0.45rem;
    font-size: 0.85rem;
    background: rgba(17, 24, 39, 0.65);
    color: #d1d9e6;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  }

  .panel-toggle:hover,
  .panel-toggle:focus-visible {
    background: rgba(37, 99, 235, 0.25);
    border-color: rgba(59, 130, 246, 0.4);
    outline: none;
  }

  .panel-toggle:focus-visible {
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35);
  }

  .panel-toggle.active {
    background: rgba(59, 130, 246, 0.3);
    border-color: rgba(59, 130, 246, 0.6);
    color: #f8fafc;
  }

  .panel-toggle.disabled,
  .panel-toggle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .panel-toggle-icon {
    font-size: 0.85rem;
  }

  .panel-toggle-label {
    line-height: 1;
    white-space: nowrap;
  }
</style>
