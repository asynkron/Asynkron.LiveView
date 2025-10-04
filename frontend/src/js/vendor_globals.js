import { marked } from 'marked';
import { baseUrl as markedBaseUrlFn } from 'marked-base-url';
import hljs from 'highlight.js/lib/common';
import mermaid from 'mermaid';
import * as dockview from 'dockview';
import React from 'react';
import * as ReactDOMLegacy from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ExcalidrawLib from '@excalidraw/excalidraw';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import * as vega from 'vega';
import * as vegaLite from 'vega-lite';
import vegaEmbed from 'vega-embed';
import CodeMirror from 'codemirror';
import 'codemirror/mode/markdown/markdown';
import * as svelte from 'svelte';
import * as svelteCompiler from 'svelte/compiler';
import * as svelteInternal from 'svelte/internal';

const globalScope = typeof window !== 'undefined' ? window : globalThis;
if (!globalScope) {
    throw new Error('Unable to determine global scope for vendor initialisation');
}

const reactDomCombined = { ...ReactDOMLegacy, ...ReactDOMClient };

Object.assign(globalScope, {
    marked,
    markedBaseUrl: { baseUrl: markedBaseUrlFn },
    hljs,
    mermaid,
    dockview,
    React,
    ReactDOM: { ...(globalScope.ReactDOM || {}), ...reactDomCombined },
    ExcalidrawLib,
    Terminal,
    FitAddon: { FitAddon },
    vega,
    vegaLite,
    vegaEmbed,
    CodeMirror,
    svelte,
    svelteCompiler,
    svelteInternal,
});
