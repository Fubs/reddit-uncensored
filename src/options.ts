document.addEventListener('DOMContentLoaded', () => {
  const expandCollapsedCommentsToggle = document.getElementById('expandCollapsedComments') as HTMLInputElement | null;
  const extensionIcon = document.getElementById('extensionIcon') as HTMLImageElement | null;

  // Set correct icon path based on browser
  if (extensionIcon) {
    extensionIcon.src = process.env.ICON_PATH + 'icon_48.png';
  }

  // Load saved settings
  if (expandCollapsedCommentsToggle) {
    chrome.storage.local.get(['expandCollapsedComments', 'runMode'], result => {
      expandCollapsedCommentsToggle.checked = result.expandCollapsedComments ?? true;
    });

    // Save settings when changed
    expandCollapsedCommentsToggle.addEventListener('change', (e: Event) => {
      chrome.storage.local
        .set({
          expandCollapsedComments: (e.target as HTMLInputElement).checked,
        })
        .then(() => {})
        .catch(e => {
          console.error(e);
        });
    });
  }
});
