// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-duplicates': 'error',
    },
  },
  eslintConfigPrettier,
);
