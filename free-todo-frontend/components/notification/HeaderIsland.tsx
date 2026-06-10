"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, Clock, Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { deleteNotificationApiNotificationsNotificationIdDelete } from "@/lib/generated/notifications/notifications";
import { useOpenSettings } from "@/lib/hooks/useOpenSettings";
import { useUpdateTodo } from "@/lib/query";
import {
	getNotificationPoller,
	markDraftTodoNotificationProcessed,
} from "@/lib/services/notification-poller";
import { useNotificationStore } from "@/lib/store/notification-store";
import { toastError, toastSuccess } from "@/lib/toast";

// 简单的相对时间格式化
function formatTime(
	timestamp: string,
	t: ReturnType<typeof useTranslations>,
): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) {
		return t("justNow");
	}
	if (diffMins < 60) {
		return t("minutesAgo", { count: diffMins });
	}
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) {
		return t("hoursAgo", { count: diffHours });
	}
	const diffDays = Math.floor(diffHours / 24);
	return t("daysAgo", { count: diffDays });
}

// 格式化当前时间
function formatCurrentTime(t: ReturnType<typeof useTranslations>): {
	time: string;
	date: string;
} {
	const now = new Date();
	const hours = now.getHours().toString().padStart(2, "0");
	const minutes = now.getMinutes().toString().padStart(2, "0");
	const time = `${hours}:${minutes}`;
	const month = (now.getMonth() + 1).toString().padStart(2, "0");
	const day = now.getDate().toString().padStart(2, "0");
	const date = t("dateFormat", { month, day });
	return { time, date };
}

export function HeaderIsland() {
	const {
		notifications,
		isExpanded,
		toggleExpanded,
		removeNotification,
		removeNotificationsBySource,
		setExpanded,
	} = useNotificationStore();
	const t = useTranslations("todoExtraction");
	const tLayout = useTranslations("layout");
	const containerRef = useRef<HTMLDivElement>(null);
	const [currentTime, setCurrentTime] = useState(() => formatCurrentTime(t));
	// noteInput: per-todo 备注文字; showNote: per-todo 当前操作类型 "accept"|"reject"|null
	const [noteInput, setNoteInput] = useState<Record<string, string>>({});
	const [showNote, setShowNote] = useState<Record<string, "accept" | "reject">>({});
	const updateTodoMutation = useUpdateTodo();

	const currentNotification = notifications[0] ?? null;
	const notificationCount = notifications.length;

	const { openSettings } = useOpenSettings();
	const isLlmConfigNotification = currentNotification?.source === "llm-config";

	// 每秒更新时间
	useEffect(() => {
		const updateTime = () => setCurrentTime(formatCurrentTime(t));
		updateTime();
		const interval = setInterval(updateTime, 1000);
		return () => clearInterval(interval);
	}, [t]);

	// 点击外部关闭
	useEffect(() => {
		if (!isExpanded || notifications.length === 0) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				useNotificationStore.getState().setExpanded(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isExpanded, notifications.length]);

	const closeNotification = async (notificationId: string, source?: string) => {
		if (source === "ddl-reminder" && notificationId) {
			try {
				await deleteNotificationApiNotificationsNotificationIdDelete(notificationId);
			} catch (error) {
				console.warn("Failed to delete notification from backend:", error);
			}
		}
		removeNotification(notificationId);
		if (useNotificationStore.getState().notifications.length === 0) {
			setExpanded(false);
		}
	};

	const classifyError = (error: unknown): string => {
		const msg = error instanceof Error ? error.message : String(error);
		if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch")) {
			return "network";
		}
		if (msg.includes("404") || msg.includes("Not Found") || msg.includes("不存在")) {
			return "not_found";
		}
		return msg;
	};

	// 点击 accept/reject 按钮：立即展示备注输入框
	const handleClickAccept = (todoId: number | undefined, e: React.MouseEvent) => {
		e.stopPropagation();
		if (!todoId) return;
		setShowNote((prev) => ({ ...prev, [String(todoId)]: "accept" }));
	};

	const handleClickReject = (todoId: number | undefined, e: React.MouseEvent) => {
		e.stopPropagation();
		if (!todoId) return;
		setShowNote((prev) => ({ ...prev, [String(todoId)]: "reject" }));
	};

	// 确认提交：立即关闭通知，API 在后台执行
	const submitAction = (todoId: number | undefined, action: "accept" | "reject", note: string) => {
		if (!todoId) return;
		const key = String(todoId);
		setShowNote((prev) => { const n = { ...prev }; delete n[key]; return n; });
		setNoteInput((prev) => { const n = { ...prev }; delete n[key]; return n; });
		// 立即标记为已处理，防止轮询在 API 写入完成前重新弹出通知
		getNotificationPoller().markTodoProcessed(todoId);
		markDraftTodoNotificationProcessed(todoId);
		removeNotificationsBySource("draft-todos");
		setExpanded(false);

		const input =
			action === "accept"
				? { status: "active" as const, ...(note.trim() ? { userNotes: note.trim() } : {}) }
				: { status: "canceled" as const, ...(note.trim() ? { rejectionReason: note.trim() } : {}) };

		updateTodoMutation.mutate(
			{ id: todoId, input },
			{
				onSuccess: () => toastSuccess(action === "accept" ? t("acceptSuccess") : t("rejectSuccess")),
				onError: (error) => {
					const kind = classifyError(error);
					if (kind === "not_found") return;
					const msg =
						kind === "network"
							? "后端服务器暂时繁忙，请稍后再试"
							: action === "accept"
								? t("acceptFailed", { error: kind })
								: t("rejectFailed", { error: kind });
					toastError(msg);
				},
			},
		);
	};

	return (
		<div
			ref={containerRef}
			className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
		>
			<motion.div
				initial={false}
				animate={{
					width: isExpanded ? "auto" : "auto",
					height: isExpanded ? "auto" : "auto",
					minWidth: isExpanded ? 800 : currentNotification ? 400 : 200,
					maxWidth: isExpanded ? 1200 : currentNotification ? 500 : 300,
				}}
				transition={{ type: "spring", stiffness: 300, damping: 30 }}
				className="relative"
			>
				{currentNotification ? (
					<motion.div
						onClick={() => {
							if (!isExpanded && isLlmConfigNotification && notificationCount === 1) {
								openSettings();
								return;
							}
							toggleExpanded();
						}}
						whileHover={{ scale: 1.02, y: -2 }}
						whileTap={{ scale: 0.98 }}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								if (!isExpanded && isLlmConfigNotification && notificationCount === 1) {
									openSettings();
									return;
								}
								toggleExpanded();
							}
						}}
						className={`
						relative flex items-center gap-2 overflow-hidden rounded-full
						bg-background/95 backdrop-blur-sm border border-border/50
						shadow-lg transition-all duration-300 cursor-pointer
						hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/30
						hover:bg-background
						focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
						${isExpanded ? "px-4 py-2.5" : "px-3 py-2"}
					`}
						aria-label={isExpanded ? t("collapseNotification") : t("expandNotification")}
					>
						<AnimatePresence mode="wait">
							{!isExpanded ? (
								<motion.div
									key="collapsed"
									initial={{ opacity: 0, scale: 0.8 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.8 }}
									transition={{ duration: 0.2 }}
									className="flex items-center gap-2"
								>
									<motion.div
										animate={{
											rotate: isLlmConfigNotification ? [0, 360] : [0, -10, 10, -10, 0],
										}}
										transition={
											isLlmConfigNotification
												? { duration: 2, repeat: Infinity, ease: "linear" }
												: { duration: 0.5, repeat: Infinity, repeatDelay: 2, ease: "easeInOut" }
										}
									>
										{isLlmConfigNotification ? (
											<Settings className="h-4 w-4 text-amber-500 shrink-0" />
										) : (
											<Bell className="h-4 w-4 text-primary shrink-0" />
										)}
									</motion.div>
									<span className="text-sm font-medium text-foreground truncate max-w-[200px]">
										{currentNotification.title || t("newNotification")}
										{currentNotification.content && (
											<span className="text-muted-foreground/70">
												{" "}
												（{currentNotification.content}）
											</span>
										)}
									</span>
									{notificationCount > 1 && (
										<span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
											{notificationCount}
										</span>
									)}
								</motion.div>
							) : (
								<motion.div
									key="expanded"
									initial={{ opacity: 0, scale: 0.95 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.95 }}
									transition={{ duration: 0.2 }}
									className="flex flex-col gap-2 w-full max-h-[60vh] overflow-y-auto"
								>
									{notifications.map((notification) => {
										const isDraftTodo =
											notification.source === "draft-todos" && notification.todoId;
										const isLlmConfig = notification.source === "llm-config";
										const key = String(notification.todoId);
										const currentShowNote = showNote[key];

										return (
											<div
												key={notification.id}
												className={`flex w-full border border-border/40 rounded-2xl px-3 py-2 bg-background/80 ${isDraftTodo && currentShowNote ? "flex-col gap-2" : "items-center gap-3"}`}
											>
												{/* 顶部行：图标 + 标题 + 时间 + 操作按钮/关闭 */}
												<div className="flex items-center gap-3 w-full">
													{isLlmConfig ? (
														<Settings className="h-4 w-4 text-amber-500 shrink-0" />
													) : (
														<Bell className="h-4 w-4 text-primary shrink-0" />
													)}
													<div className="flex-1 min-w-0 flex items-center gap-2">
														<h3 className="text-sm font-semibold text-foreground truncate max-w-[500px]">
															{notification.title || t("newNotification")}
															{notification.content && (
																<span className="text-muted-foreground/70">
																	{" "}
																	（{notification.content}）
																</span>
															)}
														</h3>
													</div>
													{notification.timestamp && (
														<span className="text-xs text-muted-foreground/70 shrink-0 whitespace-nowrap">
															{formatTime(notification.timestamp, t)}
														</span>
													)}
													{isLlmConfig && (
														<motion.button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																openSettings();
															}}
															whileHover={{ scale: 1.05 }}
															whileTap={{ scale: 0.95 }}
															className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600"
														>
															{tLayout("openSettings")}
														</motion.button>
													)}
													{isDraftTodo && !currentShowNote && (
														<div className="flex items-center gap-2 shrink-0 border-l border-border/50 pl-3">
															<motion.button
																type="button"
																onClick={(e) => handleClickAccept(notification.todoId, e)}
																whileHover={{ scale: 1.05 }}
																whileTap={{ scale: 0.95 }}
																className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
																aria-label={t("accept")}
															>
																<Check className="h-4 w-4" />
																<span>{t("accept")}</span>
															</motion.button>
															<motion.button
																type="button"
																onClick={(e) => handleClickReject(notification.todoId, e)}
																whileHover={{ scale: 1.05 }}
																whileTap={{ scale: 0.95 }}
																className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors text-sm font-medium"
																aria-label={t("reject")}
															>
																<X className="h-4 w-4" />
																<span>{t("reject")}</span>
															</motion.button>
														</div>
													)}
													<motion.button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															closeNotification(notification.id, notification.source);
														}}
														whileHover={{ scale: 1.1, rotate: 90 }}
														whileTap={{ scale: 0.9 }}
														className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors ml-1"
														aria-label={t("closeNotification")}
													>
														<X className="h-3.5 w-3.5" />
													</motion.button>
												</div>

												{/* 输入框行：独立一行，宽大 */}
												{isDraftTodo && currentShowNote && (
													<div className="flex flex-col gap-2 w-full pt-1 border-t border-border/30">
														<input
															// biome-ignore lint/a11y/noAutofocus: 用户点击后立即聚焦
															autoFocus
															type="text"
															placeholder={
																currentShowNote === "reject"
																	? "输入拒绝原因（可选），按 Enter 确认"
																	: "输入备注（可选），按 Enter 确认"
															}
															value={noteInput[key] ?? ""}
															onClick={(e) => e.stopPropagation()}
															onChange={(e) => {
																setNoteInput((prev) => ({ ...prev, [key]: e.target.value }));
															}}
															onKeyDown={(e) => {
																e.stopPropagation();
																if (e.key === "Enter") {
																	submitAction(notification.todoId, currentShowNote, noteInput[key] ?? "");
																} else if (e.key === "Escape") {
																	setShowNote((prev) => { const n = { ...prev }; delete n[key]; return n; });
																	setNoteInput((prev) => { const n = { ...prev }; delete n[key]; return n; });
																}
															}}
															className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
														/>
														<div className="flex gap-2">
															<motion.button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	submitAction(notification.todoId, currentShowNote, noteInput[key] ?? "");
																}}
																whileHover={{ scale: 1.02 }}
																whileTap={{ scale: 0.98 }}
																className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentShowNote === "reject" ? "bg-destructive/10 text-destructive hover:bg-destructive/20" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
															>
																<Check className="h-4 w-4" />
																{currentShowNote === "reject" ? "确认拒绝" : "确认同意"}
															</motion.button>
															<motion.button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	setShowNote((prev) => { const n = { ...prev }; delete n[key]; return n; });
																	setNoteInput((prev) => { const n = { ...prev }; delete n[key]; return n; });
																}}
																whileHover={{ scale: 1.02 }}
																whileTap={{ scale: 0.98 }}
																className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
															>
																取消
															</motion.button>
														</div>
													</div>
												)}
											</div>
										);
									})}
								</motion.div>
							)}
						</AnimatePresence>
					</motion.div>
				) : (
					// 没有通知时显示当前时间
					<motion.div
						initial={{ opacity: 0, scale: 0.9 }}
						animate={{ opacity: 1, scale: 1 }}
						whileHover={{ scale: 1.03, y: -2 }}
						transition={{ duration: 0.3 }}
						className="relative flex items-center gap-2 overflow-hidden rounded-full
						bg-background/95 backdrop-blur-sm border border-border/50
						shadow-lg px-3 py-2
						hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/20
						hover:bg-background transition-all duration-300
						cursor-default"
					>
						<Clock className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
						<div className="flex items-baseline gap-1.5">
							<motion.span
								key={currentTime.time}
								initial={{ opacity: 0, y: -4 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.2 }}
								className="text-sm font-medium text-foreground tabular-nums"
							>
								{currentTime.time}
							</motion.span>
							<span className="text-xs text-muted-foreground/70 font-normal">
								{currentTime.date}
							</span>
						</div>
					</motion.div>
				)}
			</motion.div>
		</div>
	);
}
