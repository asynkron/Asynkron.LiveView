import './vendor_globals.js';
import { initLayout } from './viewer/layout.js';
import { initEditor } from './editor/editor.js';
import { initNavigation } from './files/navigation.js';
import { createHandleDirectoryUpdate, createHandleFileChanged } from './files/realtime_handlers.js';
import { createAppContext } from './app/context.js';
import { createUnifiedApp } from './app/unified_app.js';
import { createSharedContext } from './app/shared_context.js';
import { createRealtimeService } from './services/realtime.js';
import { createTerminalService } from './services/terminal.js';
import {
    createViewerApi,
    normaliseFileIndex,
    buildTreeFromFlatList,
    getCssNumber,
    setStatus,
    createSetConnectionStatus,
    createResetViewToFallback,
    fallbackMarkdownFor,
} from './app/bootstrap_helpers.js';
import { createHeaderController } from './app/header_controller.js';
import { createRouter } from './app/router.js';
import { createTocController } from './app/toc_controller.js';

// Client-side bootstrap logic for the unified markdown viewer UI.
function composeUnifiedApp() {
    const context = createAppContext();
    const { initialState, state: appState, elements, sets } = context;
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
    context.initialFileFromLocation = null;

    const setConnectionStatusHandler = createSetConnectionStatus(offlineOverlay);

    const applyHasPendingChanges = (value) => {
        document?.body?.classList?.toggle('document-has-pending-changes', Boolean(value));
    };

    const sharedContext = createSharedContext({
        appState,
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
        sets: { expandedDirectories, knownDirectories },
        applyHasPendingChanges,
        setConnectionStatusHandler,
        updateHeader: () => {},
        updateActionVisibility: () => {},
        updateDocumentPanelTitle: () => {},
        buildQuery: () => '',
        updateLocation: () => {},
        fallbackMarkdownFor,
        normaliseFileIndex,
        buildTreeFromFlatList,
        getCssNumber,
        rootElement,
        setStatus,
    });
    const markdownContext = {
        content,
        tocList,
        getCurrentFile: () => sharedContext.getCurrentFile(),
        setCurrentContent(value) {
            sharedContext.setCurrentContent(value);
        },
        buildQuery: (params) => sharedContext.buildQuery(params),
    };
    sharedContext.markdownContext = markdownContext;

    const unifiedApp = createUnifiedApp({
        context,
        sharedContext,
        layout: {
            initLayout,
        },
        controllers: {
            createHeaderController,
            createTocController,
            createRouter,
        },
        services: {
            createTerminalService,
            createRealtimeService,
            createViewerApi,
            initNavigation,
            initEditor,
            createHandleDirectoryUpdate,
            createHandleFileChanged,
            createResetViewToFallback,
            setConnectionStatusHandler,
        },
    });

    return unifiedApp;
}

function startUnifiedApp() {
    const app = composeUnifiedApp();
    app.start();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startUnifiedApp, { once: true });
} else {
    startUnifiedApp();
}
