import './vendor_globals.js';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
const { marked, hljs, mermaid, vegaEmbed } = globalScope;
const reactGlobal = globalScope.React;
const reactDomGlobal = globalScope.ReactDOM;
const excalidrawGlobal = globalScope.ExcalidrawLib;
const svelteCompilerGlobal = globalScope.svelteCompiler;
const svelteInternalGlobal = globalScope.svelteInternal;

window.addEventListener('DOMContentLoaded', () => {
    const data = globalScope.__PRINT_DATA__ || {};
    const container = document.getElementById('content');
    const titleEl = document.getElementById('print-title');
    const metaEl = document.getElementById('print-meta');
    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();
    let mermaidIdCounter = 0;
    let vegaIdCounter = 0;
    let excalidrawIdCounter = 0;
    let svelteIdCounter = 0;
    const svelteInstances = new Map();

    const vegaLightBaseConfig = {
        background: '#ffffff',
        view: { stroke: '#d0d7de' },
        axis: {
            gridColor: '#e1e4e8',
            tickColor: '#8c959f',
            domainColor: '#d0d7de',
            labelColor: '#1f2328',
            titleColor: '#1f2328',
        },
        legend: {
            labelColor: '#1f2328',
            titleColor: '#1f2328',
        },
        header: {
            labelColor: '#1f2328',
            titleColor: '#1f2328',
        },
        title: {
            color: '#0f172a',
        },
        range: {
            category: ['#0969da', '#cf222e', '#8250df', '#1a7f37', '#bf3989', '#d4a72c', '#218bff', '#f78166'],
        },
    };

    if (data.fileName) {
        document.title = `${data.fileName} · Print View`;
        titleEl.textContent = data.fileName;
    }

    if (data.directory || data.modified) {
        const parts = [];
        if (data.directory) {
            parts.push(`Directory: ${data.directory}`);
        }
        if (data.modified) {
            try {
                const date = new Date(data.modified);
                parts.push(`Last updated: ${date.toLocaleString()}`);
            } catch (error) {
                parts.push(`Last updated: ${data.modified}`);
            }
        }
        metaEl.textContent = parts.join(' · ');
    }

    const escapeHtml = (value) =>
        String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    function encodeDiagramSource(code) {
        const bytes = textEncoder.encode(code);
        let binary = '';
        bytes.forEach((byte) => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    function decodeDiagramSource(encoded, label) {
        if (!encoded) {
            return '';
        }

        try {
            const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            return textDecoder.decode(bytes);
        } catch (error) {
            console.warn(`Failed to decode ${label} source`, error);
            return '';
        }
    }

    function renderMermaidDiagrams() {
        if (typeof mermaid === 'undefined' || typeof mermaid.render !== 'function') {
            return;
        }

        const diagrams = container.querySelectorAll('.mermaid[data-mermaid-source]');
        diagrams.forEach((element, index) => {
            const source = decodeDiagramSource(element.dataset.mermaidSource, 'mermaid');
            const renderId = `${element.id || 'mermaid-diagram'}-${index}`;
            mermaid
                .render(renderId, source)
                .then(({ svg }) => {
                    element.innerHTML = svg;
                })
                .catch((error) => {
                    element.innerHTML = `<div class="loading">Failed to render mermaid diagram: ${escapeHtml(error?.message || error)}</div>`;
                });
        });
    }

    function renderVegaDiagrams() {
        if (typeof vegaEmbed === 'undefined') {
            return;
        }

        const diagrams = container.querySelectorAll('.vega-diagram[data-vega-source]');
        diagrams.forEach((element) => {
            const source = decodeDiagramSource(element.dataset.vegaSource, 'vega');
            if (!source) {
                element.innerHTML = '<div class="loading">Missing Vega specification.</div>';
                return;
            }

            try {
                const spec = JSON.parse(source);
                const config = spec.$schema && typeof spec.$schema === 'string' && spec.$schema.includes('vega-lite')
                    ? { config: vegaLightBaseConfig }
                    : {};
                vegaEmbed(element, spec, { actions: false, renderer: 'canvas', ...config }).catch((error) => {
                    element.innerHTML = `<div class="loading">Failed to render Vega diagram: ${escapeHtml(error?.message || error)}</div>`;
                });
            } catch (error) {
                element.innerHTML = `<div class="loading">Failed to parse Vega specification: ${escapeHtml(error?.message || error)}</div>`;
            }
        });
    }

    function renderExcalidrawDiagrams() {
        if (!reactGlobal || !reactDomGlobal || !excalidrawGlobal) {
            return;
        }

        const diagrams = container.querySelectorAll('.excalidraw-diagram[data-excalidraw-source]');
        diagrams.forEach((element) => {
            const source = decodeDiagramSource(element.dataset.excalidrawSource, 'Excalidraw');
            if (!source) {
                element.innerHTML = '<div class="loading">Missing Excalidraw diagram.</div>';
                return;
            }

            let data;
            try {
                data = JSON.parse(source);
            } catch (error) {
                element.innerHTML = `<div class="loading">Failed to parse Excalidraw data: ${escapeHtml(error?.message || error)}</div>`;
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'excalidraw-wrapper';
            element.appendChild(wrapper);

            const excalidrawElement = reactGlobal.createElement(excalidrawGlobal.Excalidraw, {
                excalidrawAPI: (api) => {
                    if (typeof api?.updateScene === 'function') {
                        api.updateScene({ elements: data.elements || [], appState: data.appState || {}, files: data.files || {} });
                    }
                },
                renderTopRightUI: () => null,
                renderFooter: () => null,
                viewModeEnabled: true,
                zenModeEnabled: false,
                gridModeEnabled: false,
            });

            if (typeof reactDomGlobal.createRoot === 'function') {
                const root = reactDomGlobal.createRoot(wrapper);
                root.render(excalidrawElement);
            } else if (typeof reactDomGlobal.render === 'function') {
                reactDomGlobal.render(excalidrawElement, wrapper);
            } else {
                element.innerHTML = '<div class="loading">React renderer is unavailable.</div>';
            }
        });
    }

    function renderSvelteComponents() {
        if (!svelteCompilerGlobal || !svelteInternalGlobal) {
            return;
        }

        const components = container.querySelectorAll('.svelte-component[data-svelte-source]');
        components.forEach((element) => {
            const source = decodeDiagramSource(element.dataset.svelteSource, 'Svelte');
            if (!source || !source.trim()) {
                element.innerHTML = '<div class="loading">Missing Svelte component source.</div>';
                return;
            }

            const existingInstance = svelteInstances.get(element);
            if (existingInstance && typeof existingInstance.$destroy === 'function') {
                try {
                    existingInstance.$destroy();
                } catch (error) {
                    console.warn('Failed to destroy previous Svelte instance', error);
                }
            }
            svelteInstances.delete(element);

            element.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.className = 'svelte-wrapper';
            element.appendChild(wrapper);

            try {
                const compiled = svelteCompilerGlobal.compile(source, {
                    dev: false,
                    css: 'injected',
                    generate: 'dom',
                });

                let componentCode = compiled.js.code;
                
                componentCode = componentCode.replace(
                    /import\s+"svelte\/internal\/disclose-version";?/g,
                    ''
                );
                
                componentCode = componentCode.replace(
                    /import\s+{([^}]+)}\s+from\s+"svelte\/internal";?/g,
                    (match, imports) => {
                        const importList = imports.split(/,\s*\n\s*|\s*,\s*/).map(i => i.trim()).filter(i => i);
                        const declarations = importList.map(name => `const ${name} = window.svelteInternal.${name};`);
                        return declarations.join('\n');
                    }
                );
                
                componentCode = componentCode.replace(
                    /export default class/g,
                    'return class'
                );
                componentCode = componentCode.replace(
                    /export default/g,
                    'return'
                );
                
                const wrappedCode = `(function() {\n${componentCode}\n})()`;
                
                const ComponentClass = eval(wrappedCode);
                const instance = new ComponentClass({
                    target: wrapper,
                    props: {},
                });
                svelteInstances.set(element, instance);
            } catch (error) {
                console.error('Svelte rendering error', error);
                element.innerHTML = `<div class="loading">Failed to render Svelte component: ${escapeHtml(error?.message || error)}</div>`;
            }
        });
    }

    const markdown = data.content || '';

    if (typeof marked !== 'undefined') {
        marked.setOptions({
            highlight(code, lang) {
                if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (error) {
                        console.warn('Failed to highlight code block', error);
                    }
                }
                if (typeof hljs !== 'undefined') {
                    try {
                        return hljs.highlightAuto(code).value;
                    } catch (error) {
                        console.warn('Failed to auto-highlight code block', error);
                    }
                }
                return code;
            },
        });

        const renderer = new marked.Renderer();
        const originalCode = renderer.code.bind(renderer);
        renderer.code = (code, language) => {
            if ((language || '').includes('mermaid')) {
                const id = `mermaid-diagram-${mermaidIdCounter++}`;
                const encoded = encodeDiagramSource(code);
                return `<div class="mermaid" id="${id}" data-mermaid-source="${encoded}"></div>`;
            }
            if ((language || '').includes('vega-lite') || language === 'vega') {
                const id = `vega-diagram-${vegaIdCounter++}`;
                const encoded = encodeDiagramSource(code);
                return `<div class="vega-diagram" id="${id}" data-vega-source="${encoded}"></div>`;
            }
            if ((language || '').includes('excalidraw')) {
                const id = `excalidraw-diagram-${excalidrawIdCounter++}`;
                const encoded = encodeDiagramSource(code);
                return `<div class="excalidraw-diagram" id="${id}" data-excalidraw-source="${encoded}"></div>`;
            }
            if ((language || '').includes('svelte')) {
                const id = `svelte-component-${svelteIdCounter++}`;
                const encoded = encodeDiagramSource(code);
                return `<div class="svelte-component" id="${id}" data-svelte-source="${encoded}"></div>`;
            }
            return originalCode(code, language);
        };

        const html = marked.parse(markdown, { renderer });
        container.innerHTML = html;
    } else {
        container.textContent = markdown;
    }

    if (typeof hljs !== 'undefined') {
        container.querySelectorAll('pre code').forEach((block) => {
            try {
                hljs.highlightElement(block);
            } catch (error) {
                console.warn('Failed to highlight block', error);
            }
        });
    }

    renderMermaidDiagrams();
    renderVegaDiagrams();
    renderExcalidrawDiagrams();
    renderSvelteComponents();
});
