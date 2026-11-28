import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import { createNodeResolver, importX } from 'eslint-plugin-import-x'
import prettier from 'eslint-plugin-prettier'
import security from 'eslint-plugin-security'
import globals from 'globals'

export default [
  // Global ignores — only build artifacts and coverage, NOT config files
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**']
  },

  // Base recommended config
  js.configs.recommended,

  // TypeScript production files (Node-only library; no DOM, no JSX)
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.spec.ts', '**/__tests__/**'],
    // An inline `eslint-disable` above a long function would accept it without a trace, so the
    // directives are ignored in production source and the rules report as configured.
    linterOptions: { noInlineConfig: true },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import-x': importX,
      prettier,
      security
    },
    settings: {
      // The resolver answers WHERE a specifier points; this answers WHAT the
      // resolved file exports. Only the rule that walks the graph needs it: without
      // this mapping the dependency parser skips in silence every extension it
      // cannot map — on a TypeScript project, all of them — so `no-cycle` below
      // sees an empty graph and passes on a real cycle. `no-self-import` only
      // compares a resolved path against the current file, so it fires either way
      // and cannot stand in as evidence that this mapping is present.
      'import-x/parsers': {
        '@typescript-eslint/parser': ['.ts']
      },
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: './tsconfig.json'
        }),
        createNodeResolver({
          extensions: ['.js', '.ts']
        })
      ]
    },
    rules: {
      // TypeScript — strict (zero `any`; explicit return types on exports)
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `return promise` in an async function reads `promise.then`, which a host can replace before the
      // call and restore after it; `return await promise` reads only the constructor, which is checked.
      '@typescript-eslint/return-await': ['error', 'always'],
      // `for await` awaits every step of an iterator without a pinned hop or a check; read it with `nextStep`.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForOfStatement[await=true]',
          message:
            'A `for await` is a bare await: advance the iterator with `nextStep` and `pinned`.'
        }
      ],
      // A function is at most 50 raw lines — blank lines and comments count, as a reader sees
      // them. Spec files are exempt: a `describe` callback holds a whole suite.
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: false, skipComments: false, IIFEs: true }
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports'
        }
      ],
      '@typescript-eslint/no-empty-function': 'warn',

      // Code quality
      'prefer-const': 'error',
      'no-var': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Security — block dynamic code evaluation
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',

      // Security — ban bare 'crypto' and external crypto/id packages (node:crypto only).
      // This is a Bymax-wide guard-rail: even libs that do not currently use crypto
      // must reach for node: builtins, never a third-party dependency, if they ever do.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'crypto', message: "Use 'node:crypto' with the node: prefix instead." },
            { name: 'bcrypt', message: 'Use node:crypto scrypt instead.' },
            { name: 'argon2', message: 'Use node:crypto scrypt instead.' },
            { name: 'uuid', message: 'Use crypto.randomUUID() from node:crypto instead.' },
            { name: 'nanoid', message: 'Use crypto.randomBytes() from node:crypto instead.' },
            { name: 'crypto-js', message: 'Use node:crypto instead.' }
          ]
        }
      ],

      // Security plugin rules
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-possible-timing-attacks': 'error',

      // Import ordering — node: → external → internal → parent/sibling
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index'],
          pathGroups: [
            {
              pattern: 'node:*',
              group: 'builtin',
              position: 'before'
            }
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true
          }
        }
      ],
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',

      // Prettier — reads from .prettierrc (no inline options to avoid conflicts)
      'prettier/prettier': 'warn'
    }
  },

  // Node.js scripts — plain ESM, no TypeScript parser needed
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    plugins: {
      security
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'security/detect-object-injection': 'warn'
    }
  },

  // Config files (tsup.config.ts, jest.config.ts, etc.) — TS parser, no type-aware project
  {
    files: ['*.config.ts', '*.config.mjs', '*.config.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      security
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'crypto', message: "Use 'node:crypto' with the node: prefix instead." },
            { name: 'bcrypt', message: 'Use node:crypto scrypt instead.' },
            { name: 'argon2', message: 'Use node:crypto scrypt instead.' },
            { name: 'uuid', message: 'Use crypto.randomUUID() from node:crypto instead.' },
            { name: 'nanoid', message: 'Use crypto.randomBytes() from node:crypto instead.' },
            { name: 'crypto-js', message: 'Use node:crypto instead.' }
          ]
        }
      ],
      'security/detect-object-injection': 'warn'
    }
  },

  // Test files and the fixtures under `__tests__` (excluded from coverage, mutation and the build)
  // — Jest + Node globals. The typing and console rules apply here as they do in source.
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.jest,
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-console': 'error'
    }
  },

  // Prettier disables conflicting formatting rules (must be last)
  prettierConfig
]
