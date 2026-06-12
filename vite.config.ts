import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
      },
      // 使用相对路径，Electron 文件协议需要
      base: './',
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        // 禁用 sourcemap 减小体积
        sourcemap: false,
      }
    };
  });
