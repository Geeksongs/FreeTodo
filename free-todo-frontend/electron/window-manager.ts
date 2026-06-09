/**
 * 窗口管理服务
 * 封装 BrowserWindow 创建和事件处理
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { app, BrowserWindow, dialog, nativeImage, type WebContents } from "electron";
import {
	WINDOW_CONFIG,
} from "./config";
import { logger } from "./logger";

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;

/**
 * 窗口管理器类
 * 负责主窗口的创建、管理和事件处理
 */
export class WindowManager {
	/** 主窗口实例 */
	private mainWindow: BrowserWindow | null = null;
	/** 保存窗口的原始位置和尺寸（用于从全屏模式恢复） */
	private originalBounds: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;
	/**
	 * 是否处于"真正退出"状态。
	 *
	 * 默认情况下点右上角关闭按钮只把窗口 hide 到托盘，不让它真的 closed；
	 * 只有当 main.ts 在 `app.on("before-quit")` 中显式 setQuitting(true) 之后，
	 * close 事件才会放行让窗口真正销毁。这样保证：托盘"退出"/Ctrl+C/系统关机
	 * 都能正常 quit，但用户点 X 不会误关后台。
	 */
	private isQuitting = false;

	/**
	 * 为 webContents 绑定 Ctrl+=/Ctrl+-/Ctrl+0 缩放快捷键
	 */
	private setupZoomShortcuts(contents: WebContents): void {
		contents.on("before-input-event", (_event, input) => {
			if (!input.control && !input.meta) return;
			if (input.type !== "keyDown") return;

			const current = contents.getZoomFactor();

			if (input.key === "=" || input.key === "+") {
				contents.setZoomFactor(Math.min(current + ZOOM_STEP, ZOOM_MAX));
				_event.preventDefault();
			} else if (input.key === "-") {
				contents.setZoomFactor(Math.max(current - ZOOM_STEP, ZOOM_MIN));
				_event.preventDefault();
			} else if (input.key === "0") {
				contents.setZoomFactor(1.0);
				_event.preventDefault();
			}
		});
	}

	/**
	 * 获取应用图标（用于窗口标题栏和任务栏）
	 */
	private getAppIcon(): Electron.NativeImage | undefined {
		const candidates = [
			path.join(__dirname, "..", "public", "logo.png"),
			app.isPackaged ? path.join(process.resourcesPath, "standalone", "public", "logo.png") : "",
			app.isPackaged ? path.join(process.resourcesPath, "logo.png") : "",
		].filter(Boolean);

		for (const iconPath of candidates) {
			try {
				if (!fs.existsSync(iconPath)) continue;
				const buffer = fs.readFileSync(iconPath);
				const img = nativeImage.createFromBuffer(buffer);
				if (!img.isEmpty()) return img;
			} catch {
				// skip to next candidate
			}
		}
		return undefined;
	}

	/**
	 * 获取 preload 脚本路径
	 */
	private getPreloadPath(): string {
		if (app.isPackaged) {
			// 打包环境：preload.js 在 dist-electron 目录下（和 main.js 在同一目录）
			return path.join(app.getAppPath(), "dist-electron", "preload.js");
		}
		// 开发环境：使用编译后的文件路径（dist-electron 目录）
		return path.join(__dirname, "preload.js");
	}

	/**
	 * 等待服务器就绪
	 * @param url 服务器 URL
	 * @param timeout 超时时间（毫秒）
	 */
	private async waitForServer(url: string, timeout: number): Promise<void> {
		return new Promise((resolve, reject) => {
			const startTime = Date.now();

			const check = () => {
				http
					.get(url, (res) => {
						if (res.statusCode === 200 || res.statusCode === 304) {
							resolve();
						} else {
							retry();
						}
					})
					.on("error", () => {
						retry();
					});
			};

			const retry = () => {
				if (Date.now() - startTime >= timeout) {
					reject(new Error(`Server did not start within ${timeout}ms`));
				} else {
					setTimeout(check, 500);
				}
			};

			check();
		});
	}

	/**
	 * 获取原始窗口边界
	 */
	getOriginalBounds(): typeof this.originalBounds {
		return this.originalBounds;
	}

	/**
	 * 创建主窗口
	 * @param serverUrl 前端服务器 URL
	 */
	create(
		serverUrl: string,
		options?: { waitForServer?: boolean; showLoading?: boolean },
	): void {
		const { waitForServer = true, showLoading = false } = options ?? {};
		const preloadPath = this.getPreloadPath();

		// 保存原始位置和尺寸（用于从全屏模式恢复）
		if (!this.originalBounds) {
			this.originalBounds = {
				x: 0,
				y: 0,
				width: WINDOW_CONFIG.width,
				height: WINDOW_CONFIG.height,
			};
		}

		const isWin = process.platform === "win32";

		this.mainWindow = new BrowserWindow({
			width: WINDOW_CONFIG.width,
			height: WINDOW_CONFIG.height,
			minWidth: WINDOW_CONFIG.minWidth,
			minHeight: WINDOW_CONFIG.minHeight,
			autoHideMenuBar: true,
			frame: !isWin,
			transparent: false,
			alwaysOnTop: false,
			hasShadow: true,
			resizable: true,
			movable: true,
			skipTaskbar: false,
			icon: this.getAppIcon(),
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				preload: preloadPath,
				// 启用 <webview> 标签以支持内置浏览器面板（apps/browser）。
				// 内置浏览器使用 partition="persist:browser" 持久化登录态。
				webviewTag: true,
			},
			show: false,
			backgroundColor: WINDOW_CONFIG.backgroundColor,
		});


		this.setupZoomShortcuts(this.mainWindow.webContents);

		// 内置浏览器面板使用 <webview>。这里统一加固默认 webPreferences：
		// 强制禁用 nodeIntegration、保持 contextIsolation，避免任何登录页面
		// 通过我们的应用拿到 Node 能力。partition 仍由 <webview> 自己声明。
		this.mainWindow.webContents.on(
			"will-attach-webview",
			(_event, webPreferences, _params) => {
				delete webPreferences.preload;
				webPreferences.nodeIntegration = false;
				webPreferences.contextIsolation = true;
				webPreferences.sandbox = true;
			},
		);

		// 当一个 <webview> 真正 attach 上来后，给它的 webContents 注册：
		// 1) `setWindowOpenHandler`：拦截所有 target=_blank / window.open 请求，
		//    转发给渲染进程（apps/browser 会在主面板打开一个新 tab）。
		//    这是 Electron 22+ 必须的 API；旧的 `new-window` 事件已被移除，
		//    没有这个 handler 时弹窗会被静默吞掉，看起来就像「点链接没反应」。
		// 2) `did-create-window`：兜底防御。理论上 setWindowOpenHandler 返回
		//    `deny` 后不会再 create-window，但 Electron 在某些 PDF / OAuth
		//    场景仍会创建窗口；强制关掉以免出现游离的小窗口。
		this.mainWindow.webContents.on(
			"did-attach-webview",
			(_event, webContents) => {
				logger.info(
					`[browser] webview attached, registering setWindowOpenHandler (id=${webContents.id})`,
				);
				webContents.setWindowOpenHandler((details) => {
					const target = details.url;
					logger.info(
						`[browser] window.open intercepted: url=${target} disposition=${details.disposition}`,
					);
					if (
						target &&
						(target.startsWith("http://") ||
							target.startsWith("https://"))
					) {
						this.mainWindow?.webContents.send(
							"browser:open-in-new-tab",
							target,
						);
					}
					return { action: "deny" };
				});

			},
		);

		// 监听页面加载完成，检查 preload 脚本是否正确加载
		this.mainWindow.webContents.once("did-finish-load", () => {
			logger.info("Page finished loading, checking preload script...");
			// 注入调试代码检查 electronAPI
			this.mainWindow?.webContents
				.executeJavaScript(`
				(function() {
					const hasElectronAPI = typeof window.electronAPI !== 'undefined';
					const result = {
						hasElectronAPI,
						electronAPIKeys: hasElectronAPI ? Object.keys(window.electronAPI) : [],
						userAgent: navigator.userAgent,
					};
					console.log('[Electron Main] Preload script check:', result);
					return result;
				})();
			`)
				.then((result) => {
					logger.info(
						`Preload script check result: ${JSON.stringify(result, null, 2)}`,
					);
					if (!result.hasElectronAPI) {
						logger.warn(
							"WARNING: electronAPI is not available in renderer process!",
						);
						console.warn(
							"[WARN] electronAPI is not available. Check preload script loading.",
						);
					} else {
						logger.info("✅ electronAPI is available in renderer process");
						logger.info(`Available methods: ${result.electronAPIKeys.join(", ")}`);
					}
				})
				.catch((err) => {
					logger.error(`Error checking preload script: ${err instanceof Error ? err.message : String(err)}`);
					console.error("Error checking preload script:", err);
				});
		});

		// Windows 无边框模式：监听最大化/还原事件，通知渲染进程更新窗口控制按钮图标
		if (isWin) {
			this.mainWindow.on("maximize", () => {
				this.mainWindow?.webContents.send("window-maximize-changed", true);
			});
			this.mainWindow.on("unmaximize", () => {
				this.mainWindow?.webContents.send("window-maximize-changed", false);
			});
		}

		// 设置 ready-to-show 事件监听器
		this.mainWindow.once("ready-to-show", () => {
			if (this.mainWindow) {
				this.mainWindow.maximize();
				this.mainWindow.show();
				logger.info("Window is ready to show");
			}
		});

		// 拦截导航，防止加载到错误的 URL（如 DevTools URL）
		this.mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
			const parsedUrl = new URL(navigationUrl);
			// 只允许加载 localhost:PORT 的 URL
			if (
				parsedUrl.hostname !== "localhost" &&
				parsedUrl.hostname !== "127.0.0.1"
			) {
				event.preventDefault();
				logger.info(`Navigation blocked to: ${navigationUrl}`);
			}
			// 阻止加载 DevTools URL
			if (navigationUrl.startsWith("devtools://")) {
				event.preventDefault();
				logger.info(`DevTools URL blocked: ${navigationUrl}`);
			}
		});

		// 拦截关闭：默认只 hide 到托盘，不让窗口真的销毁。
		// 只有当 isQuitting=true（由 app.before-quit 触发）时才放行真正 close。
		this.mainWindow.on("close", (event) => {
			if (this.isQuitting) {
				return;
			}
			event.preventDefault();
			if (this.mainWindow && !this.mainWindow.isDestroyed()) {
				this.mainWindow.hide();
				logger.info("Window hidden to tray (close intercepted)");
			}
		});

		this.mainWindow.on("closed", () => {
			logger.info("Window closed");
			this.mainWindow = null;
		});

		// 处理窗口加载失败
		this.mainWindow.webContents.on(
			"did-fail-load",
			(_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
				// errorCode === -3 是 net::ERR_ABORTED：上一次 loadURL 还没加载完
				// 就被新的 loadURL 打断（启动时的 loading data: url → 真实页面就是
				// 典型场景）。子 frame 失败也不必当成主流程错误。这两种情况降级
				// 为 info 日志，避免误导排障。
				if (errorCode === -3 || !isMainFrame) {
					logger.info(
						`Window load aborted (benign): ${errorCode} - ${errorDescription}`,
					);
					return;
				}

				const errorMsg = `Window failed to load: ${errorCode} - ${errorDescription}`;
				logger.error(errorMsg);
				console.error(errorMsg);

				// 连接被拒绝或名称解析失败
				if (errorCode === -106 || errorCode === -105) {
					dialog.showErrorBox(
						"Connection Error",
						`Failed to connect to server at ${serverUrl}\n\nError: ${errorDescription}\n\nCheck logs at: ${logger.getLogFilePath()}`,
					);
				}
			},
		);

		// 处理渲染进程崩溃
		this.mainWindow.webContents.on("render-process-gone", (_event, details) => {
			const errorMsg = `Render process crashed: ${details.reason} (exit code: ${details.exitCode})`;
			if (details.reason === "clean-exit") {
				// clean-exit 是正常退出（exit code 0），不是真正崩溃，不弹对话框
				logger.info(errorMsg);
				return;
			}
			logger.fatal(errorMsg);
			console.error(errorMsg);

			dialog.showErrorBox(
				"Application Crashed",
				`The application window crashed:\n${details.reason}\n\nCheck logs at: ${logger.getLogFilePath()}`,
			);
		});

		// 处理未捕获的异常
		this.mainWindow.webContents.on("unresponsive", () => {
			logger.warn("Window became unresponsive");
		});

		this.mainWindow.webContents.on("responsive", () => {
			logger.info("Window became responsive again");
		});

		if (showLoading && this.mainWindow) {
			const loadingHtml = this.getLoadingPageHtml();
			const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`;
			this.mainWindow.loadURL(dataUrl);
		}

		// 确保服务器已经启动后再加载 URL
		const loadWindow = async () => {
			try {
				// 确保服务器就绪
				await this.waitForServer(serverUrl, 5000);
				logger.info(`Loading URL: ${serverUrl}`);
				if (this.mainWindow && !this.mainWindow.isDestroyed()) {
					this.mainWindow.loadURL(serverUrl);
				}
			} catch (error) {
				logger.warn(
					`Failed to verify server, loading URL anyway: ${error instanceof Error ? error.message : String(error)}`,
				);
				// 即使检查失败，也尝试加载（可能服务器刚启动）
				if (this.mainWindow && !this.mainWindow.isDestroyed()) {
					this.mainWindow.loadURL(serverUrl);
				}
			}
		};

		if (waitForServer) {
			// 延迟一点加载，确保窗口完全创建
			setTimeout(() => {
				loadWindow();
			}, 100);
		}
	}

	/**
	 * 主动加载指定 URL（用于延迟加载）
	 */
	load(serverUrl: string): void {
		if (this.mainWindow && !this.mainWindow.isDestroyed()) {
			this.mainWindow.loadURL(serverUrl);
		}
	}

	/**
	 * 内置加载界面
	 */
	private getLoadingPageHtml(): string {
		return `
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>UniCone Agent 加载中</title>
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0f1115; color: #e5e7eb; font-family: "Segoe UI", Arial, sans-serif; }
      .wrap { display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 14px; }
      .logo { font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: 14px; color: #9ca3af; }
      .spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid #2b303b; border-top-color: #3b82f6; animation: spin 1s linear infinite; }
      .hint { font-size: 13px; color: #9ca3af; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="spinner"></div>
      <div class="logo">UniCone Agent</div>
      <div class="hint">正在启动服务...</div>
    </div>
  </body>
</html>
`;
	}


	/**
	 * 聚焦窗口
	 * 如果窗口最小化则恢复；如果窗口被 hide 到托盘则重新 show；最后聚焦
	 */
	focus(): void {
		if (this.mainWindow) {
			if (this.mainWindow.isMinimized()) {
				this.mainWindow.restore();
			}
			if (!this.mainWindow.isVisible()) {
				this.mainWindow.show();
			}
			this.mainWindow.focus();
		}
	}

	/**
	 * 标记是否处于真正退出状态。
	 *
	 * main.ts 在 `app.before-quit` 中调用本方法把它置 true，之后窗口的
	 * close 事件就不会再被拦截，能正常销毁。任何走 `app.quit()` 的路径
	 * （托盘退出菜单、Ctrl+C、系统关机）都会经过 before-quit，所以这里
	 * 不需要每个调用方各自处理。
	 */
	setQuitting(quitting: boolean): void {
		this.isQuitting = quitting;
	}

	/**
	 * 获取主窗口实例
	 */
	getWindow(): BrowserWindow | null {
		return this.mainWindow;
	}


	/**
	 * 检查窗口是否存在
	 */
	hasWindow(): boolean {
		return this.mainWindow !== null;
	}

	/**
	 * 检查是否有任何窗口打开
	 */
	static hasAnyWindows(): boolean {
		return BrowserWindow.getAllWindows().length > 0;
	}
}
