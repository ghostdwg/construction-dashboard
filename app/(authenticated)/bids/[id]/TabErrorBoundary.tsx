"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  tabName: string;
};

type State = {
  hasError: boolean;
};

export default class TabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[TabErrorBoundary] ${this.props.tabName}`, error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="rounded-lg border border-red-500/40 bg-red-50 p-5 text-red-700 dark:bg-zinc-900 dark:text-red-400">
        <p className="text-sm font-semibold">
          Tab failed to load — {this.props.tabName}
        </p>
        <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
          Something in this tab crashed, but the rest of the project page is still available.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs text-red-500/60 hover:text-red-700 dark:text-red-400/50 dark:hover:text-red-400"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
