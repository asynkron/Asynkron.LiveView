<script>
    export let visible = false;
</script>

<div id="offline-overlay" class="offline-overlay" class:visible>
    <div class="offline-message">
        <div class="offline-spinner"></div>
        <h3 class="offline-title">Connection Lost</h3>
        <p class="offline-description">Reconnecting to the live view server...</p>
    </div>
</div>

<style>
    .visible {
        display: flex;
    }
</style>
