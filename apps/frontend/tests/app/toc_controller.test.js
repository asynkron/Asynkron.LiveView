import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTocController } from '../../src/js/app/toc_controller.js';

function createEventTarget() {
    let handler = null;
    return {
        addEventListener(name, callback) {
            if (name === 'click') {
                handler = callback;
            }
        },
        removeEventListener(name, callback) {
            if (name === 'click' && handler === callback) {
                handler = null;
            }
        },
        dispatch(event) {
            handler?.(event);
        },
        get handler() {
            return handler;
        },
    };
}

test('attach wires click handler that scrolls and updates history', () => {
    const tocList = createEventTarget();
    let prevented = false;
    let scrolledWith;
    let historyUrl;

    const targetElement = {
        scrollIntoView(options) {
            scrolledWith = options;
        },
    };

    const documentRef = {
        getElementById(id) {
            return id === 'heading-one' ? targetElement : null;
        },
    };

    const historyState = [];
    const windowRef = {
        location: { pathname: '/viewer', search: '?file=README.md' },
        history: {
            state: { test: true },
            replaceState(state, _title, url) {
                historyState.push({ state, url });
                historyUrl = url;
            },
        },
    };

    const controller = createTocController({ tocList, documentRef, windowRef });
    const detach = controller.attach();

    const anchor = {
        closest(selector) {
            return selector === 'a.toc-link' ? this : null;
        },
        getAttribute(name) {
            if (name === 'href') {
                return '#heading-one';
            }
            return null;
        },
    };

    const event = {
        target: anchor,
        preventDefault() {
            prevented = true;
        },
    };

    tocList.dispatch(event);

    assert.equal(prevented, true);
    assert.deepEqual(scrolledWith, { behavior: 'smooth', block: 'start' });
    assert.deepEqual(historyState[0], { state: windowRef.history.state, url: '/viewer?file=README.md#heading-one' });
    assert.equal(historyUrl, '/viewer?file=README.md#heading-one');

    detach();
    assert.equal(tocList.handler, null);
});

