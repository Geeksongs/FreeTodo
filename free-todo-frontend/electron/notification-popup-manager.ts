/**
 * NotificationPopupManager
 *
 * 当前行为：v7 — 主动消息**永远**走悬浮窗，不再尝试根据主窗口可见性做智能路由。
 *
 * 历史：v8 曾经实现"主窗口可见且在前台时推到主窗口的 ChatPanel"的智能路由
 * （见 `tryDeliverToMainWindow` 实现）。但实测下用户主窗口一旦展开过一次就会
 * 持续命中智能路由，从此所有主动消息都被静默推进 ChatPanel，悬浮窗再也不弹，
 * 让用户误以为主动服务挂了。2026-05-08 用户选择回退到 v7 行为：永远弹悬浮窗。
 *
 * 如果将来要恢复 v8 智能路由，把 ``showChat`` 里调用 ``tryDeliverToMainWindow``
 * 的那一行恢复即可——方法体本身保留未删，便于一行回滚。
 */

import type { BrowserWindow } from "electron";
import { logger } from "./logger";
import { PopupWindowManager } from "./popup-window-manager";

export class NotificationPopupManager {
	private popupWindowManager = new PopupWindowManager();
	private mainWindowGetter: (() => BrowserWindow | null) | null = null;

	/**
	 * 注入主窗口获取函数，由 main.ts bootstrap 时调用。
	 * 这样 NotificationPopupManager 不需要直接依赖 WindowManager。
	 */
	setMainWindowGetter(getter: () => BrowserWindow | null): void {
		this.mainWindowGetter = getter;
	}

	showChat(message?: string, sessionId?: string): void {
		// v7 退化（2026-05-08）：跳过 tryDeliverToMainWindow，永远弹悬浮窗。
		// 要恢复 v8 智能路由把下面两行换回:
		//   if (message && this.tryDeliverToMainWindow(message, sessionId)) {
		//       return;
		//   }
		const wasBusy = this.popupWindowManager.isVisible();
		this.popupWindowManager.show(message, sessionId);
		logger.info(
			`[Popup] Chat popup shown (wasBusy=${wasBusy})${message ? ` message: ${message.slice(0, 60)}` : ""}${sessionId ? ` session: ${sessionId}` : ""}`,
		);
	}

	/**
	 * 尝试将主动消息投递到主窗口的 ChatPanel。
	 * 仅当主窗口存在、可见、未最小化时走此路径。
	 *
	 * 当前未被调用——v7 退化（2026-05-08）后 ``showChat`` 不再走智能路由。
	 * 保留方法体是为了将来一行回滚到 v8（在 ``showChat`` 顶部恢复调用即可）。
	 */
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: kept for v8 rollback
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	// @ts-expect-error kept for v8 rollback
	private tryDeliverToMainWindow(message: string, sessionId?: string): boolean {
		const mainWin = this.mainWindowGetter?.();
		if (!mainWin || mainWin.isDestroyed() || !mainWin.isVisible() || mainWin.isMinimized()) {
			return false;
		}

		const payload = JSON.stringify({ message, sessionId: sessionId || null });
		const code = `if(window.__mainHandleProactiveMessage){window.__mainHandleProactiveMessage(${payload});'ok'}else{'no_handler'}`;
		mainWin.webContents
			.executeJavaScript(code)
			.then((result) => {
				if (result === "ok") {
					logger.info(`[Popup] Proactive message delivered to main window: ${message.slice(0, 60)}`);
				} else {
					logger.info("[Popup] Main window handler not ready, falling back to popup");
					this.popupWindowManager.show(message, sessionId);
				}
			})
			.catch((err) => {
				logger.warn(`[Popup] Main window delivery failed, falling back to popup: ${err}`);
				this.popupWindowManager.show(message, sessionId);
			});

		return true;
	}

	showPopupOnly(message?: string, sessionId?: string): void {
		if (!message && sessionId) {
			this.popupWindowManager.showAndLoadSession(sessionId);
		} else {
			this.popupWindowManager.show(message, sessionId);
		}
	}

	isVisible(): boolean {
		return this.popupWindowManager.isVisible();
	}

	getPopupWindowManager(): PopupWindowManager {
		return this.popupWindowManager;
	}

	init(): void {
		logger.info("NotificationPopupManager initialized (v7 popup-always)");
	}

	stop(): void {
		this.popupWindowManager.close();
		logger.info("NotificationPopupManager stopped");
	}
}
