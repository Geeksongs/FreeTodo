"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
	children: ReactNode;
	fallbackLabel?: string;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[PanelErrorBoundary] Panel render error:", error, info);
	}

	handleRetry = () => {
		this.setState({ hasError: false, error: null });
	};

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
					<AlertTriangle className="h-8 w-8 text-destructive/70" />
					<div className="space-y-1">
						<p className="text-sm font-medium text-foreground">
							{this.props.fallbackLabel ?? "面板加载出错"}
						</p>
						<p className="text-xs text-muted-foreground">
							{this.state.error?.message ?? "未知错误"}
						</p>
					</div>
					<button
						type="button"
						onClick={this.handleRetry}
						className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						重试
					</button>
				</div>
			);
		}

		return this.props.children;
	}
}
