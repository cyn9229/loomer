import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// WxtVitest provides WXT auto-imports and an in-memory fake of the browser APIs.
export default defineConfig({
  plugins: [WxtVitest()],
});
