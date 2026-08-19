// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import prettier from 'eslint-config-prettier'

export default withNuxt(
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
  {
    ignores: [
      'server/database/migrations/**',
      'docs/SPEC.md',
      '.data/**',
      'dist/**',
      '.output/**',
      '.nuxt/**',
    ],
  }
)
