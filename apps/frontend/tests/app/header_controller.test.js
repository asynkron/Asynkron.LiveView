import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createHeaderController } from '../../src/js/app/header_controller.js';

function createClassList() {
    const values = new Set();
    return {
        add(value) {
            values.add(value);
        },
        remove(value) {
            values.delete(value);
        },
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

function createElement() {
    return {
        textContent: '',
        classList: createClassList(),
        disabled: false,
    };
}

let appState;
let elements;
let layout;
let viewerTitle;

beforeEach(() => {
    viewerTitle = 'Document';
    appState = {
        currentFile: 'README.md',
        hasPendingChanges: false,
        isEditing: false,
        isPreviewing: false,
        resolvedRootPath: '/docs',
        originalPathArgument: '/docs',
    };

    elements = {
        fileName: createElement(),
        sidebarPath: createElement(),
        downloadButton: createElement(),
        deleteButton: createElement(),
        editButton: createElement(),
        previewButton: createElement(),
        saveButton: createElement(),
        cancelButton: createElement(),
    };

    const viewerPanel = {
        api: {
            setTitle(value) {
                viewerTitle = value;
            },
        },
    };

    layout = {
        dockviewSetup: { panels: { viewer: viewerPanel } },
        dockviewIsActive: false,
    };

    global.document = {
        body: {
            classList: createClassList(),
        },
    };
});

function createController() {
    return createHeaderController({ elements, layout, appState });
}

test('updateHeader populates file metadata', () => {
    const controller = createController();
    controller.updateHeader();

    assert.equal(elements.fileName.textContent, 'README.md');
    assert.equal(elements.sidebarPath.textContent, '/docs');
    assert.equal(elements.fileName.classList.contains('hidden'), false);
});

test('applyHasPendingChanges toggles indicator text and panel title', () => {
    const controller = createController();
    controller.updateHeader();

    controller.applyHasPendingChanges(true);

    assert.equal(appState.hasPendingChanges, true);
    assert.equal(global.document.body.classList.contains('document-has-pending-changes'), true);
    assert.equal(elements.fileName.textContent, 'README.md ●');
    assert.equal(viewerTitle, 'README.md ●');
});

test('updateActionVisibility reacts to editing state', () => {
    const controller = createController();
    appState.isEditing = true;
    controller.updateActionVisibility();

    assert.equal(elements.editButton.classList.contains('hidden'), true);
    assert.equal(elements.previewButton.classList.contains('hidden'), false);
    assert.equal(elements.downloadButton.classList.contains('hidden'), true);
    assert.equal(elements.deleteButton.classList.contains('hidden'), true);
    assert.equal(elements.saveButton.classList.contains('hidden'), false);
    assert.equal(elements.cancelButton.classList.contains('hidden'), false);
});

test('dockview layout hides filename when active', () => {
    layout.dockviewIsActive = true;
    const controller = createController();
    controller.updateHeader();

    assert.equal(elements.fileName.classList.contains('hidden'), true);
    assert.equal(elements.fileName.textContent, 'Markdown Viewer');
});
