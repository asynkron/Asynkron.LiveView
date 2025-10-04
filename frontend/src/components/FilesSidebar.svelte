<script>
  // Mirrors the layout of the right-hand file tree panel.
  export let expanded = true;
  export let label = 'Files';
  export let path = '';

  // Files are rendered in a flat list with depth metadata for indentation.
  export let files = [];
  export let onSelect = () => {};
  export let onToggle = () => {};

  function handleSelect(file) {
    onSelect(file);
  }

  function handleToggle(file) {
    onToggle(file);
  }
</script>

<aside
  class="sidebar sidebar--files"
  class:is-expanded={expanded}
  data-sidebar="files"
>
  <div class="sidebar-collapsed-label" aria-hidden="true">{label}</div>
  <div class="sidebar-content">
    <div class="sidebar-header">
      <div class="sidebar-path">{path}</div>
    </div>
    <ul class="file-list" role="tree">
      {#if files.length}
        {#each files as file (file.id)}
          <li
            class="file-item"
            class:active={file.active}
            role="treeitem"
            aria-level={file.depth ?? 1}
            aria-expanded={file.expanded}
          >
            <div class="file-row">
              {#if file.children?.length}
                <button
                  type="button"
                  class="file-toggle"
                  aria-label={file.expanded ? 'Collapse folder' : 'Expand folder'}
                  on:click={() => handleToggle(file)}
                >
                  <i class={`fas ${file.expanded ? 'fa-chevron-down' : 'fa-chevron-right'}`}></i>
                </button>
              {:else}
                <span class="file-spacer" aria-hidden="true"></span>
              {/if}
              <button
                type="button"
                class="file-button"
                style={`padding-left: ${Math.max(0, (file.depth ?? 1) - 1) * 0.75}rem;`}
                on:click={() => handleSelect(file)}
              >
                <i class={`fas ${file.children?.length ? 'fa-folder' : 'fa-file-alt'}`}></i>
                <span class="file-name">{file.name}</span>
              </button>
            </div>
            {#if file.expanded && file.children?.length}
              <ul role="group" class="file-children">
                {#each file.children as child (child.id)}
                  <li
                    class="file-item"
                    class:active={child.active}
                    role="treeitem"
                    aria-level={(child.depth ?? (file.depth ?? 1) + 1)}
                    aria-selected={child.active ? 'true' : 'false'}
                  >
                    <button
                      type="button"
                      class="file-button"
                      style={`padding-left: ${Math.max(0, (child.depth ?? 1) - 1) * 0.75}rem;`}
                      on:click={() => handleSelect(child)}
                    >
                      <i class={`fas ${child.children?.length ? 'fa-folder' : 'fa-file-alt'}`}></i>
                      <span class="file-name">{child.name}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      {:else}
        <li class="file-empty" role="note">No files found</li>
      {/if}
    </ul>
  </div>
</aside>

<style>
  /* Layout parity with the classic file explorer sidebar. */
  .sidebar {
    width: 18rem;
    background: #0f172a;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid rgba(148, 163, 184, 0.15);
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
    display: flex;
    flex-direction: column;
  }

  .sidebar-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  }

  .sidebar-path {
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.75);
  }

  .file-list {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 0.75rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .file-item {
    display: flex;
    flex-direction: column;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .file-toggle {
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  .file-spacer {
    width: 1.5rem;
  }

  .file-button {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    border-radius: 0.35rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .file-button:hover,
  .file-button:focus-visible {
    background: rgba(96, 165, 250, 0.2);
    outline: none;
  }

  .file-item.active > .file-row > .file-button,
  .file-item.active > .file-button {
    background: rgba(59, 130, 246, 0.3);
    color: #f8fafc;
  }

  .file-children {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0 0.25rem 1.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .file-empty {
    padding: 0.75rem 1rem;
    color: rgba(226, 232, 240, 0.7);
  }
</style>
