import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';

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
          <button type="button" className="btn btn-secondary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload the app</button>
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
