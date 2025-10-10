import { createMarkdownDisplay } from '../components/markdown_display.js';

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
    const sendButtons = [];
    if (startForm) {
        const button = startForm.querySelector('button[type="submit"]');
        if (button && !sendButtons.includes(button)) {
            sendButtons.push(button);
        }
    }
    if (chatForm) {
        const button = chatForm.querySelector('button[type="submit"]');
        if (button && !sendButtons.includes(button)) {
            sendButtons.push(button);
        }
    }
    let socket = null;
    let reconnectTimer = null;
    let destroyed = false;
    let hasConversation = false;
    let isConnected = false;
    let isThinking = false;
    let lastStatus = '';
    let lastStatusLevel = '';

    function updateStatusDisplay() {
        if (!statusElement) {
            return;
        }
        const message = isThinking ? 'Agent is thinking…' : lastStatus;
        statusElement.textContent = message || '';
        if (isThinking) {
            statusElement.dataset.level = 'info';
            statusElement.dataset.thinking = 'true';
        } else {
            if (lastStatusLevel) {
                statusElement.dataset.level = lastStatusLevel;
            } else {
                delete statusElement.dataset.level;
            }
            statusElement.dataset.thinking = 'false';
        }
    }

    function setStatus(message, { level } = {}) {
        lastStatus = typeof message === 'string' ? message : '';
        lastStatusLevel = typeof level === 'string' ? level : '';
        if (!isThinking) {
            updateStatusDisplay();
        }
    }

    function updateThinkingState(next) {
        const active = Boolean(next);
        if (isThinking === active) {
            return;
        }
        isThinking = active;
        sendButtons.forEach((button) => {
            button.disabled = active;
        });
        updateStatusDisplay();
    }

    function normaliseText(value) {
        if (typeof value === 'string') {
            return value;
        }
        if (value == null) {
            return '';
        }
        try {
            return String(value);
        } catch (error) {
            console.warn('Failed to normalise agent text', error);
            return '';
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
                socket.send(JSON.stringify({ type: 'prompt', prompt: next }));
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

        if (role === 'agent') {
            const markdownDisplay = createMarkdownDisplay({
                content: bubble,
                getCurrentFile: () => null,
                setCurrentContent: () => {},
                buildQuery: () => '',
            });
            markdownDisplay.render(text, { updateCurrent: false });
        } else {
            bubble.textContent = text;
        }

        wrapper.appendChild(bubble);
        messageList.appendChild(wrapper);

        window.requestAnimationFrame(() => {
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        });
    }

    function appendEvent(eventType, payload = {}) {
        if (!messageList) {
            return;
        }

        const text = normaliseText(payload.text).trim();
        const title = normaliseText(payload.title).trim();
        const subtitle = normaliseText(payload.subtitle).trim();
        const description = normaliseText(payload.description).trim();
        const details = normaliseText(payload.details).trim();

        if (eventType === 'request-input') {
            return;
        }

        let headerText = title;
        let bodyText = '';

        const fallbackTitles = {
            banner: title || text || 'Agent banner',
            status: title || 'Status update',
            'request-input': title || 'Input requested',
        };

        if (eventType === 'banner') {
            headerText = fallbackTitles.banner;
            bodyText = subtitle || description || details;
            if (!bodyText && text && text !== headerText) {
                bodyText = text;
            }
        } else {
            headerText = fallbackTitles[eventType] || headerText;
            bodyText = subtitle || description || details || text;
        }

        if (!headerText && !bodyText && text) {
            bodyText = text;
        }

        if (!headerText && !bodyText) {
            return;
        }

        ensureConversationStarted();

        const wrapper = document.createElement('div');
        wrapper.className = 'agent-message agent-message--event';
        if (eventType) {
            wrapper.dataset.eventType = eventType;
        }
        if (payload.level) {
            wrapper.dataset.level = payload.level;
        }

        const bubble = document.createElement('div');
        bubble.className = 'agent-message-bubble agent-message-bubble--event';

        if (headerText) {
            const header = document.createElement('div');
            header.className = 'agent-event-title';
            header.textContent = headerText;
            bubble.appendChild(header);
        }

        if (bodyText && (!headerText || bodyText !== headerText)) {
            const body = document.createElement('div');
            body.className = 'agent-event-body';
            body.textContent = bodyText;
            bubble.appendChild(body);
        }

        const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null;
        const scopeText = metadata ? normaliseText(metadata.scope).trim() : '';
        if (scopeText) {
            const meta = document.createElement('div');
            meta.className = 'agent-event-meta';
            const scope = document.createElement('span');
            scope.className = 'agent-event-meta-tag';
            scope.textContent = `Scope: ${scopeText}`;
            meta.appendChild(scope);
            bubble.appendChild(meta);
        }

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
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            console.warn('Failed to parse agent payload', error);
            return;
        }

        if (!payload || typeof payload !== 'object') {
            return;
        }

        switch (payload.type) {
            case 'agent_message': {
                const text = normaliseText(payload.text).trim();
                if (text) {
                    updateThinkingState(false);
                    appendMessage('agent', text);
                }
                break;
            }
            case 'agent_status': {
                const text = normaliseText(payload.text);
                if (text) {
                    const level = typeof payload.level === 'string' ? payload.level : undefined;
                    setStatus(text, { level });
                    const eventType = typeof payload.eventType === 'string' ? payload.eventType : 'status';
                    appendEvent(eventType, { ...payload, text, level });
                }
                break;
            }
            case 'agent_error': {
                updateThinkingState(false);
                const message = normaliseText(payload.message);
                if (message) {
                    setStatus(message, { level: 'error' });
                    appendMessage('agent', message);
                }
                const details = normaliseText(payload.details).trim();
                if (details && details !== message) {
                    appendMessage('agent', details);
                }
                break;
            }
            case 'agent_thinking': {
                if (payload.state === 'start') {
                    updateThinkingState(true);
                } else if (payload.state === 'stop') {
                    updateThinkingState(false);
                }
                break;
            }
            case 'agent_request_input': {
                updateThinkingState(false);
                const promptText = normaliseText(payload.prompt).trim();
                const readyMessage = 'Agent is ready for your next message.';
                const shouldShowPrompt = promptText && promptText !== '▷';
                const displayText = shouldShowPrompt ? promptText : readyMessage;
                setStatus(displayText);
                break;
            }
            case 'agent_plan':
            case 'agent_event':
                // Reserved for future UI enhancements.
                break;
            default:
                console.warn('Received unsupported agent payload', payload);
                break;
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
        updateThinkingState(false);
        setStatus('Connected to the agent runtime.', { level: 'info' });
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
        updateThinkingState(false);
        setStatus('Reconnecting to the agent runtime...', { level: 'warn' });
        scheduleReconnect();
    }

    function handleError(event) {
        if (socket && event?.currentTarget && socket !== event.currentTarget) {
            return;
        }
        if (!socket) {
            return;
        }
        updateThinkingState(false);
        try {
            socket.close();
        } catch (error) {
            console.warn('Failed to close agent socket after error', error);
        }
        setStatus('Agent connection encountered an error.', { level: 'error' });
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

        setStatus('Connecting to the agent runtime...');

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
            setStatus('Waiting for the agent runtime connection...');
        }
    }

    function sendUserMessage(rawText) {
        if (typeof rawText !== 'string' || isThinking) {
            return false;
        }
        const trimmed = rawText.trim();
        if (!trimmed) {
            return false;
        }

        appendMessage('user', trimmed);
        queueMessage(trimmed);
        return true;
    }

    function handleStartSubmit(event) {
        event.preventDefault();
        const value = startInput?.value || '';
        const sent = sendUserMessage(value);
        if (sent && startInput) {
            startInput.value = '';
        }
    }

    function handleChatSubmit(event) {
        event.preventDefault();
        const value = chatInput?.value || '';
        const sent = sendUserMessage(value);
        if (sent && chatInput) {
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

    updateStatusDisplay();
    updatePanelState();
    return {
        connect,
        dispose() {
            destroyed = true;
            clearReconnectTimer();
            updateThinkingState(false);
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
