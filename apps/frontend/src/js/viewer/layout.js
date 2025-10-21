// Layout utilities for the unified markdown viewer.
// Handles Dockview initialisation as well as legacy sidebar toggling.
export function initLayout(context) {
    const {
        dockviewRoot,
        appShell,
        viewerSection,
        tocSidebar,
        fileSidebar,
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

    // Remove references to panels that are no longer provided by the app before restoring a layout snapshot.
    function sanitiseDockviewLayout(savedLayout, allowedPanelComponents) {
        if (!savedLayout || typeof savedLayout !== 'object') {
            return null;
        }

        const allowedComponents = new Set((allowedPanelComponents ?? []).filter(Boolean));
        if (allowedComponents.size === 0) {
            return savedLayout;
        }

        const layoutPanels = savedLayout.panels;
        if (!layoutPanels || typeof layoutPanels !== 'object') {
            return savedLayout;
        }

        const eligiblePanels = new Map();
        const allowedPanelIds = new Set();

        for (const [panelId, panelState] of Object.entries(layoutPanels)) {
            if (!panelState || typeof panelState !== 'object') {
                continue;
            }

            const componentName = panelState.contentComponent ?? panelState.renderer;
            if (componentName && allowedComponents.has(componentName)) {
                eligiblePanels.set(panelId, { ...panelState });
                allowedPanelIds.add(panelId);
            }
        }

        if (eligiblePanels.size === 0) {
            return null;
        }

        const referencedPanelIds = new Set();
        const remainingGroupIds = new Set();

        const pruneGroupState = (groupState) => {
            if (!groupState || typeof groupState !== 'object') {
                return null;
            }

            const filteredViews = Array.isArray(groupState.views)
                ? groupState.views.filter((viewId) => {
                      if (allowedPanelIds.has(viewId)) {
                          referencedPanelIds.add(viewId);
                          return true;
                      }
                      return false;
                  })
                : [];

            if (filteredViews.length === 0) {
                return null;
            }

            const activeView = filteredViews.includes(groupState.activeView)
                ? groupState.activeView
                : filteredViews[0];

            if (groupState.id) {
                remainingGroupIds.add(groupState.id);
            }

            return {
                ...groupState,
                views: filteredViews,
                activeView,
            };
        };

        const pruneGridNode = (node) => {
            if (!node || typeof node !== 'object') {
                return null;
            }

            if (node.type === 'leaf') {
                const prunedGroup = pruneGroupState(node.data);
                if (!prunedGroup) {
                    return null;
                }
                return {
                    ...node,
                    data: prunedGroup,
                };
            }

            if (node.type === 'branch' && Array.isArray(node.data)) {
                const prunedChildren = node.data.map(pruneGridNode).filter(Boolean);
                if (prunedChildren.length === 0) {
                    return null;
                }
                return {
                    ...node,
                    data: prunedChildren,
                };
            }

            return null;
        };

        const pruneGroupCollection = (groups) => {
            if (!Array.isArray(groups)) {
                return [];
            }

            return groups
                .map((group) => {
                    const prunedGroup = pruneGroupState(group?.data);
                    if (!prunedGroup) {
                        return null;
                    }
                    return {
                        ...group,
                        data: prunedGroup,
                    };
                })
                .filter(Boolean);
        };

        const grid = savedLayout.grid ? { ...savedLayout.grid } : null;
        const prunedRoot = grid?.root ? pruneGridNode(grid.root) : null;
        const floatingGroups = pruneGroupCollection(savedLayout.floatingGroups);
        const popoutGroups = pruneGroupCollection(savedLayout.popoutGroups);

        if (!prunedRoot && floatingGroups.length === 0 && popoutGroups.length === 0) {
            return null;
        }

        const sanitisedPanels = {};
        referencedPanelIds.forEach((panelId) => {
            const panelState = eligiblePanels.get(panelId);
            if (panelState) {
                sanitisedPanels[panelId] = panelState;
            }
        });

        if (Object.keys(sanitisedPanels).length === 0) {
            return null;
        }

        const sanitisedLayout = {
            ...savedLayout,
            panels: sanitisedPanels,
            floatingGroups: floatingGroups.length > 0 ? floatingGroups : undefined,
            popoutGroups: popoutGroups.length > 0 ? popoutGroups : undefined,
        };

        if (grid && prunedRoot) {
            sanitisedLayout.grid = {
                ...grid,
                root: prunedRoot,
            };
        } else if (!prunedRoot) {
            delete sanitisedLayout.grid;
        }

        if (sanitisedLayout.activeGroup && !remainingGroupIds.has(sanitisedLayout.activeGroup)) {
            delete sanitisedLayout.activeGroup;
        }

        return sanitisedLayout;
    }

    function restoreDockviewLayout(instance, allowedPanelComponents = []) {
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
            const sanitisedLayout = sanitiseDockviewLayout(savedLayout, allowedPanelComponents);
            if (!sanitisedLayout) {
                return false;
            }
            if (typeof instance.restoreLayout === 'function') {
                instance.restoreLayout(sanitisedLayout);
            } else if (typeof instance.fromJSON === 'function') {
                instance.fromJSON(sanitisedLayout);
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

        if (!viewerSection || !tocSidebar || !fileSidebar) {
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

        const newlyAddedPanels = [];

        // Small helper that tries every known Dockview lookup surface so that
        // we can find a panel regardless of which API version is present.
        function findExistingPanel(id) {
            if (!dockview || !id) {
                return null;
            }

            const lookups = [
                () => dockview.getPanel?.(id),
                () => dockview.api?.getPanel?.(id),
            ];

            for (const lookup of lookups) {
                try {
                    const panel = lookup?.();
                    if (panel) {
                        return panel;
                    }
                } catch (_error) {
                    // Ignore lookup failures – different Dockview builds expose
                    // slightly different APIs and we only care about success.
                }
            }

            return null;
        }

        function ensurePanel(id, createPanel) {
            const existing = findExistingPanel(id);
            if (existing) {
                return { panel: existing, created: false };
            }

            try {
                const panel = createPanel?.();
                if (panel) {
                    newlyAddedPanels.push(panel);
                }

                return { panel: panel ?? null, created: Boolean(panel) };
            } catch (error) {
                if (error instanceof Error && /already exists/i.test(error.message)) {
                    console.warn(`Dockview panel '${id}' already existed; using the restored instance.`, error);

                    const fallbackPanel = findExistingPanel(id);
                    if (fallbackPanel) {
                        return { panel: fallbackPanel, created: false };
                    }

                    try {
                        window.localStorage?.removeItem?.(storageKey);
                    } catch (storageError) {
                        console.warn('Unable to clear conflicting dockview layout.', storageError);
                    }

                    return { panel: null, created: false };
                }

                throw error;
            }
        }

        // Try to restore the user's saved layout first; missing panels will be
        // re-added below so older layouts keep working.
        restoreDockviewLayout(dockview, Object.keys(panelSources));

        const { panel: viewerPanel } = ensurePanel('dockview-viewer', () => dockview.addPanel({
            id: 'dockview-viewer',
            component: 'viewer',
            title: currentViewerTitle,
        }));

        if (viewerPanel?.api?.setTitle) {
            viewerPanel.api.setTitle(currentViewerTitle);
        }

        const { panel: tocPanel } = ensurePanel('dockview-toc', () => dockview.addPanel({
            id: 'dockview-toc',
            component: 'toc',
            title: 'Table of contents',
            position: viewerPanel ? { referencePanel: viewerPanel, direction: 'left' } : undefined,
        }));

        const { panel: filesPanel } = ensurePanel('dockview-files', () => dockview.addPanel({
            id: 'dockview-files',
            component: 'files',
            title: 'Files',
            position: viewerPanel ? { referencePanel: viewerPanel, direction: 'right' } : undefined,
        }));

        dockviewRoot.classList.remove('hidden');
        appShell?.classList.add('hidden');

        const setup = {
            instance: dockview,
            panels: {
                viewer: viewerPanel,
                toc: tocPanel,
                files: filesPanel,
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

        updatePanelToggleButtonState('toc', getPanelVisibility('toc'));
        updatePanelToggleButtonState('files', getPanelVisibility('files'));

        if (newlyAddedPanels.length > 0) {
            window.requestAnimationFrame(() => {
                scheduleDockviewLayoutSave();
            });
        }

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
