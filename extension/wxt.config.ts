import { defineConfig } from 'wxt';

// Manifest permissions stay minimal. Site access (Canvas origin, Google Docs,
// research pages) is requested at runtime from a user action, never at install.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'loomer',
    description: 'Know what you are getting into, and pick up where you left off.',
    permissions: ['storage', 'alarms'],
    // Loopback http is only for the labeled local Canvas replay.
    optional_host_permissions: ['https://*/*', 'http://127.0.0.1/*', 'http://localhost/*'],
    action: { default_title: 'Open loomer' },
    // Automated end-to-end runs cannot click Chrome's permission prompt, so the
    // E2E build pre-grants the loopback replay only. Never set for real builds.
    ...(process.env.LOOMER_E2E === '1' ? { host_permissions: ['http://127.0.0.1/*'] } : {}),
  },
});
