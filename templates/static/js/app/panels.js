export function setupPanels(ctx) {
    const {
        panelToggleButtons,
        panelToggleButtonMap,
        dom: {
            rootElement,
            tocSidebar,
            fileSidebar,
            tocSplitter,
            fileSplitter,
            dockviewRoot,
            appShell,
            viewerSection,
            terminalPanel,
            body,
        },
    } = ctx;

    function updatePanelToggleButtonState(name, isVisible) {
        const button = panelToggleButtonMap.get(name);
        if (!button) {
            return;
        }
        button.setAttribute('aria-pressed', String(Boolean(isVisible)));
    }

    function getPanelVisibility(name) {
        const setup = ctx.dockviewSetup;
        if (setup && setup.panels && setup.panels[name]) {
            const panel = setup.panels[name];
            const groupApi = panel?.group?.api;
            if (groupApi && typeof groupApi.isVisible === 'boolean') {
                return groupApi.isVisible;
            }
            return panel?.api?.isVisible ?? true;
        }

        if (name === 'toc' && tocSidebar) {
            return !tocSidebar.classList.contains('hidden');
        }

        if (name === 'files' && fileSidebar) {
            return !fileSidebar.classList.contains('hidden');
        }

        return true;
    }

    function toggleLegacySidebar(name, visible) {
        const targetSidebar = name === 'toc' ? tocSidebar : name === 'files' ? fileSidebar : null;
        if (!targetSidebar) {
            return;
        }

        targetSidebar.classList.toggle('hidden', !visible);
        targetSidebar.classList.toggle('is-expanded', visible);

        const widthVar = name === 'toc' ? '--toc-sidebar-current-width' : '--file-sidebar-current-width';
        const defaultWidth = name === 'toc' ? 'var(--toc-sidebar-width)' : 'var(--file-sidebar-width)';

        if (rootElement) {
            rootElement.style.setProperty(widthVar, visible ? defaultWidth : 'var(--sidebar-collapsed-width)');
        }

        const splitter = name === 'toc' ? tocSplitter : fileSplitter;
        if (splitter) {
            splitter.classList.toggle('hidden', !visible);
        }
    }

    function setPanelVisibility(name, visible) {
        const setup = ctx.dockviewSetup;
        if (setup && setup.panels && setup.panels[name]) {
            const panel = setup.panels[name];
            const groupApi = panel?.group?.api;
            if (groupApi && typeof groupApi.setVisible === 'function') {
                groupApi.setVisible(visible);
            } else if (panel?.api && typeof panel.api.setVisible === 'function') {
                panel.api.setVisible(visible);
            }
        } else {
            toggleLegacySidebar(name, visible);
        }

        if (name === 'toc' && tocSidebar) {
            tocSidebar.classList.toggle('is-expanded', visible);
        } else if (name === 'files' && fileSidebar) {
            fileSidebar.classList.toggle('is-expanded', visible);
        }

        updatePanelToggleButtonState(name, visible);
        window.requestAnimationFrame(() => {
            updatePanelToggleButtonState(name, getPanelVisibility(name));
        });
    }

    function refreshPanelToggleStates() {
        panelToggleButtonMap.forEach((_button, name) => {
            updatePanelToggleButtonState(name, getPanelVisibility(name));
        });
    }

    function initialiseDockviewLayout() {
        window.__dockviewSetup = null;

        if (!dockviewRoot) {
            return null;
        }

        if (!window.dockview || !window.dockview.DockviewComponent) {
            dockviewRoot.classList.add('hidden');
            if (appShell) {
                appShell.classList.remove('hidden');
            }
            return null;
        }

        if (!viewerSection || !tocSidebar || !fileSidebar || !terminalPanel) {
            console.warn('Dockview initialisation skipped: missing panel sources.');
            dockviewRoot.classList.add('hidden');
            if (appShell) {
                appShell.classList.remove('hidden');
            }
            return null;
        }

        if (tocSplitter && tocSplitter.parentElement) {
            tocSplitter.parentElement.removeChild(tocSplitter);
        }
        if (fileSplitter && fileSplitter.parentElement) {
            fileSplitter.parentElement.removeChild(fileSplitter);
        }

        const panelSources = {
            viewer: viewerSection,
            toc: tocSidebar,
            files: fileSidebar,
            terminal: terminalPanel,
        };

        tocSidebar.classList.add('is-expanded');
        fileSidebar.classList.add('is-expanded');

        const dockview = new window.dockview.DockviewComponent(dockviewRoot, {
            hideBorders: true,
            createComponent({ name }) {
                const element = document.createElement('div');
                element.classList.add('dockview-panel-container', `dockview-panel-${name}`);
                const source = panelSources[name];
                if (source) {
                    element.appendChild(source);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'panel-missing';
                    placeholder.textContent = `Missing panel: ${name}`;
                    element.appendChild(placeholder);
                }

                return {
                    element,
                    init() { },
                    dispose() { },
                };
            },
        });

        const currentViewerTitle = (typeof ctx.currentFile === 'string' && ctx.currentFile.length)
            ? ctx.currentFile
            : 'Document';

        const viewerPanel = dockview.addPanel({
            id: 'dockview-viewer',
            component: 'viewer',
            title: currentViewerTitle,
        });

        const tocPanel = dockview.addPanel({
            id: 'dockview-toc',
            component: 'toc',
            title: 'Table of contents',
            position: { referencePanel: viewerPanel, direction: 'left' },
        });

        const filesPanel = dockview.addPanel({
            id: 'dockview-files',
            component: 'files',
            title: 'Files',
            position: { referencePanel: viewerPanel, direction: 'right' },
        });

        const terminalDockviewPanel = dockview.addPanel({
            id: 'dockview-terminal',
            component: 'terminal',
            title: 'Terminal',
            position: { referencePanel: viewerPanel, direction: 'bottom' },
        });

        dockviewRoot.classList.remove('hidden');
        if (appShell) {
            appShell.classList.add('hidden');
        }

        const setup = {
            instance: dockview,
            panels: {
                viewer: viewerPanel,
                toc: tocPanel,
                files: filesPanel,
                terminal: terminalDockviewPanel,
            },
        };

        window.__dockviewSetup = setup;

        [
            ['toc', tocPanel?.group?.api],
            ['files', filesPanel?.group?.api],
        ].forEach(([name, api]) => {
            if (api && typeof api.onDidVisibilityChange === 'function') {
                api.onDidVisibilityChange(({ isVisible }) => {
                    updatePanelToggleButtonState(name, isVisible);
                });
            }
        });

        updatePanelToggleButtonState('toc', true);
        updatePanelToggleButtonState('files', true);

        return setup;
    }

    ctx.updatePanelToggleButtonState = updatePanelToggleButtonState;
    ctx.getPanelVisibility = getPanelVisibility;
    ctx.setPanelVisibility = setPanelVisibility;
    ctx.toggleLegacySidebar = toggleLegacySidebar;
    ctx.refreshPanelToggleStates = refreshPanelToggleStates;
    ctx.initialiseDockviewLayout = initialiseDockviewLayout;

    panelToggleButtons.forEach((button) => {
        const panelName = button.dataset.panelToggle;
        if (!panelName) {
            return;
        }
        panelToggleButtonMap.set(panelName, button);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const currentlyVisible = getPanelVisibility(panelName);
            const nextVisible = !currentlyVisible;
            setPanelVisibility(panelName, nextVisible);
        });
    });

    ctx.dockviewSetup = initialiseDockviewLayout();
    ctx.dockviewIsActive = Boolean(ctx.dockviewSetup);
    if (body) {
        body.classList.toggle('dockview-active', ctx.dockviewIsActive);
    }
    refreshPanelToggleStates();
}
