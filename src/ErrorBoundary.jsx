import React from 'react'
import { captureError } from './usage.js'

// Catches a render error in whatever it wraps, records it, and shows a calm card instead of a blank page.
// `kind` picks the frame: 'screen' sits inside a tab, 'sheet' covers the screen like Settings does (and can be
// closed), 'app' is the whole window.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false, tries: 0 } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { captureError('render', (error && error.message) || 'Render error', { screen: this.props.name }) }
  render() {
    if (!this.state.failed) return <React.Fragment key={this.state.tries}>{this.props.children}</React.Fragment>
    const { kind = 'screen', onClose } = this.props
    const again = () => this.setState((s) => ({ failed: false, tries: s.tries + 1 }))
    const card = <div className="card empty oops" role="alert">
      <b>Something went wrong on this screen</b>
      <p>Nothing you saved is lost. Try again, and if it keeps happening, Settings has a Help and diagnostics page with a report you can copy.</p>
      <button className="cta small" onClick={again}>Try again</button>
      {kind === 'sheet' && onClose && <button className="cta small white bordered" onClick={onClose}>Close</button>}
      {kind === 'app' && <button className="cta small white bordered" onClick={() => location.reload()}>Reload Trot</button>}
    </div>
    if (kind === 'sheet') return <div className="detail" role="dialog" aria-modal="true" aria-label="Something went wrong"><div className="scroll"><div className="list">{card}</div></div></div>
    if (kind === 'app') return <div className="shell"><div className="scroll"><div className="list oopsapp">{card}</div></div></div>
    return <div className="scroll"><div className="list">{card}</div></div>
  }
}
