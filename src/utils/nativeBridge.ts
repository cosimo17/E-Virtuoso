import { Score } from "../types/score";

const HOST_BASE = "http://127.0.0.1:17890";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let triggerSeq = 0;

/**
 * 触发音符或释放按键：
 * - relSemitone >= 0 (0..36): 按下对应音符并保持对应鼠标变调长按
 * - relSemitone === -2: 音符换气间隙，仅释放键盘按键，保持鼠标长按不松开
 * - relSemitone === null 或 -1: 停止/暂停，幂等释放所有键盘与鼠标左/中/右键
 */
export async function nativeTriggerNote(
  relSemitone: number | null
): Promise<void> {
  const seq = ++triggerSeq;

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("trigger_single_note", {
        relSemitone: relSemitone !== null && relSemitone >= 0 ? relSemitone : null,
      });
      return;
    } catch {
      // fallback
    }
  }

  fetch(`${HOST_BASE}/api/trigger_note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relSemitone: relSemitone ?? -1, seq }),
  }).catch(() => {});
}

/**
 * 当用户在工具界面上点击“播放”时，自动将系统输入焦点归还给游戏窗口
 */
export async function nativeFocusGameWindow(): Promise<void> {
  fetch(`${HOST_BASE}/api/focus_game`, {
    method: "POST",
  }).catch(() => {});
}

export async function nativeSetClickThrough(enabled: boolean): Promise<void> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_click_through", { enabled });
      return;
    } catch {
      // fallback
    }
  }
  fetch(`${HOST_BASE}/api/window`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clickThrough: enabled }),
  }).catch(() => {});
}

export async function nativeSetWindowOpacity(opacity: number): Promise<void> {
  fetch(`${HOST_BASE}/api/window`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opacity }),
  }).catch(() => {});
}

export async function nativeSetMiniMode(mini: boolean): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      const win = getCurrentWindow();
      if (mini) {
        await win.setSize(new LogicalSize(470, 230));
      } else {
        await win.setSize(new LogicalSize(600, 700));
      }
      return;
    } catch {
      // fallback
    }
  }
  fetch(`${HOST_BASE}/api/window`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mini }),
  }).catch(() => {});
}

export interface HostStatusInfo {
  connected: boolean;
  hotkey: string | null;
  isAdmin: boolean;
  targetWindow: string;
}

export async function nativePollHostStatus(): Promise<HostStatusInfo> {
  try {
    const res = await fetch(`${HOST_BASE}/api/poll_hotkey`);
    if (!res.ok) {
      return { connected: false, hotkey: null, isAdmin: false, targetWindow: "" };
    }
    const data = await res.json();
    return {
      connected: true,
      hotkey: data.hotkey || null,
      isAdmin: Boolean(data.isAdmin),
      targetWindow: data.targetWindow || "",
    };
  } catch {
    return { connected: false, hotkey: null, isAdmin: false, targetWindow: "" };
  }
}

export async function nativeSyncBackendScore(
  score: Score,
  localPreviewOnly: boolean
): Promise<void> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("load_score", { score });
      await invoke("update_playback_config", {
        config: {
          localPreviewOnly,
          speed: 1.0,
          clipStartMs: 0,
          clipEndMs: score.totalDurationMs,
          loopClip: false,
        },
      });
    } catch {
      // ignore
    }
  }
}

export interface DiskScoresPayload {
  customScores: Score[];
  midiFiles: { name: string; base64: string }[];
}

/**
 * 从程序同级目录下的 scores/custom_scores.json 及 scores/*.mid 加载曲谱库
 */
export async function nativeLoadScoresFromDisk(): Promise<DiskScoresPayload | null> {
  try {
    const res = await fetch(`${HOST_BASE}/api/scores_sync`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      customScores: Array.isArray(data.customScores) ? data.customScores : [],
      midiFiles: Array.isArray(data.midiFiles) ? data.midiFiles : [],
    };
  } catch {
    return null;
  }
}

/**
 * 将用户导入/编辑的所有自定义曲谱自动持久化保存到 scores/custom_scores.json，方便随程序一起打包分发
 */
export async function nativeSaveScoresToDisk(
  customScores: Score[]
): Promise<void> {
  try {
    await fetch(`${HOST_BASE}/api/scores_sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customScores),
    });
  } catch {
    // ignore
  }
}

