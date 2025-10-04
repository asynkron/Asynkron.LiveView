// Layout utilities for the unified markdown viewer.
// Handles Dockview initialisation as well as legacy sidebar toggling.
export function initLayout(context) {
    const {
        dockviewRoot,
        appShell,
        viewerSection,
        tocSidebar,
        fileSidebar,
        terminalPanel,
        tocSplitter,
        fileSplitter,
        rootElement,
        panelToggleButtons = [],
        getCurrentFile = () => null,
        storageKey = 'dockviewLayout',
        saveDelayMs = 750,
    } = context || {};

    const state = {
        panelToggleButtonMap: new Map(),
        dockviewLayoutSaveTimer: null,
        dockviewPointerActive: false,
        dockviewSetup: null,
    };

    panelToggleButtons.forEach((button) => {
        const panelName = button?.dataset?.panelToggle;
        if (!panelName) {
            return;
        }

        state.panelToggleButtonMap.set(panelName, button);
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const currentVisibility = getPanelVisibility(panelName);
            setPanelVisibility(panelName, !currentVisibility);
        });
    });

    function updatePanelToggleButtonState(name, isVisible) {
        const button = state.panelToggleButtonMap.get(name);
        if (!button) {
            return;
        }
        button.setAttribute('aria-pressed', String(Boolean(isVisible)));
    }

    function getPanelVisibility(name) {
        const setup = state.dockviewSetup;
        if (setup?.panels?.[name]) {
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

        if (!rootElement) {
            return;
        }

        const widthVar = name === 'toc' ? '--toc-sidebar-current-width' : '--file-sidebar-current-width';
        const defaultWidth = name === 'toc' ? 'var(--toc-sidebar-width)' : 'var(--file-sidebar-width)';
        rootElement.style.setProperty(widthVar, visible ? defaultWidth : 'var(--sidebar-collapsed-width)');

        const splitter = name === 'toc' ? tocSplitter : fileSplitter;
        if (splitter) {
            splitter.classList.toggle('hidden', !visible);
        }
    }

    function persistDockviewLayout() {
        const setup = state.dockviewSetup;
        if (!setup?.instance || typeof window?.localStorage === 'undefined') {
            return;
        }

        try {
            const { instance } = setup;
            const layoutState = typeof instance.saveLayout === 'function'
                ? instance.saveLayout()
                : typeof instance.toJSON === 'function'
                    ? instance.toJSON()
                    : (() => { throw new Error('Dockview instance cannot serialise layouts'); })();
            const serialisedLayout = JSON.stringify(layoutState);
            window.localStorage.setItem(storageKey, serialisedLayout);
        } catch (error) {
            console.warn('Failed to persist dockview layout.', error);
        }
    }

    function scheduleDockviewLayoutSave() {
        if (!state.dockviewSetup?.instance) {
            return;
        }

        if (state.dockviewLayoutSaveTimer) {
            window.clearTimeout(state.dockviewLayoutSaveTimer);
        }

        state.dockviewLayoutSaveTimer = window.setTimeout(() => {
            state.dockviewLayoutSaveTimer = null;
            persistDockviewLayout();
        }, saveDelayMs);
    }

    function setPanelVisibility(name, visible) {
        const setup = state.dockviewSetup;
        if (setup?.panels?.[name]) {
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

        scheduleDockviewLayoutSave();
    }

    function refreshPanelToggleStates() {
        state.panelToggleButtonMap.forEach((_button, name) => {
            updatePanelToggleButtonState(name, getPanelVisibility(name));
        });
    }

    function restoreDockviewLayout(instance) {
        if (!instance || typeof window?.localStorage === 'undefined') {
            return false;
        }

        let rawLayout = null;
        try {
            rawLayout = window.localStorage.getItem(storageKey);
        } catch (storageError) {
            console.warn('Dockview layout restore skipped: storage unavailable.', storageError);
            return false;
        }

        if (!rawLayout) {
            return false;
        }

        try {
            const savedLayout = JSON.parse(rawLayout);
            if (typeof instance.restoreLayout === 'function') {
                instance.restoreLayout(savedLayout);
            } else if (typeof instance.fromJSON === 'function') {
                instance.fromJSON(savedLayout);
            } else {
                throw new Error('Dockview instance cannot restore layouts');
            }
            return true;
        } catch (error) {
            console.warn('Failed to restore dockview layout; clearing saved state.', error);
            try {
                window.localStorage.removeItem(storageKey);
            } catch (clearError) {
                console.warn('Unable to clear saved dockview layout.', clearError);
            }
        }

        return false;
    }

    function handlePointerDown(event) {
        if (!state.dockviewSetup?.instance || !dockviewRoot) {
            state.dockviewPointerActive = false;
            return;
        }

        state.dockviewPointerActive = dockviewRoot.contains(event.target);
    }

    function handlePointerFinish() {
        if (!state.dockviewPointerActive) {
            return;
        }

        state.dockviewPointerActive = false;
        scheduleDockviewLayoutSave();
    }

    function initialiseDockviewLayout() {
        window.__dockviewSetup = null;

        if (!dockviewRoot) {
            return null;
        }

        if (!window.dockview?.DockviewComponent) {
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

        if (tocSplitter?.parentElement) {
            tocSplitter.parentElement.removeChild(tocSplitter);
        }
        if (fileSplitter?.parentElement) {
            fileSplitter.parentElement.removeChild(fileSplitter);
        }

        const panelSources = {
            viewer: viewerSection,
            toc: tocSidebar,
            files: fileSidebar,
            terminal: terminalPanel,
        };

        tocSidebar?.classList.add('is-expanded');
        fileSidebar?.classList.add('is-expanded');

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
                    init() {},
                    dispose() {},
                };
            },
        });

        const currentFile = getCurrentFile();
        const currentViewerTitle = typeof currentFile === 'string' && currentFile.length
            ? currentFile
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
        appShell?.classList.add('hidden');

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

        restoreDockviewLayout(dockview);

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

    state.dockviewSetup = initialiseDockviewLayout();

    return {
        get dockviewSetup() {
            return state.dockviewSetup;
        },
        get dockviewIsActive() {
            return Boolean(state.dockviewSetup);
        },
        getPanelVisibility,
        setPanelVisibility,
        refreshPanelToggleStates,
        handlePointerDown,
        handlePointerFinish,
    };
}
