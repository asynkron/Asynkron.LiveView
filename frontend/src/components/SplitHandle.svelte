<script>
  import { createEventDispatcher } from 'svelte';

  // Orientation lets us reuse the same component for vertical and horizontal dividers.
  export let orientation = 'vertical'; // or 'horizontal'
  export let thickness = 8;
  export let disabled = false;

  const dispatch = createEventDispatcher();

  let activePointer = null;
  let startPos = 0;

  function axis(event) {
    return orientation === 'horizontal' ? event.clientY : event.clientX;
  }

  function handlePointerDown(event) {
    if (disabled) {
      return;
    }

    activePointer = event.pointerId;
    startPos = axis(event);
    event.currentTarget.setPointerCapture(activePointer);

    dispatch('resizeStart', { orientation });
  }

  function handlePointerMove(event) {
    if (disabled || activePointer === null || event.pointerId !== activePointer) {
      return;
    }

    const current = axis(event);
    const delta = current - startPos;
    dispatch('resize', { orientation, delta });
  }

  function finishGesture(event) {
    if (activePointer === null || event.pointerId !== activePointer) {
      return;
    }

    if (event.currentTarget.hasPointerCapture?.(activePointer)) {
      event.currentTarget.releasePointerCapture(activePointer);
    }

    activePointer = null;
    dispatch('resizeEnd', { orientation });
  }

  $: style =
    orientation === 'horizontal'
      ? `height: ${thickness}px; cursor: row-resize;`
      : `width: ${thickness}px; cursor: col-resize;`;
</script>

<div
  role="separator"
  class={`split-handle ${orientation}`}
  class:disabled={disabled}
  aria-orientation={orientation}
  tabindex={disabled ? undefined : 0}
  style={style}
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={finishGesture}
  on:pointercancel={finishGesture}
  on:lostpointercapture={() => (activePointer = null)}
></div>

<style>
  /* Thin gradient bar that mirrors the original sidebar splitters. */
  .split-handle {
    background: linear-gradient(180deg, rgba(48, 54, 61, 0.85), rgba(29, 35, 42, 0.85));
    position: relative;
    flex: 0 0 auto;
    touch-action: none;
  }

  .split-handle.vertical::after,
  .split-handle.horizontal::after {
    content: '';
    position: absolute;
    inset: 30%;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.45);
  }

  .split-handle.vertical::after {
    width: 2px;
    left: calc(50% - 1px);
  }

  .split-handle.horizontal::after {
    height: 2px;
    top: calc(50% - 1px);
  }

  .split-handle:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.5);
    outline-offset: 2px;
  }

  .split-handle.disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
