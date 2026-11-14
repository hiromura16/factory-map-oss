import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
export default [
  {
    ignores: [
      'public/**',
      'vendor/**',
      'node_modules/**',
      '**/node_modules/**',
      '.runtime/**',
      '.deploy/**',
      '.wrangler/**',
      'cloudflare/dist/**',
      'server/target/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.worker,
        ...globals.node,
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: [
        'error',
        'always',
        {
          null: 'ignore',
        },
      ],
      curly: ['error', 'all'],
      'no-empty': [
        'error',
        {
          allowEmptyCatch: true,
        },
      ],
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['*.js', 'frontend/**/*.jsx'],
    languageOptions: {
      sourceType: 'script',
      globals: Object.fromEntries(
        [
          'L',
          'DxfParser',
          'pdfjsLib',
          'SwaggerUIBundle',
          'SwaggerUIStandalonePreset',
          'FactoryAPI',
          'FactoryMedia',
          'FactoryPreferences',
          'FactoryAppearance',
          'FactoryEquipmentIcons',
          'FactoryReactPhotos',
          'FactoryFeatures',
          'FactoryLayerSets',
          'FactoryMapDisplay',
          'FactoryProduct',
          'FactoryDisplay',
          'FactoryOrganization',
          'FactoryEquipment',
          'FactoryNotes',
          'FactoryCAD',
          'FactoryWebMCP',
          'FactoryPDF',
          'FactoryCategories',
          'factoryMap',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  {
    files: ['frontend/**/*.jsx'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
];
