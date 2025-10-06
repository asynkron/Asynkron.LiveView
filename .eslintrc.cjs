const globals = require('globals');

module.exports = {
  root: true,
  env: {
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: ['eslint:recommended', 'eslint-config-prettier'],
  ignorePatterns: [
    'node_modules/',
    'frontend/node_modules/',
    'backend/node_modules/',
    'templates/static/dist/',
  ],
  overrides: [
    {
      files: ['backend/**/*.js'],
      env: {
        node: true,
      },
      globals: {
        ...globals.node,
      },
    },
    {
      files: ['backend/tests/**/*.js'],
      env: {
        node: true,
      },
      globals: {
        ...globals.node,
      },
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['frontend/src/**/*.js'],
      env: {
        browser: true,
      },
      globals: {
        ...globals.browser,
        marked: 'readonly',
        markedBaseUrl: 'readonly',
        hljs: 'readonly',
        mermaid: 'readonly',
        vegaEmbed: 'readonly',
        React: 'readonly',
        ReactDOM: 'readonly',
        ExcalidrawLib: 'readonly',
        svelteCompilerGlobal: 'readonly',
        svelteInternalGlobal: 'readonly',
        svelteInstances: 'writable',
      },
      rules: {
        'no-unused-vars': 'off',
        'no-undef': 'off',
      },
    },
    {
      files: ['frontend/tests/**/*.js'],
      env: {
        node: true,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  ],
};
