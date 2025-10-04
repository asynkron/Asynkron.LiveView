<script>
  import { createEventDispatcher } from 'svelte';

  export let title = 'Panel unavailable';
  export let description = 'This area will show its content once the feature is wired up.';
  export let actions = [];

  const dispatch = createEventDispatcher();

  function handleAction(action) {
    dispatch('action', { action });
    action.onSelect?.(action);
  }
</script>

<section class="panel-placeholder" role="note">
  <h2 class="panel-title">{title}</h2>
  <p class="panel-description">{description}</p>

  {#if actions.length}
    <div class="panel-actions">
      {#each actions as action (action.id ?? action.label)}
        <button
          type="button"
          class={`panel-action ${action.variant ?? 'secondary'}`}
          on:click={() => handleAction(action)}
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  /* Matches the warning tone used when dockview panels go missing. */
  .panel-placeholder {
    padding: 1.25rem;
    background: rgba(248, 113, 113, 0.08);
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: 0.75rem;
    color: #fecaca;
    font-size: 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .panel-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: #fca5a5;
  }

  .panel-description {
    margin: 0;
    color: rgba(254, 226, 226, 0.85);
    line-height: 1.5;
  }

  .panel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .panel-action {
    appearance: none;
    border-radius: 0.5rem;
    padding: 0.45rem 0.9rem;
    border: 1px solid transparent;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .panel-action.primary {
    background: rgba(248, 113, 113, 0.85);
    color: #0f172a;
  }

  .panel-action.primary:hover,
  .panel-action.primary:focus-visible {
    background: rgba(248, 113, 113, 0.95);
  }

  .panel-action.secondary {
    background: transparent;
    color: inherit;
    border-color: rgba(248, 113, 113, 0.35);
  }

  .panel-action.secondary:hover,
  .panel-action.secondary:focus-visible {
    border-color: rgba(248, 113, 113, 0.6);
    background: rgba(248, 113, 113, 0.15);
  }

  .panel-action:focus-visible {
    outline: 2px solid rgba(248, 113, 113, 0.6);
    outline-offset: 2px;
  }
</style>
