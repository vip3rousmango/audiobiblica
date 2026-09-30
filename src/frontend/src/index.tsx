import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import { Button } from './components/ui';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('AudioBiblica render error', error);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="crash-panel">
        <h1>AudioBiblica hit a rendering error</h1>
        <p>{this.state.error.message || 'An unexpected error interrupted the interface.'}</p>
        <div className="crash-panel-actions">
          <Button type="button" variant="secondary" size="md" onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button type="button" variant="primary" size="md" onClick={() => window.location.reload()}>Reload the app</Button>
          {/* Best effort: a crashed page still needs a way to hand over the
              failure when the on-screen message is all the user has. */}
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon="copy"
            onClick={() => { void navigator.clipboard.writeText(this.state.error?.stack || String(this.state.error)); }}
          >
            Copy error details
          </Button>
        </div>
      </div>
    );
  }
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
