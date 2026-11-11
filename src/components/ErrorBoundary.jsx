import { Component } from 'react'
import { reportError } from '../game/errors.js'

// A render error inside the Canvas would otherwise unmount the whole tree and
// leave a blank page. Report it to the on-screen error panel and keep the rest
// of the UI (menu, HUD) alive.
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err) {
    reportError(err)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
