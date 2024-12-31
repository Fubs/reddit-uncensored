document.addEventListener('DOMContentLoaded', () => {
  const expandCollapsedCommentsToggle = document.getElementById('expandCollapsedComments')
  const extensionIcon = document.getElementById('extensionIcon')

  // Set correct icon path based on browser
  extensionIcon.src = process.env.ICON_PATH + 'icon_48.png'

  // Load saved settings
  chrome.storage.local.get(['expandCollapsedComments'], result => {
    expandCollapsedCommentsToggle.checked = result.expandCollapsedComments ?? true
  })

  // Save settings when changed
  expandCollapsedCommentsToggle.addEventListener('change', e => {
    chrome.storage.local
      .set({
        expandCollapsedComments: e.target.checked,
      })
      .then(() => {})
      .catch(e => {
        console.error(e)
      })
  })
})
