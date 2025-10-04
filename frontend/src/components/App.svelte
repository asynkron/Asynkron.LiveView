<script>
    import FileHeader from './FileHeader.svelte';
    import OfflineOverlay from './OfflineOverlay.svelte';
    import UnsavedChangesModal from './UnsavedChangesModal.svelte';

    export let state = {};
    export let callbacks = {};

    // Extract state
    $: fileName = state.fileName || 'Markdown Viewer';
    $: isEditing = state.isEditing || false;
    $: isPreviewing = state.isPreviewing || false;
    $: isOffline = state.isOffline || false;
    $: showUnsavedModal = state.showUnsavedModal || false;
    $: unsavedFilename = state.unsavedFilename || '';
    $: unsavedMessage = state.unsavedMessage || 'You have unsaved changes in';
    $: unsavedDetail = state.unsavedDetail || 'What would you like to do?';

    // Extract callbacks
    $: onEdit = callbacks.onEdit || (() => {});
    $: onPreview = callbacks.onPreview || (() => {});
    $: onSave = callbacks.onSave || (() => {});
    $: onCancel = callbacks.onCancel || (() => {});
    $: onDownload = callbacks.onDownload || (() => {});
    $: onDelete = callbacks.onDelete || (() => {});
    $: onUnsavedSave = callbacks.onUnsavedSave || (() => {});
    $: onUnsavedDiscard = callbacks.onUnsavedDiscard || (() => {});
    $: onUnsavedCancel = callbacks.onUnsavedCancel || (() => {});
</script>

<FileHeader 
    {fileName}
    {isEditing}
    {isPreviewing}
    {onEdit}
    {onPreview}
    {onSave}
    {onCancel}
    {onDownload}
    {onDelete}
/>

<OfflineOverlay visible={isOffline} />

<UnsavedChangesModal 
    visible={showUnsavedModal}
    filename={unsavedFilename}
    message={unsavedMessage}
    detail={unsavedDetail}
    onSave={onUnsavedSave}
    onDiscard={onUnsavedDiscard}
    onCancel={onUnsavedCancel}
/>
