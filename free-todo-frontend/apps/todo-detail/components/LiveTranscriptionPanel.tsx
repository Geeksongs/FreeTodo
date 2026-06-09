"use client";

import { useEffect, useRef } from "react";
import { useAudioRecordingStore } from "@/lib/store/audio-recording-store";

interface Segment {
	timeLabel: string;
	lines: string[];
}

export function LiveTranscriptionPanel() {
	const transcriptionText = useAudioRecordingStore((s) => s.transcriptionText);
	const partialText = useAudioRecordingStore((s) => s.partialText);
	const segmentTimeLabels = useAudioRecordingStore((s) => s.segmentTimeLabels);
	const isRecording = useAudioRecordingStore((s) => s.isRecording);
	const scrollRef = useRef<HTMLDivElement>(null);
	const userNearBottomRef = useRef(true);

	// 自动滚动到底部（仅当用户在底部附近时）
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !userNearBottomRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [transcriptionText, partialText]);

	// 开始录音时强制滚到底
	useEffect(() => {
		if (!isRecording) return;
		userNearBottomRef.current = true;
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [isRecording]);

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
		<div className="flex flex-col border-t border-border" style={{ height: 200 }}>
			{/* 标题栏 */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2">
				<span
					className={`h-2 w-2 rounded-full ${
						isRecording
							? "animate-pulse bg-red-500"
							: "bg-muted-foreground/30"
					}`}
				/>
				<span className="text-xs font-medium text-muted-foreground">
					实时转写
				</span>
				{!isRecording && (
					<span className="ml-auto text-[10px] text-muted-foreground/50">
						录音未开始
					</span>
				)}
			</div>

			{/* 文本区域 */}
			<div
				ref={scrollRef}
				className="flex-1 overflow-y-auto px-4 py-2 space-y-3"
				onScroll={() => {
					const el = scrollRef.current;
					if (!el) return;
					userNearBottomRef.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 60;
				}}
			>
				{!hasContent ? (
					<p className="mt-4 text-center text-xs text-muted-foreground/40">
						{isRecording ? "等待语音输入…" : "暂无转写内容"}
					</p>
				) : (
					<>
						{segments.map((seg, si) => (
							<div key={`${si}-${seg.timeLabel}`}>
								{seg.timeLabel && (
									<div className="mb-1 text-[10px] font-medium text-muted-foreground/60">
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
						{/* 实时未确认文字 */}
						{partialText.trim() && (
							<p className="text-sm italic text-muted-foreground/60">
								{partialText}…
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
}
