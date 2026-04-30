/**
 * SectionErrorBoundary
 *
 * Wraps each home section. If a section crashes (CF error, render error, etc.)
 * it returns null — the section silently disappears instead of crashing the
 * entire home screen.
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Optional fallback UI. Defaults to null (section hidden). */
  fallback?: React.ReactNode;
  /** Section name for logging. */
  name?: string;
}

interface State {
  hasError: boolean;
}

export class SectionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn(
      `[SectionErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`,
      error.message
    );
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
