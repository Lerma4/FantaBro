// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'
import prettier from 'eslint-config-prettier'

export default withNuxt(
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'error',

      // `exceljs` e CommonJS senza wrapper ESM: l'import nominato passa sotto vitest e
      // fallisce nel server buildato, dove Node rifiuta l'export nominato. E costato tre
      // route di import in errore 500 con 291 test verdi, quindi la regola sta qui e non
      // in un commento che si puo ignorare. Gli import di tipo restano ammessi: vengono
      // cancellati in compilazione.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'exceljs',
              importNames: ['Workbook'],
              message:
                "Usa `import ExcelJS from 'exceljs'` e destruttura: l'export nominato rompe il server buildato.",
              allowTypeImports: true,
            },
          ],
        },
      ],
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
