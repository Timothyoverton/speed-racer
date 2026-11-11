// A visible error panel. Uncaught errors and unhandled promise rejections land
// here instead of vanishing into a console nobody has open on a phone or a
// friend's laptop. Plain DOM, installed once, no React involved.

const errors = []
let panel = null

function show() {
  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'fatal'
    panel.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;z-index:99999;max-height:40%;overflow:auto;padding:10px 14px;' +
      'font:12px/1.4 ui-monospace,Menlo,monospace;color:#ffb4a8;background:rgba(40,8,4,.88);white-space:pre-wrap;' +
      'user-select:text;pointer-events:auto'
    const close = document.createElement('button')
    close.textContent = 'dismiss'
    close.style.cssText = 'float:right;margin-left:10px;font:inherit;cursor:pointer'
    close.onclick = () => {
      panel.style.display = 'none'
    }
    panel.appendChild(close)
    panel.appendChild(document.createElement('div'))
    document.body.appendChild(panel)
  }
  panel.style.display = 'block'
  panel.lastChild.textContent = errors.slice(-6).join('\n\n')
}

export function reportError(err) {
  const msg = err && (err.stack || err.message) ? String(err.stack || err.message) : String(err)
  // the same error firing every frame would bury everything else
  if (errors.includes(msg)) return
  errors.push(msg)
  if (errors.length > 20) errors.shift()
  if (typeof document !== 'undefined') show()
}

export function installErrorOverlay() {
  if (typeof window === 'undefined' || window.__errorOverlay) return
  window.__errorOverlay = true
  window.__errors = errors
  window.addEventListener('error', (e) => reportError(e.error || e.message))
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason))
}
