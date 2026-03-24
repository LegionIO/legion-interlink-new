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
            <span style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(197,194,245,0.96) 30%, rgba(160,154,232,0.96) 65%, rgba(127,119,221,0.9))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 'bold',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              textShadow: '0 0 18px rgba(160, 154, 232, 0.18)',
            }}>Legion Interlink</span> encountered an error
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
