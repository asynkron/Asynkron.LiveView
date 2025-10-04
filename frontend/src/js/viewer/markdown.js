const RELATIVE_LINK_DUMMY_ORIGIN = 'http://__dummy__/';
const RELATIVE_LINK_SCHEME_PATTERN = /^[a-zA-Z][\w+.-]*:/;
const RELATIVE_LINK_PROTOCOL_RELATIVE_PATTERN = /^\/\//;

const DIAGRAM_ICONS = {
    Mermaid: '📊',
    Vega: '📈',
    Excalidraw: '✏️',
};

function buildQueryString(context, params) {
    if (typeof context?.buildQuery === 'function') {
        return context.buildQuery(params);
    }

    if (typeof URLSearchParams === 'undefined') {
        return '';
    }

    const searchParams = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, value);
        }
    });

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
}

function getMarkdownState(context) {
    if (!context) {
        throw new Error('Markdown context is required');
    }

    if (!context.__markdownState) {
        context.__markdownState = {
            textEncoder: typeof TextEncoder !== 'undefined' ? new TextEncoder() : null,
            textDecoder: typeof TextDecoder !== 'undefined' ? new TextDecoder() : null,
            markedConfigured: false,
            mermaidInitAttempted: false,
            mermaidRetryTimer: null,
            vegaRetryTimer: null,
            excalidrawRetryTimer: null,
            mermaidIdCounter: 0,
            vegaIdCounter: 0,
            excalidrawIdCounter: 0,
            excalidrawRoots: new Map(),
            excalidrawResizeHandlerAttached: false,
            excalidrawFitFailureLogged: false,
            librariesReadyPromise: null,
            pendingMarkdown: null,
            relativeLinksEnabled: false,
            relativeLinkBasePath: '',
            relativeLinkBaseWalker: null,
            relativeLinkExtensionRegistered: false,
            headingLocationMap: new Map(),
            documentSlugCounts: new Map(),
            activeHeadingCollection: null,
        };
    }

    return context.__markdownState;
}

function updateRelativeLinkBase(context, state, filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
        state.relativeLinksEnabled = false;
        state.relativeLinkBasePath = '';
        state.relativeLinkBaseWalker = null;
        return;
    }

    state.relativeLinksEnabled = true;
    const lastSlashIndex = filePath.lastIndexOf('/');
    state.relativeLinkBasePath = lastSlashIndex === -1 ? '' : filePath.slice(0, lastSlashIndex + 1);

    if (typeof markedBaseUrl !== 'undefined' && markedBaseUrl && typeof markedBaseUrl.baseUrl === 'function') {
        const baseCandidate = state.relativeLinkBasePath || './';
        try {
            state.relativeLinkBaseWalker = markedBaseUrl.baseUrl(baseCandidate);
        } catch (error) {
            console.warn('Failed to initialise marked-base-url', error);
            state.relativeLinkBaseWalker = null;
        }
    } else {
        state.relativeLinkBaseWalker = null;
    }
}

function decodePathSegments(path) {
    if (!path) {
        return '';
    }
    return path
        .split('/')
        .map((segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        })
        .join('/');
}

function encodePathSegments(path) {
    if (!path) {
        return '';
    }
    return path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function fallbackResolveRelativeHref(state, href) {
    try {
        const baseReference = state.relativeLinkBasePath ? state.relativeLinkBasePath : '.';
        const baseUrl = new URL(baseReference, RELATIVE_LINK_DUMMY_ORIGIN);
        const resolvedUrl = new URL(href, baseUrl);
        const normalisedPath = resolvedUrl.pathname.replace(/^\/+/u, '');
        const decodedPath = decodePathSegments(normalisedPath);
        return `${decodedPath}${resolvedUrl.search}${resolvedUrl.hash}`;
    } catch (error) {
        console.warn('Relative link fallback failed', error);
        return href;
    }
}

function splitResolvedHref(resolvedHref) {
    if (typeof resolvedHref !== 'string' || resolvedHref.length === 0) {
        return { filePath: '', search: '', hash: '' };
    }

    let working = resolvedHref;
    let hash = '';
    const hashIndex = working.indexOf('#');
    if (hashIndex !== -1) {
        hash = working.slice(hashIndex);
        working = working.slice(0, hashIndex);
    }

    let search = '';
    const searchIndex = working.indexOf('?');
    if (searchIndex !== -1) {
        search = working.slice(searchIndex);
        working = working.slice(0, searchIndex);
    }

    const cleaned = working.replace(/^\.\//, '').replace(/^\/+/u, '');
    const filePath = decodePathSegments(cleaned);
    return { filePath, search, hash };
}

function transformRelativeAsset(context, state, rawHref, tokenType) {
    if (!state.relativeLinksEnabled || typeof rawHref !== 'string') {
        return null;
    }

    const trimmedHref = rawHref.trim();
    if (
        !trimmedHref ||
        trimmedHref.startsWith('#') ||
        RELATIVE_LINK_PROTOCOL_RELATIVE_PATTERN.test(trimmedHref) ||
        RELATIVE_LINK_SCHEME_PATTERN.test(trimmedHref) ||
        trimmedHref.startsWith('/')
    ) {
        return null;
    }

    let resolvedHref = trimmedHref;
    const walker = state.relativeLinkBaseWalker;

    if (walker && typeof walker.walkTokens === 'function') {
        const tempToken = { type: tokenType, href: trimmedHref };
        try {
            walker.walkTokens(tempToken);
            resolvedHref = tempToken.href;
        } catch (error) {
            console.warn('marked-base-url resolution failed', error);
            resolvedHref = fallbackResolveRelativeHref(state, trimmedHref);
        }
    } else {
        resolvedHref = fallbackResolveRelativeHref(state, trimmedHref);
    }

    const parts = splitResolvedHref(resolvedHref);
    if (!parts.filePath) {
        return null;
    }

    if (tokenType === 'image') {
        return {
            assetHref: `${encodePathSegments(parts.filePath)}${parts.search}${parts.hash}`,
        };
    }

    return {
        fileTarget: `${parts.filePath}${parts.search}`,
        hash: parts.hash,
    };
}

function ensureRelativeLinkExtension(context, state) {
    if (state.relativeLinkExtensionRegistered || typeof marked === 'undefined') {
        return;
    }

    const extension = {
        walkTokens(token) {
            if (!token || typeof token.href !== 'string') {
                return;
            }

            if (token.type === 'image') {
                const asset = transformRelativeAsset(context, state, token.href, 'image');
                if (asset?.assetHref) {
                    token.href = asset.assetHref;
                }
                return;
            }

            if (token.type !== 'link') {
                return;
            }

            const result = transformRelativeAsset(context, state, token.href, 'link');
            if (!result?.fileTarget) {
                return;
            }

            const basePathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
            const query = buildQueryString(context, { file: result.fileTarget });
            token.href = `${basePathname}${query}${result.hash || ''}`;
        },
    };

    marked.use(extension);
    state.relativeLinkExtensionRegistered = true;
}

function encodeDiagramSource(state, code) {
    if (!code) {
        return '';
    }

    const encoder = state.textEncoder;
    if (encoder) {
        const bytes = encoder.encode(code);
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    try {
        return btoa(unescape(encodeURIComponent(code)));
    } catch (error) {
        console.warn('Failed to encode diagram source', error);
        return '';
    }
}

function decodeDiagramSource(state, encoded, label) {
    if (!encoded) {
        return '';
    }

    try {
        if (state.textDecoder) {
            const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            return state.textDecoder.decode(bytes);
        }
        return decodeURIComponent(escape(atob(encoded)));
    } catch (error) {
        console.warn(`Failed to decode ${label} source`, error);
        return '';
    }
}

function encodeMermaidSource(state, code) {
    return encodeDiagramSource(state, code);
}

function decodeMermaidSource(state, encoded) {
    return decodeDiagramSource(state, encoded, 'Mermaid');
}

function encodeVegaSource(state, code) {
    return encodeDiagramSource(state, code);
}

function decodeVegaSource(state, encoded) {
    return decodeDiagramSource(state, encoded, 'Vega');
}

function encodeExcalidrawSource(state, code) {
    return encodeDiagramSource(state, code);
}

function decodeExcalidrawSource(state, encoded) {
    return decodeDiagramSource(state, encoded, 'Excalidraw');
}

function normaliseHeadingText(rendered, raw) {
    if (typeof rendered === 'string' && rendered.trim()) {
        const temp = document.createElement('div');
        temp.innerHTML = rendered;
        const textContent = (temp.textContent || temp.innerText || '').trim();
        if (textContent) {
            return textContent;
        }
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed) {
            return trimmed;
        }
    }

    return '';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function computeBaseSlug(text) {
    if (!text) {
        return '';
    }

    const temp = document.createElement('div');
    temp.innerHTML = text;
    const cleanText = temp.textContent || temp.innerText || text;

    return cleanText
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function createSlug(state, text) {
    let slug = computeBaseSlug(text);

    if (!slug) {
        slug = 'heading';
    }

    const counts = state.documentSlugCounts;
    if (counts) {
        if (counts.has(slug)) {
            const count = counts.get(slug) + 1;
            counts.set(slug, count);
            return `${slug}-${count}`;
        }

        counts.set(slug, 0);
    }

    return slug;
}

function configureMarked(context, state) {
    if (typeof marked === 'undefined' || state.markedConfigured) {
        return;
    }

    marked.use({
        walkTokens(token) {
            if (!token || token.type !== 'code') {
                return;
            }

            const language = typeof token.lang === 'string' ? token.lang.toLowerCase() : '';
            const source = token.text || token.raw || '';

            if (language.includes('mermaid')) {
                const id = `mermaid-diagram-${state.mermaidIdCounter++}`;
                const encodedSource = encodeMermaidSource(state, source);
                const mermaidHtml = `<div class="mermaid" id="${id}" data-mermaid-source="${encodedSource}"></div>`;
                token.type = 'html';
                token.raw = mermaidHtml;
                token.text = mermaidHtml;
                return;
            }

            if (language.includes('vega-lite') || language === 'vega') {
                const id = `vega-diagram-${state.vegaIdCounter++}`;
                const encodedSource = encodeVegaSource(state, source);
                const vegaHtml = `<div class="vega-diagram" id="${id}" data-vega-source="${encodedSource}"></div>`;
                token.type = 'html';
                token.raw = vegaHtml;
                token.text = vegaHtml;
                return;
            }

            if (language.includes('excalidraw')) {
                const id = `excalidraw-diagram-${state.excalidrawIdCounter++}`;
                const encodedSource = encodeExcalidrawSource(state, source);
                const excalidrawHtml = `<div class="excalidraw-diagram" id="${id}" data-excalidraw-source="${encodedSource}"></div>`;
                token.type = 'html';
                token.raw = excalidrawHtml;
                token.text = excalidrawHtml;
                return;
            }
        },
    });

    marked.use({
        headerIds: true,
        mangle: false,
        renderer: {
            heading({ text, depth, raw }) {
                const headingLevel = Math.min(Math.max(depth || 1, 1), 6);

                const sourceText = typeof raw === 'string' ? raw : text;
                const slug = createSlug(state, sourceText);
                const plainText = normaliseHeadingText(text, raw);
                const ariaSource = plainText || (typeof raw === 'string' ? raw : 'heading');
                const ariaLabel = escapeHtml(`Link to section ${ariaSource}`);
                const headingLabel = plainText || ariaSource || 'this section';
                const safeSlug = escapeHtml(slug);
                const actionsAriaLabel = escapeHtml(`Section actions for ${headingLabel}`);
                const editLabel = escapeHtml(`Edit section "${headingLabel}" in the editor`);
                const copyLabel = escapeHtml(`Copy link to section "${headingLabel}"`);

                if (Array.isArray(state.activeHeadingCollection)) {
                    state.activeHeadingCollection.push({
                        level: headingLevel,
                        text: plainText || ariaSource,
                        slug,
                    });
                }

                return `<h${headingLevel} id="${safeSlug}">${text}<span class="heading-actions" role="group" aria-label="${actionsAriaLabel}"><button type="button" class="heading-action-button heading-action-edit" data-heading-action="edit" data-heading-slug="${safeSlug}" title="${editLabel}"><i class="fa-solid fa-pen-to-square" aria-hidden="true"></i><span class="sr-only">${editLabel}</span></button><button type="button" class="heading-action-button heading-action-copy" data-heading-action="copy" data-heading-slug="${safeSlug}" title="${copyLabel}"><i class="fa-solid fa-link" aria-hidden="true"></i><span class="sr-only">${copyLabel}</span></button></span><a class="heading-anchor" href="#${safeSlug}" aria-label="${ariaLabel}"></a></h${headingLevel}>`;
            },
        },
    });

    marked.setOptions({
        breaks: true,
        gfm: true,
        highlight(code, language) {
            if (typeof hljs === 'undefined') {
                return code;
            }
            try {
                if (language && hljs.getLanguage(language)) {
                    return hljs.highlight(code, { language }).value;
                }
                return hljs.highlightAuto(code).value;
            } catch (err) {
                console.warn('Highlight.js failed to render a block', err);
                return code;
            }
        },
    });

    ensureRelativeLinkExtension(context, state);

    state.markedConfigured = true;
}

function waitForCoreLibraries(state, { maxRetries = 80, interval = 100 } = {}) {
    if (state.librariesReadyPromise) {
        return state.librariesReadyPromise;
    }

    state.librariesReadyPromise = new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            if (typeof marked !== 'undefined') {
                resolve();
                return;
            }

            if (attempts++ >= maxRetries) {
                resolve();
                return;
            }

            if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
                window.setTimeout(check, interval);
            } else {
                resolve();
            }
        };

        check();
    });

    return state.librariesReadyPromise;
}

function showDiagramStatus(element, type, message, source, variant) {
    const icon = DIAGRAM_ICONS[type] || 'ℹ️';
    const emphasised = variant === 'error' ? `<strong>${escapeHtml(message)}</strong>` : escapeHtml(message);
    const sourceMarkup = source ? `<pre>${escapeHtml(source)}</pre>` : '';
    element.innerHTML = `
        <div class="diagram-loading">
            ${icon} <strong>${escapeHtml(type)}</strong><br>
            ${emphasised}
            ${sourceMarkup}
        </div>
    `;
}

function showDiagramLoading(element, type, source) {
    showDiagramStatus(element, type, `${type} renderer loading…`, source, 'loading');
}

function showDiagramError(element, type, message, source) {
    showDiagramStatus(element, type, `Error: ${message}`, source, 'error');
}

function cleanupExcalidrawRoots(state) {
    state.excalidrawRoots.forEach((record) => {
        try {
            if (record && typeof record.unmount === 'function') {
                record.unmount();
            } else if (record?.root && typeof record.root.unmount === 'function') {
                record.root.unmount();
            }
        } catch (error) {
            console.warn('Failed to unmount Excalidraw root', error);
        }
    });
    state.excalidrawRoots.clear();
}

function scheduleMermaidRetry(context, state) {
    if (state.mermaidRetryTimer || typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
        return;
    }
    state.mermaidRetryTimer = window.setTimeout(() => {
        state.mermaidRetryTimer = null;
        renderMermaidDiagrams(context, state);
    }, 400);
}

function scheduleVegaRetry(context, state) {
    if (state.vegaRetryTimer || typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
        return;
    }
    state.vegaRetryTimer = window.setTimeout(() => {
        state.vegaRetryTimer = null;
        renderVegaVisualizations(context, state);
    }, 400);
}

function scheduleExcalidrawRetry(context, state) {
    if (state.excalidrawRetryTimer || typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
        return;
    }
    state.excalidrawRetryTimer = window.setTimeout(() => {
        state.excalidrawRetryTimer = null;
        renderExcalidrawDiagrams(context, state);
    }, 400);
}

function handleExcalidrawResize(state) {
    state.excalidrawRoots.forEach((record) => {
        if (record?.api) {
            fitExcalidrawToViewport(state, record.api);
        }
    });
}

function ensureExcalidrawResizeHandler(state) {
    if (state.excalidrawResizeHandlerAttached) {
        return;
    }
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    window.addEventListener('resize', () => handleExcalidrawResize(state));
    state.excalidrawResizeHandlerAttached = true;
}

function fitExcalidrawToViewport(state, api) {
    if (!api || typeof api.getSceneElements !== 'function' || typeof api.scrollToContent !== 'function') {
        return;
    }

    let elements;
    try {
        elements = api.getSceneElements();
    } catch (error) {
        console.warn('Failed to read Excalidraw scene elements', error);
        return;
    }

    if (!Array.isArray(elements) || !elements.length) {
        return;
    }

    const visibleElements = elements.filter((item) => item && !item.isDeleted);
    if (!visibleElements.length) {
        return;
    }

    const executeFit = () => {
        try {
            api.scrollToContent(visibleElements, { fitToViewport: true, animate: false });
        } catch (error) {
            if (!state.excalidrawFitFailureLogged) {
                console.warn('Failed to fit Excalidraw content', error);
                state.excalidrawFitFailureLogged = true;
            }
        }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(executeFit);
    } else {
        executeFit();
    }

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(executeFit, 150);
    }
}

function renderMermaidDiagrams(context, state) {
    const content = context?.content;
    if (!content) {
        return;
    }
    const diagrams = content.querySelectorAll('.mermaid[data-mermaid-source]');
    if (!diagrams.length) {
        return;
    }

    if (typeof mermaid === 'undefined' || typeof mermaid.render !== 'function') {
        diagrams.forEach((element) => {
            const source = decodeMermaidSource(state, element.dataset.mermaidSource);
            showDiagramLoading(element, 'Mermaid', source);
        });
        scheduleMermaidRetry(context, state);
        return;
    }

    if (!state.mermaidInitAttempted) {
        try {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'dark',
                securityLevel: 'loose',
            });
        } catch (error) {
            console.warn('Mermaid initialization issue', error);
        }
        state.mermaidInitAttempted = true;
    }

    diagrams.forEach((element, index) => {
        const source = decodeMermaidSource(state, element.dataset.mermaidSource);
        if (!source.trim()) {
            showDiagramError(element, 'Mermaid', 'Diagram source is empty', source);
            return;
        }

        const renderId = `${element.id || 'mermaid-diagram'}-${index}`;
        mermaid
            .render(renderId, source)
            .then(({ svg }) => {
                element.innerHTML = svg;
            })
            .catch((error) => {
                console.error('Mermaid rendering error', error);
                showDiagramError(element, 'Mermaid', error.message, source);
            });
    });
}

function renderVegaVisualizations(context, state) {
    const content = context?.content;
    if (!content) {
        return;
    }

    const diagrams = content.querySelectorAll('.vega-diagram[data-vega-source]');
    if (!diagrams.length) {
        return;
    }

    if (typeof vegaEmbed === 'undefined') {
        diagrams.forEach((element) => {
            const source = decodeVegaSource(state, element.dataset.vegaSource);
            showDiagramLoading(element, 'Vega', source);
        });
        scheduleVegaRetry(context, state);
        return;
    }

    diagrams.forEach((element) => {
        const source = decodeVegaSource(state, element.dataset.vegaSource);
        if (!source.trim()) {
            showDiagramError(element, 'Vega', 'Specification is empty', source);
            return;
        }

        let spec;
        try {
            spec = JSON.parse(source);
        } catch (error) {
            console.error('Vega parsing error', error);
            showDiagramError(element, 'Vega', 'Invalid Vega/Vega-Lite specification', source);
            return;
        }

        element.innerHTML = '';
        vegaEmbed(element, spec, { actions: false, renderer: 'canvas', theme: 'dark' }).catch((error) => {
            console.error('Vega rendering error', error);
            showDiagramError(element, 'Vega', error.message, source);
        });
    });
}

function createExcalidrawViewerUiOptions() {
    return {
        canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveAsImage: false,
            saveScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
            toggleShortcuts: false,
            zoomIn: false,
            zoomOut: false,
            zoomToFit: false,
            resetZoom: false,
            pan: false,
            viewMode: false,
            zenMode: false,
            gridMode: false,
            stats: false,
        },
    };
}

function renderExcalidrawDiagrams(context, state) {
    const content = context?.content;
    if (!content) {
        return;
    }

    const diagrams = content.querySelectorAll('.excalidraw-diagram[data-excalidraw-source]');
    if (!diagrams.length) {
        return;
    }

    if (!window.React || !window.ReactDOM || !window.ExcalidrawLib || !window.ExcalidrawLib.Excalidraw) {
        diagrams.forEach((element) => {
            const source = decodeExcalidrawSource(state, element.dataset.excalidrawSource);
            showDiagramLoading(element, 'Excalidraw', source);
        });
        scheduleExcalidrawRetry(context, state);
        return;
    }

    diagrams.forEach((element) => {
        const source = decodeExcalidrawSource(state, element.dataset.excalidrawSource);
        if (!source.trim()) {
            showDiagramError(element, 'Excalidraw', 'Scene data is empty', source);
            return;
        }

        let sceneData;
        try {
            sceneData = JSON.parse(source);
        } catch (error) {
            console.error('Excalidraw parsing error', error);
            showDiagramError(element, 'Excalidraw', 'Invalid scene JSON', source);
            return;
        }

        const desiredBackground = 'transparent';
        sceneData = {
            ...sceneData,
            appState: {
                ...(sceneData && typeof sceneData === 'object' && sceneData.appState
                    ? sceneData.appState
                    : {}),
                viewBackgroundColor: desiredBackground,
            },
        };

        const existingRoot = state.excalidrawRoots.get(element);
        if (existingRoot && typeof existingRoot.unmount === 'function') {
            try {
                existingRoot.unmount();
            } catch (error) {
                console.warn('Failed to unmount previous Excalidraw root', error);
            }
        }
        state.excalidrawRoots.delete(element);

        element.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'excalidraw-wrapper';
        wrapper.tabIndex = -1;
        element.appendChild(wrapper);

        const record = {
            root: null,
            api: null,
            wrapper,
            unmount() {
                record.api = null;
                if (record.root && typeof record.root.unmount === 'function') {
                    record.root.unmount();
                } else if (typeof window.ReactDOM?.unmountComponentAtNode === 'function') {
                    try {
                        window.ReactDOM.unmountComponentAtNode(wrapper);
                    } catch (error) {
                        console.warn('Failed to unmount Excalidraw instance', error);
                    }
                }
            },
        };

        try {
            const viewerUiOptions = createExcalidrawViewerUiOptions();
            const excalidrawElement = window.React.createElement(window.ExcalidrawLib.Excalidraw, {
                initialData: sceneData,
                viewModeEnabled: true,
                zenModeEnabled: false,
                gridModeEnabled: false,
                theme: 'dark',
                autoFocus: false,
                UIOptions: viewerUiOptions,
                handleKeyboardEvent: () => false,
                ref: (api) => {
                    record.api = api || null;
                    if (api) {
                        state.excalidrawFitFailureLogged = false;
                        ensureExcalidrawResizeHandler(state);
                        fitExcalidrawToViewport(state, api);
                        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
                            window.setTimeout(() => fitExcalidrawToViewport(state, api), 250);
                        }
                    }
                },
            });

            let root;
            if (typeof window.ReactDOM.createRoot === 'function') {
                root = window.ReactDOM.createRoot(wrapper);
                root.render(excalidrawElement);
            } else if (typeof window.ReactDOM.render === 'function') {
                window.ReactDOM.render(excalidrawElement, wrapper);
                root = {
                    unmount() {
                        if (typeof window.ReactDOM.unmountComponentAtNode === 'function') {
                            window.ReactDOM.unmountComponentAtNode(wrapper);
                        }
                    },
                };
            } else {
                throw new Error('ReactDOM renderer is unavailable');
            }

            record.root = root;
            state.excalidrawRoots.set(element, record);
        } catch (error) {
            record.api = null;
            console.error('Excalidraw rendering error', error);
            showDiagramError(element, 'Excalidraw', error.message, source);
        }
    });
}

function renderAllDiagrams(context, state) {
    renderMermaidDiagrams(context, state);
    renderVegaVisualizations(context, state);
    renderExcalidrawDiagrams(context, state);
}

function updateTableOfContents(context, state, headings) {
    const tocList = context?.tocList;
    if (!tocList) {
        return;
    }

    tocList.innerHTML = '';

    if (!Array.isArray(headings) || headings.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'toc-empty-state';
        emptyState.textContent = 'No headings found in this document yet.';
        tocList.appendChild(emptyState);
        return;
    }

    const minLevel = headings.reduce((accumulator, entry) => {
        const level = typeof entry.level === 'number' ? entry.level : 1;
        return Math.min(accumulator, Math.max(1, Math.min(6, level)));
    }, 6);

    const list = document.createElement('ol');
    list.setAttribute('role', 'list');

    headings.forEach((entry) => {
        const level = Math.max(1, Math.min(6, entry.level || 1));
        const item = document.createElement('li');
        item.className = 'toc-entry';

        const link = document.createElement('a');
        link.className = 'toc-link';
        link.href = `#${entry.slug}`;
        link.textContent = entry.text || entry.slug || 'Untitled section';
        link.setAttribute('aria-level', String(level));
        link.dataset.level = String(level);
        const indentLevel = Math.max(0, level - minLevel);
        link.style.paddingLeft = `${10 + indentLevel * 16}px`;
        item.appendChild(link);
        list.appendChild(item);
    });

    tocList.appendChild(list);
}

export function captureHeadingLocations(context, markdownSource) {
    const state = getMarkdownState(context);
    state.headingLocationMap = new Map();

    if (typeof markdownSource !== 'string' || !markdownSource) {
        return;
    }

    const slugCounts = new Map();
    const lines = markdownSource.split(/\r?\n/);

    lines.forEach((line, index) => {
        const match = line.match(/^(#{1,6})\s+(.*)$/);
        if (!match) {
            return;
        }

        const rawHeading = match[2].trim();
        let baseSlug = computeBaseSlug(rawHeading);
        if (!baseSlug) {
            baseSlug = 'heading';
        }

        let slug = baseSlug;
        if (slugCounts.has(baseSlug)) {
            const count = slugCounts.get(baseSlug) + 1;
            slugCounts.set(baseSlug, count);
            slug = `${baseSlug}-${count}`;
        } else {
            slugCounts.set(baseSlug, 0);
        }

        state.headingLocationMap.set(slug, {
            line: index,
            column: 0,
            level: match[1].length,
            text: rawHeading,
        });
    });
}

export function getHeadingLocation(context, slug) {
    const state = getMarkdownState(context);
    return state.headingLocationMap.get(slug);
}

export function renderMarkdown(context, markdownText, options = {}) {
    const state = getMarkdownState(context);
    cleanupExcalidrawRoots(state);
    configureMarked(context, state);

    const currentFile = typeof context?.getCurrentFile === 'function' ? context.getCurrentFile() : null;
    updateRelativeLinkBase(context, state, currentFile);
    state.mermaidIdCounter = 0;
    state.vegaIdCounter = 0;
    state.excalidrawIdCounter = 0;
    state.documentSlugCounts = new Map();

    const sourceText = markdownText || '';
    const updateCurrent = Boolean(options.updateCurrent);
    captureHeadingLocations(context, sourceText);

    const content = context?.content;

    if (typeof marked === 'undefined') {
        state.activeHeadingCollection = null;
        state.pendingMarkdown = sourceText;
        if (content) {
            content.textContent = sourceText;
        }
        updateTableOfContents(context, state, []);
        waitForCoreLibraries(state).then(() => {
            if (state.pendingMarkdown !== null) {
                const textToRender = state.pendingMarkdown;
                state.pendingMarkdown = null;
                renderMarkdown(context, textToRender, { updateCurrent });
            }
        });
        if (updateCurrent && typeof context?.setCurrentContent === 'function') {
            context.setCurrentContent(sourceText);
        }
        return;
    }

    state.activeHeadingCollection = [];
    if (content) {
        content.innerHTML = marked.parse(sourceText);
    } else {
        marked.parse(sourceText);
    }
    const headings = Array.isArray(state.activeHeadingCollection) ? [...state.activeHeadingCollection] : [];
    state.activeHeadingCollection = null;
    state.pendingMarkdown = null;

    if (content && typeof hljs !== 'undefined') {
        content.querySelectorAll('pre code').forEach((block) => {
            if (block.closest('.mermaid, .vega-diagram, .excalidraw-diagram')) {
                return;
            }
            try {
                hljs.highlightElement(block);
            } catch (err) {
                console.warn('Highlight.js error', err);
            }
        });
    }

    updateTableOfContents(context, state, headings);
    renderAllDiagrams(context, state);

    if (updateCurrent && typeof context?.setCurrentContent === 'function') {
        context.setCurrentContent(sourceText);
    }
}
