// Service worker. Chrome may stop it at any time, so it must keep no state in memory
// that cannot be rebuilt from storage.
export default defineBackground(() => {
  // The toolbar icon opens the side panel.
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
