/**
 * Per-panel error boundary (UX0-T7): a thrown instrument is an ErrorState,
 * never a white screen (UI-UX-SPEC §1.2 principle 8).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./ErrorState.tsx";

export interface ErrorBoundaryProps {
  /** Label used in console reporting (e.g. "scope", "inspector"). */
  readonly region: string;
  readonly children: ReactNode;
  /** Invoked with the error for diagnostics/telemetry surfaces. */
  readonly onError?: (error: Error) => void;
  /** Change to reset the boundary state (e.g. theme, panel id). */
  readonly resetKeys?: readonly unknown[];
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.region}]`, error, info.componentStack);
    this.props.onError?.(error);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    const currentKeys = this.props.resetKeys;
    const reset =
      this.state.error !== null &&
      prev.resetKeys !== undefined &&
      currentKeys !== undefined &&
      prev.resetKeys.some((key, i) => key !== currentKeys[i]);
    if (
      reset ||
      (this.state.error !== null && prev.resetKeys === undefined && currentKeys !== undefined)
    ) {
      this.setState({ error: null });
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return (
        <ErrorState
          title={`Panel error — ${this.props.region}`}
          detail={error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
