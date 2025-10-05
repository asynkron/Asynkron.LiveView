import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { initEditor } from './editor/editor.js';
import { initNavigation } from './files/navigation.js';
import { createHandleDirectoryUpdate, createHandleFileChanged } from './files/realtime_handlers.js';
import { createAppContext } from './app/context.js';
import { createRealtimeService } from './services/realtime.js';
import { createTerminalService } from './services/terminal.js';
import {
    createViewerApi,
    normaliseFileIndex,
    buildTreeFromFlatList,
    getCssNumber,
    setStatus,
    createSetConnectionStatus,
    createApplyHasPendingChanges,
    createResetViewToFallback,
    fallbackMarkdownFor,
} from './app/bootstrap_helpers.js';

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

    const setConnectionStatusHandler = createSetConnectionStatus(offlineOverlay);
    const applyHasPendingChanges = createApplyHasPendingChanges(appState, updateHeader);
    let resetViewToFallback = () => {};

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
        setConnectionStatus: (connected) => setConnectionStatusHandler(connected),
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
        getCssNumber: (variableName, fallback) => getCssNumber(rootElement, variableName, fallback),
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

    const viewerApi = createViewerApi(markdownContext);

    const navigationApi = initNavigation(sharedContext, viewerApi);
    const editorApi = initEditor(sharedContext, viewerApi, navigationApi);
    if (typeof navigationApi?.bindEditorApi === 'function') {
        navigationApi.bindEditorApi(editorApi);
    }
    if (typeof navigationApi?.updateActiveFileHighlight === 'function') {
        sharedContext.updateActiveFileHighlight = () => navigationApi.updateActiveFileHighlight();
    }

    resetViewToFallback = createResetViewToFallback({ sharedContext, viewerApi, editorApi });

    if (content && typeof editorApi?.handleHeadingActionClick === 'function') {
        content.addEventListener('click', (event) => {
            editorApi.handleHeadingActionClick(event);
        });
    }

    const handleDirectoryUpdate = createHandleDirectoryUpdate({
        navigationApi,
        sharedContext,
        resetViewToFallback,
    });
    const handleFileChanged = createHandleFileChanged({
        navigationApi,
        sharedContext,
    });

    const realtimeService = createRealtimeService({
        getSubscriptionPath: () => appState.originalPathArgument,
        onConnectionChange: (connected) => {
            setConnectionStatusHandler(connected);
        },
        onDirectoryUpdate: handleDirectoryUpdate,
        onFileChanged: handleFileChanged,
    });

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
