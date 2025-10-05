import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createRouter, __test__ } from '../../src/js/app/router.js';

function createWindowStub() {
    const listeners = new Map();
    const historyCalls = {
        push: [],
        replace: [],
    };

    const windowRef = {
        location: {
            pathname: '/viewer',
            search: '',
        },
        history: {
            pushState(state, _title, url) {
                historyCalls.push.push({ state, url });
                windowRef.location.search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            },
            replaceState(state, _title, url) {
                historyCalls.replace.push({ state, url });
                windowRef.location.search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
            },
        },
        addEventListener(name, handler) {
            listeners.set(name, handler);
        },
        removeEventListener(name) {
            listeners.delete(name);
        },
        getListener(name) {
            return listeners.get(name);
        },
        historyCalls,
    };

    return windowRef;
}

let appState;
let windowRef;
let lastNavigate;
let lastFallback;

beforeEach(() => {
    appState = { originalPathArgument: '/docs' };
    windowRef = createWindowStub();
    lastNavigate = null;
    lastFallback = null;
});

test('buildQuery preserves original path argument', () => {
    const router = createRouter({
        appState,
        windowRef,
        getCurrentFile: () => null,
        onNavigate: () => {},
        onFallback: () => {},
    });

    assert.equal(router.buildQuery({}), '?path=%2Fdocs');
    assert.equal(router.buildQuery({ file: 'README.md' }), '?path=%2Fdocs&file=README.md');
    router.dispose();
});

test('push and replace update history with state payload', () => {
    const router = createRouter({
        appState,
        windowRef,
        getCurrentFile: () => null,
    });

    router.push('README.md');
    assert.equal(windowRef.historyCalls.push.length, 1);
    assert.deepEqual(windowRef.historyCalls.push[0], {
        state: { file: 'README.md' },
        url: '/viewer?path=%2Fdocs&file=README.md',
    });

    router.replace('NOTES.md');
    assert.equal(windowRef.historyCalls.replace.length, 1);
    assert.deepEqual(windowRef.historyCalls.replace[0], {
        state: { file: 'NOTES.md' },
        url: '/viewer?path=%2Fdocs&file=NOTES.md',
    });

    router.dispose();
});

test('getCurrent reads from search string', () => {
    windowRef.location.search = '?file= notes.md ';
    const router = createRouter({ appState, windowRef });
    assert.equal(router.getCurrent(), 'notes.md');
    assert.equal(__test__.fileFromSearch('?file='), '');
    router.dispose();
});

test('popstate triggers navigation callbacks', () => {
    const router = createRouter({
        appState,
        windowRef,
        getCurrentFile: () => 'README.md',
        onNavigate: (file, options) => {
            lastNavigate = { file, options };
        },
        onFallback: (options) => {
            lastFallback = options;
        },
    });

    windowRef.location.search = '?file=notes.md';
    windowRef.getListener('popstate')();
    assert.deepEqual(lastNavigate, {
        file: 'notes.md',
        options: { skipHistory: true, replaceHistory: true },
    });

    windowRef.location.search = '';
    windowRef.getListener('popstate')();
    assert.deepEqual(lastFallback, { skipHistory: true });

    router.dispose();
});
