import './vendor_globals.js';

// Client-side bootstrap logic for the unified markdown viewer UI.
function bootstrap() {
    const state = window.__INITIAL_STATE__ || {};
    const content = document.getElementById('content');
    const fileName = document.getElementById('file-name');
    const sidebarPath = document.getElementById('sidebar-path');
    const fileList = document.getElementById('file-list');
    const downloadButton = document.getElementById('download-button');
    const deleteButton = document.getElementById('delete-button');
    const editButton = document.getElementById('edit-button');
    const previewButton = document.getElementById('preview-button');
    const saveButton = document.getElementById('save-button');
    const cancelButton = document.getElementById('cancel-button');
    const editorContainer = document.getElementById('editor-container');
    const offlineOverlay = document.getElementById('offline-overlay');
    const unsavedChangesModal = document.getElementById('unsaved-changes-modal');
    const unsavedChangesFilename = document.getElementById('unsaved-changes-filename');
    const unsavedChangesMessage = document.getElementById('unsaved-changes-message');
    const unsavedChangesDetail = document.getElementById('unsaved-changes-detail');
    const unsavedChangesSaveButton = document.getElementById('unsaved-changes-save');
    const unsavedChangesDiscardButton = document.getElementById('unsaved-changes-discard');
    const unsavedChangesCancelButton = document.getElementById('unsaved-changes-cancel');
    const tocList = document.getElementById('toc-list');
    const tocSidebar = document.querySelector('.sidebar--toc');
    const fileSidebar = document.querySelector('.sidebar--files');
    const tocSplitter = document.getElementById('toc-splitter');
    const fileSplitter = document.getElementById('file-splitter');
    const dockviewRoot = document.getElementById('dockview-root');
    const appShell = document.querySelector('.app-shell');
    const rootElement = document.documentElement;
    const viewerSection = document.querySelector('.viewer');
    const terminalPanel = document.getElementById('terminal-panel');
    const terminalContainer = document.getElementById('terminal-container');
    const terminalToggleButton = document.getElementById('terminal-toggle');
    const terminalStatusText = document.getElementById('terminal-status');
    const terminalResizeHandle = document.getElementById('terminal-resize-handle');
    const terminalStorageKey = 'terminalPanelHeight';
    const panelToggleButtons = Array.from(document.querySelectorAll('[data-panel-toggle]'));
    const panelToggleButtonMap = new Map();
    // Persist dockview layout between sessions so panel positions are restored.
    const dockviewLayoutStorageKey = 'dockviewLayout';
    const dockviewLayoutSaveDelayMs = 750;
    let dockviewLayoutSaveTimer = null;
    let dockviewPointerActive = false;

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

    if (content) {
        content.addEventListener('click', handleHeadingActionClick);
    }

    const initialIndex = normaliseFileIndex({
        filesValue: state.files,
        treeValue: state.fileTree,
    });
    let currentFile = state.selectedFile || null;
    let files = initialIndex.files;
    let fileTree = initialIndex.tree;
    let websocket = null;
    let reconnectTimer = null;
    let isEditing = false;
    let isPreviewing = false;
    let editorInstance = null;
    let draftContent = '';
    let currentContent = typeof state.content === 'string' ? state.content : '';
    let hasPendingChanges = false;
    let suppressEditorChangeEvents = false;
    let activeUnsavedPrompt = null;

    const originalPathArgument = state.pathArgument || '';
    let resolvedRootPath = state.rootPath || '';
    const initialFileFromLocation = fileFromSearch(window.location.search);
    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();
    let markedConfigured = false;
    let mermaidInitAttempted = false;
    let mermaidRetryTimer = null;
    let vegaRetryTimer = null;
    let excalidrawRetryTimer = null;
    let mermaidIdCounter = 0;
    let vegaIdCounter = 0;
    let excalidrawIdCounter = 0;
    let svelteIdCounter = 0;
    const excalidrawRoots = new Map();
    const svelteInstances = new Map();
    let excalidrawResizeHandlerAttached = false;
    let excalidrawFitFailureLogged = false;
    let svelteRetryTimer = null;
    let librariesReadyPromise = null;
    let pendingMarkdown = null;
    let relativeLinksEnabled = false;
    let relativeLinkBasePath = '';
    let relativeLinkBaseWalker = null;
    let relativeLinkExtensionRegistered = false;
    let headingLocationMap = new Map();
    let headingHighlightLine = null;
    let headingHighlightTimeout = null;
    const relativeLinkDummyOrigin = 'http://__dummy__/';
    const relativeLinkSchemePattern = /^[a-zA-Z][\w+.-]*:/;
    const relativeLinkProtocolRelativePattern = /^\/\//;
    const expandedDirectories = new Set();
    const knownDirectories = new Set();
    const dockviewSetup = initialiseDockviewLayout();
    const dockviewIsActive = Boolean(dockviewSetup);
    document.body.classList.toggle('dockview-active', dockviewIsActive);
    refreshPanelToggleStates();

    if (dockviewIsActive && dockviewRoot) {
        dockviewRoot.addEventListener('pointerdown', handleDockviewPointerDown);
        window.addEventListener('pointerup', handleDockviewPointerFinish);
        window.addEventListener('pointercancel', handleDockviewPointerFinish);
    }
    let activeHeadingCollection = null;
    let documentSlugCounts = null;
    let terminalInstance = null;
    let terminalFitAddon = null;
    let terminalSocket = null;
    let terminalReconnectTimer = null;
    let terminalLibraryRetryTimer = null;
    let terminalCollapsed = false;
    let terminalHeight = null;
    let pendingTerminalFitFrame = null;
    let terminalResizeObserver = null;
    const terminalDecoder = new TextDecoder();
    let terminalLastStatusMessage = '';

    function updatePanelToggleButtonState(name, isVisible) {
        const button = panelToggleButtonMap.get(name);
        if (!button) {
            return;
        }
        button.setAttribute('aria-pressed', String(Boolean(isVisible)));
    }

    function getPanelVisibility(name) {
        if (dockviewSetup && dockviewSetup.panels && dockviewSetup.panels[name]) {
            const panel = dockviewSetup.panels[name];
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

        rootElement.style.setProperty(
            widthVar,
            visible ? defaultWidth : 'var(--sidebar-collapsed-width)'
        );

        const splitter = name === 'toc' ? tocSplitter : fileSplitter;
        if (splitter) {
            splitter.classList.toggle('hidden', !visible);
        }
    }

    function setPanelVisibility(name, visible) {
        if (dockviewSetup && dockviewSetup.panels && dockviewSetup.panels[name]) {
            const panel = dockviewSetup.panels[name];
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
        panelToggleButtonMap.forEach((_button, name) => {
            updatePanelToggleButtonState(name, getPanelVisibility(name));
        });
    }

    function restoreDockviewLayout(instance) {
        if (!instance || typeof window.localStorage === 'undefined') {
            return false;
        }

        let rawLayout = null;
        try {
            rawLayout = window.localStorage.getItem(dockviewLayoutStorageKey);
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
                // Dockview >= 1.12 exposes fromJSON instead of restoreLayout
                instance.fromJSON(savedLayout);
            } else {
                throw new Error('Dockview instance cannot restore layouts');
            }
            return true;
        } catch (error) {
            console.warn('Failed to restore dockview layout; clearing saved state.', error);
            try {
                window.localStorage.removeItem(dockviewLayoutStorageKey);
            } catch (clearError) {
                console.warn('Unable to clear saved dockview layout.', clearError);
            }
        }

        return false;
    }

    function persistDockviewLayout() {
        if (!dockviewSetup?.instance || typeof window.localStorage === 'undefined') {
            return;
        }

        try {
            const { instance } = dockviewSetup;
            const layoutState = (typeof instance.saveLayout === 'function')
                ? instance.saveLayout()
                : (typeof instance.toJSON === 'function')
                    ? instance.toJSON()
                    : (() => { throw new Error('Dockview instance cannot serialise layouts'); })();
            const serialisedLayout = JSON.stringify(layoutState);
            window.localStorage.setItem(dockviewLayoutStorageKey, serialisedLayout);
        } catch (error) {
            console.warn('Failed to persist dockview layout.', error);
        }
    }

    function scheduleDockviewLayoutSave() {
        if (!dockviewSetup?.instance) {
            return;
        }

        if (dockviewLayoutSaveTimer) {
            window.clearTimeout(dockviewLayoutSaveTimer);
        }

        dockviewLayoutSaveTimer = window.setTimeout(() => {
            dockviewLayoutSaveTimer = null;
            persistDockviewLayout();
        }, dockviewLayoutSaveDelayMs);
    }

    function handleDockviewPointerDown(event) {
        if (!dockviewSetup?.instance || !dockviewRoot) {
            dockviewPointerActive = false;
            return;
        }

        dockviewPointerActive = dockviewRoot.contains(event.target);
    }

    function handleDockviewPointerFinish() {
        if (!dockviewPointerActive) {
            return;
        }

        dockviewPointerActive = false;
        scheduleDockviewLayoutSave();
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
            window.__dockviewSetup = null;
            return null;
        }

        if (!viewerSection || !tocSidebar || !fileSidebar || !terminalPanel) {
            console.warn('Dockview initialisation skipped: missing panel sources.');
            dockviewRoot.classList.add('hidden');
            if (appShell) {
                appShell.classList.remove('hidden');
            }
            window.__dockviewSetup = null;
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

        if (tocSidebar) {
            tocSidebar.classList.add('is-expanded');
        }

        if (fileSidebar) {
            fileSidebar.classList.add('is-expanded');
        }

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

        const currentViewerTitle = (typeof currentFile === 'string' && currentFile.length)
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

    function normaliseFileIndex({ filesValue, treeValue }) {
        let flat = [];
        let tree = [];

        if (Array.isArray(filesValue)) {
            flat = filesValue;
        } else if (filesValue && Array.isArray(filesValue.files)) {
            flat = filesValue.files;
            if (Array.isArray(filesValue.tree)) {
                tree = filesValue.tree;
            }
        }

        if (!tree.length && Array.isArray(treeValue)) {
            tree = treeValue;
        }

        if (tree.length && !flat.length) {
            flat = flattenTree(tree);
        }

        if (!tree.length && flat.length) {
            tree = buildTreeFromFlatList(flat);
        }

        return { files: flat, tree };
    }

    function flattenTree(nodes) {
        const result = [];
        if (!Array.isArray(nodes)) {
            return result;
        }

        const stack = [...nodes];
        while (stack.length) {
            const node = stack.shift();
            if (!node || typeof node !== 'object') {
                continue;
            }

            if (node.type === 'file') {
                result.push({
                    name: node.name,
                    relativePath: node.relativePath,
                    size: node.size,
                    updated: node.updated,
                });
                continue;
            }

            if (node.type === 'directory' && Array.isArray(node.children)) {
                stack.unshift(...node.children);
            }
        }

        return result;
    }

    function buildTreeFromFlatList(flatList) {
        if (!Array.isArray(flatList) || !flatList.length) {
            return [];
        }

        const root = [];
        const directoryMap = new Map();
        directoryMap.set('', root);

        function ensureDirectory(path, name) {
            if (directoryMap.has(path)) {
                return directoryMap.get(path);
            }

            const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
            const parentChildren = directoryMap.get(parentPath) || root;
            const node = {
                type: 'directory',
                name,
                relativePath: path,
                children: [],
            };
            parentChildren.push(node);
            directoryMap.set(path, node.children);
            return node.children;
        }

        flatList.forEach((file) => {
            if (!file || typeof file.relativePath !== 'string') {
                return;
            }

            const segments = file.relativePath.split('/');
            const fileName = segments.pop();
            let currentPath = '';
            segments.forEach((segment) => {
                if (!segment) {
                    return;
                }
                currentPath = currentPath ? `${currentPath}/${segment}` : segment;
                ensureDirectory(currentPath, segment);
            });

            const parentPath = segments.join('/');
            const parentChildren = directoryMap.get(parentPath) || root;
            parentChildren.push({
                type: 'file',
                name: fileName,
                relativePath: file.relativePath,
                size: file.size,
                updated: file.updated,
            });
        });

        sortTree(root);
        return root;
    }

    function sortTree(nodes) {
        if (!Array.isArray(nodes)) {
            return;
        }
        nodes.sort((a, b) => {
            if (a.type === b.type) {
                return String(a.name || '').localeCompare(String(b.name || ''));
            }
            return a.type === 'directory' ? -1 : 1;
        });
        nodes.forEach((node) => {
            if (node.type === 'directory') {
                sortTree(node.children);
            }
        });
    }

    function updateRelativeLinkBase(filePath) {
        if (typeof filePath !== 'string' || filePath.length === 0) {
            relativeLinksEnabled = false;
            relativeLinkBasePath = '';
            relativeLinkBaseWalker = null;
            return;
        }

        relativeLinksEnabled = true;
        const lastSlashIndex = filePath.lastIndexOf('/');
        relativeLinkBasePath = lastSlashIndex === -1 ? '' : filePath.slice(0, lastSlashIndex + 1);

        if (typeof markedBaseUrl !== 'undefined' && markedBaseUrl && typeof markedBaseUrl.baseUrl === 'function') {
            const baseCandidate = relativeLinkBasePath || './';
            try {
                relativeLinkBaseWalker = markedBaseUrl.baseUrl(baseCandidate);
            } catch (error) {
                console.warn('Failed to initialise marked-base-url', error);
                relativeLinkBaseWalker = null;
            }
        } else {
            relativeLinkBaseWalker = null;
        }
    }

    function decodePathSegments(path) {
        if (!path) {
            return '';
        }
        return path
            .split('/')
            .map((segment) => {
                try {
                    return decodeURIComponent(segment);
                } catch {
                    return segment;
                }
            })
            .join('/');
    }

    function encodePathSegments(path) {
        if (!path) {
            return '';
        }
        return path
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
    }

    function fallbackResolveRelativeHref(href) {
        try {
            const baseReference = relativeLinkBasePath ? relativeLinkBasePath : '.';
            const baseUrl = new URL(baseReference, relativeLinkDummyOrigin);
            const resolvedUrl = new URL(href, baseUrl);
            const normalisedPath = resolvedUrl.pathname.replace(/^\/+/u, '');
            const decodedPath = decodePathSegments(normalisedPath);
            return `${decodedPath}${resolvedUrl.search}${resolvedUrl.hash}`;
        } catch (error) {
            console.warn('Relative link fallback failed', error);
            return href;
        }
    }

    function splitResolvedHref(resolvedHref) {
        if (typeof resolvedHref !== 'string' || resolvedHref.length === 0) {
            return { filePath: '', search: '', hash: '' };
        }

        let working = resolvedHref;
        let hash = '';
        const hashIndex = working.indexOf('#');
        if (hashIndex !== -1) {
            hash = working.slice(hashIndex);
            working = working.slice(0, hashIndex);
        }

        let search = '';
        const searchIndex = working.indexOf('?');
        if (searchIndex !== -1) {
            search = working.slice(searchIndex);
            working = working.slice(0, searchIndex);
        }

        const cleaned = working.replace(/^\.\//, '').replace(/^\/+/u, '');
        const filePath = decodePathSegments(cleaned);
        return { filePath, search, hash };
    }

    function transformRelativeAsset(rawHref, tokenType) {
        if (!relativeLinksEnabled || typeof rawHref !== 'string') {
            return null;
        }

        const trimmedHref = rawHref.trim();
        if (
            !trimmedHref ||
            trimmedHref.startsWith('#') ||
            relativeLinkProtocolRelativePattern.test(trimmedHref) ||
            relativeLinkSchemePattern.test(trimmedHref) ||
            trimmedHref.startsWith('/')
        ) {
            return null;
        }

        let resolvedHref = trimmedHref;
        const walker = relativeLinkBaseWalker;

        if (walker && typeof walker.walkTokens === 'function') {
            const tempToken = { type: tokenType, href: trimmedHref };
            try {
                walker.walkTokens(tempToken);
                resolvedHref = tempToken.href;
            } catch (error) {
                console.warn('marked-base-url resolution failed', error);
                resolvedHref = fallbackResolveRelativeHref(trimmedHref);
            }
        } else {
            resolvedHref = fallbackResolveRelativeHref(trimmedHref);
        }

        const parts = splitResolvedHref(resolvedHref);
        if (!parts.filePath) {
            return null;
        }

        if (tokenType === 'image') {
            return {
                assetHref: `${encodePathSegments(parts.filePath)}${parts.search}${parts.hash}`,
            };
        }

        return {
            fileTarget: `${parts.filePath}${parts.search}`,
            hash: parts.hash,
        };
    }

    const relativeLinkExtension = {
        walkTokens(token) {
            if (!token || typeof token.href !== 'string') {
                return;
            }

            if (token.type === 'image') {
                const asset = transformRelativeAsset(token.href, 'image');
                if (asset && asset.assetHref) {
                    token.href = asset.assetHref;
                }
                return;
            }

            if (token.type !== 'link') {
                return;
            }

            const result = transformRelativeAsset(token.href, 'link');
            if (!result || !result.fileTarget) {
                return;
            }

            const basePathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
            const query = buildQuery({ file: result.fileTarget });
            token.href = `${basePathname}${query}${result.hash || ''}`;
        },
    };

    function getCssNumber(variableName, fallback) {
        if (typeof variableName !== 'string' || !variableName) {
            return typeof fallback === 'number' ? fallback : 0;
        }

        try {
            const computed = getComputedStyle(rootElement).getPropertyValue(variableName);
            const parsed = Number.parseFloat(computed);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.warn('Failed to read CSS variable', variableName, error);
        }

        return typeof fallback === 'number' ? fallback : 0;
    }

    function configureMarked() {
        if (typeof marked === 'undefined' || markedConfigured) {
            return;
        }

        marked.use({
            walkTokens(token) {
                if (!token || token.type !== 'code') {
                    return;
                }

                const language = typeof token.lang === 'string' ? token.lang.toLowerCase() : '';
                const source = token.text || token.raw || '';

                if (language.includes('mermaid')) {
                    const id = `mermaid-diagram-${mermaidIdCounter++}`;
                    const encodedSource = encodeMermaidSource(source);
                    const mermaidHtml = `<div class="mermaid" id="${id}" data-mermaid-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = mermaidHtml;
                    token.text = mermaidHtml;
                    return;
                }

                if (language.includes('vega-lite') || language === 'vega') {
                    const id = `vega-diagram-${vegaIdCounter++}`;
                    const encodedSource = encodeVegaSource(source);
                    const vegaHtml = `<div class="vega-diagram" id="${id}" data-vega-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = vegaHtml;
                    token.text = vegaHtml;
                    return;
                }

                if (language.includes('excalidraw')) {
                    const id = `excalidraw-diagram-${excalidrawIdCounter++}`;
                    const encodedSource = encodeExcalidrawSource(source);
                    const excalidrawHtml = `<div class="excalidraw-diagram" id="${id}" data-excalidraw-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = excalidrawHtml;
                    token.text = excalidrawHtml;
                    return;
                }

                if (language.includes('svelte')) {
                    const id = `svelte-component-${svelteIdCounter++}`;
                    const encodedSource = encodeSvelteSource(source);
                    const svelteHtml = `<div class="svelte-component" id="${id}" data-svelte-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = svelteHtml;
                    token.text = svelteHtml;
                }
            },
        });

        marked.use({
            headerIds: true,
            mangle: false,
            renderer: {
                heading({ text, depth, raw }) {
                    const headingLevel = Math.min(Math.max(depth || 1, 1), 6);

                    // Create slug from the raw text or the rendered text
                    const sourceText = typeof raw === 'string' ? raw : text;
                    const slug = createSlug(sourceText);
                    const plainText = normaliseHeadingText(text, raw);
                    const ariaSource = plainText || (typeof raw === 'string' ? raw : 'heading');
                    const ariaLabel = escapeHtml(`Link to section ${ariaSource}`);
                    const headingLabel = plainText || ariaSource || 'this section';
                    const safeSlug = escapeHtml(slug);
                    const actionsAriaLabel = escapeHtml(`Section actions for ${headingLabel}`);
                    const editLabel = escapeHtml(`Edit section "${headingLabel}" in the editor`);
                    const copyLabel = escapeHtml(`Copy link to section "${headingLabel}"`);

                    if (Array.isArray(activeHeadingCollection)) {
                        activeHeadingCollection.push({
                            level: headingLevel,
                            text: plainText || ariaSource,
                            slug,
                        });
                    }

                    return `<h${headingLevel} id="${safeSlug}">${text}<span class="heading-actions" role="group" aria-label="${actionsAriaLabel}"><button type="button" class="heading-action-button heading-action-edit" data-heading-action="edit" data-heading-slug="${safeSlug}" title="${editLabel}"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span class="sr-only">${editLabel}</span></button><button type="button" class="heading-action-button heading-action-copy" data-heading-action="copy" data-heading-slug="${safeSlug}" title="${copyLabel}"><i class="fa-solid fa-link" aria-hidden="true"></i><span class="sr-only">${copyLabel}</span></button></span><a class="heading-anchor" href="#${safeSlug}" aria-label="${ariaLabel}"></a></h${headingLevel}>`;
                },
            },
        });

        marked.setOptions({
            breaks: true,
            gfm: true,
            highlight(code, language) {
                if (typeof hljs === 'undefined') {
                    return code;
                }
                try {
                    if (language && hljs.getLanguage(language)) {
                        return hljs.highlight(code, { language }).value;
                    }
                    return hljs.highlightAuto(code).value;
                } catch (err) {
                    console.warn('Highlight.js failed to render a block', err);
                    return code;
                }
            },
        });

        if (!relativeLinkExtensionRegistered) {
            marked.use(relativeLinkExtension);
            relativeLinkExtensionRegistered = true;
        }

        markedConfigured = true;
    }

    function normaliseHeadingText(rendered, raw) {
        if (typeof rendered === 'string' && rendered.trim()) {
            const temp = document.createElement('div');
            temp.innerHTML = rendered;
            const textContent = (temp.textContent || temp.innerText || '').trim();
            if (textContent) {
                return textContent;
            }
        }

        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed) {
                return trimmed;
            }
        }

        return '';
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function computeBaseSlug(text) {
        if (!text) {
            return '';
        }

        const temp = document.createElement('div');
        temp.innerHTML = text;
        const cleanText = temp.textContent || temp.innerText || text;

        return cleanText
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function createSlug(text) {
        let slug = computeBaseSlug(text);

        if (!slug) {
            slug = 'heading';
        }

        if (documentSlugCounts) {
            if (documentSlugCounts.has(slug)) {
                const count = documentSlugCounts.get(slug) + 1;
                documentSlugCounts.set(slug, count);
                return `${slug}-${count}`;
            }

            documentSlugCounts.set(slug, 0);
        }

        return slug;
    }

    function captureHeadingLocations(markdownSource) {
        headingLocationMap = new Map();

        if (typeof markdownSource !== 'string' || !markdownSource) {
            return;
        }

        const slugCounts = new Map();
        const lines = markdownSource.split(/\r?\n/);

        lines.forEach((line, index) => {
            const match = line.match(/^(#{1,6})\s+(.*)$/);
            if (!match) {
                return;
            }

            const rawHeading = match[2].trim();
            let baseSlug = computeBaseSlug(rawHeading);
            if (!baseSlug) {
                baseSlug = 'heading';
            }

            let slug = baseSlug;
            if (slugCounts.has(baseSlug)) {
                const count = slugCounts.get(baseSlug) + 1;
                slugCounts.set(baseSlug, count);
                slug = `${baseSlug}-${count}`;
            } else {
                slugCounts.set(baseSlug, 0);
            }

            headingLocationMap.set(slug, {
                line: index,
                column: 0,
                level: match[1].length,
                text: rawHeading,
            });
        });
    }

    function clearEditorHeadingHighlight() {
        if (!editorInstance || headingHighlightLine === null) {
            headingHighlightLine = null;
            return;
        }

        try {
            editorInstance.removeLineClass(headingHighlightLine, 'background', 'heading-target-line');
        } catch (error) {
            console.warn('Failed to remove heading highlight', error);
        }

        headingHighlightLine = null;
    }

    function highlightEditorLine(lineNumber) {
        const editor = ensureEditorInstance();
        if (!editor || typeof editor.addLineClass !== 'function') {
            return;
        }

        if (headingHighlightTimeout) {
            window.clearTimeout(headingHighlightTimeout);
            headingHighlightTimeout = null;
        }

        if (headingHighlightLine !== null) {
            try {
                editor.removeLineClass(headingHighlightLine, 'background', 'heading-target-line');
            } catch (error) {
                console.warn('Failed to clear previous heading highlight', error);
            }
        }

        try {
            editor.addLineClass(lineNumber, 'background', 'heading-target-line');
            headingHighlightLine = lineNumber;
        } catch (error) {
            console.warn('Failed to apply heading highlight', error);
            headingHighlightLine = null;
            return;
        }

        headingHighlightTimeout = window.setTimeout(() => {
            const instance = ensureEditorInstance();
            if (instance && headingHighlightLine !== null) {
                try {
                    instance.removeLineClass(headingHighlightLine, 'background', 'heading-target-line');
                } catch (error) {
                    console.warn('Failed to remove heading highlight after delay', error);
                }
            }
            headingHighlightLine = null;
            headingHighlightTimeout = null;
        }, 2000);
    }

    function handleHeadingActionClick(event) {
        const button = event.target.closest('.heading-action-button');
        if (!button) {
            return;
        }

        if (!content || !content.contains(button)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const action = button.dataset.headingAction;
        const slug = button.dataset.headingSlug;

        if (!slug) {
            return;
        }

        if (action === 'edit') {
            jumpToHeadingInEditor(slug);
            return;
        }

        if (action === 'copy') {
            copyHeadingLink(slug);
        }
    }

    function jumpToHeadingInEditor(slug) {
        if (!slug) {
            return;
        }

        if (!currentFile) {
            setStatus('Open a markdown file to edit sections.');
            return;
        }

        const focusEditorOnHeading = () => {
            const editor = ensureEditorInstance();
            if (!editor) {
                setStatus('Editor resources are still loading. Please try again in a moment.');
                return;
            }

            let location = headingLocationMap.get(slug);
            if (!location) {
                const source = typeof editor.getValue === 'function' ? editor.getValue() : currentContent;
                captureHeadingLocations(source);
                location = headingLocationMap.get(slug);
            }

            if (!location) {
                setStatus('Unable to locate this section in the editor.');
                return;
            }

            const targetPosition = { line: location.line, ch: location.column || 0 };

            editor.operation(() => {
                editor.setCursor(targetPosition);
                const bottomLine = Math.min(editor.lineCount() - 1, targetPosition.line + 5);
                editor.scrollIntoView({ from: targetPosition, to: { line: bottomLine, ch: 0 } }, 200);
                editor.focus();
            });

            highlightEditorLine(location.line);
            setStatus('Jumped to section in editor.');
        };

        if (!isEditing) {
            enterEditMode();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        if (isPreviewing) {
            returnToCodeMode();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        focusEditorOnHeading();
    }

    function copyHeadingLink(slug) {
        if (!slug) {
            return;
        }

        const baseUrl = window.location.href.split('#')[0];
        const link = `${baseUrl}#${slug}`;

        const notifyFailure = (error) => {
            if (error) {
                console.warn('Failed to copy heading link', error);
            }
            setStatus(`Copy failed. Link: ${link}`);
        };

        const notifySuccess = () => {
            setStatus('Copied link to clipboard.');
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(link).then(notifySuccess).catch((error) => {
                fallbackCopyLink(link, notifySuccess, () => notifyFailure(error));
            });
            return;
        }

        fallbackCopyLink(link, notifySuccess, notifyFailure);
    }

    function fallbackCopyLink(text, onSuccess, onFailure) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();

        let succeeded = false;
        let lastError = null;
        try {
            succeeded = document.execCommand('copy');
        } catch (error) {
            lastError = error;
        }

        document.body.removeChild(textarea);

        if (succeeded) {
            if (typeof onSuccess === 'function') {
                onSuccess();
            }
            return;
        }

        if (typeof onFailure === 'function') {
            onFailure(lastError);
        }
    }

    function encodeDiagramSource(code) {
        if (!code) {
            return '';
        }
        const bytes = textEncoder.encode(code);
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    function decodeDiagramSource(encoded, label = 'diagram') {
        if (!encoded) {
            return '';
        }
        try {
            const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            return textDecoder.decode(bytes);
        } catch (error) {
            console.warn(`Failed to decode ${label} source`, error);
            return '';
        }
    }

    function encodeMermaidSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeMermaidSource(encoded) {
        return decodeDiagramSource(encoded, 'Mermaid');
    }

    function encodeVegaSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeVegaSource(encoded) {
        return decodeDiagramSource(encoded, 'Vega');
    }

    function encodeExcalidrawSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeExcalidrawSource(encoded) {
        return decodeDiagramSource(encoded, 'Excalidraw');
    }

    function encodeSvelteSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeSvelteSource(encoded) {
        return decodeDiagramSource(encoded, 'Svelte');
    }

    function createExcalidrawViewerUiOptions() {
        return {
            canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: false,
                export: false,
                loadScene: false,
                saveAsImage: false,
                saveScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
                toggleShortcuts: false,
                zoomIn: false,
                zoomOut: false,
                zoomToFit: false,
                resetZoom: false,
                pan: false,
                viewMode: false,
                zenMode: false,
                gridMode: false,
                stats: false,
            },
        };
    }

    function waitForCoreLibraries(maxRetries = 80, interval = 100) {
        if (librariesReadyPromise) {
            return librariesReadyPromise;
        }

        librariesReadyPromise = new Promise((resolve) => {
            let attempts = 0;
            const check = () => {
                if (typeof marked !== 'undefined') {
                    resolve();
                    return;
                }

                if (attempts++ >= maxRetries) {
                    resolve();
                    return;
                }

                window.setTimeout(check, interval);
            };

            check();
        });

        return librariesReadyPromise;
    }

    const DIAGRAM_ICONS = {
        Mermaid: '📊',
        Vega: '📈',
        Excalidraw: '✏️',
    };

    function showDiagramStatus(element, type, message, source, variant) {
        const icon = DIAGRAM_ICONS[type] || 'ℹ️';
        const emphasised = variant === 'error' ? `<strong>${escapeHtml(message)}</strong>` : escapeHtml(message);
        const sourceMarkup = source ? `<pre>${escapeHtml(source)}</pre>` : '';
        element.innerHTML = `
            <div class="diagram-loading">
                ${icon} <strong>${escapeHtml(type)}</strong><br>
                ${emphasised}
                ${sourceMarkup}
            </div>
        `;
    }

    function showDiagramLoading(element, type, source) {
        showDiagramStatus(element, type, `${type} renderer loading…`, source, 'loading');
    }

    function showDiagramError(element, type, message, source) {
        showDiagramStatus(element, type, `Error: ${message}`, source, 'error');
    }

    function cleanupExcalidrawRoots() {
        excalidrawRoots.forEach((record) => {
            try {
                if (record && typeof record.unmount === 'function') {
                    record.unmount();
                } else if (record && record.root && typeof record.root.unmount === 'function') {
                    record.root.unmount();
                }
            } catch (error) {
                console.warn('Failed to unmount Excalidraw root', error);
            }
        });
        excalidrawRoots.clear();
    }

    function scheduleMermaidRetry() {
        if (mermaidRetryTimer) {
            return;
        }
        mermaidRetryTimer = window.setTimeout(() => {
            mermaidRetryTimer = null;
            renderMermaidDiagrams();
        }, 400);
    }

    function scheduleVegaRetry() {
        if (vegaRetryTimer) {
            return;
        }
        vegaRetryTimer = window.setTimeout(() => {
            vegaRetryTimer = null;
            renderVegaVisualizations();
        }, 400);
    }

    function scheduleExcalidrawRetry() {
        if (excalidrawRetryTimer) {
            return;
        }
        excalidrawRetryTimer = window.setTimeout(() => {
            excalidrawRetryTimer = null;
            renderExcalidrawDiagrams();
        }, 400);
    }

    function handleExcalidrawResize() {
        excalidrawRoots.forEach((record) => {
            if (record && record.api) {
                fitExcalidrawToViewport(record.api);
            }
        });
    }

    function ensureExcalidrawResizeHandler() {
        if (excalidrawResizeHandlerAttached) {
            return;
        }
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
            return;
        }
        window.addEventListener('resize', handleExcalidrawResize);
        excalidrawResizeHandlerAttached = true;
    }

    function fitExcalidrawToViewport(api) {
        if (!api || typeof api.getSceneElements !== 'function' || typeof api.scrollToContent !== 'function') {
            return;
        }

        let elements;
        try {
            elements = api.getSceneElements();
        } catch (error) {
            console.warn('Failed to read Excalidraw scene elements', error);
            return;
        }

        if (!Array.isArray(elements) || !elements.length) {
            return;
        }

        const visibleElements = elements.filter((item) => item && !item.isDeleted);
        if (!visibleElements.length) {
            return;
        }

        const executeFit = () => {
            try {
                api.scrollToContent(visibleElements, { fitToViewport: true, animate: false });
            } catch (error) {
                if (!excalidrawFitFailureLogged) {
                    console.warn('Failed to fit Excalidraw content', error);
                    excalidrawFitFailureLogged = true;
                }
            }
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(executeFit);
        } else {
            executeFit();
        }

        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
            window.setTimeout(executeFit, 150);
        }
    }

    function renderMermaidDiagrams() {
        const diagrams = content.querySelectorAll('.mermaid[data-mermaid-source]');
        if (!diagrams.length) {
            return;
        }

        if (typeof mermaid === 'undefined' || typeof mermaid.render !== 'function') {
            diagrams.forEach((element) => {
                const source = decodeMermaidSource(element.dataset.mermaidSource);
                showDiagramLoading(element, 'Mermaid', source);
            });
            scheduleMermaidRetry();
            return;
        }

        if (!mermaidInitAttempted) {
            try {
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'dark',
                    securityLevel: 'loose',
                });
            } catch (error) {
                console.warn('Mermaid initialization issue', error);
            }
            mermaidInitAttempted = true;
        }

        diagrams.forEach((element, index) => {
            const source = decodeMermaidSource(element.dataset.mermaidSource);
            if (!source.trim()) {
                showDiagramError(element, 'Mermaid', 'Diagram source is empty', source);
                return;
            }

            const renderId = `${element.id || 'mermaid-diagram'}-${index}`;
            mermaid
                .render(renderId, source)
                .then(({ svg }) => {
                    element.innerHTML = svg;
                })
                .catch((error) => {
                    console.error('Mermaid rendering error', error);
                    showDiagramError(element, 'Mermaid', error.message, source);
                });
        });
    }

    function renderVegaVisualizations() {
        const diagrams = content.querySelectorAll('.vega-diagram[data-vega-source]');
        if (!diagrams.length) {
            return;
        }

        if (typeof vegaEmbed === 'undefined') {
            diagrams.forEach((element) => {
                const source = decodeVegaSource(element.dataset.vegaSource);
                showDiagramLoading(element, 'Vega', source);
            });
            scheduleVegaRetry();
            return;
        }

        diagrams.forEach((element) => {
            const source = decodeVegaSource(element.dataset.vegaSource);
            if (!source.trim()) {
                showDiagramError(element, 'Vega', 'Specification is empty', source);
                return;
            }

            let spec;
            try {
                spec = JSON.parse(source);
            } catch (error) {
                console.error('Vega parsing error', error);
                showDiagramError(element, 'Vega', 'Invalid Vega/Vega-Lite specification', source);
                return;
            }

            element.innerHTML = '';
            vegaEmbed(element, spec, { actions: false, renderer: 'canvas', theme: 'dark' }).catch((error) => {
                console.error('Vega rendering error', error);
                showDiagramError(element, 'Vega', error.message, source);
            });
        });
    }

    function renderExcalidrawDiagrams() {
        const diagrams = content.querySelectorAll('.excalidraw-diagram[data-excalidraw-source]');
        if (!diagrams.length) {
            return;
        }

        if (
            !window.React ||
            !window.ReactDOM ||
            !window.ExcalidrawLib ||
            !window.ExcalidrawLib.Excalidraw
        ) {
            diagrams.forEach((element) => {
                const source = decodeExcalidrawSource(element.dataset.excalidrawSource);
                showDiagramLoading(element, 'Excalidraw', source);
            });
            scheduleExcalidrawRetry();
            return;
        }

        diagrams.forEach((element) => {
            const source = decodeExcalidrawSource(element.dataset.excalidrawSource);
            if (!source.trim()) {
                showDiagramError(element, 'Excalidraw', 'Scene data is empty', source);
                return;
            }

            let sceneData;
            try {
                sceneData = JSON.parse(source);
            } catch (error) {
                console.error('Excalidraw parsing error', error);
                showDiagramError(element, 'Excalidraw', 'Invalid scene JSON', source);
                return;
            }

            const desiredBackground = 'transparent';
            sceneData = {
                ...sceneData,
                appState: {
                    ...(sceneData && typeof sceneData === 'object' && sceneData.appState
                        ? sceneData.appState
                        : {}),
                    viewBackgroundColor: desiredBackground,
                },
            };

            const existingRoot = excalidrawRoots.get(element);
            if (existingRoot && typeof existingRoot.unmount === 'function') {
                try {
                    existingRoot.unmount();
                } catch (error) {
                    console.warn('Failed to unmount previous Excalidraw root', error);
                }
            }
            excalidrawRoots.delete(element);

            element.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.className = 'excalidraw-wrapper';
            wrapper.tabIndex = -1;
            element.appendChild(wrapper);

            const record = {
                root: null,
                api: null,
                wrapper,
                unmount() {
                    record.api = null;
                    if (record.root && typeof record.root.unmount === 'function') {
                        record.root.unmount();
                    } else if (
                        typeof window.ReactDOM !== 'undefined' &&
                        typeof window.ReactDOM.unmountComponentAtNode === 'function'
                    ) {
                        try {
                            window.ReactDOM.unmountComponentAtNode(wrapper);
                        } catch (error) {
                            console.warn('Failed to unmount Excalidraw instance', error);
                        }
                    }
                },
            };

            try {
                const viewerUiOptions = createExcalidrawViewerUiOptions();
                const excalidrawElement = window.React.createElement(window.ExcalidrawLib.Excalidraw, {
                    initialData: sceneData,
                    viewModeEnabled: true,
                    zenModeEnabled: false,
                    gridModeEnabled: false,
                    theme: 'dark',
                    autoFocus: false,
                    UIOptions: viewerUiOptions,
                    handleKeyboardEvent: () => false,
                    ref: (api) => {
                        record.api = api || null;
                        if (api) {
                            excalidrawFitFailureLogged = false;
                            ensureExcalidrawResizeHandler();
                            fitExcalidrawToViewport(api);
                            if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
                                window.setTimeout(() => fitExcalidrawToViewport(api), 250);
                            }
                        }
                    },
                });

                let root;
                if (typeof window.ReactDOM.createRoot === 'function') {
                    root = window.ReactDOM.createRoot(wrapper);
                    root.render(excalidrawElement);
                } else if (typeof window.ReactDOM.render === 'function') {
                    window.ReactDOM.render(excalidrawElement, wrapper);
                    root = {
                        unmount() {
                            if (typeof window.ReactDOM.unmountComponentAtNode === 'function') {
                                window.ReactDOM.unmountComponentAtNode(wrapper);
                            }
                        },
                    };
                } else {
                    throw new Error('ReactDOM renderer is unavailable');
                }

                record.root = root;
                excalidrawRoots.set(element, record);
            } catch (error) {
                record.api = null;
                console.error('Excalidraw rendering error', error);
                showDiagramError(element, 'Excalidraw', error.message, source);
            }
        });
    }

    function renderSvelteComponents() {
        const components = content.querySelectorAll('.svelte-component[data-svelte-source]');
        if (!components.length) {
            return;
        }

        if (!window.svelteCompiler || !window.svelte) {
            components.forEach((element) => {
                const source = decodeSvelteSource(element.dataset.svelteSource);
                showDiagramLoading(element, 'Svelte', source);
            });
            scheduleSvelteRetry();
            return;
        }

        components.forEach((element) => {
            const source = decodeSvelteSource(element.dataset.svelteSource);
            if (!source.trim()) {
                showDiagramError(element, 'Svelte', 'Component source is empty', source);
                return;
            }

            const existingInstance = svelteInstances.get(element);
            if (existingInstance && typeof existingInstance.$destroy === 'function') {
                try {
                    existingInstance.$destroy();
                } catch (error) {
                    console.warn('Failed to destroy previous Svelte instance', error);
                }
            }
            svelteInstances.delete(element);

            element.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.className = 'svelte-wrapper';
            element.appendChild(wrapper);

            try {
                const compiled = window.svelteCompiler.compile(source, {
                    dev: false,
                    css: 'injected',
                    generate: 'dom',
                });

                let componentCode = compiled.js.code;
                
                // Replace all import statements with global references for Svelte 4
                // First, handle the disclose-version import
                componentCode = componentCode.replace(
                    /import\s+"svelte\/internal\/disclose-version";?/g,
                    ''
                );
                
                // Then handle the main svelte/internal imports with destructuring
                componentCode = componentCode.replace(
                    /import\s+{([^}]+)}\s+from\s+"svelte\/internal";?/g,
                    (match, imports) => {
                        const importList = imports.split(/,\s*\n\s*|\s*,\s*/).map(i => i.trim()).filter(i => i);
                        const declarations = importList.map(name => `const ${name} = window.svelteInternal.${name};`);
                        return declarations.join('\n');
                    }
                );
                
                // Replace export default
                componentCode = componentCode.replace(
                    /export default class/g,
                    'return class'
                );
                componentCode = componentCode.replace(
                    /export default/g,
                    'return'
                );
                
                // Wrap in a function to make it return the component class
                const wrappedCode = `(function() {\n${componentCode}\n})()`;
                
                try {
                    const ComponentClass = eval(wrappedCode);
                    const instance = new ComponentClass({
                        target: wrapper,
                        props: {},
                    });
                    svelteInstances.set(element, instance);
                } catch (error) {
                    console.error('Svelte instantiation error', error);
                    showDiagramError(element, 'Svelte', error.message, source);
                }
            } catch (error) {
                console.error('Svelte compilation error', error);
                showDiagramError(element, 'Svelte', error.message, source);
            }
        });
    }

    function scheduleSvelteRetry() {
        if (svelteRetryTimer) {
            return;
        }
        svelteRetryTimer = window.setTimeout(() => {
            svelteRetryTimer = null;
            renderSvelteComponents();
        }, 500);
    }

    function renderAllDiagrams() {
        renderMermaidDiagrams();
        renderVegaVisualizations();
        renderExcalidrawDiagrams();
        renderSvelteComponents();
    }

    function setStatus(message) {
        // Status banner removed; keep function to avoid touching callers.
        void message;
    }

    function setConnectionStatus(connected) {
        offlineOverlay.classList.toggle('visible', !connected);
    }

    function setHasPendingChanges(value) {
        const nextValue = Boolean(value);
        if (nextValue === hasPendingChanges) {
            return;
        }
        hasPendingChanges = nextValue;
        document.body.classList.toggle('document-has-pending-changes', hasPendingChanges);
        updateHeader();
    }

    function updateDocumentPanelTitle() {
        const viewerPanel = dockviewSetup?.panels?.viewer;
        if (!viewerPanel) {
            return;
        }

        const baseTitle = currentFile || 'Document';
        const title = hasPendingChanges && currentFile ? `${baseTitle} ●` : baseTitle;
        const panelApi = viewerPanel?.api;

        if (panelApi && typeof panelApi.setTitle === 'function') {
            panelApi.setTitle(title);
        } else if (typeof viewerPanel.setTitle === 'function') {
            viewerPanel.setTitle(title);
        }
    }

    function promptUnsavedChanges(context = {}) {
        if (!unsavedChangesModal) {
            return Promise.resolve('cancel');
        }

        if (activeUnsavedPrompt) {
            return activeUnsavedPrompt;
        }

        const nextFile = typeof context.nextFile === 'string' ? context.nextFile : '';
        const displayName = currentFile || 'this document';
        if (unsavedChangesFilename) {
            unsavedChangesFilename.textContent = displayName;
        }
        if (unsavedChangesMessage) {
            unsavedChangesMessage.setAttribute('data-current-file', displayName);
        }
        if (unsavedChangesDetail) {
            if (nextFile && nextFile !== currentFile) {
                unsavedChangesDetail.textContent = `Switch to “${nextFile}” without saving?`;
            } else {
                unsavedChangesDetail.textContent = 'What would you like to do?';
            }
        }

        unsavedChangesModal.classList.add('visible');
        document.body.classList.add('modal-open');

        const promise = new Promise((resolve) => {
            const cleanup = () => {
                unsavedChangesModal.classList.remove('visible');
                document.body.classList.remove('modal-open');
                if (unsavedChangesSaveButton) {
                    unsavedChangesSaveButton.removeEventListener('click', onSave);
                }
                if (unsavedChangesDiscardButton) {
                    unsavedChangesDiscardButton.removeEventListener('click', onDiscard);
                }
                if (unsavedChangesCancelButton) {
                    unsavedChangesCancelButton.removeEventListener('click', onCancel);
                }
                unsavedChangesModal.removeEventListener('keydown', onKeyDown, true);
                unsavedChangesModal.removeEventListener('click', onOverlayClick);
                activeUnsavedPrompt = null;
            };

            const choose = (result) => {
                cleanup();
                resolve(result);
            };

            const onSave = () => choose('save');
            const onDiscard = () => choose('discard');
            const onCancel = () => choose('cancel');
            const onKeyDown = (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    choose('cancel');
                }
            };
            const onOverlayClick = (event) => {
                if (event.target === unsavedChangesModal) {
                    choose('cancel');
                }
            };

            if (unsavedChangesSaveButton) {
                unsavedChangesSaveButton.addEventListener('click', onSave);
            }
            if (unsavedChangesDiscardButton) {
                unsavedChangesDiscardButton.addEventListener('click', onDiscard);
            }
            if (unsavedChangesCancelButton) {
                unsavedChangesCancelButton.addEventListener('click', onCancel);
            }

            unsavedChangesModal.addEventListener('keydown', onKeyDown, true);
            unsavedChangesModal.addEventListener('click', onOverlayClick);

            window.setTimeout(() => {
                if (typeof unsavedChangesSaveButton?.focus === 'function') {
                    unsavedChangesSaveButton.focus();
                } else if (typeof unsavedChangesDiscardButton?.focus === 'function') {
                    unsavedChangesDiscardButton.focus();
                } else {
                    unsavedChangesModal.focus({ preventScroll: true });
                }
            }, 0);
        });

        activeUnsavedPrompt = promise;
        return promise;
    }

    function updateHeader() {
        const hasFile = Boolean(currentFile);
        const indicator = hasPendingChanges && hasFile ? ' ●' : '';

        if (fileName) {
            if (dockviewIsActive) {
                if (hasFile) {
                    fileName.textContent = `Markdown Viewer${indicator}`;
                    fileName.classList.add('hidden');
                } else {
                    fileName.textContent = 'No file selected';
                    fileName.classList.remove('hidden');
                }
            } else {
                fileName.classList.remove('hidden');
                const baseName = hasFile ? currentFile : 'No file selected';
                fileName.textContent = hasFile ? `${baseName}${indicator}` : baseName;
            }
        }

        sidebarPath.textContent = resolvedRootPath || originalPathArgument || 'Unknown';
        downloadButton.disabled = !hasFile;
        deleteButton.disabled = !hasFile;
        editButton.disabled = !hasFile && !isEditing;
        previewButton.disabled = !hasFile;
        saveButton.disabled = !hasFile;
        cancelButton.disabled = false;
        updateActionVisibility();
        updateDocumentPanelTitle();
    }

    function updateActionVisibility() {
        const hasFile = Boolean(currentFile);
        editButton.classList.toggle('hidden', !hasFile || (isEditing && !isPreviewing));
        previewButton.classList.toggle('hidden', !isEditing || isPreviewing);
        saveButton.classList.toggle('hidden', !isEditing);
        cancelButton.classList.toggle('hidden', !isEditing);
        downloadButton.classList.toggle('hidden', isEditing);
        deleteButton.classList.toggle('hidden', isEditing);
    }

    function buildQuery(params) {
        const query = new URLSearchParams();
        if (originalPathArgument) {
            query.set('path', originalPathArgument);
        }
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                query.set(key, value);
            }
        });
        const queryString = query.toString();
        return queryString ? `?${queryString}` : '';
    }

    function updateLocation(file, { replace = false } = {}) {
        const newQuery = buildQuery({ file });
        const newUrl = `${window.location.pathname}${newQuery}`;
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        const stateData = { file };

        if (replace || newUrl === currentUrl) {
            window.history.replaceState(stateData, '', newUrl);
        } else {
            window.history.pushState(stateData, '', newUrl);
        }
    }

    function fileFromSearch(search) {
        const params = new URLSearchParams(search || '');
        const value = params.get('file');
        if (typeof value !== 'string') {
            return '';
        }
        const trimmed = value.trim();
        return trimmed === '' ? '' : trimmed;
    }

    function renderMarkdown(markdownText, options = {}) {
        cleanupExcalidrawRoots();
        configureMarked();
        updateRelativeLinkBase(currentFile);
        mermaidIdCounter = 0;
        vegaIdCounter = 0;
        excalidrawIdCounter = 0;

        // Reset slug counter for each document to ensure unique IDs
        documentSlugCounts = new Map();

        const sourceText = markdownText || '';
        const updateCurrent = Boolean(options.updateCurrent);
        captureHeadingLocations(sourceText);

        if (typeof marked === 'undefined') {
            activeHeadingCollection = null;
            pendingMarkdown = sourceText;
            content.textContent = sourceText;
            updateTableOfContents([]);
            waitForCoreLibraries().then(() => {
                if (pendingMarkdown !== null) {
                    const textToRender = pendingMarkdown;
                    pendingMarkdown = null;
                    renderMarkdown(textToRender, { updateCurrent });
                }
            });
            if (updateCurrent) {
                currentContent = sourceText;
            }
            return;
        }

        activeHeadingCollection = [];
        content.innerHTML = marked.parse(sourceText);
        const headings = Array.isArray(activeHeadingCollection) ? [...activeHeadingCollection] : [];
        activeHeadingCollection = null;
        pendingMarkdown = null;

        if (typeof hljs !== 'undefined') {
            content.querySelectorAll('pre code').forEach((block) => {
                if (block.closest('.mermaid, .vega-diagram, .excalidraw-diagram')) {
                    return;
                }
                try {
                    hljs.highlightElement(block);
                } catch (err) {
                    console.warn('Highlight.js error', err);
                }
            });
        }

        updateTableOfContents(headings);
        renderAllDiagrams();
        if (updateCurrent) {
            currentContent = sourceText;
        }
    }

    function updateTableOfContents(headings) {
        if (!tocList) {
            return;
        }

        tocList.innerHTML = '';

        if (!Array.isArray(headings) || headings.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'toc-empty-state';
            emptyState.textContent = 'No headings found in this document yet.';
            tocList.appendChild(emptyState);
            return;
        }

        const minLevel = headings.reduce((accumulator, entry) => {
            const level = typeof entry.level === 'number' ? entry.level : 1;
            return Math.min(accumulator, Math.max(1, Math.min(6, level)));
        }, 6);

        const list = document.createElement('ol');
        list.setAttribute('role', 'list');

        headings.forEach((entry) => {
            const level = Math.max(1, Math.min(6, entry.level || 1));
            const item = document.createElement('li');
            item.className = 'toc-entry';

            const link = document.createElement('a');
            link.className = 'toc-link';
            link.href = `#${entry.slug}`;
            link.textContent = entry.text || entry.slug || 'Untitled section';
            link.setAttribute('aria-level', String(level));
            link.dataset.level = String(level);
            const indentLevel = Math.max(0, level - minLevel);
            link.style.paddingLeft = `${10 + indentLevel * 16}px`;

            item.appendChild(link);
            list.appendChild(item);
        });

        tocList.appendChild(list);
    }

    function handleTocClick(event) {
        const link = event.target.closest('a.toc-link');
        if (!link) {
            return;
        }

        const hash = link.getAttribute('href');
        if (typeof hash !== 'string' || !hash.startsWith('#')) {
            return;
        }

        const targetId = hash.slice(1);
        if (!targetId) {
            return;
        }

        const targetElement = document.getElementById(targetId);
        if (!targetElement) {
            return;
        }

        event.preventDefault();

        try {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            targetElement.scrollIntoView();
        }

        if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
            const newUrl = `${window.location.pathname}${window.location.search}#${targetId}`;
            history.replaceState(history.state, '', newUrl);
        }
    }

    if (tocList) {
        tocList.addEventListener('click', handleTocClick);
    }

    // ------------------------------------------------------------------
    // Markdown editing helpers
    // ------------------------------------------------------------------
    function ensureEditorInstance() {
        if (editorInstance) {
            return editorInstance;
        }
        if (typeof window.CodeMirror === 'undefined') {
            return null;
        }

        editorContainer.innerHTML = '';
        suppressEditorChangeEvents = true;
        try {
            editorInstance = window.CodeMirror(editorContainer, {
                value: draftContent,
                mode: 'markdown',
                theme: 'one-dark',
                lineNumbers: true,
                lineWrapping: true,
                autofocus: true,
            });
            editorInstance.setSize('100%', '100%');
            editorInstance.on('change', handleEditorContentChange);
        } finally {
            suppressEditorChangeEvents = false;
        }
        setHasPendingChanges(draftContent !== currentContent);
        return editorInstance;
    }

    function handleEditorContentChange(instance) {
        if (!instance || suppressEditorChangeEvents) {
            return;
        }
        draftContent = instance.getValue();
        setHasPendingChanges(draftContent !== currentContent);
    }

    function enterEditMode() {
        if (!currentFile) {
            return;
        }
        if (typeof window.CodeMirror === 'undefined') {
            setStatus('Editor resources are still loading. Please try again in a moment.');
            return;
        }

        isEditing = true;
        isPreviewing = false;
        draftContent = currentContent;
        const editor = ensureEditorInstance();
        if (!editor) {
            isEditing = false;
            setStatus('Editor resources are still loading. Please try again in a moment.');
            updateActionVisibility();
            return;
        }

        suppressEditorChangeEvents = true;
        try {
            editor.setValue(draftContent);
        } finally {
            suppressEditorChangeEvents = false;
        }
        setHasPendingChanges(false);
        window.setTimeout(() => {
            editor.refresh();
            editor.focus();
        }, 0);

        content.classList.add('hidden');
        editorContainer.classList.add('visible');
        updateHeader();
        setStatus('Editing markdown…');
    }

    function enterPreviewMode() {
        if (!isEditing) {
            return;
        }
        const editor = ensureEditorInstance();
        if (editor) {
            draftContent = editor.getValue();
        }
        setHasPendingChanges(draftContent !== currentContent);
        isPreviewing = true;
        renderMarkdown(draftContent, { updateCurrent: false });
        editorContainer.classList.remove('visible');
        content.classList.remove('hidden');
        updateHeader();
        setStatus('Previewing changes.');
    }

    function returnToCodeMode() {
        if (!isPreviewing) {
            return;
        }
        isPreviewing = false;
        renderMarkdown(currentContent, { updateCurrent: true });
        content.classList.add('hidden');
        editorContainer.classList.add('visible');
        const editor = ensureEditorInstance();
        if (editor) {
            window.setTimeout(() => {
                editor.refresh();
                editor.focus();
            }, 0);
        }
        updateHeader();
        setStatus('Editing markdown…');
    }

    function exitEditMode(options = {}) {
        const { restoreContent = true } = options;
        if (!isEditing && !isPreviewing) {
            updateHeader();
            return;
        }
        isEditing = false;
        isPreviewing = false;
        draftContent = '';
        clearEditorHeadingHighlight();
        content.classList.remove('hidden');
        editorContainer.classList.remove('visible');
        if (restoreContent) {
            renderMarkdown(currentContent, { updateCurrent: true });
        }
        setHasPendingChanges(false);
        updateHeader();
    }


    function resetViewToFallback(options = {}) {
        const { skipHistory = false } = options;
        exitEditMode({ restoreContent: false });
        currentFile = null;
        const fallback = fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path');
        renderMarkdown(fallback, { updateCurrent: true });
        updateActiveFileHighlight();
        updateHeader();
        if (!skipHistory) {
            updateLocation('', { replace: true });
        }
    }
    function renderFileList() {
        fileList.innerHTML = '';

        const treeToRender = Array.isArray(fileTree) && fileTree.length
            ? fileTree
            : buildTreeFromFlatList(files);

        if (!treeToRender.length) {
            const empty = document.createElement('li');
            empty.className = 'empty-state';
            empty.textContent = 'No markdown files yet';
            fileList.appendChild(empty);
            return;
        }

        ensureExpandedForCurrentFile(currentFile);

        const visited = new Set();
        const fragment = document.createDocumentFragment();
        treeToRender.forEach((node) => {
            fragment.appendChild(renderTreeNode(node, 0, visited));
        });
        fileList.appendChild(fragment);

        const stale = [];
        expandedDirectories.forEach((value) => {
            if (!visited.has(value)) {
                stale.push(value);
            }
        });
        stale.forEach((value) => expandedDirectories.delete(value));

        knownDirectories.clear();
        visited.forEach((value) => knownDirectories.add(value));

        updateActiveFileHighlight();
    }

    function renderTreeNode(node, depth, visited) {
        const item = document.createElement('li');
        item.className = `tree-node ${node.type === 'directory' ? 'directory-node' : 'file-node'}`;

        if (node.type === 'directory') {
            const pathKey = typeof node.relativePath === 'string' ? node.relativePath : '';
            visited.add(pathKey);

            if (!knownDirectories.has(pathKey) && !expandedDirectories.has(pathKey)) {
                expandedDirectories.add(pathKey);
            }

            const row = document.createElement('div');
            row.className = 'tree-row directory-row';
            row.style.paddingLeft = `${depth * 16}px`;

            const isExpanded = expandedDirectories.has(pathKey);
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'tree-toggle';
            toggle.setAttribute('aria-expanded', String(isExpanded));
            toggle.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`);
            toggle.textContent = isExpanded ? '▾' : '▸';
            toggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleDirectory(pathKey);
            });

            const label = document.createElement('button');
            label.type = 'button';
            label.className = 'tree-label directory-label';

            // Create folder icon element
            const folderIcon = document.createElement('i');
            folderIcon.className = isExpanded ? 'directory-icon fas fa-folder-open' : 'directory-icon fas fa-folder';

            // Create text element
            const labelText = document.createElement('span');
            labelText.textContent = node.name;

            // Append icon and text to label
            label.appendChild(folderIcon);
            label.appendChild(labelText);

            label.addEventListener('click', (event) => {
                event.preventDefault();
                toggleDirectory(pathKey);
            });

            row.appendChild(toggle);
            row.appendChild(label);
            item.appendChild(row);

            const childrenList = document.createElement('ul');
            childrenList.className = 'tree-children';
            if (!isExpanded) {
                childrenList.classList.add('collapsed');
            }
            const children = Array.isArray(node.children) ? node.children : [];
            children.forEach((child) => {
                childrenList.appendChild(renderTreeNode(child, depth + 1, visited));
            });
            item.appendChild(childrenList);
            return item;
        }

        const button = document.createElement('button');
        button.className = 'file-button';
        button.type = 'button';

        // Create icon element
        const icon = document.createElement('i');
        icon.className = 'file-icon fab fa-markdown'; // Font Awesome markdown icon

        // Create text element
        const text = document.createElement('span');
        text.textContent = node.name;

        // Append icon and text to button
        button.appendChild(icon);
        button.appendChild(text);

        button.dataset.file = node.relativePath;
        button.style.paddingLeft = `${depth * 16 + 24}px`;
        button.addEventListener('click', () => {
            if (node.relativePath !== currentFile) {
                selectFile(node.relativePath);
            }
        });
        item.appendChild(button);
        return item;
    }

    function ensureExpandedForCurrentFile(filePath) {
        if (typeof filePath !== 'string' || !filePath.includes('/')) {
            return;
        }
        const parts = filePath.split('/');
        parts.pop();
        let prefix = '';
        parts.forEach((segment) => {
            if (!segment) {
                return;
            }
            prefix = prefix ? `${prefix}/${segment}` : segment;
            expandedDirectories.add(prefix);
        });
    }

    function toggleDirectory(pathKey) {
        if (!pathKey && pathKey !== '') {
            return;
        }
        if (expandedDirectories.has(pathKey)) {
            expandedDirectories.delete(pathKey);
        } else {
            expandedDirectories.add(pathKey);
        }
        renderFileList();
    }

    function updateActiveFileHighlight() {
        fileList.querySelectorAll('.file-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.file === currentFile);
        });
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `Request failed with status ${response.status}`);
        }
        return response.json();
    }

    async function refreshFiles() {
        const url = `/api/files${buildQuery({})}`;
        const data = await fetchJson(url);
        resolvedRootPath = data.rootPath || resolvedRootPath;
        const updatedIndex = normaliseFileIndex({ filesValue: data.files, treeValue: data.tree });
        files = updatedIndex.files;
        fileTree = updatedIndex.tree;
        renderFileList();
        if (!files.find((entry) => entry.relativePath === currentFile)) {
            currentFile = files.length ? files[0].relativePath : null;
            if (currentFile) {
                await loadFile(currentFile, { replaceHistory: true });
            } else {
                currentFile = null;
                exitEditMode({ restoreContent: false });
                renderMarkdown(
                    fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path'),
                    { updateCurrent: true }
                );
                updateLocation('', { replace: true });
                updateHeader();
            }
        } else {
            updateActiveFileHighlight();
            updateHeader();
        }
    }

    function fallbackMarkdownFor(path) {
        return `# No markdown files found\n\nThe directory \`${path}\` does not contain any markdown files yet.`;
    }

    async function loadFile(file, options = {}) {
        const { skipHistory = false, replaceHistory = false } = options;
        if (isEditing || isPreviewing) {
            setStatus('Editing session closed because the file was reloaded.');
            exitEditMode();
        } else {
            setStatus('');
        }
        const url = `/api/file${buildQuery({ file })}`;
        try {
            const data = await fetchJson(url);
            resolvedRootPath = data.rootPath || resolvedRootPath;
            currentFile = data.file || file;
            renderMarkdown(data.content || '', { updateCurrent: true });
            setHasPendingChanges(false);
            updateActiveFileHighlight();
            updateHeader();
            updateLocation(currentFile, { replace: replaceHistory || skipHistory });
        } catch (err) {
            setStatus(err.message);
            console.error('Failed to load file', err);
        }
    }

    async function saveCurrentFile() {
        if (!isEditing || !currentFile) {
            return false;
        }

        const editor = ensureEditorInstance();
        if (editor && !isPreviewing) {
            draftContent = editor.getValue();
        }

        const contentToSave = draftContent;
        setStatus('Saving changes…');

        try {
            await fetchJson(`/api/file${buildQuery({ file: currentFile })}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: contentToSave }),
            });
            currentContent = contentToSave;
            exitEditMode();
            setStatus('Changes saved.');
            updateActiveFileHighlight();
            return true;
        } catch (err) {
            setStatus(err.message);
            console.error('Save failed', err);
            return false;
        }
    }

    async function selectFile(file) {
        if (hasPendingChanges) {
            const decision = await promptUnsavedChanges({ nextFile: file });
            if (decision === 'cancel') {
                return;
            }
            if (decision === 'save') {
                const saved = await saveCurrentFile();
                if (!saved) {
                    return;
                }
            } else if (decision === 'discard') {
                exitEditMode();
                setStatus('Changes discarded.');
            }
        } else if (isEditing || isPreviewing) {
            exitEditMode();
        }
        await loadFile(file);
    }

    function setupActions() {
        editButton.addEventListener('click', () => {
            if (isEditing && isPreviewing) {
                returnToCodeMode();
                return;
            }
            if (!isEditing) {
                enterEditMode();
            }
        });

        previewButton.addEventListener('click', () => {
            if (!currentFile) {
                return;
            }
            enterPreviewMode();
        });

        cancelButton.addEventListener('click', () => {
            if (!isEditing && !isPreviewing) {
                return;
            }
            exitEditMode();
            setStatus('Edits cancelled.');
        });

        saveButton.addEventListener('click', async () => {
            await saveCurrentFile();
        });

        downloadButton.addEventListener('click', async () => {
            if (!currentFile) {
                return;
            }
            try {
                const data = await fetchJson(`/api/file${buildQuery({ file: currentFile })}`);
                const blob = new Blob([data.content || ''], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = currentFile;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } catch (err) {
                setStatus(err.message);
                console.error('Download failed', err);
            }
        });

        deleteButton.addEventListener('click', async () => {
            if (!currentFile) {
                return;
            }
            const confirmed = window.confirm(`Delete ${currentFile}?`);
            if (!confirmed) {
                return;
            }
            try {
                await fetchJson(`/api/file${buildQuery({ file: currentFile })}`, { method: 'DELETE' });
                setStatus('File deleted.');
                await refreshFiles();
            } catch (err) {
                setStatus(err.message);
                console.error('Delete failed', err);
            }
        });
    }

    function connectWebSocket() {
        if (websocket) {
            websocket.close();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        websocket = new WebSocket(`${protocol}://${window.location.host}/ws`);

        websocket.addEventListener('open', () => {
            setConnectionStatus(true);
            websocket.send(JSON.stringify({ type: 'subscribe', path: originalPathArgument }));
        });

        websocket.addEventListener('message', async (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'directory_update') {
                    resolvedRootPath = payload.path || resolvedRootPath;
                    const updatedIndex = normaliseFileIndex({
                        filesValue: payload.files,
                        treeValue: payload.tree,
                    });
                    files = updatedIndex.files;
                    fileTree = updatedIndex.tree;
                    renderFileList();
                    if (!files.find((entry) => entry.relativePath === currentFile)) {
                        currentFile = files.length ? files[0].relativePath : null;
                        if (currentFile) {
                            await loadFile(currentFile, { replaceHistory: true });
                        } else {
                            currentFile = null;
                            exitEditMode({ restoreContent: false });
                            renderMarkdown(
                                fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path'),
                                { updateCurrent: true }
                            );
                            updateLocation('', { replace: true });
                            updateHeader();
                        }
                    } else {
                        updateActiveFileHighlight();
                        updateHeader();
                    }
                } else if (payload.type === 'file_changed') {
                    if (payload.file && payload.file === currentFile) {
                        await loadFile(currentFile, { replaceHistory: true });
                    }
                }
            } catch (err) {
                console.error('Failed to process websocket event', err);
            }
        });

        function scheduleReconnect() {
            if (reconnectTimer) {
                return;
            }
            reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connectWebSocket();
            }, 1500);
        }

        websocket.addEventListener('close', () => {
            setConnectionStatus(false);
            scheduleReconnect();
        });

        websocket.addEventListener('error', () => {
            websocket.close();
        });
    }

    function scheduleTerminalLibraryRetry() {
        if (terminalLibraryRetryTimer) {
            return;
        }
        terminalLibraryRetryTimer = window.setTimeout(() => {
            terminalLibraryRetryTimer = null;
            if (!terminalInstance) {
                ensureTerminalInstance();
            }
            if (!terminalSocket) {
                connectTerminal();
            }
        }, 250);
    }

    function areTerminalLibrariesReady() {
        return (
            typeof window !== 'undefined' &&
            typeof window.Terminal === 'function' &&
            window.FitAddon &&
            typeof window.FitAddon.FitAddon === 'function'
        );
    }

    function ensureTerminalInstance() {
        if (terminalInstance || !terminalContainer) {
            return terminalInstance;
        }

        if (!areTerminalLibrariesReady()) {
            scheduleTerminalLibraryRetry();
            return null;
        }

        try {
            terminalInstance = new window.Terminal({
                convertEol: true,
                cursorBlink: true,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: 13,
                theme: {
                    // Palette derived from the provided macOS Terminal profile to keep the
                    // in-browser terminal consistent with the requested look-and-feel.
                    background: '#21252b',
                    foreground: '#abb2bf',
                    cursor: '#abb2bf',
                    cursorAccent: '#21252b',
                    selection: '#323844',
                    selectionForeground: '#abb2bf',
                    black: '#21252b',
                    red: '#e06c75',
                    green: '#98c379',
                    yellow: '#e5c07b',
                    blue: '#61afef',
                    magenta: '#c678dd',
                    cyan: '#56b6c2',
                    white: '#abb2bf',
                    brightBlack: '#767676',
                    brightRed: '#e06c75',
                    brightGreen: '#98c379',
                    brightYellow: '#e5c07b',
                    brightBlue: '#61afef',
                    brightMagenta: '#c678dd',
                    brightCyan: '#56b6c2',
                    brightWhite: '#abb2bf',
                },
            });
        } catch (error) {
            console.warn('Failed to initialise terminal instance', error);
            terminalInstance = null;
            return null;
        }

        try {
            terminalFitAddon = new window.FitAddon.FitAddon();
            terminalInstance.loadAddon(terminalFitAddon);
        } catch (error) {
            console.warn('Failed to load terminal fit addon', error);
            terminalInstance.dispose();
            terminalInstance = null;
            return null;
        }

        terminalInstance.open(terminalContainer);
        terminalInstance.focus();

        terminalInstance.onData((data) => {
            if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
                terminalSocket.send(JSON.stringify({ type: 'input', data }));
            }
        });

        terminalInstance.onResize((size) => {
            if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
                terminalSocket.send(
                    JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows })
                );
            }
        });

        scheduleTerminalFit();
        return terminalInstance;
    }

    function scheduleTerminalFit() {
        if (!terminalInstance || !terminalFitAddon || terminalCollapsed) {
            return;
        }

        if (pendingTerminalFitFrame) {
            window.cancelAnimationFrame(pendingTerminalFitFrame);
        }

        pendingTerminalFitFrame = window.requestAnimationFrame(() => {
            pendingTerminalFitFrame = null;
            fitTerminal();
        });
    }

    function fitTerminal() {
        if (!terminalInstance || !terminalFitAddon || terminalCollapsed) {
            return;
        }

        try {
            terminalFitAddon.fit();
        } catch (error) {
            console.warn('Unable to fit terminal to container', error);
            return;
        }

        sendTerminalResize();
    }

    function sendTerminalResize() {
        if (!terminalInstance || !terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        terminalSocket.send(
            JSON.stringify({ type: 'resize', cols: terminalInstance.cols, rows: terminalInstance.rows })
        );
    }

    function updateTerminalStatus(message) {
        if (terminalStatusText) {
            terminalStatusText.textContent = message || '';
        }
        terminalLastStatusMessage = message || '';
    }

    function scheduleTerminalReconnect(delay = 1500) {
        if (terminalReconnectTimer) {
            return;
        }
        terminalReconnectTimer = window.setTimeout(() => {
            terminalReconnectTimer = null;
            connectTerminal();
        }, delay);
    }

    function connectTerminal() {
        if (!terminalContainer) {
            return;
        }

        if (terminalSocket &&
            (terminalSocket.readyState === WebSocket.OPEN || terminalSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const terminal = ensureTerminalInstance();
        if (!terminal) {
            scheduleTerminalLibraryRetry();
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
        socket.binaryType = 'arraybuffer';
        terminalSocket = socket;
        updateTerminalStatus('Connecting…');

        socket.addEventListener('open', () => {
            if (terminalReconnectTimer) {
                window.clearTimeout(terminalReconnectTimer);
                terminalReconnectTimer = null;
            }
            updateTerminalStatus('Connected');
            scheduleTerminalFit();
        });

        socket.addEventListener('message', (event) => {
            if (!terminalInstance) {
                return;
            }

            if (typeof event.data === 'string') {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'state' && typeof payload.message === 'string') {
                        updateTerminalStatus(payload.message);
                        return;
                    }
                    if (payload.type === 'exit') {
                        if (typeof payload.code === 'number') {
                            updateTerminalStatus(`Process exited (${payload.code})`);
                        } else {
                            updateTerminalStatus('Process exited');
                        }
                        scheduleTerminalReconnect();
                        return;
                    }
                } catch (error) {
                    // Treat as raw output when parsing fails.
                    terminalInstance.write(event.data);
                    return;
                }

                terminalInstance.write(event.data);
                return;
            }

            const consumeBuffer = (buffer) => {
                if (!buffer) {
                    return;
                }
                const text = terminalDecoder.decode(buffer);
                if (text) {
                    terminalInstance.write(text);
                }
            };

            if (event.data instanceof ArrayBuffer) {
                consumeBuffer(new Uint8Array(event.data));
                return;
            }

            if (event.data && typeof event.data.arrayBuffer === 'function') {
                event.data
                    .arrayBuffer()
                    .then((buffer) => consumeBuffer(new Uint8Array(buffer)))
                    .catch((error) => console.warn('Failed to decode terminal payload', error));
            }
        });

        socket.addEventListener('close', () => {
            terminalSocket = null;
            if (!terminalLastStatusMessage.startsWith('Process exited')) {
                updateTerminalStatus('Disconnected – reconnecting…');
            }
            scheduleTerminalReconnect();
        });

        socket.addEventListener('error', () => {
            updateTerminalStatus('Connection error');
            socket.close();
        });
    }

    function setupTerminalPanel() {
        if (!terminalPanel) {
            return;
        }

        if (!dockviewIsActive && terminalResizeObserver) {
            terminalResizeObserver.disconnect();
            terminalResizeObserver = null;
        }

        if (dockviewIsActive) {
            terminalCollapsed = false;
            terminalPanel.style.height = '';
            terminalPanel.style.maxHeight = '';
            terminalPanel.classList.remove('is-collapsed');
            if (terminalResizeHandle) {
                terminalResizeHandle.remove();
            }
            if (terminalToggleButton) {
                terminalToggleButton.disabled = true;
                terminalToggleButton.textContent = 'Terminal (layout-managed)';
                terminalToggleButton.setAttribute('aria-expanded', 'true');
            }

            if (!terminalResizeObserver && typeof window.ResizeObserver === 'function') {
                const resizeTarget = terminalPanel.parentElement || terminalPanel;
                if (resizeTarget) {
                    terminalResizeObserver = new window.ResizeObserver(() => {
                        scheduleTerminalFit();
                    });
                    terminalResizeObserver.observe(resizeTarget);
                }
            }

            const instance = ensureTerminalInstance();
            if (instance) {
                scheduleTerminalFit();
            }
            connectTerminal();
            return;
        }

        const minHeight = 140;

        const clampHeight = (value) => {
            const max = Math.max(minHeight, Math.round(window.innerHeight * 0.75));
            if (Number.isFinite(value)) {
                return Math.min(Math.max(value, minHeight), max);
            }
            return minHeight;
        };

        const persistHeight = () => {
            if (typeof window.localStorage === 'undefined') {
                return;
            }
            try {
                window.localStorage.setItem(terminalStorageKey, String(terminalHeight));
            } catch (error) {
                // Ignore persistence errors (e.g. storage disabled).
            }
        };

        const applyHeight = (value, { persist = false } = {}) => {
            const clamped = clampHeight(value);
            terminalHeight = clamped;
            terminalPanel.style.height = `${clamped}px`;
            if (persist) {
                persistHeight();
            }
            scheduleTerminalFit();
            return clamped;
        };

        const restoreHeightFromStorage = () => {
            if (typeof window.localStorage === 'undefined') {
                terminalHeight = clampHeight(terminalPanel.getBoundingClientRect().height || 260);
                return;
            }
            let stored = null;
            try {
                stored = window.localStorage.getItem(terminalStorageKey);
            } catch (error) {
                stored = null;
            }
            const numeric = stored === null ? NaN : Number(stored);
            if (Number.isFinite(numeric)) {
                applyHeight(numeric);
            } else {
                terminalHeight = clampHeight(terminalPanel.getBoundingClientRect().height || 260);
            }
        };

        const setCollapsed = (value) => {
            const collapsed = Boolean(value);
            if (terminalCollapsed === collapsed) {
                return;
            }
            terminalCollapsed = collapsed;
            terminalPanel.classList.toggle('is-collapsed', collapsed);
            if (terminalToggleButton) {
                terminalToggleButton.setAttribute('aria-expanded', String(!collapsed));
                terminalToggleButton.textContent = collapsed ? 'Show terminal' : 'Hide terminal';
            }

            if (collapsed) {
                terminalPanel.style.height = '';
                return;
            }

            applyHeight(terminalHeight || clampHeight(terminalPanel.getBoundingClientRect().height || 260));

            if (terminalPanel) {
                const handleTransitionEnd = (event) => {
                    if (event.target !== terminalPanel || event.propertyName !== 'height') {
                        return;
                    }
                    terminalPanel.removeEventListener('transitionend', handleTransitionEnd);
                    scheduleTerminalFit();
                };
                terminalPanel.addEventListener('transitionend', handleTransitionEnd, { once: true });
            }

            const instance = ensureTerminalInstance();
            if (instance) {
                instance.focus();
                if (typeof instance.scrollToBottom === 'function') {
                    instance.scrollToBottom();
                }
            }

            connectTerminal();
        };

        restoreHeightFromStorage();

        if (terminalToggleButton) {
            terminalToggleButton.addEventListener('click', () => {
                setCollapsed(!terminalCollapsed);
            });
        }

        if (terminalResizeHandle) {
            terminalResizeHandle.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = terminalPanel.getBoundingClientRect().height;

                const handleMove = (moveEvent) => {
                    const delta = startY - moveEvent.clientY;
                    const next = clampHeight(startHeight + delta);
                    applyHeight(next);
                };

                const handleUp = () => {
                    document.removeEventListener('pointermove', handleMove);
                    document.removeEventListener('pointerup', handleUp);
                    persistHeight();
                    scheduleTerminalFit();
                };

                document.addEventListener('pointermove', handleMove);
                document.addEventListener('pointerup', handleUp);
            });

            terminalResizeHandle.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return;
                }
                event.preventDefault();
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                const offset = event.key === 'ArrowUp' ? 32 : -32;
                const next = clampHeight((terminalHeight || terminalPanel.getBoundingClientRect().height) + offset);
                applyHeight(next, { persist: true });
            });

            terminalResizeHandle.addEventListener('dblclick', () => {
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                applyHeight(clampHeight(260), { persist: true });
            });
        }

        window.addEventListener('resize', () => {
            if (terminalCollapsed) {
                return;
            }
            const current = terminalHeight || terminalPanel.getBoundingClientRect().height;
            const clamped = clampHeight(current);
            if (clamped !== current) {
                applyHeight(clamped, { persist: true });
            } else {
                scheduleTerminalFit();
            }
        });

        setCollapsed(false);
        ensureTerminalInstance();
        connectTerminal();
    }

    window.addEventListener('beforeunload', () => {
        if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
            try {
                terminalSocket.close();
            } catch (error) {
                // Swallow shutdown errors.
            }
        }
    });

    function initialise() {
        const initialFallback = fallbackMarkdownFor(resolvedRootPath || originalPathArgument || 'the selected path');
        renderMarkdown(state.content || initialFallback, { updateCurrent: true });
        renderFileList();
        updateHeader();
        if (state.error) {
            setStatus(state.error);
        }
        setupActions();
        setupTerminalPanel();
        connectWebSocket();
        if (!currentFile && files.length) {
            currentFile = files[0].relativePath;
        }

        if (!initialFileFromLocation && currentFile) {
            loadFile(currentFile, { replaceHistory: true });
        }
    }

    window.addEventListener('popstate', () => {
        const targetFile = fileFromSearch(window.location.search);
        if (targetFile) {
            if (targetFile !== currentFile) {
                loadFile(targetFile, { skipHistory: true, replaceHistory: true });
            }
        } else {
            resetViewToFallback({ skipHistory: true });
        }
    });

    initialise();

    if (initialFileFromLocation) {
        loadFile(initialFileFromLocation, { replaceHistory: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
