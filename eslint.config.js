import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['public/vendor/'] },
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // O e2e roda no Node, mas as funções passadas ao navegador usam globais do browser.
    files: ['e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
