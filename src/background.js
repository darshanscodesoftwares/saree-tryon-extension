// The whole of the service worker: make the toolbar button open the side
// panel. Everything else happens in the panel itself, which can call
// chrome.scripting directly and so needs no errand-runner here.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
