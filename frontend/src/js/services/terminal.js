// Provides an isolated controller for the embedded terminal panel. The service keeps
// WebSocket management, sizing logic, and xterm.js integration out of the main
// bootstrap file so UI coordination can plug in through small hooks.
export function createTerminalService(options = {}) {
    const {
        terminalPanel = null,
        terminalContainer = null,
        terminalToggleButton = null,
        terminalStatusText = null,
        terminalResizeHandle = null,
        storageKey = 'terminalPanelHeight',
        isDockviewActive = () => false,
    } = options;

    let terminalInstance = null;
    let terminalFitAddon = null;
    let terminalSocket = null;
    let terminalReconnectTimer = null;
    let terminalLibraryRetryTimer = null;
    let terminalCollapsed = false;
    let terminalHeight = null;
    let pendingTerminalFitFrame = null;
    let terminalResizeObserver = null;
    const terminalDecoder = new TextDecoder();
    let terminalLastStatusMessage = '';

    function areLibrariesReady() {
        return (
            typeof window !== 'undefined' &&
            typeof window.Terminal === 'function' &&
            window.FitAddon &&
            typeof window.FitAddon.FitAddon === 'function'
        );
    }

    function scheduleTerminalLibraryRetry() {
        if (terminalLibraryRetryTimer) {
            return;
        }
        terminalLibraryRetryTimer = window.setTimeout(() => {
            terminalLibraryRetryTimer = null;
            if (!terminalInstance) {
                ensureTerminalInstance();
            }
            if (!terminalSocket) {
                connectTerminal();
            }
        }, 250);
    }

    function ensureTerminalInstance() {
        if (terminalInstance || !terminalContainer) {
            return terminalInstance;
        }

        if (!areLibrariesReady()) {
            scheduleTerminalLibraryRetry();
            return null;
        }

        try {
            terminalInstance = new window.Terminal({
                convertEol: true,
                cursorBlink: true,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: 13,
                theme: {
                    // Palette derived from the provided macOS Terminal profile to keep the
                    // in-browser terminal consistent with the requested look-and-feel.
                    background: '#21252b',
                    foreground: '#abb2bf',
                    cursor: '#abb2bf',
                    cursorAccent: '#21252b',
                    selection: '#323844',
                    selectionForeground: '#abb2bf',
                    black: '#21252b',
                    red: '#e06c75',
                    green: '#98c379',
                    yellow: '#e5c07b',
                    blue: '#61afef',
                    magenta: '#c678dd',
                    cyan: '#56b6c2',
                    white: '#abb2bf',
                    brightBlack: '#767676',
                    brightRed: '#e06c75',
                    brightGreen: '#98c379',
                    brightYellow: '#e5c07b',
                    brightBlue: '#61afef',
                    brightMagenta: '#c678dd',
                    brightCyan: '#56b6c2',
                    brightWhite: '#abb2bf',
                },
            });
        } catch (error) {
            console.warn('Failed to initialise terminal instance', error);
            terminalInstance = null;
            return null;
        }

        try {
            terminalFitAddon = new window.FitAddon.FitAddon();
            terminalInstance.loadAddon(terminalFitAddon);
        } catch (error) {
            console.warn('Failed to load terminal fit addon', error);
            terminalInstance.dispose();
            terminalInstance = null;
            terminalFitAddon = null;
            return null;
        }

        terminalInstance.open(terminalContainer);
        terminalInstance.focus();

        terminalInstance.onData((data) => {
            if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
                terminalSocket.send(JSON.stringify({ type: 'input', data }));
            }
        });

        terminalInstance.onResize((size) => {
            if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
                terminalSocket.send(
                    JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows })
                );
            }
        });

        scheduleTerminalFit();
        return terminalInstance;
    }

    function scheduleTerminalFit() {
        if (!terminalInstance || !terminalFitAddon || terminalCollapsed) {
            return;
        }

        if (pendingTerminalFitFrame) {
            window.cancelAnimationFrame(pendingTerminalFitFrame);
        }

        pendingTerminalFitFrame = window.requestAnimationFrame(() => {
            pendingTerminalFitFrame = null;
            fitTerminal();
        });
    }

    function fitTerminal() {
        if (!terminalInstance || !terminalFitAddon || terminalCollapsed) {
            return;
        }

        try {
            terminalFitAddon.fit();
        } catch (error) {
            console.warn('Unable to fit terminal to container', error);
            return;
        }

        sendTerminalResize();
    }

    function sendTerminalResize() {
        if (!terminalInstance || !terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) {
            return;
        }
        terminalSocket.send(
            JSON.stringify({ type: 'resize', cols: terminalInstance.cols, rows: terminalInstance.rows })
        );
    }

    function updateTerminalStatus(message) {
        if (terminalStatusText) {
            terminalStatusText.textContent = message || '';
        }
        terminalLastStatusMessage = message || '';
    }

    function scheduleTerminalReconnect(delay = 1500) {
        if (terminalReconnectTimer) {
            return;
        }
        terminalReconnectTimer = window.setTimeout(() => {
            terminalReconnectTimer = null;
            connectTerminal();
        }, delay);
    }

    function connectTerminal() {
        if (!terminalContainer) {
            return;
        }

        if (terminalSocket &&
            (terminalSocket.readyState === WebSocket.OPEN || terminalSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const terminal = ensureTerminalInstance();
        if (!terminal) {
            scheduleTerminalLibraryRetry();
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(`${protocol}://${window.location.host}/ws/terminal`);
        socket.binaryType = 'arraybuffer';
        terminalSocket = socket;
        updateTerminalStatus('Connecting…');

        socket.addEventListener('open', () => {
            if (terminalReconnectTimer) {
                window.clearTimeout(terminalReconnectTimer);
                terminalReconnectTimer = null;
            }
            updateTerminalStatus('Connected');
            scheduleTerminalFit();
        });

        socket.addEventListener('message', (event) => {
            if (!terminalInstance) {
                return;
            }

            const consumeBuffer = (buffer) => {
                if (!buffer) {
                    return;
                }
                const text = terminalDecoder.decode(buffer);
                if (text) {
                    terminalInstance.write(text);
                }
            };

            if (event.data instanceof ArrayBuffer) {
                consumeBuffer(new Uint8Array(event.data));
                return;
            }

            if (typeof event.data === 'string') {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'state' && typeof payload.message === 'string') {
                        updateTerminalStatus(payload.message);
                        return;
                    }
                    if (payload.type === 'exit') {
                        if (typeof payload.code === 'number') {
                            updateTerminalStatus(`Process exited (${payload.code})`);
                        } else {
                            updateTerminalStatus('Process exited');
                        }
                        scheduleTerminalReconnect();
                        return;
                    }
                } catch (error) {
                    // Treat as raw output when parsing fails.
                    terminalInstance.write(event.data);
                    return;
                }

                terminalInstance.write(event.data);
                return;
            }

            if (event.data && typeof event.data.arrayBuffer === 'function') {
                event.data
                    .arrayBuffer()
                    .then((buffer) => consumeBuffer(new Uint8Array(buffer)))
                    .catch((error) => console.warn('Failed to decode terminal payload', error));
            }
        });

        socket.addEventListener('close', () => {
            if (terminalSocket === socket) {
                terminalSocket = null;
            }
            if (!terminalLastStatusMessage.startsWith('Process exited')) {
                updateTerminalStatus('Disconnected – reconnecting…');
            }
            scheduleTerminalReconnect();
        });

        socket.addEventListener('error', () => {
            updateTerminalStatus('Connection error');
            socket.close();
        });
    }

    function setupTerminalPanel() {
        if (!terminalPanel) {
            return;
        }

        const dockviewActive = Boolean(isDockviewActive?.());

        if (!dockviewActive && terminalResizeObserver) {
            terminalResizeObserver.disconnect();
            terminalResizeObserver = null;
        }

        if (dockviewActive) {
            terminalCollapsed = false;
            terminalPanel.style.height = '';
            terminalPanel.style.maxHeight = '';
            terminalPanel.classList.remove('is-collapsed');
            if (terminalResizeHandle) {
                terminalResizeHandle.remove();
            }
            if (terminalToggleButton) {
                terminalToggleButton.disabled = true;
                terminalToggleButton.textContent = 'Terminal (layout-managed)';
                terminalToggleButton.setAttribute('aria-expanded', 'true');
            }

            if (!terminalResizeObserver && typeof window.ResizeObserver === 'function') {
                const resizeTarget = terminalPanel.parentElement || terminalPanel;
                if (resizeTarget) {
                    terminalResizeObserver = new window.ResizeObserver(() => {
                        scheduleTerminalFit();
                    });
                    terminalResizeObserver.observe(resizeTarget);
                }
            }

            const instance = ensureTerminalInstance();
            if (instance) {
                scheduleTerminalFit();
            }
            connectTerminal();
            return;
        }

        const minHeight = 140;

        const clampHeight = (value) => {
            const max = Math.max(minHeight, Math.round(window.innerHeight * 0.75));
            if (Number.isFinite(value)) {
                return Math.min(Math.max(value, minHeight), max);
            }
            return minHeight;
        };

        const applyHeight = (value, { persist = false } = {}) => {
            const clamped = clampHeight(value);
            terminalHeight = clamped;
            terminalPanel.style.height = `${clamped}px`;
            if (persist) {
                persistHeight();
            }
            scheduleTerminalFit();
            return clamped;
        };

        const persistHeight = () => {
            if (typeof window.localStorage === 'undefined') {
                return;
            }
            try {
                window.localStorage.setItem(storageKey, String(terminalHeight));
            } catch (error) {
                // Ignore persistence errors (e.g. storage disabled).
            }
        };

        const restoreHeightFromStorage = () => {
            if (typeof window.localStorage === 'undefined') {
                terminalHeight = clampHeight(terminalPanel.getBoundingClientRect().height || 260);
                return;
            }
            let stored = null;
            try {
                stored = window.localStorage.getItem(storageKey);
            } catch (error) {
                stored = null;
            }
            const numeric = stored === null ? NaN : Number(stored);
            if (Number.isFinite(numeric)) {
                applyHeight(numeric);
            } else {
                terminalHeight = clampHeight(terminalPanel.getBoundingClientRect().height || 260);
            }
        };

        const setCollapsed = (value) => {
            const collapsed = Boolean(value);
            if (terminalCollapsed === collapsed) {
                return;
            }
            terminalCollapsed = collapsed;
            terminalPanel.classList.toggle('is-collapsed', collapsed);
            if (terminalToggleButton) {
                terminalToggleButton.setAttribute('aria-expanded', String(!collapsed));
                terminalToggleButton.textContent = collapsed ? 'Show terminal' : 'Hide terminal';
            }

            if (collapsed) {
                terminalPanel.style.height = '';
                return;
            }

            applyHeight(terminalHeight || clampHeight(terminalPanel.getBoundingClientRect().height || 260));

            if (terminalPanel) {
                const handleTransitionEnd = (event) => {
                    if (event.target !== terminalPanel || event.propertyName !== 'height') {
                        return;
                    }
                    terminalPanel.removeEventListener('transitionend', handleTransitionEnd);
                    scheduleTerminalFit();
                };
                terminalPanel.addEventListener('transitionend', handleTransitionEnd, { once: true });
            }

            const instance = ensureTerminalInstance();
            if (instance) {
                instance.focus();
                if (typeof instance.scrollToBottom === 'function') {
                    instance.scrollToBottom();
                }
            }

            connectTerminal();
        };

        restoreHeightFromStorage();

        if (terminalToggleButton) {
            terminalToggleButton.addEventListener('click', () => {
                setCollapsed(!terminalCollapsed);
            });
        }

        if (terminalResizeHandle) {
            terminalResizeHandle.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = terminalPanel.getBoundingClientRect().height;

                const handleMove = (moveEvent) => {
                    const delta = startY - moveEvent.clientY;
                    const next = clampHeight(startHeight + delta);
                    applyHeight(next);
                };

                const handleUp = () => {
                    document.removeEventListener('pointermove', handleMove);
                    document.removeEventListener('pointerup', handleUp);
                    persistHeight();
                    scheduleTerminalFit();
                };

                document.addEventListener('pointermove', handleMove);
                document.addEventListener('pointerup', handleUp);
            });

            terminalResizeHandle.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
                    return;
                }
                event.preventDefault();
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                const offset = event.key === 'ArrowUp' ? 32 : -32;
                const next = clampHeight((terminalHeight || terminalPanel.getBoundingClientRect().height) + offset);
                applyHeight(next, { persist: true });
            });

            terminalResizeHandle.addEventListener('dblclick', () => {
                if (terminalCollapsed) {
                    setCollapsed(false);
                }
                applyHeight(clampHeight(260), { persist: true });
            });
        }

        window.addEventListener('resize', () => {
            if (terminalCollapsed) {
                return;
            }
            const current = terminalHeight || terminalPanel.getBoundingClientRect().height;
            const clamped = clampHeight(current);
            if (clamped !== current) {
                applyHeight(clamped, { persist: true });
            } else {
                scheduleTerminalFit();
            }
        });

        setCollapsed(false);
        ensureTerminalInstance();
        connectTerminal();
    }

    function handleBeforeUnload() {
        if (terminalSocket && terminalSocket.readyState === WebSocket.OPEN) {
            try {
                terminalSocket.close();
            } catch (error) {
                // Swallow shutdown errors.
            }
        }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return {
        ensureTerminalInstance,
        connectTerminal,
        setupTerminalPanel,
        scheduleTerminalFit,
    };
}
