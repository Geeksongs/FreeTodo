"use client";

import { useAutoRecording } from "@/lib/hooks/useAutoRecording";

/**
 * 全局录音初始化组件 — 挂载在根 layout，确保任意页面模式（Island/Home/Popup）
 * 下都能根据 audioIs24x7 配置自动启动录音，而不依赖特定页面是否渲染。
 */
export function AudioRecordingInit() {
	useAutoRecording();
	return null;
}
