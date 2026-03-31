import { Component, type ReactNode, type ErrorInfo } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'system-ui, monospace', backgroundColor: '#120f29', color: '#f4efff', height: '100vh', overflow: 'auto' }}>
          <h2 style={{ marginBottom: 16 }}>
            {__BRAND_ERROR_BOUNDARY_TEXT}
          </h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, color: '#d9d0ff' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
