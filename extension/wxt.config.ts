import { defineConfig } from 'wxt';

// Manifest permissions stay minimal. Site access (Canvas origin, Google Docs,
// research pages) is requested at runtime from a user action, never at install.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'loomer',
    description: 'Know what you are getting into, and pick up where you left off.',
    permissions: ['storage', 'alarms'],
    optional_host_permissions: ['https://*/*'],
    action: { default_title: 'Open loomer' },
  },
});
