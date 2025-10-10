export function createChatService(options = {}) {
    const {
        panel,
        startContainer,
        startForm,
        startInput,
        chatContainer,
        chatBody,
        messageList,
        chatForm,
        chatInput,
        statusElement,
        reconnectDelay = 2000,
    } = options;

    if (!panel) {
        return null;
    }

    const cleanupFns = [];
    const pendingMessages = [];
    const scrollContainer = chatBody || messageList;
    let socket = null;
    let reconnectTimer = null;
    let destroyed = false;
    let hasConversation = false;
    let isConnected = false;

    function setStatus(message) {
        if (statusElement) {
            statusElement.textContent = message || '';
        }
    }

    function updatePanelState() {
        const active = hasConversation;
        panel.classList.toggle('agent-panel--empty', !active);
        if (startContainer) {
            startContainer.classList.toggle('hidden', active);
        }
        if (chatContainer) {
            chatContainer.classList.toggle('hidden', !active);
        }
        if (active && chatInput) {
            window.requestAnimationFrame(() => {
                chatInput.focus();
                autoResize(chatInput);
            });
        }
    }

    function ensureConversationStarted() {
        if (hasConversation) {
            return;
        }
        hasConversation = true;
        updatePanelState();
    }

    function autoResize(textarea) {
        if (!textarea) {
            return;
        }
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
    }

    function clearReconnectTimer() {
        if (reconnectTimer) {
            window.clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer || destroyed) {
            return;
        }
        reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, reconnectDelay);
    }

    function flushPending() {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        while (pendingMessages.length > 0) {
            const next = pendingMessages[0];
            try {
                socket.send(JSON.stringify({ type: 'user_message', text: next }));
                pendingMessages.shift();
            } catch (error) {
                console.warn('Failed to deliver chat message', error);
                scheduleReconnect();
                break;
            }
        }
    }

    function appendMessage(role, text) {
        if (!messageList || typeof text !== 'string' || !text) {
            return;
        }

        ensureConversationStarted();

        const wrapper = document.createElement('div');
        wrapper.className = `agent-message agent-message--${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'agent-message-bubble';
        bubble.textContent = text;

        wrapper.appendChild(bubble);
        messageList.appendChild(wrapper);

        window.requestAnimationFrame(() => {
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        });
    }

    function handleIncoming(event) {
        if (socket && event?.currentTarget && socket !== event.currentTarget) {
            return;
        }
        try {
            const payload = JSON.parse(event.data);
            if (payload?.type === 'agent_message' && typeof payload.text === 'string') {
                appendMessage('agent', payload.text);
            }
        } catch (error) {
            console.warn('Failed to parse agent payload', error);
        }
    }

    function handleOpen(event) {
        if (socket && event?.currentTarget && socket !== event.currentTarget) {
            return;
        }
        if (destroyed || !socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }
        isConnected = true;
        setStatus('Connected to the demo agent.');
        flushPending();
    }

    function handleClose(event) {
        if (socket && event?.currentTarget && socket !== event.currentTarget) {
            return;
        }
        if (destroyed) {
            return;
        }
        isConnected = false;
        setStatus('Reconnecting to the agent...');
        scheduleReconnect();
    }

    function handleError(event) {
        if (socket && event?.currentTarget && socket !== event.currentTarget) {
            return;
        }
        if (!socket) {
            return;
        }
        try {
            socket.close();
        } catch (error) {
            console.warn('Failed to close agent socket after error', error);
        }
    }

    function connect() {
        if (destroyed) {
            return;
        }

        clearReconnectTimer();

        if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
            try {
                socket.close();
            } catch (error) {
                console.warn('Failed to close existing agent socket', error);
            }
        }

        let url;
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            url = `${protocol}://${window.location.host}/ws/agent`;
        } catch (error) {
            console.error('Failed to resolve agent websocket URL', error);
            scheduleReconnect();
            return;
        }

        setStatus('Connecting to the agent...');

        const nextSocket = new WebSocket(url);
        socket = nextSocket;

        nextSocket.addEventListener('open', handleOpen);
        nextSocket.addEventListener('message', handleIncoming);
        nextSocket.addEventListener('close', handleClose);
        nextSocket.addEventListener('error', handleError);
    }

    function queueMessage(text) {
        if (!text) {
            return;
        }
        pendingMessages.push(text);
        flushPending();
        if (!isConnected) {
            if (!socket || socket.readyState === WebSocket.CLOSED) {
                connect();
            }
            scheduleReconnect();
            setStatus('Waiting for the agent connection...');
        }
    }

    function sendUserMessage(rawText) {
        if (typeof rawText !== 'string') {
            return;
        }
        const trimmed = rawText.trim();
        if (!trimmed) {
            return;
        }

        appendMessage('user', trimmed);
        queueMessage(trimmed);
    }

    function handleStartSubmit(event) {
        event.preventDefault();
        const value = startInput?.value || '';
        sendUserMessage(value);
        if (startInput) {
            startInput.value = '';
        }
    }

    function handleChatSubmit(event) {
        event.preventDefault();
        const value = chatInput?.value || '';
        sendUserMessage(value);
        if (chatInput) {
            chatInput.value = '';
            autoResize(chatInput);
        }
    }

    function handleChatKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleChatSubmit(event);
        }
    }

    function addListener(target, type, handler) {
        if (!target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') {
            return;
        }
        target.addEventListener(type, handler);
        cleanupFns.push(() => target.removeEventListener(type, handler));
    }

    addListener(startForm, 'submit', handleStartSubmit);
    addListener(chatForm, 'submit', handleChatSubmit);
    addListener(chatInput, 'keydown', handleChatKeydown);
    addListener(chatInput, 'input', () => autoResize(chatInput));

    if (chatInput) {
        autoResize(chatInput);
    }

    updatePanelState();
    return {
        connect,
        dispose() {
            destroyed = true;
            clearReconnectTimer();
            if (socket) {
                try {
                    socket.close();
                } catch (error) {
                    console.warn('Failed to close agent socket on dispose', error);
                }
                socket = null;
            }
            cleanupFns.splice(0).forEach((cleanup) => {
                try {
                    cleanup();
                } catch (error) {
                    console.warn('Failed to clean up chat listener', error);
                }
            });
        },
    };
}
