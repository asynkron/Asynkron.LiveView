<script>
  import { createEventDispatcher } from 'svelte';

  // Mirrors the layout of the legacy HTML shell so we can slot components in later.
  export let tocVisible = true;
  export let tocCollapsed = false;
  export let tocLabel = 'ToC';
  export let filesVisible = true;
  export let filesCollapsed = false;
  export let filesLabel = 'Files';

  const dispatch = createEventDispatcher();

  function toggleSidebar(name) {
    if (name === 'toc') {
      tocCollapsed = !tocCollapsed;
      dispatch('toggleSidebar', { name, collapsed: tocCollapsed });
      return;
    }

    if (name === 'files') {
      filesCollapsed = !filesCollapsed;
      dispatch('toggleSidebar', { name, collapsed: filesCollapsed });
    }
  }
</script>

<div class="app-shell">
  {#if tocVisible}
    <aside
      class={`sidebar sidebar--toc ${tocCollapsed ? '' : 'is-expanded'} ${tocCollapsed ? 'is-collapsed' : ''}`}
      data-sidebar="toc"
      aria-hidden={tocCollapsed}
    >
      <div class="sidebar-collapsed-label" aria-hidden="true">{tocLabel}</div>
      <div class="sidebar-content" class:hidden={tocCollapsed}>
        <header class="sidebar-header">
          <button type="button" class="sidebar-toggle" on:click={() => toggleSidebar('toc')}>
            {tocCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </header>
        <slot name="toc">Add your ToC markup here.</slot>
      </div>
    </aside>
  {/if}

  <section class="viewer">
    <slot name="viewer" />
  </section>

  {#if filesVisible}
    <aside
      class={`sidebar sidebar--files ${filesCollapsed ? '' : 'is-expanded'} ${filesCollapsed ? 'is-collapsed' : ''}`}
      data-sidebar="files"
      aria-hidden={filesCollapsed}
    >
      <div class="sidebar-collapsed-label" aria-hidden="true">{filesLabel}</div>
      <div class="sidebar-content" class:hidden={filesCollapsed}>
        <header class="sidebar-header">
          <button type="button" class="sidebar-toggle" on:click={() => toggleSidebar('files')}>
            {filesCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </header>
        <slot name="files">Add your file tree markup here.</slot>
      </div>
    </aside>
  {/if}
</div>

<style>
  /* Lightweight styles so the shell looks familiar in Storybook or the REPL. */
  .app-shell {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 320px;
    gap: 0;
    background: #0d1117;
    color: #c9d1d9;
    border: 1px solid #30363d;
    min-height: 480px;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    border-right: 1px solid #30363d;
    background: #161b22;
  }

  .sidebar--files {
    border-right: none;
    border-left: 1px solid #30363d;
  }

  .sidebar.is-collapsed {
    width: 48px;
    overflow: hidden;
  }

  .sidebar-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem;
  }

  .hidden {
    display: none;
  }

  .sidebar-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.5rem;
  }

  .sidebar-toggle {
    appearance: none;
    border: 1px solid #30363d;
    border-radius: 4px;
    background: #21262d;
    color: #c9d1d9;
    padding: 0.25rem 0.75rem;
    cursor: pointer;
  }

  .sidebar-toggle:focus-visible {
    outline: 2px solid #4e9cff;
    outline-offset: 2px;
  }

  .sidebar-collapsed-label {
    text-align: center;
    padding: 0.25rem 0;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #8b949e;
  }

  .viewer {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #161b22;
  }

  @media (max-width: 980px) {
    .app-shell {
      grid-template-columns: 1fr;
    }

    .sidebar,
    .viewer {
      grid-column: 1 / -1;
    }

    .sidebar {
      border-left: none;
      border-right: none;
      border-bottom: 1px solid #30363d;
    }
  }
</style>
