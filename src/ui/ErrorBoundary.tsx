import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** What to show instead of the children after they fail to render. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches an error while rendering part of the interface, so one broken panel
 * shows a message instead of taking the whole editor down with it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('StyleCode: part of the interface failed to render', error, info.componentStack);
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

/** A panel that failed: the rest of the editor keeps working. */
export function PanelBoundary({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="panel-crash" role="alert">
          <strong>The {name} panel hit a problem.</strong>
          <p>Your design is not affected. {error.message}</p>
          <button type="button" className="button" onClick={reset}>
            Try again
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
