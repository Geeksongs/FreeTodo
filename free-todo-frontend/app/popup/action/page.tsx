"use client";

import { useEffect, useRef, useState } from "react";
import { unwrapApiData } from "@/lib/api/fetcher";
import { listTodosApiTodosGet } from "@/lib/generated/todos/todos";
import { useUpdateTodo } from "@/lib/query";

interface DraftTodo {
	id: number;
	name: string;
}

declare global {
	interface Window {
		__popupHandleProactiveMessage?: (payload: {
			message: string;
			sessionId: string | null;
		}) => void;
	}
}

export default function PopupActionPage() {
	const [draftTodo, setDraftTodo] = useState<DraftTodo | null>(null);
	const [displayName, setDisplayName] = useState<string>("");
	const [showNote, setShowNote] = useState<"accept" | "reject" | null>(null);
	const [note, setNote] = useState("");
	const updateTodoMutation = useUpdateTodo();
	const fetchedRef = useRef(false);

	const fetchLatestDraftTodo = async () => {
		if (fetchedRef.current) return;
		fetchedRef.current = true;
		try {
			const result = await listTodosApiTodosGet({ status: "draft", limit: 1 });
			const data = unwrapApiData<{ todos: DraftTodo[] }>(result);
			if (data?.todos?.[0]) {
				setDraftTodo(data.todos[0]);
				setDisplayName(data.todos[0].name);
			}
		} catch (e) {
			console.warn("[PopupAction] Failed to fetch draft todo:", e);
		}
	};

	useEffect(() => {
		// Signal Electron that popup React is ready to receive messages
		window.electronAPI?.popupReady?.();

		// Register global handler for Electron-pushed messages
		window.__popupHandleProactiveMessage = ({ message }) => {
			const extracted = message.replace(/^发现新待办：/, "").trim();
			if (extracted) setDisplayName(extracted);
			fetchLatestDraftTodo();
		};

		// Also fetch immediately (handles case where message arrived before handler)
		fetchLatestDraftTodo();

		return () => {
			window.__popupHandleProactiveMessage = undefined;
		};
	}, []);

	const handleClose = () => {
		window.electronAPI?.popupClose?.();
	};

	const handleSubmit = () => {
		if (!draftTodo) {
			handleClose();
			return;
		}
		const input =
			showNote === "accept"
				? {
						status: "active" as const,
						...(note.trim() ? { userNotes: note.trim() } : {}),
					}
				: {
						status: "canceled" as const,
						...(note.trim() ? { rejectionReason: note.trim() } : {}),
					};
		updateTodoMutation.mutate({ id: draftTodo.id, input });
		handleClose();
	};

	const todoName = displayName || "新待办事项";

	return (
		<div className="flex items-end justify-end h-screen bg-transparent p-4">
			<div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xs p-4 select-none">
				{/* Header */}
				<div className="flex items-start justify-between gap-2 mb-3">
					<div className="flex-1 min-w-0">
						<p className="text-xs text-muted-foreground mb-1 font-medium tracking-wide uppercase">
							发现新待办
						</p>
						<p className="text-sm font-semibold text-foreground leading-snug break-words">
							{todoName}
						</p>
					</div>
					<button
						type="button"
						onClick={handleClose}
						className="shrink-0 text-muted-foreground hover:text-foreground transition-colors text-base leading-none mt-0.5"
						aria-label="关闭"
					>
						✕
					</button>
				</div>

				{/* Actions */}
				{!showNote ? (
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => setShowNote("accept")}
							className="flex-1 rounded-lg bg-primary text-primary-foreground text-sm py-2 font-medium hover:opacity-90 transition-opacity"
						>
							接受
						</button>
						<button
							type="button"
							onClick={() => setShowNote("reject")}
							className="flex-1 rounded-lg border border-border bg-background text-foreground text-sm py-2 font-medium hover:bg-muted transition-colors"
						>
							忽略
						</button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						<textarea
							className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none h-16 focus:outline-none focus:ring-1 focus:ring-ring"
							placeholder={
								showNote === "accept" ? "添加备注（可选）" : "忽略原因（可选）"
							}
							value={note}
							onChange={(e) => setNote(e.target.value)}
							autoFocus
						/>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleSubmit}
								className="flex-1 rounded-lg bg-primary text-primary-foreground text-sm py-2 font-medium hover:opacity-90 transition-opacity"
							>
								{showNote === "accept" ? "确认接受" : "确认忽略"}
							</button>
							<button
								type="button"
								onClick={() => setShowNote(null)}
								className="flex-1 rounded-lg border border-border bg-background text-foreground text-sm py-2 font-medium hover:bg-muted transition-colors"
							>
								返回
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
