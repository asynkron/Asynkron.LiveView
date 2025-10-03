export function setupMarkdown(ctx) {
    const {
        dom: {
            content,
            tocList,
            rootElement,
        },
    } = ctx;

    const DIAGRAM_ICONS = {
        Mermaid: '📊',
        Vega: '📈',
        Excalidraw: '✏️',
    };

    function updateRelativeLinkBase(filePath) {
        if (typeof filePath !== 'string' || filePath.length === 0) {
            ctx.relativeLinksEnabled = false;
            ctx.relativeLinkBasePath = '';
            ctx.relativeLinkBaseWalker = null;
            return;
        }

        ctx.relativeLinksEnabled = true;
        const lastSlashIndex = filePath.lastIndexOf('/');
        ctx.relativeLinkBasePath = lastSlashIndex === -1 ? '' : filePath.slice(0, lastSlashIndex + 1);

        if (typeof markedBaseUrl !== 'undefined' && markedBaseUrl && typeof markedBaseUrl.baseUrl === 'function') {
            const baseCandidate = ctx.relativeLinkBasePath || './';
            try {
                ctx.relativeLinkBaseWalker = markedBaseUrl.baseUrl(baseCandidate);
            } catch (error) {
                console.warn('Failed to initialise marked-base-url', error);
                ctx.relativeLinkBaseWalker = null;
            }
        } else {
            ctx.relativeLinkBaseWalker = null;
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

    function fallbackResolveRelativeHref(href) {
        try {
            const baseReference = ctx.relativeLinkBasePath ? ctx.relativeLinkBasePath : '.';
            const baseUrl = new URL(baseReference, ctx.relativeLinkDummyOrigin);
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

    function transformRelativeAsset(rawHref, tokenType) {
        if (!ctx.relativeLinksEnabled || typeof rawHref !== 'string') {
            return null;
        }

        const trimmedHref = rawHref.trim();
        if (
            !trimmedHref ||
            trimmedHref.startsWith('#') ||
            ctx.relativeLinkProtocolRelativePattern.test(trimmedHref) ||
            ctx.relativeLinkSchemePattern.test(trimmedHref) ||
            trimmedHref.startsWith('/')
        ) {
            return null;
        }

        let resolvedHref = trimmedHref;
        const walker = ctx.relativeLinkBaseWalker;

        if (walker && typeof walker.walkTokens === 'function') {
            const tempToken = { type: tokenType, href: trimmedHref };
            try {
                walker.walkTokens(tempToken);
                resolvedHref = tempToken.href;
            } catch (error) {
                console.warn('marked-base-url resolution failed', error);
                resolvedHref = fallbackResolveRelativeHref(trimmedHref);
            }
        } else {
            resolvedHref = fallbackResolveRelativeHref(trimmedHref);
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

    const relativeLinkExtension = {
        walkTokens(token) {
            if (!token || typeof token.href !== 'string') {
                return;
            }

            if (token.type === 'image') {
                const asset = transformRelativeAsset(token.href, 'image');
                if (asset && asset.assetHref) {
                    token.href = asset.assetHref;
                }
                return;
            }

            if (token.type !== 'link') {
                return;
            }

            const result = transformRelativeAsset(token.href, 'link');
            if (!result || !result.fileTarget) {
                return;
            }

            const basePathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
            const query = ctx.buildQuery({ file: result.fileTarget });
            token.href = `${basePathname}${query}${result.hash || ''}`;
        },
    };

    function getCssNumber(variableName, fallback) {
        if (typeof variableName !== 'string' || !variableName) {
            return typeof fallback === 'number' ? fallback : 0;
        }

        try {
            const computed = getComputedStyle(rootElement).getPropertyValue(variableName);
            const parsed = Number.parseFloat(computed);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        } catch (error) {
            console.warn('Failed to read CSS variable', variableName, error);
        }

        return typeof fallback === 'number' ? fallback : 0;
    }

    function encodeDiagramSource(code) {
        if (!code) {
            return '';
        }
        const bytes = ctx.textEncoder.encode(code);
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    function decodeDiagramSource(encoded, label = 'diagram') {
        if (!encoded) {
            return '';
        }
        try {
            const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            return ctx.textDecoder.decode(bytes);
        } catch (error) {
            console.warn(`Failed to decode ${label} source`, error);
            return '';
        }
    }

    function encodeMermaidSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeMermaidSource(encoded) {
        return decodeDiagramSource(encoded, 'Mermaid');
    }

    function encodeVegaSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeVegaSource(encoded) {
        return decodeDiagramSource(encoded, 'Vega');
    }

    function encodeExcalidrawSource(code) {
        return encodeDiagramSource(code);
    }

    function decodeExcalidrawSource(encoded) {
        return decodeDiagramSource(encoded, 'Excalidraw');
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

    function waitForCoreLibraries(maxRetries = 80, interval = 100) {
        if (ctx.librariesReadyPromise) {
            return ctx.librariesReadyPromise;
        }

        ctx.librariesReadyPromise = new Promise((resolve) => {
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

                window.setTimeout(check, interval);
            };

            check();
        });

        return ctx.librariesReadyPromise;
    }

    function cleanupExcalidrawRoots() {
        ctx.excalidrawRoots.forEach((record) => {
            try {
                if (record && typeof record.unmount === 'function') {
                    record.unmount();
                } else if (record && record.root && typeof record.root.unmount === 'function') {
                    record.root.unmount();
                }
            } catch (error) {
                console.warn('Failed to unmount Excalidraw root', error);
            }
        });
        ctx.excalidrawRoots.clear();
    }

    function scheduleMermaidRetry() {
        if (ctx.mermaidRetryTimer) {
            return;
        }
        ctx.mermaidRetryTimer = window.setTimeout(() => {
            ctx.mermaidRetryTimer = null;
            renderMermaidDiagrams();
        }, 400);
    }

    function scheduleVegaRetry() {
        if (ctx.vegaRetryTimer) {
            return;
        }
        ctx.vegaRetryTimer = window.setTimeout(() => {
            ctx.vegaRetryTimer = null;
            renderVegaVisualizations();
        }, 400);
    }

    function scheduleExcalidrawRetry() {
        if (ctx.excalidrawRetryTimer) {
            return;
        }
        ctx.excalidrawRetryTimer = window.setTimeout(() => {
            ctx.excalidrawRetryTimer = null;
            renderExcalidrawDiagrams();
        }, 400);
    }

    function handleExcalidrawResize() {
        ctx.excalidrawRoots.forEach((record) => {
            if (record && record.api) {
                fitExcalidrawToViewport(record.api);
            }
        });
    }

    function ensureExcalidrawResizeHandler() {
        if (ctx.excalidrawResizeHandlerAttached) {
            return;
        }
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
            return;
        }
        window.addEventListener('resize', handleExcalidrawResize);
        ctx.excalidrawResizeHandlerAttached = true;
    }

    function fitExcalidrawToViewport(api) {
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
                if (!ctx.excalidrawFitFailureLogged) {
                    console.warn('Failed to fit Excalidraw content', error);
                    ctx.excalidrawFitFailureLogged = true;
                }
            }
        };

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(executeFit);
        } else {
            executeFit();
        }

        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
            window.setTimeout(() => {
                ctx.excalidrawFitFailureLogged = false;
                executeFit();
            }, 120);
        }
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

    function renderMermaidDiagrams() {
        if (!content) {
            return;
        }

        const diagrams = content.querySelectorAll('.mermaid[data-mermaid-source]');
        if (!diagrams.length) {
            return;
        }

        if (typeof mermaid === 'undefined') {
            diagrams.forEach((element) => {
                const source = decodeMermaidSource(element.dataset.mermaidSource);
                showDiagramLoading(element, 'Mermaid', source);
            });
            scheduleMermaidRetry();
            return;
        }

        if (!ctx.mermaidInitAttempted) {
            try {
                mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
            } catch (error) {
                console.warn('Mermaid initialisation failed', error);
            }
            ctx.mermaidInitAttempted = true;
        }

        diagrams.forEach((element) => {
            const source = decodeMermaidSource(element.dataset.mermaidSource);
            if (!source.trim()) {
                showDiagramError(element, 'Mermaid', 'Diagram source is empty', source);
                return;
            }

            try {
                mermaid.render(`mermaid-${element.id}`, source, (svgCode) => {
                    element.innerHTML = svgCode;
                }, element);
            } catch (error) {
                console.error('Mermaid rendering error', error);
                showDiagramError(element, 'Mermaid', error.message, source);
            }
        });
    }

    function renderVegaVisualizations() {
        if (!content) {
            return;
        }

        const diagrams = content.querySelectorAll('.vega-diagram[data-vega-source]');
        if (!diagrams.length) {
            return;
        }

        if (typeof vegaEmbed === 'undefined') {
            diagrams.forEach((element) => {
                const source = decodeVegaSource(element.dataset.vegaSource);
                showDiagramLoading(element, 'Vega', source);
            });
            scheduleVegaRetry();
            return;
        }

        diagrams.forEach((element) => {
            const source = decodeVegaSource(element.dataset.vegaSource);
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

    function renderExcalidrawDiagrams() {
        if (!content) {
            return;
        }

        const diagrams = content.querySelectorAll('.excalidraw-diagram[data-excalidraw-source]');
        if (!diagrams.length) {
            return;
        }

        if (
            !window.React ||
            !window.ReactDOM ||
            !window.ExcalidrawLib ||
            !window.ExcalidrawLib.Excalidraw
        ) {
            diagrams.forEach((element) => {
                const source = decodeExcalidrawSource(element.dataset.excalidrawSource);
                showDiagramLoading(element, 'Excalidraw', source);
            });
            scheduleExcalidrawRetry();
            return;
        }

        diagrams.forEach((element) => {
            const source = decodeExcalidrawSource(element.dataset.excalidrawSource);
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

            const existingRoot = ctx.excalidrawRoots.get(element);
            if (existingRoot && typeof existingRoot.unmount === 'function') {
                try {
                    existingRoot.unmount();
                } catch (error) {
                    console.warn('Failed to unmount previous Excalidraw root', error);
                }
            }
            ctx.excalidrawRoots.delete(element);

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
                    } else if (
                        typeof window.ReactDOM !== 'undefined' &&
                        typeof window.ReactDOM.unmountComponentAtNode === 'function'
                    ) {
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
                            ctx.excalidrawFitFailureLogged = false;
                            ensureExcalidrawResizeHandler();
                            fitExcalidrawToViewport(api);
                            if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
                                window.setTimeout(() => fitExcalidrawToViewport(api), 250);
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
                ctx.excalidrawRoots.set(element, record);
            } catch (error) {
                record.api = null;
                console.error('Excalidraw rendering error', error);
                showDiagramError(element, 'Excalidraw', error.message, source);
            }
        });
    }

    function renderAllDiagrams() {
        renderMermaidDiagrams();
        renderVegaVisualizations();
        renderExcalidrawDiagrams();
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

    function createSlug(text) {
        let slug = computeBaseSlug(text);

        if (!slug) {
            slug = 'heading';
        }

        if (ctx.documentSlugCounts) {
            if (ctx.documentSlugCounts.has(slug)) {
                const count = ctx.documentSlugCounts.get(slug) + 1;
                ctx.documentSlugCounts.set(slug, count);
                return `${slug}-${count}`;
            }

            ctx.documentSlugCounts.set(slug, 0);
        }

        return slug;
    }

    function captureHeadingLocations(markdownSource) {
        ctx.headingLocationMap = new Map();

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

            ctx.headingLocationMap.set(slug, {
                line: index,
                column: 0,
                level: match[1].length,
                text: rawHeading,
            });
        });
    }

    function clearEditorHeadingHighlight() {
        if (!ctx.editorInstance || ctx.headingHighlightLine === null) {
            ctx.headingHighlightLine = null;
            return;
        }

        try {
            ctx.editorInstance.removeLineClass(ctx.headingHighlightLine, 'background', 'heading-target-line');
        } catch (error) {
            console.warn('Failed to remove heading highlight', error);
        }

        ctx.headingHighlightLine = null;
    }

    function highlightEditorLine(lineNumber) {
        const editor = ctx.ensureEditorInstance ? ctx.ensureEditorInstance() : null;
        if (!editor || typeof editor.addLineClass !== 'function') {
            return;
        }

        if (ctx.headingHighlightTimeout) {
            window.clearTimeout(ctx.headingHighlightTimeout);
            ctx.headingHighlightTimeout = null;
        }

        if (ctx.headingHighlightLine !== null) {
            try {
                editor.removeLineClass(ctx.headingHighlightLine, 'background', 'heading-target-line');
            } catch (error) {
                console.warn('Failed to clear previous heading highlight', error);
            }
        }

        try {
            editor.addLineClass(lineNumber, 'background', 'heading-target-line');
            ctx.headingHighlightLine = lineNumber;
        } catch (error) {
            console.warn('Failed to apply heading highlight', error);
            ctx.headingHighlightLine = null;
            return;
        }

        ctx.headingHighlightTimeout = window.setTimeout(() => {
            const instance = ctx.ensureEditorInstance ? ctx.ensureEditorInstance() : null;
            if (instance && ctx.headingHighlightLine !== null) {
                try {
                    instance.removeLineClass(ctx.headingHighlightLine, 'background', 'heading-target-line');
                } catch (error) {
                    console.warn('Failed to remove heading highlight after delay', error);
                }
            }
            ctx.headingHighlightLine = null;
            ctx.headingHighlightTimeout = null;
        }, 2000);
    }

    function handleHeadingActionClick(event) {
        const button = event.target.closest('.heading-action-button');
        if (!button || !content || !content.contains(button)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const action = button.dataset.headingAction;
        const slug = button.dataset.headingSlug;

        if (!slug) {
            return;
        }

        if (action === 'edit') {
            jumpToHeadingInEditor(slug);
            return;
        }

        if (action === 'copy') {
            copyHeadingLink(slug);
        }
    }

    function copyTextFallback(text, { onSuccess, onFailure } = {}) {
        if (!text) {
            if (typeof onFailure === 'function') {
                onFailure(new Error('Nothing to copy'));
            }
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        let succeeded = false;
        let lastError = null;
        try {
            succeeded = document.execCommand('copy');
        } catch (error) {
            lastError = error;
        }

        document.body.removeChild(textarea);

        if (succeeded) {
            if (typeof onSuccess === 'function') {
                onSuccess();
            }
            return;
        }

        if (typeof onFailure === 'function') {
            onFailure(lastError);
        }
    }

    function copyHeadingLink(slug) {
        if (!slug) {
            return;
        }

        const basePathname = window.location ? window.location.pathname : '';
        const query = ctx.buildQuery({ file: ctx.currentFile || '' });
        const url = `${basePathname}${query}#${slug}`;

        const onSuccess = () => ctx.setStatus('Heading link copied to clipboard.');
        const onFailure = (error) => {
            console.warn('Clipboard API failed, using fallback', error);
            copyTextFallback(url, {
                onSuccess,
                onFailure: () => ctx.setStatus('Unable to copy heading link automatically.'),
            });
        };

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(url).then(onSuccess).catch(onFailure);
        } else {
            copyTextFallback(url, { onSuccess, onFailure: () => ctx.setStatus('Unable to copy heading link automatically.') });
        }
    }

    function jumpToHeadingInEditor(slug) {
        if (!slug) {
            return;
        }

        if (!ctx.currentFile) {
            ctx.setStatus('Open a markdown file to edit sections.');
            return;
        }

        const focusEditorOnHeading = () => {
            const editor = ctx.ensureEditorInstance ? ctx.ensureEditorInstance() : null;
            if (!editor) {
                ctx.setStatus('Editor resources are still loading. Please try again in a moment.');
                return;
            }

            let location = ctx.headingLocationMap.get(slug);
            if (!location) {
                const source = typeof editor.getValue === 'function' ? editor.getValue() : ctx.currentContent;
                captureHeadingLocations(source);
                location = ctx.headingLocationMap.get(slug);
            }

            if (!location) {
                ctx.setStatus('Unable to locate this section in the editor.');
                return;
            }

            const targetPosition = { line: location.line, ch: location.column || 0 };

            editor.operation(() => {
                editor.setCursor(targetPosition);
                const bottomLine = Math.min(editor.lineCount() - 1, targetPosition.line + 5);
                editor.scrollIntoView({ from: targetPosition, to: { line: bottomLine, ch: 0 } }, 200);
                editor.focus();
            });

            highlightEditorLine(location.line);
            ctx.setStatus('Jumped to section in editor.');
        };

        if (!ctx.isEditing) {
            ctx.enterEditMode?.();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        if (ctx.isPreviewing) {
            ctx.returnToCodeMode?.();
            window.setTimeout(focusEditorOnHeading, 120);
            return;
        }

        focusEditorOnHeading();
    }

    function configureMarked() {
        if (typeof marked === 'undefined' || ctx.markedConfigured) {
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
                    const id = `mermaid-diagram-${ctx.mermaidIdCounter++}`;
                    const encodedSource = encodeMermaidSource(source);
                    const mermaidHtml = `<div class="mermaid" id="${id}" data-mermaid-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = mermaidHtml;
                    token.text = mermaidHtml;
                    return;
                }

                if (language.includes('vega-lite') || language === 'vega') {
                    const id = `vega-diagram-${ctx.vegaIdCounter++}`;
                    const encodedSource = encodeVegaSource(source);
                    const vegaHtml = `<div class="vega-diagram" id="${id}" data-vega-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = vegaHtml;
                    token.text = vegaHtml;
                    return;
                }

                if (language.includes('excalidraw')) {
                    const id = `excalidraw-diagram-${ctx.excalidrawIdCounter++}`;
                    const encodedSource = encodeExcalidrawSource(source);
                    const excalidrawHtml = `<div class="excalidraw-diagram" id="${id}" data-excalidraw-source="${encodedSource}"></div>`;
                    token.type = 'html';
                    token.raw = excalidrawHtml;
                    token.text = excalidrawHtml;
                    return;
                }
            },
            renderer: {
                heading(text, level, raw, slugger) {
                    const slug = slugger.slug(raw);
                    const headingText = normaliseHeadingText(text, raw);
                    if (Array.isArray(ctx.activeHeadingCollection)) {
                        ctx.activeHeadingCollection.push({ slug, level, text: headingText });
                    }
                    return `
                        <h${level} id="${slug}">
                            <span class="heading-text">${text}</span>
                            <a class="heading-anchor" href="#${slug}" aria-label="Link to heading"></a>
                            <span class="heading-actions">
                                <button class="heading-action-button" data-heading-action="copy" data-heading-slug="${slug}">
                                    <i class="fa fa-link" aria-hidden="true"></i>
                                    Copy link
                                </button>
                                <button class="heading-action-button" data-heading-action="edit" data-heading-slug="${slug}">
                                    <i class="fa fa-pen" aria-hidden="true"></i>
                                    Edit section
                                </button>
                            </span>
                        </h${level}>
                    `;
                },
            },
        });

        if (!ctx.relativeLinkExtensionRegistered) {
            marked.use(relativeLinkExtension);
            ctx.relativeLinkExtensionRegistered = true;
        }

        ctx.markedConfigured = true;
    }

    function updateTableOfContents(headings) {
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

    function renderMarkdown(markdownText, options = {}) {
        cleanupExcalidrawRoots();
        configureMarked();
        updateRelativeLinkBase(ctx.currentFile);
        ctx.mermaidIdCounter = 0;
        ctx.vegaIdCounter = 0;
        ctx.excalidrawIdCounter = 0;

        ctx.documentSlugCounts = new Map();

        const sourceText = markdownText || '';
        const updateCurrent = Boolean(options.updateCurrent);
        captureHeadingLocations(sourceText);

        if (typeof marked === 'undefined') {
            ctx.activeHeadingCollection = null;
            ctx.pendingMarkdown = sourceText;
            if (content) {
                content.textContent = sourceText;
            }
            updateTableOfContents([]);
            waitForCoreLibraries().then(() => {
                if (ctx.pendingMarkdown !== null) {
                    const textToRender = ctx.pendingMarkdown;
                    ctx.pendingMarkdown = null;
                    renderMarkdown(textToRender, { updateCurrent });
                }
            });
            if (updateCurrent) {
                ctx.currentContent = sourceText;
            }
            return;
        }

        ctx.activeHeadingCollection = [];
        if (content) {
            content.innerHTML = marked.parse(sourceText);
        }
        const headings = Array.isArray(ctx.activeHeadingCollection) ? [...ctx.activeHeadingCollection] : [];
        ctx.activeHeadingCollection = null;
        ctx.pendingMarkdown = null;

        if (typeof hljs !== 'undefined' && content) {
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

        updateTableOfContents(headings);
        renderAllDiagrams();
        if (updateCurrent) {
            ctx.currentContent = sourceText;
        }
    }

    function handleTocClick(event) {
        const link = event.target.closest('a.toc-link');
        if (!link) {
            return;
        }

        const hash = link.getAttribute('href');
        if (typeof hash !== 'string' || !hash.startsWith('#')) {
            return;
        }

        const targetId = hash.slice(1);
        if (!targetId) {
            return;
        }

        const targetElement = document.getElementById(targetId);
        if (!targetElement) {
            return;
        }

        event.preventDefault();

        try {
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            targetElement.scrollIntoView();
        }

        if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
            const newUrl = `${window.location.pathname}${window.location.search}#${targetId}`;
            history.replaceState(history.state, '', newUrl);
        }
    }

    if (content) {
        content.addEventListener('click', handleHeadingActionClick);
    }

    if (tocList) {
        tocList.addEventListener('click', handleTocClick);
    }

    ctx.updateRelativeLinkBase = updateRelativeLinkBase;
    ctx.configureMarked = configureMarked;
    ctx.captureHeadingLocations = captureHeadingLocations;
    ctx.clearEditorHeadingHighlight = clearEditorHeadingHighlight;
    ctx.highlightEditorLine = highlightEditorLine;
    ctx.copyHeadingLink = copyHeadingLink;
    ctx.jumpToHeadingInEditor = jumpToHeadingInEditor;
    ctx.renderMarkdown = renderMarkdown;
    ctx.updateTableOfContents = updateTableOfContents;
    ctx.renderAllDiagrams = renderAllDiagrams;
    ctx.waitForCoreLibraries = waitForCoreLibraries;
    ctx.getCssNumber = getCssNumber;
}
