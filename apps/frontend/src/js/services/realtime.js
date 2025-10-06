// Encapsulates the realtime WebSocket connection used for directory and file updates.
// Consumers provide callbacks for handling events so UI modules remain decoupled
// from the networking details.
export function createRealtimeService(options = {}) {
    const {
        getSubscriptionPath = () => undefined,
        onDirectoryUpdate,
        onFileChanged,
        onConnectionChange,
        reconnectDelay = 1500,
        buildUrl = () => {
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            return `${protocol}://${window.location.host}/ws`;
        },
    } = options;

    let socket = null;
    let reconnectTimer = null;

    function clearReconnectTimer() {
        if (reconnectTimer) {
            window.clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer) {
            return;
        }
        reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, reconnectDelay);
    }

    function handleDirectoryUpdate(payload) {
        if (typeof onDirectoryUpdate !== 'function') {
            return;
        }
        Promise.resolve(onDirectoryUpdate(payload)).catch((error) => {
            console.error('Realtime directory update handler failed', error);
        });
    }

    function handleFileChanged(payload) {
        if (typeof onFileChanged !== 'function') {
            return;
        }
        const file = payload && typeof payload.file === 'string' ? payload.file : undefined;
        Promise.resolve(onFileChanged(file)).catch((error) => {
            console.error('Realtime file change handler failed', error);
        });
    }

    function connect() {
        if (socket) {
            try {
                socket.close();
            } catch (error) {
                console.warn('Failed to close existing realtime socket', error);
            }
        }

        let url;
        try {
            url = typeof buildUrl === 'function' ? buildUrl() : buildUrl;
        } catch (error) {
            console.error('Failed to build realtime socket URL', error);
            scheduleReconnect();
            return;
        }

        const nextSocket = new WebSocket(url);
        socket = nextSocket;

        const handleOpen = () => {
            if (socket !== nextSocket) {
                return;
            }
            clearReconnectTimer();
            if (typeof onConnectionChange === 'function') {
                onConnectionChange(true);
            }
            try {
                const path = getSubscriptionPath?.();
                const message = JSON.stringify({ type: 'subscribe', path });
                nextSocket.send(message);
            } catch (error) {
                console.warn('Failed to send realtime subscription message', error);
            }
        };

        const handleMessage = (event) => {
            if (socket !== nextSocket) {
                return;
            }
            try {
                const payload = JSON.parse(event.data);
                if (payload?.type === 'directory_update') {
                    handleDirectoryUpdate(payload);
                    return;
                }
                if (payload?.type === 'file_changed') {
                    handleFileChanged(payload);
                }
            } catch (error) {
                console.error('Failed to process realtime message', error);
            }
        };

        const handleClose = () => {
            if (socket !== nextSocket) {
                return;
            }
            if (typeof onConnectionChange === 'function') {
                onConnectionChange(false);
            }
            scheduleReconnect();
        };

        const handleError = () => {
            if (socket !== nextSocket) {
                return;
            }
            try {
                nextSocket.close();
            } catch (error) {
                console.warn('Failed to close realtime socket after error', error);
            }
        };

        nextSocket.addEventListener('open', handleOpen);
        nextSocket.addEventListener('message', handleMessage);
        nextSocket.addEventListener('close', handleClose);
        nextSocket.addEventListener('error', handleError);
    }

    function disconnect() {
        clearReconnectTimer();
        if (!socket) {
            return;
        }
        const current = socket;
        socket = null;
        try {
            current.close();
        } catch (error) {
            console.warn('Failed to close realtime socket during disconnect', error);
        }
    }

    function dispose() {
        disconnect();
    }

    return {
        connect,
        disconnect,
        dispose,
        getSocket: () => socket,
    };
}
