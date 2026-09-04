// This page deliberately imports no app modules: no scheduler or data migration can restart.
const status = document.querySelector('#status')
const retry = document.querySelector('#retry')
const open = document.querySelector('#open')
const channel =
  typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel('ahead-reset')
const peer = new URLSearchParams(location.search).has('peer')
open.onclick = () => location.replace('/discover')
function complete() {
  status.textContent = '本机资料、登录状态和缓存已清空。'
  open.hidden = false
}
if (peer) {
  // A peer stays quiescent until the user explicitly reopens it.
  sessionStorage.clear()
  status.textContent = '另一标签页正在清空本机数据，请等待清理完成。'
  if (channel)
    channel.onmessage = (event) => {
      if (event.data === 'complete') complete()
    }
  window.addEventListener('storage', (event) => {
    if (event.key === null) complete()
  })
} else {
  const start = () =>
    navigator.locks
      ? navigator.locks.request(
          'ahead-full-reset',
          { ifAvailable: true },
          (lock) => {
            if (lock) return clear()
            location.replace('/reset.html?peer=1')
          },
        )
      : clear()
  retry.onclick = () => void start()
  void start()
}
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    const timer = setTimeout(
      () => reject(new Error('有其他标签页仍在占用数据库，请关闭它们后重试。')),
      8000,
    )
    request.onsuccess = () => {
      clearTimeout(timer)
      resolve()
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error)
    }
  })
}
async function clear() {
  retry.hidden = true
  open.hidden = true
  status.textContent = '正在清空全部本机数据和缓存…'
  try {
    localStorage.setItem('ahead-reset-in-progress', String(Date.now()))
    channel?.postMessage('prepare')
    // Let sibling documents unload and release their database connections.
    await new Promise((resolve) => setTimeout(resolve, 250))
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      )
    }
    if (!indexedDB.databases)
      throw new Error(
        '当前浏览器无法枚举全部数据库，请在浏览器的网站设置中清除本站全部数据。',
      )
    const databases = await indexedDB.databases()
    await Promise.all(
      databases.filter((db) => db.name).map((db) => deleteDatabase(db.name)),
    )
    if (navigator.storage?.getDirectory) {
      const directory = await navigator.storage.getDirectory()
      for await (const name of directory.keys())
        await directory.removeEntry(name, { recursive: true })
    }
    if ('caches' in window)
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)))
    // An origin response is required for HTTP cache and HttpOnly cookies. Never clear on ordinary requests.
    const response = await fetch('/clear-site-data.txt?reset=' + Date.now(), {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (
      !response.ok ||
      response.headers.get('X-Ahead-Reset') !== 'clear-cache-and-cookies'
    ) {
      throw new Error(
        '资料已清理，但浏览器缓存清理未完成。请联网后重试；若仍失败，请在浏览器的网站设置中清除本站数据。',
      )
    }
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim()
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
    }
    sessionStorage.clear()
    localStorage.clear()
    channel?.postMessage('complete')
    complete()
    location.replace('/discover')
  } catch (error) {
    status.textContent =
      '清理未完成：' + (error instanceof Error ? error.message : String(error))
    retry.hidden = false
  }
}
