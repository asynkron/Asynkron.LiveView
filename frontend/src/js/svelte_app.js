import FileHeader from '../components/FileHeader.svelte';
import OfflineOverlay from '../components/OfflineOverlay.svelte';
import UnsavedChangesModal from '../components/UnsavedChangesModal.svelte';

export function initializeSvelteComponents(mountPoints, initialState = {}, callbacks = {}) {
    const fileHeader = new FileHeader({
        target: mountPoints.header,
        props: {
            fileName: initialState.fileName || 'Markdown Viewer',
            isEditing: initialState.isEditing || false,
            isPreviewing: initialState.isPreviewing || false,
            onEdit: callbacks.onEdit || (() => {}),
            onPreview: callbacks.onPreview || (() => {}),
            onSave: callbacks.onSave || (() => {}),
            onCancel: callbacks.onCancel || (() => {}),
            onDownload: callbacks.onDownload || (() => {}),
            onDelete: callbacks.onDelete || (() => {})
        }
    });

    // Create a container for overlays
    const overlaysContainer = document.createElement('div');
    mountPoints.overlays.appendChild(overlaysContainer);

    const offlineOverlay = new OfflineOverlay({
        target: overlaysContainer,
        props: {
            visible: initialState.isOffline || false
        }
    });

    const unsavedChangesModal = new UnsavedChangesModal({
        target: overlaysContainer,
        props: {
            visible: initialState.showUnsavedModal || false,
            filename: initialState.unsavedFilename || '',
            message: initialState.unsavedMessage || 'You have unsaved changes in',
            detail: initialState.unsavedDetail || 'What would you like to do?',
            onSave: callbacks.onUnsavedSave || (() => {}),
            onDiscard: callbacks.onUnsavedDiscard || (() => {}),
            onCancel: callbacks.onUnsavedCancel || (() => {})
        }
    });

    return {
        fileHeader,
        offlineOverlay,
        unsavedChangesModal,
        updateState: (componentName, newState) => {
            const component = { fileHeader, offlineOverlay, unsavedChangesModal }[componentName];
            if (component) {
                component.$set(newState);
            }
        },
        destroy: () => {
            fileHeader.$destroy();
            offlineOverlay.$destroy();
            unsavedChangesModal.$destroy();
        }
    };
}
