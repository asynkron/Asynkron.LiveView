import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { renderMarkdown, captureHeadingLocations, getHeadingLocation } from './viewer/markdown.js';
import { initEditor } from './editor/editor.js';
import { initNavigation } from './files/navigation.js';
import { createAppContext } from './app/context.js';
import { createRealtimeService } from './services/realtime.js';
import { createTerminalService } from './services/terminal.js';

// Client-side bootstrap logic for the unified markdown viewer UI.
function bootstrap() {
    const context = createAppContext();
    const { initialState, state: appState, elements, sets, terminalStorageKey } = context;
    const {
        content,
        fileName,
        sidebarPath,
        fileList,
        downloadButton,
        deleteButton,
        editButton,
        previewButton,
        saveButton,
        cancelButton,
        editorContainer,
        offlineOverlay,
        unsavedChangesModal,
        unsavedChangesFilename,
        unsavedChangesMessage,
        unsavedChangesDetail,
        unsavedChangesSaveButton,
        unsavedChangesDiscardButton,
        unsavedChangesCancelButton,
        tocList,
        tocSidebar,
        fileSidebar,
        tocSplitter,
        fileSplitter,
        dockviewRoot,
        appShell,
        rootElement,
        viewerSection,
        terminalPanel,
        terminalContainer,
        terminalToggleButton,
        terminalStatusText,
        terminalResizeHandle,
        panelToggleButtons,
    } = elements;
    const { expandedDirectories, knownDirectories } = sets;

    const initialIndex = normaliseFileIndex({
        filesValue: initialState.files,
        treeValue: initialState.fileTree,
    });
    appState.files = initialIndex.files;
    appState.fileTree = initialIndex.tree;

    appState.currentFile = initialState.selectedFile || null;
    context.initialFileFromLocation = fileFromSearch(window.location.search);

    const sharedContext = {
        elements: {
            content,
            fileName,
            sidebarPath,
            fileList,
            downloadButton,
            deleteButton,
            editButton,
            previewButton,
            saveButton,
            cancelButton,
            editorContainer,
            unsavedChangesModal,
            unsavedChangesFilename,
            unsavedChangesMessage,
            unsavedChangesDetail,
            unsavedChangesSaveButton,
            unsavedChangesDiscardButton,
            unsavedChangesCancelButton,
        },
        getCurrentFile: () => appState.currentFile,
        setCurrentFile(value, options = {}) {
            const { silent = false } = options || {};
            const nextValue = typeof value === 'string' && value.length ? value : value || null;
            if (appState.currentFile === nextValue) {
                return;
            }
            appState.currentFile = nextValue;
            if (!silent) {
                this.updateActiveFileHighlight();
                this.updateHeader();
                this.updateDocumentPanelTitle();
            }
        },
        getCurrentContent: () => appState.currentContent,
        setCurrentContent(value) {
            appState.currentContent = typeof value === 'string' ? value : '';
        },
        hasPendingChanges: () => appState.hasPendingChanges,
        setHasPendingChanges: (value) => applyHasPendingChanges(value),
        isEditing: () => appState.isEditing,
        setEditing(value) {
            const next = Boolean(value);
            if (appState.isEditing === next) {
                return;
            }
            appState.isEditing = next;
            this.updateActionVisibility();
        },
        isPreviewing: () => appState.isPreviewing,
        setPreviewing(value) {
            const next = Boolean(value);
            if (appState.isPreviewing === next) {
                return;
            }
            appState.isPreviewing = next;
            this.updateActionVisibility();
        },
        getResolvedRootPath: () => appState.resolvedRootPath,
        setResolvedRootPath(value) {
            appState.resolvedRootPath = typeof value === 'string' ? value : appState.resolvedRootPath;
        },
        getOriginalPathArgument: () => appState.originalPathArgument,
        getFiles: () => appState.files,
        setFiles: (value) => {
            appState.files = Array.isArray(value) ? value : [];
        },
        getFileTree: () => appState.fileTree,
        setFileTree: (value) => {
            appState.fileTree = Array.isArray(value) ? value : [];
        },
        getExpandedDirectories: () => expandedDirectories,
        getKnownDirectories: () => knownDirectories,
        setStatus,
        setConnectionStatus,
        updateHeader() {
            updateHeader();
        },
        updateActionVisibility() {
            updateActionVisibility();
        },
        updateActiveFileHighlight() {},
        updateDocumentPanelTitle() {
            updateDocumentPanelTitle();
        },
        buildQuery: (params) => buildQuery(params),
        updateLocation: (file, options) => updateLocation(file, options),
        fallbackMarkdownFor,
        normaliseFileIndex: (values) => normaliseFileIndex(values),
        buildTreeFromFlatList: (list) => buildTreeFromFlatList(list),
    };
    const markdownContext = {
        content,
        tocList,
        getCurrentFile: () => sharedContext.getCurrentFile(),
        setCurrentContent(value) {
            sharedContext.setCurrentContent(value);
        },
        buildQuery,
    };
    sharedContext.markdownContext = markdownContext;

    const layout = initLayout({
        dockviewRoot,
        appShell,
        viewerSection,
        tocSidebar,
        fileSidebar,
        terminalPanel,
        tocSplitter,
        fileSplitter,
        rootElement,
        panelToggleButtons,
        getCurrentFile: () => sharedContext.getCurrentFile(),
    });
    const dockviewSetup = layout.dockviewSetup;
    const dockviewIsActive = layout.dockviewIsActive;
    document.body.classList.toggle('dockview-active', dockviewIsActive);
    layout.refreshPanelToggleStates();

    if (dockviewIsActive && dockviewRoot) {
        dockviewRoot.addEventListener('pointerdown', layout.handlePointerDown);
        window.addEventListener('pointerup', layout.handlePointerFinish);
        window.addEventListener('pointercancel', layout.handlePointerFinish);
    }

    sharedContext.layout = layout;

    const terminalService = createTerminalService({
        terminalPanel,
        terminalContainer,
        terminalToggleButton,
        terminalStatusText,
        terminalResizeHandle,
        storageKey: terminalStorageKey,
        isDockviewActive: () => layout.dockviewIsActive,
    });

    const realtimeService = createRealtimeService({
        getSubscriptionPath: () => appState.originalPathArgument,
        onConnectionChange: (connected) => {
            setConnectionStatus(connected);
        },
        onDirectoryUpdate: handleDirectoryUpdate,
        onFileChanged: handleFileChanged,
    });

    const viewerApi = {
        render(contentValue, options = {}) {
            renderMarkdown(markdownContext, contentValue, options);
        },
        captureHeadings(source) {
            return captureHeadingLocations(markdownContext, source);
        },
        getHeadingLocation(slug) {
            return getHeadingLocation(markdownContext, slug);
        },
        getMarkdownContext() {
            return markdownContext;
        },
    };

    const navigationApi = initNavigation(sharedContext, viewerApi);
    const editorApi = initEditor(sharedContext, viewerApi, navigationApi);
    if (typeof navigationApi?.bindEditorApi === 'function') {
        navigationApi.bindEditorApi(editorApi);
    }
    if (typeof navigationApi?.updateActiveFileHighlight === 'function') {
        sharedContext.updateActiveFileHighlight = () => navigationApi.updateActiveFileHighlight();
    }

    if (content && typeof editorApi?.handleHeadingActionClick === 'function') {
        content.addEventListener('click', (event) => {
            editorApi.handleHeadingActionClick(event);
        });
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

    function setStatus(message) {
        // Status banner removed; keep function to avoid touching callers.
        void message;
    }

    function setConnectionStatus(connected) {
        offlineOverlay?.classList.toggle('visible', !connected);
    }

    function applyHasPendingChanges(value) {
        const nextValue = Boolean(value);
        if (nextValue === appState.hasPendingChanges) {
            return;
        }
        appState.hasPendingChanges = nextValue;
        document.body.classList.toggle('document-has-pending-changes', appState.hasPendingChanges);
        updateHeader();
    }

    function resetViewToFallback(options = {}) {
        const { skipHistory = false } = options || {};
        if (typeof editorApi?.exitEditMode === 'function') {
            editorApi.exitEditMode({ restoreContent: false });
        }
        sharedContext.setCurrentFile(null, { silent: true });
        const fallback = sharedContext.fallbackMarkdownFor(
            sharedContext.getResolvedRootPath() || sharedContext.getOriginalPathArgument() || 'the selected path'
        );
        viewerApi.render(fallback, { updateCurrent: true });
        sharedContext.updateActiveFileHighlight();
        sharedContext.updateHeader();
        if (!skipHistory) {
            sharedContext.updateLocation('', { replace: true });
        }
    }

    function fallbackMarkdownFor(path) {
        return `# No markdown files found\n\nThe directory \`${path}\` does not contain any markdown files yet.`;
    }

    function updateDocumentPanelTitle() {
        const viewerPanel = dockviewSetup?.panels?.viewer;
        if (!viewerPanel) {
            return;
        }

        const baseTitle = appState.currentFile || 'Document';
        const title = appState.hasPendingChanges && appState.currentFile ? `${baseTitle} ●` : baseTitle;
        const panelApi = viewerPanel?.api;

        if (panelApi && typeof panelApi.setTitle === 'function') {
            panelApi.setTitle(title);
        } else if (typeof viewerPanel.setTitle === 'function') {
            viewerPanel.setTitle(title);
        }
    }

    function updateHeader() {
        const hasFile = Boolean(appState.currentFile);
        const indicator = appState.hasPendingChanges && hasFile ? ' ●' : '';

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
                const baseName = hasFile ? appState.currentFile : 'No file selected';
                fileName.textContent = hasFile ? `${baseName}${indicator}` : baseName;
            }
        }

        sidebarPath.textContent = appState.resolvedRootPath || appState.originalPathArgument || 'Unknown';
        downloadButton.disabled = !hasFile;
        deleteButton.disabled = !hasFile;
        editButton.disabled = !hasFile && !appState.isEditing;
        previewButton.disabled = !hasFile;
        saveButton.disabled = !hasFile;
        cancelButton.disabled = false;
        updateActionVisibility();
        updateDocumentPanelTitle();
    }

    function updateActionVisibility() {
        const hasFile = Boolean(appState.currentFile);
        editButton.classList.toggle('hidden', !hasFile || (appState.isEditing && !appState.isPreviewing));
        previewButton.classList.toggle('hidden', !appState.isEditing || appState.isPreviewing);
        saveButton.classList.toggle('hidden', !appState.isEditing);
        cancelButton.classList.toggle('hidden', !appState.isEditing);
        downloadButton.classList.toggle('hidden', appState.isEditing);
        deleteButton.classList.toggle('hidden', appState.isEditing);
    }

    function buildQuery(params) {
        const query = new URLSearchParams();
        if (appState.originalPathArgument) {
            query.set('path', appState.originalPathArgument);
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

    async function handleDirectoryUpdate(payload = {}) {
        if (!payload || typeof payload !== 'object') {
            return;
        }

        appState.resolvedRootPath = payload.path || appState.resolvedRootPath;
        sharedContext.setResolvedRootPath(appState.resolvedRootPath);

        const updatedIndex = sharedContext.normaliseFileIndex({
            filesValue: payload.files,
            treeValue: payload.tree,
        });
        sharedContext.setFiles(updatedIndex.files);
        sharedContext.setFileTree(updatedIndex.tree);
        navigationApi.renderFileList();

        const filesList = sharedContext.getFiles();
        const currentPath = sharedContext.getCurrentFile();
        if (!filesList.find((entry) => entry.relativePath === currentPath)) {
            const nextFile = filesList.length ? filesList[0].relativePath : null;
            if (nextFile) {
                await navigationApi.loadFile(nextFile, { replaceHistory: true });
            } else {
                resetViewToFallback();
            }
            return;
        }

        sharedContext.updateActiveFileHighlight();
        sharedContext.updateHeader();
    }

    async function handleFileChanged(file) {
        const currentPath = sharedContext.getCurrentFile();
        if (file && file === currentPath) {
            await navigationApi.loadFile(currentPath, { replaceHistory: true });
        }
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

    sharedContext.layout = layout;

    const viewerApi = {
        render(contentValue, options = {}) {
            renderMarkdown(markdownContext, contentValue, options);
        },
        captureHeadings(source) {
            return captureHeadingLocations(markdownContext, source);
        },
        getHeadingLocation(slug) {
            return getHeadingLocation(markdownContext, slug);
        },
        getMarkdownContext() {
            return markdownContext;
        },
    };

    const navigationApi = initNavigation(sharedContext, viewerApi);
    const editorApi = initEditor(sharedContext, viewerApi, navigationApi);
    if (typeof navigationApi?.bindEditorApi === 'function') {
        navigationApi.bindEditorApi(editorApi);
    }
    if (typeof navigationApi?.updateActiveFileHighlight === 'function') {
        sharedContext.updateActiveFileHighlight = () => navigationApi.updateActiveFileHighlight();
    }

    if (content && typeof editorApi?.handleHeadingActionClick === 'function') {
        content.addEventListener('click', (event) => {
            editorApi.handleHeadingActionClick(event);
        });
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

    function setStatus(message) {
        // Status banner removed; keep function to avoid touching callers.
        void message;
    }

    function setConnectionStatus(connected) {
        offlineOverlay?.classList.toggle('visible', !connected);
    }

    function applyHasPendingChanges(value) {
        const nextValue = Boolean(value);
        if (nextValue === appState.hasPendingChanges) {
            return;
        }
        appState.hasPendingChanges = nextValue;
        document.body.classList.toggle('document-has-pending-changes', appState.hasPendingChanges);
        updateHeader();
    }

    function resetViewToFallback(options = {}) {
        const { skipHistory = false } = options || {};
        if (typeof editorApi?.exitEditMode === 'function') {
            editorApi.exitEditMode({ restoreContent: false });
        }
        sharedContext.setCurrentFile(null, { silent: true });
        const fallback = sharedContext.fallbackMarkdownFor(
            sharedContext.getResolvedRootPath() || sharedContext.getOriginalPathArgument() || 'the selected path'
        );
        viewerApi.render(fallback, { updateCurrent: true });
        sharedContext.updateActiveFileHighlight();
        sharedContext.updateHeader();
        if (!skipHistory) {
            sharedContext.updateLocation('', { replace: true });
        }
    }

    function fallbackMarkdownFor(path) {
        return `# No markdown files found\n\nThe directory \`${path}\` does not contain any markdown files yet.`;
    }

    function updateDocumentPanelTitle() {
        const viewerPanel = dockviewSetup?.panels?.viewer;
        if (!viewerPanel) {
            return;
        }

        const baseTitle = appState.currentFile || 'Document';
        const title = appState.hasPendingChanges && appState.currentFile ? `${baseTitle} ●` : baseTitle;
        const panelApi = viewerPanel?.api;

        if (panelApi && typeof panelApi.setTitle === 'function') {
            panelApi.setTitle(title);
        } else if (typeof viewerPanel.setTitle === 'function') {
            viewerPanel.setTitle(title);
        }
    }

    function updateHeader() {
        const hasFile = Boolean(appState.currentFile);
        const indicator = appState.hasPendingChanges && hasFile ? ' ●' : '';

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
                const baseName = hasFile ? appState.currentFile : 'No file selected';
                fileName.textContent = hasFile ? `${baseName}${indicator}` : baseName;
            }
        }

        sidebarPath.textContent = appState.resolvedRootPath || appState.originalPathArgument || 'Unknown';
        downloadButton.disabled = !hasFile;
        deleteButton.disabled = !hasFile;
        editButton.disabled = !hasFile && !appState.isEditing;
        previewButton.disabled = !hasFile;
        saveButton.disabled = !hasFile;
        cancelButton.disabled = false;
        updateActionVisibility();
        updateDocumentPanelTitle();
    }

    function updateActionVisibility() {
        const hasFile = Boolean(appState.currentFile);
        editButton.classList.toggle('hidden', !hasFile || (appState.isEditing && !appState.isPreviewing));
        previewButton.classList.toggle('hidden', !appState.isEditing || appState.isPreviewing);
        saveButton.classList.toggle('hidden', !appState.isEditing);
        cancelButton.classList.toggle('hidden', !appState.isEditing);
        downloadButton.classList.toggle('hidden', appState.isEditing);
        deleteButton.classList.toggle('hidden', appState.isEditing);
    }

    function buildQuery(params) {
        const query = new URLSearchParams();
        if (appState.originalPathArgument) {
            query.set('path', appState.originalPathArgument);
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

    function initialise() {
        const initialFallback = fallbackMarkdownFor(
            appState.resolvedRootPath || appState.originalPathArgument || 'the selected path'
        );
        viewerApi.render(initialState.content || initialFallback, { updateCurrent: true });
        navigationApi.renderFileList();
        updateHeader();
        if (initialState.error) {
            setStatus(initialState.error);
        }
        terminalService.setupTerminalPanel();
        realtimeService.connect();
        const filesList = sharedContext.getFiles();
        if (!sharedContext.getCurrentFile() && filesList.length) {
            sharedContext.setCurrentFile(filesList[0].relativePath);
        }

        const currentPath = sharedContext.getCurrentFile();
        if (!context.initialFileFromLocation && currentPath) {
            void navigationApi.loadFile(currentPath, { replaceHistory: true });
        }
    }

    window.addEventListener('popstate', () => {
        const targetFile = fileFromSearch(window.location.search);
        const currentPath = sharedContext.getCurrentFile();
        if (targetFile) {
            if (targetFile !== currentPath) {
                void navigationApi.loadFile(targetFile, { skipHistory: true, replaceHistory: true });
            }
        } else {
            resetViewToFallback({ skipHistory: true });
        }
    });

    initialise();

    if (context.initialFileFromLocation) {
        void navigationApi.loadFile(context.initialFileFromLocation, { replaceHistory: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
    bootstrap();
}
