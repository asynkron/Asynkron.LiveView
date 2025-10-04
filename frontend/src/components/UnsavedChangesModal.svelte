<script>
    export let visible = false;
    export let filename = '';
    export let message = 'You have unsaved changes';
    export let detail = 'What would you like to do?';
    export let onSave = () => {};
    export let onDiscard = () => {};
    export let onCancel = () => {};
</script>

<div 
    id="unsaved-changes-modal" 
    class="dialog-overlay" 
    class:visible
    role="dialog" 
    aria-modal="true"
    aria-labelledby="unsaved-changes-title" 
    aria-describedby="unsaved-changes-message" 
    tabindex="-1"
>
    <div class="dialog-window">
        <h3 id="unsaved-changes-title">Unsaved changes</h3>
        <p id="unsaved-changes-message">
            {message}
            <span id="unsaved-changes-filename" class="dialog-filename">{filename}</span>.
        </p>
        <p id="unsaved-changes-detail" class="dialog-detail">{detail}</p>
        <div class="dialog-actions">
            <button type="button" id="unsaved-changes-save" class="primary" on:click={onSave}>
                Save changes
            </button>
            <button type="button" id="unsaved-changes-discard" class="secondary" on:click={onDiscard}>
                Discard
            </button>
            <button type="button" id="unsaved-changes-cancel" class="secondary" on:click={onCancel}>
                Cancel
            </button>
        </div>
    </div>
</div>
