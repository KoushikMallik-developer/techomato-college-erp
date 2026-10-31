import { Component } from 'react';
import { Button } from './ui';

// Without this, any error while a screen draws (or a screen file that no longer exists after a new deploy)
// leaves a blank page with no way out.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // React does not print errors a boundary catches in production, and there is no monitoring service yet.
  componentDidCatch(error) {
    console.error('Screen error at', window.location.pathname, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card" role="alert">
        <h2>Something went wrong</h2>
        <p className="muted">Reload the page. If it keeps happening, sign out and back in, or tell your admin.</p>
        <div className="row">
          <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
          <Button onClick={this.props.onSignOut}>Sign out</Button>
        </div>
      </div>
    );
  }
}
