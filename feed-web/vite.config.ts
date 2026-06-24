import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 5173 },
  // vidstack — web-components, регистрируются на клиенте; не экстернализировать при SSR-сборке.
  ssr: { noExternal: ['vidstack'] },
});
