<script>
  import { createEventDispatcher } from 'svelte';

  // Allow consumers to drive collapse, height and messaging when we plug this in for real.
  export let collapsed = false;
  export let height = 260; // pixels
  export let minHeight = 120;
  export let maxHeight = 600;
  export let statusText = '';
  export let showStatusBadge = false;
  export let showResizeHandle = true;

  const dispatch = createEventDispatcher();

  let isDragging = false;
  let dragPointerId = null;
  let dragStartY = 0;
  let dragStartHeight = height;
  let internalHeight = clamp(height);

  // Sync the incoming height prop whenever we are not in the middle of a drag gesture.
  $: if (!isDragging) {
    internalHeight = clamp(height);
  }

  $: panelStyle = collapsed
    ? undefined
    : `height: ${internalHeight}px; min-height: ${minHeight}px; max-height: ${maxHeight}px;`;

  function clamp(value) {
    return Math.min(maxHeight, Math.max(minHeight, Number(value) || minHeight));
  }

  function toggleCollapsed() {
    const nextState = !collapsed;
    collapsed = nextState;
    dispatch('toggle', { collapsed: nextState });
  }

  function handlePointerDown(event) {
    if (!showResizeHandle) {
      return;
    }

    dragPointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartHeight = internalHeight;
    isDragging = true;

    event.currentTarget.setPointerCapture(dragPointerId);
    dispatch('resizeStart', { height: internalHeight });
  }

  function handlePointerMove(event) {
    if (!isDragging || event.pointerId !== dragPointerId) {
      return;
    }

    const delta = dragStartY - event.clientY;
    internalHeight = clamp(dragStartHeight + delta);
    dispatch('resize', { height: internalHeight });
  }

  function handlePointerUp(event) {
    if (!isDragging || event.pointerId !== dragPointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(dragPointerId)) {
      event.currentTarget.releasePointerCapture(dragPointerId);
    }
    dragPointerId = null;
    isDragging = false;
    height = internalHeight;
    dispatch('resizeEnd', { height: internalHeight });
  }
</script>

<div
  class={`terminal-panel ${collapsed ? 'is-collapsed' : ''}`}
  style={panelStyle}
  aria-hidden={collapsed}
>
  <div class="terminal-toolbar">
    <button
      type="button"
      class="terminal-toggle"
      aria-pressed={!collapsed}
      on:click={toggleCollapsed}
    >
      {#if collapsed}
        Show terminal
      {:else}
        Hide terminal
      {/if}
    </button>

    <slot name="toolbar" />
  </div>

  {#if showResizeHandle}
    <div
      class="terminal-resize-handle"
      role="separator"
      aria-label="Resize terminal"
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
    />
  {/if}

  <div class="terminal-body">
    <slot />

    {#if showStatusBadge && statusText}
      <div class="terminal-status-badge" aria-live="polite">{statusText}</div>
    {/if}
  </div>
</div>

<style>
  /* Give the panel enough styling to preview it outside of the full application shell. */
  .terminal-panel {
    background: #0d1117;
    border-top: 1px solid #30363d;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 960px;
  }

  .terminal-panel.is-collapsed {
    display: none;
  }

  .terminal-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #11151a;
    border-bottom: 1px solid #30363d;
  }

  .terminal-toggle {
    appearance: none;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 0.25rem 0.75rem;
    background: #21262d;
    color: #c9d1d9;
    cursor: pointer;
  }

  .terminal-toggle:focus-visible {
    outline: 2px solid #4e9cff;
    outline-offset: 2px;
  }

  .terminal-resize-handle {
    height: 6px;
    background: linear-gradient(180deg, #30363d 0%, #21262d 100%);
    cursor: row-resize;
  }

  .terminal-body {
    position: relative;
    flex: 1 1 auto;
    min-height: 120px;
    padding: 0.5rem;
  }

  .terminal-status-badge {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: rgba(22, 27, 34, 0.85);
    border: 1px solid #30363d;
    border-radius: 0.5rem;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    color: #8b949e;
    pointer-events: none;
  }
</style>
