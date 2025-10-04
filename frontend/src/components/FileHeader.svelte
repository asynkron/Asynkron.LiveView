<script>
    export let fileName = 'Markdown Viewer';
    export let isEditing = false;
    export let isPreviewing = false;
    export let onEdit = () => {};
    export let onPreview = () => {};
    export let onSave = () => {};
    export let onCancel = () => {};
    export let onDownload = () => {};
    export let onDelete = () => {};
</script>

<header class="file-header">
    <h1 id="file-name">{fileName}</h1>
    <div class="file-actions">
        <button 
            id="edit-button" 
            class={isEditing || isPreviewing ? 'hidden' : ''}
            title="Edit the current file"
            on:click={onEdit}
        >
            <i class="fas fa-edit file-button-icon"></i>
        </button>
        <button 
            id="preview-button" 
            class={isEditing ? '' : 'hidden'}
            title="Preview the pending changes"
            on:click={onPreview}
        >
            <i class="fas fa-eye file-button-icon"></i>
        </button>
        <button 
            id="save-button" 
            class={(isEditing || isPreviewing) ? '' : 'hidden'}
            title="Save your changes"
            on:click={onSave}
        >
            <i class="fas fa-save file-button-icon"></i>
        </button>
        <button 
            id="cancel-button" 
            class={(isEditing || isPreviewing) ? '' : 'hidden'}
            title="Cancel editing"
            on:click={onCancel}
        >
            <i class="fas fa-times file-button-icon"></i>
        </button>
        <button 
            id="download-button" 
            class={isEditing || isPreviewing ? 'hidden' : ''}
            title="Download the current file"
            on:click={onDownload}
        >
            <i class="fas fa-download file-button-icon"></i>
        </button>
        <button 
            id="delete-button" 
            class={isEditing || isPreviewing ? 'hidden' : ''}
            title="Delete the current file"
            on:click={onDelete}
        >
            <i class="fas fa-trash file-button-icon"></i>
        </button>
    </div>
</header>
