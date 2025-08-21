import { defineConfig } from 'eslint/config'
import cmyr from 'eslint-config-cmyr'
export default defineConfig([{
    extends: [cmyr],
    ignores: [
        '.github',
        '.husky',
        '.nuxt',
        '.output',
        '.vercel/**',
        '.vitepress',
        'output',
    ],
    rules: {
        '@stylistic/padded-blocks': [1, { blocks: 'never', classes: 'always', switches: 'never' }], // 强制在代码块中保持一致的空行填充
    },
}])
