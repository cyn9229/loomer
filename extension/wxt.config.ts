import { defineConfig } from 'wxt';

// Automated end-to-end runs cannot click Chrome's permission prompts, so the E2E
// build pre-grants the loopback replay and tab titles. Never set for real builds.
const e2e = process.env.LOOMER_E2E === '1';

// Manifest permissions stay minimal. Site access (Canvas origin, Google Docs,
// research pages) is requested at runtime from a user action, never at install.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'loomer',
    description: 'Know what you are getting into, and pick up where you left off.',
    // activeTab + scripting: a right-click or shortcut lets Loomer read that one tab once.
    permissions: ['storage', 'alarms', 'contextMenus', 'activeTab', 'scripting', ...(e2e ? ['tabs'] : [])],
    // Loopback http is only for the labeled local Canvas replay and demo sources.
    optional_host_permissions: ['https://*/*', 'http://127.0.0.1/*', 'http://localhost/*'],
    // tabs: opt-in research discovery. notifications: opt-in deadline-change alerts.
    optional_permissions: ['tabs', 'notifications'],
    ...(e2e ? { host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'] } : {}),
    action: { default_title: 'Open loomer' },
    commands: {
      'add-page': { suggested_key: { default: 'Alt+Shift+L' }, description: 'Add this page to Loomer' },
    },
  },
});
