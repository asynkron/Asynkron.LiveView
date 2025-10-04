const globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
if (!globalScope.process) {
    globalScope.process = { env: {} };
}
if (!globalScope.process.env) {
    globalScope.process.env = {};
}
if (typeof globalScope.process.env.NODE_ENV === 'undefined') {
    globalScope.process.env.NODE_ENV = 'production';
}

export { };
