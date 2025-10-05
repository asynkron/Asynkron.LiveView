import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createSharedContext } from '../../src/js/app/shared_context.js';

function createClassList() {
    const values = new Set();
    return {
        toggle(value, force) {
            if (force === undefined) {
                if (values.has(value)) {
                    values.delete(value);
                    return false;
                }
                values.add(value);
                return true;
            }
            if (force) {
                values.add(value);
                return true;
            }
            values.delete(value);
            return false;
        },
        contains(value) {
            return values.has(value);
        },
    };
}

function createAppState() {
    return {
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
}

let originalDocument;

beforeEach(() => {
    originalDocument = global.document;
});

afterEach(() => {
    global.document = originalDocument;
});

// Utility factory so each test can supply only the dependencies it cares about.
function createSharedContextWithOverrides(overrides = {}) {
    const appState = overrides.appState || createAppState();
    const callbacks = overrides.callbacks || {};
    const hasApplyOverride = Object.prototype.hasOwnProperty.call(overrides, 'applyHasPendingChanges');
    const sharedContext = createSharedContext({
        appState,
        elements: overrides.elements || {},
        sets: overrides.sets || { expandedDirectories: new Set(), knownDirectories: new Set() },
        applyHasPendingChanges: hasApplyOverride
            ? overrides.applyHasPendingChanges
            : (value) => {
                  callbacks.pendingCalls = (callbacks.pendingCalls || 0) + 1;
                  appState.hasPendingChanges = Boolean(value);
              },
        setConnectionStatusHandler: overrides.setConnectionStatusHandler || (() => {}),
        updateHeader:
            overrides.updateHeader
            || (() => {
                callbacks.headerCalls = (callbacks.headerCalls || 0) + 1;
            }),
        updateActionVisibility:
            overrides.updateActionVisibility
            || (() => {
                callbacks.actionCalls = (callbacks.actionCalls || 0) + 1;
            }),
        updateDocumentPanelTitle:
            overrides.updateDocumentPanelTitle
            || (() => {
                callbacks.titleCalls = (callbacks.titleCalls || 0) + 1;
            }),
        buildQuery: overrides.buildQuery || ((params) => JSON.stringify(params)),
        updateLocation:
            overrides.updateLocation
            || ((file, options = {}) => {
                callbacks.location = { file, options };
            }),
        fallbackMarkdownFor: overrides.fallbackMarkdownFor || ((value) => value),
        normaliseFileIndex: overrides.normaliseFileIndex || ((values) => values),
        buildTreeFromFlatList: overrides.buildTreeFromFlatList || ((list) => list),
        getCssNumber: overrides.getCssNumber || ((_, __, fallback) => fallback ?? 0),
        rootElement: overrides.rootElement || {},
    });

    return { sharedContext, appState, callbacks };
}

test('setCurrentFile updates state and invokes callbacks when not silent', () => {
    const events = [];
    const { sharedContext, appState } = createSharedContextWithOverrides({
        updateHeader: () => events.push('header'),
        updateDocumentPanelTitle: () => events.push('title'),
    });

    sharedContext.updateActiveFileHighlight = () => events.push('highlight');

    sharedContext.setCurrentFile('README.md');

    assert.equal(appState.currentFile, 'README.md');
    assert.deepEqual(events, ['highlight', 'header', 'title']);

    events.length = 0;
    sharedContext.setCurrentFile('CHANGELOG.md', { silent: true });
    assert.equal(appState.currentFile, 'CHANGELOG.md');
    assert.deepEqual(events, []);
});

test('setHasPendingChanges delegates to the provided callback', () => {
    const pendingCalls = [];
    const appState = createAppState();
    const { sharedContext } = createSharedContextWithOverrides({
        appState,
        applyHasPendingChanges(value) {
            pendingCalls.push(Boolean(value));
            appState.hasPendingChanges = Boolean(value);
        },
    });

    sharedContext.setHasPendingChanges(true);

    assert.equal(appState.hasPendingChanges, true);
    assert.deepEqual(pendingCalls, [true]);
});

test('setHasPendingChanges falls back to toggling the document class when no callback', () => {
    const appState = createAppState();
    const classList = createClassList();
    global.document = { body: { classList } };

    const { sharedContext } = createSharedContextWithOverrides({
        appState,
        applyHasPendingChanges: undefined,
    });

    sharedContext.setHasPendingChanges(true);
    assert.equal(appState.hasPendingChanges, true);
    assert.equal(classList.contains('document-has-pending-changes'), true);
});
