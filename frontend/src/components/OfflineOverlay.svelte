<script>
  // Boolean prop so the host can toggle the overlay without recreating it.
  export let visible = false;

  // Allow customizing the message copy for future reuse/testing scenarios.
  export let title = 'Connection Lost';
  export let description = 'Reconnecting to the live view server...';
  export let showSpinner = true;
</script>

<div
  id="offline-overlay"
  class="offline-overlay"
  class:hidden={!visible}
  aria-hidden={!visible}
>
  <div class="offline-message" role="status" aria-live="polite">
    {#if showSpinner}
      <div class="offline-spinner" aria-hidden="true"></div>
    {/if}
    <h3 class="offline-title">{title}</h3>
    <p class="offline-description">{description}</p>
  </div>
</div>

<style>
  /* Mirror the existing overlay visuals so previews stay true to production. */
  .offline-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(15, 23, 42, 0.8);
    z-index: 2000;
  }

  .offline-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
    border-radius: 0.5rem;
    background: #111827;
    color: #f9fafb;
    text-align: center;
    min-width: 18rem;
    box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.45);
  }

  .offline-spinner {
    width: 3rem;
    height: 3rem;
    border-radius: 9999px;
    border: 0.35rem solid rgba(255, 255, 255, 0.25);
    border-top-color: #60a5fa;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .offline-title {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .offline-description {
    font-size: 0.95rem;
    color: rgba(249, 250, 251, 0.8);
    margin: 0;
  }

  .hidden {
    display: none;
  }
</style>
