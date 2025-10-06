import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSharedContext } from '../../src/js/app/shared_context.js';

// Helper to construct a shared context with overridable hooks for assertions.
function createContext(overrides = {}) {
    const appState = {
        currentFile: null,
        currentContent: '',
        hasPendingChanges: false,
        isEditing: false,
        isPreviewing: false,
        resolvedRootPath: '',
        originalPathArgument: '',
        files: [],
        fileTree: [],
    };

    const elements = {
        content: {},
        fileName: {},
        sidebarPath: {},
        fileList: {},
        downloadButton: {},
        deleteButton: {},
        editButton: {},
        previewButton: {},
        saveButton: {},
        cancelButton: {},
        editorContainer: {},
        unsavedChangesModal: {},
        unsavedChangesFilename: {},
        unsavedChangesMessage: {},
        unsavedChangesDetail: {},
        unsavedChangesSaveButton: {},
        unsavedChangesDiscardButton: {},
        unsavedChangesCancelButton: {},
    };

    const sets = {
        expandedDirectories: new Set(),
        knownDirectories: new Set(),
    };

    const baseConfig = {
        appState,
        elements,
        sets,
        applyHasPendingChanges: () => {},
        setConnectionStatusHandler: () => {},
        updateHeader: () => {},
        updateActionVisibility: () => {},
        updateDocumentPanelTitle: () => {},
        buildQuery: () => '',
        updateLocation: () => {},
        fallbackMarkdownFor: () => '',
        normaliseFileIndex: (value) => value,
        buildTreeFromFlatList: (value) => value,
        getCssNumber: () => 0,
        rootElement: {},
        setStatus: () => {},
    };

    return {
        appState,
        sharedContext: createSharedContext({ ...baseConfig, ...overrides }),
    };
}

test('setCurrentFile updates state and triggers injected callbacks', () => {
    let headerCalls = 0;
    let docTitleCalls = 0;
    let highlightCalls = 0;

    const { appState, sharedContext } = createContext({
        updateHeader: () => {
            headerCalls += 1;
        },
        updateDocumentPanelTitle: () => {
            docTitleCalls += 1;
        },
    });

    sharedContext.updateActiveFileHighlight = () => {
        highlightCalls += 1;
    };

    sharedContext.setCurrentFile('README.md');

    assert.equal(appState.currentFile, 'README.md');
    assert.equal(headerCalls, 1, 'updateHeader should be called when file changes');
    assert.equal(docTitleCalls, 1, 'updateDocumentPanelTitle should be called when file changes');
    assert.equal(highlightCalls, 1, 'updateActiveFileHighlight should be called when file changes');

    sharedContext.setCurrentFile('README.md', { silent: true });
    assert.equal(headerCalls, 1, 'callbacks are not repeated when value does not change');
});

test('setHasPendingChanges uses injected applyHasPendingChanges when no header controller exists', () => {
    const pendingValues = [];
    const { appState, sharedContext } = createContext({
        applyHasPendingChanges: (value) => {
            pendingValues.push(value);
        },
    });

    sharedContext.setHasPendingChanges(true);

    assert.equal(appState.hasPendingChanges, true);
    assert.deepEqual(pendingValues, [true]);
});

test('setHasPendingChanges prefers header controller when present', () => {
    const pendingValues = [];
    const headerValues = [];

    const { appState, sharedContext } = createContext({
        applyHasPendingChanges: (value) => {
            pendingValues.push(value);
        },
    });

    sharedContext.controllers.header = {
        applyHasPendingChanges(value) {
            headerValues.push(value);
            appState.hasPendingChanges = Boolean(value);
        },
    };

    sharedContext.setHasPendingChanges(true);

    assert.equal(appState.hasPendingChanges, true);
    assert.deepEqual(headerValues, [true]);
    assert.deepEqual(pendingValues, [], 'fallback handler should not run when header is available');
});
