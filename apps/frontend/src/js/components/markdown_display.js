import {
    renderMarkdown,
    captureHeadingLocations,
    getHeadingLocation,
    getHeadingSection,
} from '../viewer/markdown.js';

// Provides a lightweight wrapper around the markdown renderer so that
// consumers can embed fully featured markdown (including code highlighting
// and diagram rendering) into arbitrary DOM nodes.
export function createMarkdownDisplay({
    content,
    tocList = null,
    getCurrentFile = () => null,
    setCurrentContent = () => {},
    buildQuery = () => '',
} = {}) {
    if (!content) {
        throw new Error('createMarkdownDisplay requires a content element.');
    }

    if (content.classList && !content.classList.contains('markdown-display')) {
        content.classList.add('markdown-display');
    }

    const context = {
        content,
        tocList,
        getCurrentFile,
        setCurrentContent,
        buildQuery,
    };

    return {
        element: content,
        render(markdownText, options = {}) {
            renderMarkdown(context, markdownText, options);
        },
        captureHeadings(markdownSource) {
            return captureHeadingLocations(context, markdownSource);
        },
        getHeadingLocation(slug) {
            return getHeadingLocation(context, slug);
        },
        getHeadingSection(slug) {
            return getHeadingSection(context, slug);
        },
        getContext() {
            return context;
        },
    };
}
