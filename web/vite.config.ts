import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Сборка идёт в каталог статики панели. Имя входного файла фиксированное (/ui/main.js): старый интерфейс подгружает его через import().
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: '../app/admin/public/ui',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.tsx',
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'main.js', chunkFileNames: 'chunk-[hash].js', assetFileNames: '[name][extname]' },
    },
  },
});
