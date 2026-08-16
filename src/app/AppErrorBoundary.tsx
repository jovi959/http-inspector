import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly error: Error | null;
}

/** Recovers the React shell without resetting the Rust capture session. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public state: AppErrorBoundaryState = { error: null };

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // The source session remains in the capture runtime; recovery only remounts this view tree.
  }

  public render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-shell app-error-boundary">
        <section className="panel error-recovery" role="alert">
          <p className="eyebrow">View recovery</p>
          <h1>The inspector view needs to be reloaded.</h1>
          <p>The capture session remains available while this view is recovered.</p>
          <button className="primary-button" type="button" onClick={() => this.setState({ error: null })}>Recover view</button>
        </section>
      </main>
    );
  }
}
