<script>
  // Flag to match the CSS-driven expand/collapse behavior of the legacy sidebar.
  export let expanded = true;

  // Accessible label and collapsed badge text stay customizable.
  export let label = 'ToC';

  // Simple array of headings so consuming code can render whatever it needs.
  export let items = [];
  export let onSelect = () => {};

  function handleSelect(item) {
    onSelect(item);
  }
</script>

<aside
  class="sidebar sidebar--toc"
  class:is-expanded={expanded}
  data-sidebar="toc"
>
  <div class="sidebar-collapsed-label" aria-hidden="true">{label}</div>
  <div class="sidebar-content">
    <nav aria-label="Table of contents">
      {#if items.length}
        <ul class="toc-list" role="tree">
          {#each items as item (item.id)}
            <li
              class="toc-item"
              role="treeitem"
              aria-level={item.level ?? 1}
              aria-selected={item.active ? 'true' : 'false'}
            >
              <button
                type="button"
                class="toc-link"
                class:active={item.active}
                style={`padding-left: ${Math.max(0, (item.level ?? 1) - 1) * 0.75}rem;`}
                on:click={() => handleSelect(item)}
              >
                <span class="toc-text">{item.title}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="toc-empty" role="note">No headings available</p>
      {/if}
    </nav>
  </div>
</aside>

<style>
  /* Replicates the shell layout for the left-hand table of contents. */
  .sidebar {
    width: 18rem;
    background: #0f172a;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid rgba(148, 163, 184, 0.15);
  }

  .sidebar:not(.is-expanded) {
    width: 3rem;
  }

  .sidebar-collapsed-label {
    writing-mode: vertical-rl;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-size: 0.75rem;
    padding: 0.5rem;
    text-align: center;
    background: rgba(148, 163, 184, 0.1);
  }

  .sidebar-content {
    flex: 1;
    overflow: auto;
    padding: 1rem;
  }

  .toc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .toc-item {
    display: flex;
  }

  .toc-link {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    padding: 0.35rem 0.5rem;
    border-radius: 0.35rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .toc-link:hover,
  .toc-link:focus-visible {
    background: rgba(96, 165, 250, 0.2);
    outline: none;
  }

  .toc-link.active {
    background: rgba(59, 130, 246, 0.3);
    color: #f8fafc;
  }

  .toc-empty {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.7);
  }
</style>
