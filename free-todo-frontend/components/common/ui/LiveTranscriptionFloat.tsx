"use client";

import { useEffect, useRef, useState } from "react";
import { useAudioRecordingStore } from "@/lib/store/audio-recording-store";

interface Segment {
	timeLabel: string;
	lines: string[];
}

export function LiveTranscriptionFloat() {
	const transcriptionText = useAudioRecordingStore((s) => s.transcriptionText);
	const partialText = useAudioRecordingStore((s) => s.partialText);
	const segmentTimeLabels = useAudioRecordingStore((s) => s.segmentTimeLabels);
	const isRecording = useAudioRecordingStore((s) => s.isRecording);
	const startRecording = useAudioRecordingStore((s) => s.startRecording);
	const appendTranscriptionText = useAudioRecordingStore((s) => s.appendTranscriptionText);
	const updateLastFinalEnd = useAudioRecordingStore((s) => s.updateLastFinalEnd);
	const appendSegmentData = useAudioRecordingStore((s) => s.appendSegmentData);
	const setPartialText = useAudioRecordingStore((s) => s.setPartialText);
	const clearSessionData = useAudioRecordingStore((s) => s.clearSessionData);

	const scrollRef = useRef<HTMLDivElement>(null);
	const userNearBottomRef = useRef(true);
	const [collapsed, setCollapsed] = useState(false);
	const [starting, setStarting] = useState(false);

	// 自动滚到底部（仅当用户在底部附近）
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !userNearBottomRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [transcriptionText, partialText]);

	useEffect(() => {
		if (!isRecording) return;
		userNearBottomRef.current = true;
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [isRecording]);

	// 手动启动录音（点击按钮触发麦克风权限请求）
	const handleStartRecording = async () => {
		if (isRecording || starting) return;
		setStarting(true);
		try {
			clearSessionData();
			await startRecording(
				(text, isFinal) => {
					if (isFinal && text.startsWith("__SEGMENT_SAVED__")) return;
					if (isFinal) {
						const state = useAudioRecordingStore.getState();
						const startedAt = state.recordingStartedAt ?? Date.now();
						const lastEnd = state.lastFinalEndMs;
						const elapsed = ((lastEnd ?? startedAt) - startedAt) / 1000;
						updateLastFinalEnd(Date.now());
						appendTranscriptionText(text);
						const now = new Date();
						const label = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
						appendSegmentData({ timeSec: elapsed, timeLabel: label, recordingId: 0, offsetSec: elapsed });
						setPartialText("");
					} else {
						setPartialText(text);
					}
				},
				undefined,
				(err) => console.error("[LiveTranscriptionFloat] 录音错误:", err),
				true,
			);
		} catch (e) {
			console.error("[LiveTranscriptionFloat] 启动失败:", e);
		} finally {
			setStarting(false);
		}
	};

	// 把 transcriptionText 按行拆分，与 segmentTimeLabels 对应，按时间段分组
	const lines = transcriptionText.split("\n").filter((l) => l.trim());
	const segments: Segment[] = [];
	for (let i = 0; i < lines.length; i++) {
		const label = segmentTimeLabels[i] ?? "";
		const last = segments[segments.length - 1];
		if (last && last.timeLabel === label) {
			last.lines.push(lines[i]);
		} else {
			segments.push({ timeLabel: label, lines: [lines[i]] });
		}
	}

	const hasContent = lines.length > 0 || partialText.trim();

	return (
		<div
			className="fixed bottom-16 right-4 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
			style={{ width: 300, height: collapsed ? "auto" : 220 }}
		>
			{/* 标题栏 */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
				{/* 录音状态点 / 开始按钮 */}
				{isRecording ? (
					<span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
				) : (
					<button
						type="button"
						onClick={handleStartRecording}
						disabled={starting}
						className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted hover:bg-muted-foreground/20 disabled:opacity-50 transition-colors"
						title="开始录音"
					>
						<span className="text-[9px]">▶</span>
					</button>
				)}

				{/* 标题 — 点击折叠/展开 */}
				<button
					type="button"
					className="flex-1 cursor-pointer text-left text-xs font-medium text-muted-foreground"
					onClick={() => setCollapsed((v) => !v)}
				>
					{isRecording ? "实时转写" : starting ? "连接中…" : "实时转写（未录音）"}
				</button>

				<span
					className="cursor-pointer text-[10px] text-muted-foreground/40"
					onClick={() => setCollapsed((v) => !v)}
				>
					{collapsed ? "▲" : "▼"}
				</span>
			</div>

			{/* 文本区域 */}
			{!collapsed && (
				<div
					ref={scrollRef}
					className="flex-1 space-y-2 overflow-y-auto px-3 py-2"
					onScroll={() => {
						const el = scrollRef.current;
						if (!el) return;
						userNearBottomRef.current =
							el.scrollHeight - el.scrollTop - el.clientHeight < 60;
					}}
				>
					{!hasContent ? (
						<p className="mt-4 text-center text-xs text-muted-foreground/40">
							{isRecording
								? "等待语音输入…"
								: "点击 ▶ 开始录音，或等待自动启动"}
						</p>
					) : (
						<>
							{segments.map((seg, si) => (
								<div key={`${si}-${seg.timeLabel}`}>
									{seg.timeLabel && (
										<div className="mb-0.5 text-[10px] font-medium text-muted-foreground/60">
											{seg.timeLabel}
										</div>
									)}
									{seg.lines.map((line, li) => (
										<p
											key={`${si}-${li}`}
											className="text-sm leading-relaxed text-foreground"
										>
											{line}
										</p>
									))}
								</div>
							))}
							{partialText.trim() && (
								<p className="text-sm italic text-muted-foreground/60">
									{partialText}…
								</p>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
