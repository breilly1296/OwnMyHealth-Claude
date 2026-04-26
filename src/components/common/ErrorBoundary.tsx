/**
 * ErrorBoundary Component
 *
 * A React class component that catches JavaScript errors anywhere in its child
 * component tree and displays a fallback UI instead of crashing the entire app.
 *
 * Features:
 * - Catches errors during rendering, in lifecycle methods, and in constructors
 * - Displays a user-friendly error page with retry and home navigation options
 * - Shows detailed error information in development mode (stack trace, component stack)
 * - Supports custom fallback UI via the `fallback` prop
 * - Logs errors to console in development (can be extended for error reporting services)
 *
 * Usage:
 * Wrap any component tree that might throw errors:
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * Or with custom fallback:
 * <ErrorBoundary fallback={<CustomErrorPage />}>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * @module components/common/ErrorBoundary
 */

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { errorBoundaryLogger } from '../../utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function isChunkLoadError(error: Error | null): boolean {
  if (!error?.message) return false;
  const msg = error.message;
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('Failed to fetch') ||
    msg.includes('Loading chunk')
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });

    // Log error using structured logger (automatically suppressed in production unless DEBUG is enabled)
    errorBoundaryLogger.error('Caught an error', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Here you could also send the error to an error reporting service
    // logErrorToService(error, errorInfo);
  }

  handleRetry = (): void => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI provided via props
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Stale-chunk path: a deploy landed mid-session and this user's
      // tab is holding references to chunks that no longer exist on the CDN.
      // Show a clean "new version" prompt instead of a generic crash.
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-slate-900 rounded-lg shadow-lg p-8 text-center">
              <div className="flex justify-center mb-6">
                <div className="bg-brand-500/10 rounded-full p-4">
                  <RefreshCw className="w-12 h-12 text-brand-400" />
                </div>
              </div>

              <h1 className="text-2xl font-bold text-white mb-2">
                A new version of OwnMyHealth is available.
              </h1>

              <p className="text-slate-400 mb-6">
                Reload to pick up the latest update.
              </p>

              <div className="flex justify-center">
                <button
                  onClick={this.handleReload}
                  className="flex items-center justify-center px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Default error UI
      return (
        <div className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 rounded-lg shadow-lg p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="bg-red-500/10 rounded-full p-4">
                <AlertTriangle className="w-12 h-12 text-red-400" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">
              Something went wrong
            </h1>

            <p className="text-slate-400 mb-6">
              We're sorry, but something unexpected happened. Please try again or contact support if the problem persists.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mb-6 text-left">
                <details className="bg-slate-800 rounded-lg p-4">
                  <summary className="cursor-pointer text-sm font-medium text-slate-300">
                    Error Details (Development Only)
                  </summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-mono text-red-400 break-all">
                      {this.state.error.message}
                    </p>
                    {this.state.errorInfo && (
                      <pre className="text-xs text-slate-400 overflow-auto max-h-40 bg-slate-950 p-2 rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    )}
                  </div>
                </details>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="flex items-center justify-center px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </button>

              <button
                onClick={this.handleGoHome}
                className="flex items-center justify-center px-4 py-2 bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition-colors"
              >
                <Home className="w-4 h-4 mr-2" />
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
