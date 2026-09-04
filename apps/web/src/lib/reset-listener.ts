/** Unload the app in every open tab before the reset page deletes storage. */
export function installResetListener() {
  const reset = () => {
    window.dispatchEvent(new Event('ahead-reset'))
    window.location.replace('/reset.html?peer=1')
  }
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('ahead-reset')
    channel.onmessage = (event) => {
      if (event.data === 'prepare') reset()
    }
  }
  window.addEventListener('storage', (event) => {
    if (event.key === 'ahead-reset-in-progress' && event.newValue) reset()
  })
  try {
    if (localStorage.getItem('ahead-reset-in-progress')) {
      window.location.replace('/reset.html')
      return true
    }
  } catch {
    /* The app reports unavailable browser storage. */
  }
  return false
}
