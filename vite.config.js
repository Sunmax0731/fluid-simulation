import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        airflow: resolve(__dirname, 'airflow/index.html'),
        liquid: resolve(__dirname, 'liquid/index.html'),
        multiphase: resolve(__dirname, 'multiphase/index.html'),
      },
    },
  },
  assetsInclude: ['**/*.glsl', '**/*.wgsl'],
});
