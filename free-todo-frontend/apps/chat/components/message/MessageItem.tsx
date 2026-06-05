import { Loader2, MoreVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ExtractionState } from "@/apps/chat/hooks/useMessageExtraction";
import type { ChatMessage } from "@/apps/chat/types";
import { saveMessageFeedback } from "@/lib/api";
import { useChatStore } from "@/lib/store/chat-store";
import { cn } from "@/lib/utils";
import { MessageContent } from "./MessageContent";
import { MessageTodoExtractionPanel } from "./MessageTodoExtractionPanel";
import { ToolCallLoading } from "./ToolCallLoading";
import { ToolCallSteps } from "./ToolCallSteps";
import {
	extractToolCalls,
	removeToolCalls,
	removeToolEvents,
} from "./utils/messageContentUtils";

type FeedbackValue = "accept" | "reject" | null;

type MessageItemProps = {
	message: ChatMessage;
	isLastMessage: boolean;
	isStreaming: boolean;
	typingText: string;
	extractionState?: ExtractionState;
	onRemoveExtractionState: () => void;
	onMenuButtonClick: (event: React.MouseEvent, messageId: string) => void;
	onMessageBoxRef: (messageId: string, ref: HTMLDivElement | null) => void;
};

export function MessageItem({
	message,
	isLastMessage,
	isStreaming,
	typingText,
	extractionState,
	onRemoveExtractionState,
	onMenuButtonClick,
	onMessageBoxRef,
}: MessageItemProps) {
	const tContextMenu = useTranslations("contextMenu");
	const [hovered, setHovered] = useState(false);
	const [feedback, setFeedback] = useState<FeedbackValue>(null);
	const [reason, setReason] = useState("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const { conversationId } = useChatStore();

	const sanitizedContent = message.content
		? removeToolEvents(message.content)
		: "";
	// 检测工具调用标记（在消息渲染前）
	const toolCalls = sanitizedContent ? extractToolCalls(sanitizedContent) : [];
	// 移除工具调用标记后的内容
	const contentWithoutToolCalls = sanitizedContent
		? removeToolCalls(sanitizedContent)
		: "";

	// 获取新的工具调用步骤（来自 toolCallSteps 属性）
	const toolCallSteps = message.toolCallSteps || [];
	const hasToolCallSteps = toolCallSteps.length > 0;

	// 判断是否正在工具调用（有工具调用标记且移除标记后内容为空）
	// 或者有新的 toolCallSteps 且没有内容
	// 注意：只要有 toolCallSteps（无论是 running 还是 completed），就显示工具调用步骤
	const isToolCallingOnly =
		isStreaming &&
		isLastMessage &&
		message.role === "assistant" &&
		((toolCalls.length > 0 && !contentWithoutToolCalls.trim()) ||
			(hasToolCallSteps && !contentWithoutToolCalls.trim()));

	// 如果正在工具调用且没有实际内容，显示工具调用步骤
	if (isToolCallingOnly) {
		// 优先使用新的 toolCallSteps
		if (hasToolCallSteps) {
			return (
				<div className="flex flex-col items-start w-full px-4">
					<ToolCallSteps steps={toolCallSteps} />
				</div>
			);
		}

		// 降级到旧的 ToolCallLoading（兼容旧的工具调用标记）
		const lastToolCall = toolCalls[toolCalls.length - 1];
		// 提取搜索关键词（如果参数中包含"关键词:"）
		let searchQuery: string | undefined;
		if (lastToolCall.params) {
			const keywordMatch = lastToolCall.params.match(/关键词:\s*(.+)/);
			if (keywordMatch) {
				searchQuery = keywordMatch[1].trim();
			}
		}
		return (
			<div className="flex flex-col items-start w-full px-4">
				<ToolCallLoading
					toolName={lastToolCall.name}
					searchQuery={searchQuery}
				/>
			</div>
		);
	}

	// 判断是否是正在等待首次回复的空 assistant 消息
	const isEmptyStreamingMessage =
		isStreaming &&
		isLastMessage &&
		message.role === "assistant" &&
		!contentWithoutToolCalls.trim();

	// 跳过没有内容的非 streaming assistant 消息
	// 注意：这里使用 contentWithoutToolCalls 来判断，排除工具调用标记
	if (
		!contentWithoutToolCalls.trim() &&
		message.role === "assistant" &&
		!isEmptyStreamingMessage
	) {
		return null;
	}

	// 是否为 assistant 消息且不是空的 streaming 消息
	// 使用 contentWithoutToolCalls 来判断，排除工具调用标记
	const isAssistantMessageWithContent =
		message.role === "assistant" &&
		contentWithoutToolCalls.trim() &&
		!isEmptyStreamingMessage;

	// 处理消息菜单按钮点击
	const handleMessageMenuClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		onMenuButtonClick(event, message.id);
	};

	// 使用 ref callback 来传递 ref
	const handleMessageBoxRef = (el: HTMLDivElement | null) => {
		onMessageBoxRef(message.id, el);
	};

	return (
		<div
			className={cn(
				"flex flex-col",
				message.role === "assistant" ? "items-start" : "items-end",
			)}
		>
			{/* 空的 streaming 消息显示 loading 指示器 */}
			{isEmptyStreamingMessage ? (
				<div className="flex items-center gap-2 rounded-full bg-muted px-3 py-2 text-xs text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					{typingText}
				</div>
			) : (
				<div className="max-w-[80%]">
					{/* 工具调用步骤（显示在消息内容之前） */}
					{message.role === "assistant" && hasToolCallSteps && (
						<ToolCallSteps steps={toolCallSteps} className="mb-2" />
					)}
					<div
						ref={handleMessageBoxRef}
						role="group"
						className={cn(
							"relative rounded-2xl px-4 py-3 text-sm shadow-sm",
							message.role === "assistant"
								? "bg-muted/30 text-foreground"
								: "bg-primary/10 dark:bg-primary/20 text-foreground",
						)}
						onMouseEnter={() => {
							if (isAssistantMessageWithContent) {
								setHovered(true);
							}
						}}
						onMouseLeave={() => {
							setHovered(false);
						}}
					>
						{/* <div className="mb-1 text-[11px] uppercase tracking-wide opacity-70">
							{message.role === "assistant" ? t("assistant") : t("user")}
						</div> */}
						<div className="leading-relaxed relative">
							{/* Hover 时显示的菜单按钮 - 位于右下角 */}
							{hovered && isAssistantMessageWithContent && (
								<button
									type="button"
									onClick={handleMessageMenuClick}
									className="absolute -bottom-1 -right-1 opacity-70 hover:opacity-100 transition-opacity rounded-full p-1.5 bg-background/80 hover:bg-background shadow-sm border border-border/50"
									aria-label={tContextMenu("extractButton")}
								>
									<MoreVertical className="h-3.5 w-3.5" />
								</button>
							)}
							<MessageContent message={message} />
						</div>
					</div>
				</div>
			)}
			{/* Accept / Reject 反馈区 - 仅主动提示会话的 assistant 非 streaming 消息显示 */}
			{message.isProactive && isAssistantMessageWithContent && !isStreaming && (
				<div className="max-w-[80%] mt-2 flex flex-col gap-2">
					{saved ? (
						<p className="text-xs text-muted-foreground">
							{feedback === "accept" ? "✓ 已接受" : "✗ 已拒绝"} — 反馈已保存
						</p>
					) : (
						<>
							<div className="flex gap-2">
								<button
									type="button"
									disabled={saving}
									onClick={() => {
										setFeedback(feedback === "accept" ? null : "accept");
										setReason("");
									}}
									className={cn(
										"flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
										feedback === "accept"
											? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
											: "border-border bg-background text-muted-foreground hover:border-emerald-400 hover:text-emerald-600",
									)}
								>
									✓ Accept
								</button>
								<button
									type="button"
									disabled={saving}
									onClick={() => {
										setFeedback(feedback === "reject" ? null : "reject");
										setReason("");
									}}
									className={cn(
										"flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
										feedback === "reject"
											? "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400"
											: "border-border bg-background text-muted-foreground hover:border-orange-400 hover:text-orange-600",
									)}
								>
									✗ Reject
								</button>
							</div>
							{feedback && (
								<input
									type="text"
									value={reason}
									disabled={saving}
									onChange={(e) => setReason(e.target.value)}
									onKeyDown={async (e) => {
										if (e.key !== "Enter") return;
										const trimmed = reason.trim();
										if (!trimmed || !message.dbMessageId || !conversationId) return;
										setSaving(true);
										try {
											await saveMessageFeedback(
												conversationId,
												message.dbMessageId,
												feedback,
												trimmed,
											);
											setSaved(true);
										} catch (err) {
											console.error("保存反馈失败", err);
										} finally {
											setSaving(false);
										}
									}}
									placeholder={
										feedback === "accept"
											? "输入接受原因后按 Enter 保存..."
											: "输入拒绝原因后按 Enter 保存..."
									}
									className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none disabled:opacity-50"
								/>
							)}
						</>
					)}
				</div>
			)}
			{/* 提取待办面板 - 显示在消息下方 */}
			{extractionState && (
				<div
					className={cn(
						"w-full",
						message.role === "assistant" ? "max-w-[80%]" : "max-w-[80%]",
					)}
				>
					<MessageTodoExtractionPanel
						todos={extractionState.todos}
						parentTodoId={extractionState.parentTodoId}
						isExtracting={extractionState.isExtracting}
						onComplete={onRemoveExtractionState}
					/>
				</div>
			)}
		</div>
	);
}
