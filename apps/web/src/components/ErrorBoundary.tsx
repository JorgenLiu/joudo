import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div className="errorBoundary">
          <h2>界面出现异常</h2>
          <p className="errorBoundaryMessage">{this.state.error.message}</p>
          <button type="button" className="errorBoundaryRetry" onClick={this.handleReload}>
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
