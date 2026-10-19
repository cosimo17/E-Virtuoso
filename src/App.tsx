import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Square,
  Headphones,
  Gamepad2,
  Minimize2,
  Maximize2,
  Lock,
  Unlock,
  Volume2,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import {
  FingeringState,
  OctaveMode,
  resolveHarmonicaFingering,
  Score,
} from "./types/score";
import {
  clipScoreSegment,
  parseMidiArrayBuffer,
  PRESET_SCORES,
} from "./utils/jianpuParser";
import { harmonicaSynth } from "./audio/harmonicaSynth";
import { VirtualHarmonica } from "./components/VirtualHarmonica";
import { ClipTimeline, formatTimeMs } from "./components/ClipTimeline";
import { ScoreManager } from "./components/ScoreManager";
import {
  nativeFocusGameWindow,
  nativeLoadScoresFromDisk,
  nativePollHostStatus,
  nativeSaveScoresToDisk,
  nativeSetClickThrough,
  nativeSetMiniMode,
  nativeSetWindowOpacity,
  nativeSyncBackendScore,
  nativeTriggerNote,
} from "./utils/nativeBridge";

const STORAGE_KEY = "e_virtuoso_saved_scores_v2";
const LEGACY_STORAGE_KEY = "e_virtuoso_saved_scores_v1";
const PRESET_ID_SET = new Set(PRESET_SCORES.map((p) => p.id));

function extractCustomScoresFromLocalStorage(): Score[] {
  const result: Score[] = [];
  const seenTitles = new Set<string>();

  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: Score[] = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const s of parsed) {
        if (
          s &&
          s.id &&
          !PRESET_ID_SET.has(s.id) &&
          Array.isArray(s.notes) &&
          s.notes.length > 0 &&
          !seenTitles.has(s.title)
        ) {
          seenTitles.add(s.title);
          result.push(s);
        }
      }
    } catch {
      // ignore
    }
  }
  return result;
}

const DEFAULT_FINGERING: FingeringState = {
  octave: "mid",
  leftHeld: false,
  middleHeld: false,
  rightHeld: false,
  activeKey: null,
  relSemitone: null,
};

export const App: React.FC = () => {
  const [scores, setScores] = useState<Score[]>(() => {
    const customScores = extractCustomScoresFromLocalStorage();
    const merged = [...customScores, ...PRESET_SCORES];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }
    return merged;
  });

  const [selectedScore, setSelectedScore] = useState<Score>(() => scores[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);
  const [localPreviewOnly, setLocalPreviewOnly] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [opacity, setOpacity] = useState(0.9);
  const [volume, setVolume] = useState(0.65);

  const [currentMs, setCurrentMs] = useState(0);
  const [clipStartMs, setClipStartMs] = useState(0);
  const [clipEndMs, setClipEndMs] = useState(0);
  const [loopClip, setLoopClip] = useState(false);

  const [miniHud, setMiniHud] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [fingering, setFingering] = useState<FingeringState>(DEFAULT_FINGERING);

  // 原生宿主状态（是否已连接 SendInput 宿主、是否具备管理员权限、当前锁定的游戏窗口名）
  const [hostConnected, setHostConnected] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [targetWindow, setTargetWindow] = useState("");

  // 高精度调度引用
  const playingRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const currentMsRef = useRef(0);
  const activeNoteIdRef = useRef<string | null>(null);
  const currentOctaveRef = useRef<OctaveMode>("mid");

  const clearCountdown = () => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownLeft(null);
  };

  // 启动时从磁盘 scores/custom_scores.json 及 scores/*.mid 同步曲谱，并将本机已导入曲谱自动回写到磁盘
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const payload = await nativeLoadScoresFromDisk();
      if (!payload || cancelled) return;

      const localCustom = extractCustomScoresFromLocalStorage();
      const diskCustom = (payload.customScores || []).filter(
        (s) => s && s.title && Array.isArray(s.notes) && !PRESET_ID_SET.has(s.id)
      );

      // 解析放入 scores/ 文件夹下的 .mid 文件
      const scannedMidis: Score[] = [];
      for (const mf of payload.midiFiles || []) {
        try {
          const binary = atob(mf.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const parsedMidi = parseMidiArrayBuffer(mf.name, bytes.buffer);
          scannedMidis.push(parsedMidi);
        } catch {
          // ignore invalid midi
        }
      }

      // 合并去重（按曲谱标题去重：优先保留磁盘 custom_scores.json 与本机导入曲谱）
      const mergedCustom: Score[] = [];
      const seenTitles = new Set<string>();
      for (const s of [...diskCustom, ...localCustom, ...scannedMidis]) {
        if (!seenTitles.has(s.title)) {
          seenTitles.add(s.title);
          mergedCustom.push(s);
        }
      }

      const finalScores = [...mergedCustom, ...PRESET_SCORES];
      setScores(finalScores);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalScores));
      } catch {
        // ignore
      }

      // 将合并后的所有自定义曲谱自动写回 scores/custom_scores.json，确保直接打包发布即可携带全部曲谱
      if (mergedCustom.length > 0) {
        await nativeSaveScoresToDisk(mergedCustom);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 持久化曲谱库（同时写入 localStorage 与程序目录下的 scores/custom_scores.json）
  const handleUpdateScores = (nextScores: Score[], nextSel?: Score) => {
    setScores(nextScores);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextScores));
    } catch {
      // ignore
    }
    const customList = nextScores.filter((s) => !PRESET_ID_SET.has(s.id));
    nativeSaveScoresToDisk(customList);

    if (nextSel) {
      handleSelectScore(nextSel);
    }
  };

  // 切换曲谱
  const handleSelectScore = (score: Score) => {
    handleStop();
    setSelectedScore(score);
    setClipStartMs(0);
    setClipEndMs(score.totalDurationMs);
    setCurrentMs(0);
    currentMsRef.current = 0;
    nativeSyncBackendScore(score, localPreviewOnly);
  };

  // 停止演奏并执行幂等释放复位（释放键盘按键 + 释放鼠标左/中/右键长按）
  const handleStop = () => {
    clearCountdown();
    playingRef.current = false;
    setIsPlaying(false);
    activeNoteIdRef.current = null;
    currentOctaveRef.current = "mid";
    harmonicaSynth.stopNote();
    nativeTriggerNote(-1);
    setFingering(DEFAULT_FINGERING);
    setCurrentMs(clipStartMs);
    currentMsRef.current = clipStartMs;
  };

  // 播放 / 暂停切换（在游戏演奏模式下：立即自动聚焦《三角洲行动》窗口，并延迟 2 秒后正式开始演奏）
  const handleTogglePlay = async () => {
    if (isPlaying || countdownLeft !== null) {
      clearCountdown();
      playingRef.current = false;
      setIsPlaying(false);
      activeNoteIdRef.current = null;
      harmonicaSynth.stopNote();
      nativeTriggerNote(-1);
      setFingering((prev) => ({
        ...prev,
        activeKey: null,
        leftHeld: false,
        middleHeld: false,
        rightHeld: false,
      }));
    } else {
      const effectiveEnd =
        clipEndMs > clipStartMs ? clipEndMs : selectedScore.totalDurationMs;
      if (
        currentMsRef.current >= effectiveEnd ||
        currentMsRef.current < clipStartMs
      ) {
        currentMsRef.current = clipStartMs;
        setCurrentMs(clipStartMs);
      }

      if (!localPreviewOnly) {
        // 1. 立即自动将窗口焦点切换到《三角洲行动》游戏窗口
        await nativeFocusGameWindow();

        // 2. 启动 2.0 秒延迟倒计时，结束后正式开始演奏
        const startWait = performance.now();
        setCountdownLeft(2.0);
        countdownTimerRef.current = window.setInterval(async () => {
          const elapsedSec = (performance.now() - startWait) / 1000;
          const remain = Math.max(0, 2.0 - elapsedSec);
          if (remain <= 0.05) {
            clearCountdown();
            await nativeFocusGameWindow();
            playingRef.current = true;
            setIsPlaying(true);
          } else {
            setCountdownLeft(Number(remain.toFixed(1)));
          }
        }, 80);
      } else {
        playingRef.current = true;
        setIsPlaying(true);
      }
    }
  };

  // 实时高精度演奏循环（使用高频 Timer 替代 requestAnimationFrame，彻底避免焦点切回游戏后被后台节流）
  useEffect(() => {
    if (!isPlaying) return;

    let lastTime = performance.now();

    const timerId = window.setInterval(() => {
      if (!playingRef.current) return;
      const now = performance.now();
      const dt = now - lastTime;
      lastTime = now;

      const nextMs = currentMsRef.current + dt * speed;
      const effectiveEnd =
        clipEndMs > clipStartMs ? clipEndMs : selectedScore.totalDurationMs;

      if (nextMs >= effectiveEnd) {
        harmonicaSynth.stopNote();
        nativeTriggerNote(-1);
        activeNoteIdRef.current = null;

        if (loopClip) {
          currentMsRef.current = clipStartMs;
          setCurrentMs(clipStartMs);
        } else {
          handleStop();
        }
        return;
      }

      currentMsRef.current = nextMs;
      setCurrentMs(Math.round(nextMs));

      // 查找当前时刻正在吹奏的音符
      const activeNote = selectedScore.notes.find(
        (n) => nextMs >= n.startMs && nextMs < n.startMs + n.durationMs
      );

      const nextId = activeNote ? activeNote.id : null;
      if (nextId !== activeNoteIdRef.current) {
        activeNoteIdRef.current = nextId;

        if (activeNote) {
          const resolved = resolveHarmonicaFingering(
            activeNote.relSemitone,
            currentOctaveRef.current
          );
          currentOctaveRef.current = resolved.octave;

          setFingering({
            octave: resolved.octave,
            leftHeld: resolved.leftHeld,
            middleHeld: resolved.middleHeld,
            rightHeld: resolved.rightHeld,
            activeKey: resolved.key,
            relSemitone: activeNote.relSemitone,
          });

          if (localPreviewOnly) {
            harmonicaSynth.startNote(activeNote.relSemitone);
          } else {
            harmonicaSynth.stopNote();
            nativeTriggerNote(activeNote.relSemitone);
          }
        } else {
          // 音符间隙 (-2)：仅释放键盘琴键，保持当前鼠标八度长按状态不松开
          harmonicaSynth.stopNote();
          if (!localPreviewOnly) {
            nativeTriggerNote(-2);
          }
          setFingering((prev) => ({
            ...prev,
            activeKey: null,
            relSemitone: null,
          }));
        }
      }
    }, 8);

    return () => window.clearInterval(timerId);
  }, [
    isPlaying,
    speed,
    clipStartMs,
    clipEndMs,
    loopClip,
    selectedScore,
    localPreviewOnly,
  ]);

  const lastHotkeyRef = useRef<{ key: string; time: number }>({
    key: "",
    time: 0,
  });
  const hotkeyActionRef = useRef<(hk: string) => void>(() => {});

  hotkeyActionRef.current = (hk: string) => {
    const now = performance.now();
    if (
      lastHotkeyRef.current.key === hk &&
      now - lastHotkeyRef.current.time < 300
    ) {
      return;
    }
    lastHotkeyRef.current = { key: hk, time: now };

    if (hk === "F5") {
      handleTogglePlay();
    } else if (hk === "F6") {
      handleStop();
    } else if (hk === "F7") {
      setLocalPreviewOnly((prev) => {
        const next = !prev;
        if (next) nativeTriggerNote(-1);
        return next;
      });
    } else if (hk === "F8") {
      handleToggleClickThrough();
    }
  };

  // 窗口内键盘快捷键绑定 (F5 播放/暂停, F6 停止复位, F7 模式切换, F8 鼠标穿透切换)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F5" || e.key === "F6" || e.key === "F7" || e.key === "F8") {
        e.preventDefault();
        hotkeyActionRef.current(e.key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 后台全局热键与宿主状态轮询（独立空依赖 [] 定时器，绝不被播放进度 8ms 重渲染打断）
  useEffect(() => {
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const status = await nativePollHostStatus();
        setHostConnected(status.connected);
        setIsAdmin(status.isAdmin);
        if (status.targetWindow) {
          setTargetWindow(status.targetWindow);
        }
        if (status.hotkey) {
          hotkeyActionRef.current(status.hotkey);
        }
      } finally {
        busy = false;
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, []);

  // 切换迷你 HUD 模式
  const handleToggleMiniHud = () => {
    const next = !miniHud;
    setMiniHud(next);
    nativeSetMiniMode(next);
  };

  // 切换鼠标穿透
  const handleToggleClickThrough = () => {
    const next = !clickThrough;
    setClickThrough(next);
    nativeSetClickThrough(next);
  };

  // 将 A-B 选中片段截取另存为独立新曲谱
  const handleSaveClipAsScore = () => {
    const effectiveEnd =
      clipEndMs > clipStartMs ? clipEndMs : selectedScore.totalDurationMs;
    const newScore = clipScoreSegment(
      selectedScore,
      clipStartMs,
      effectiveEnd,
      `${selectedScore.title} [片段]`
    );
    const nextList = [newScore, ...scores];
    handleUpdateScores(nextList, newScore);
  };

  // 手动按压虚拟琴键试音
  const handleManualPress = (relSemitone: number) => {
    const resolved = resolveHarmonicaFingering(
      relSemitone,
      currentOctaveRef.current
    );
    setFingering({
      octave: resolved.octave,
      leftHeld: resolved.leftHeld,
      middleHeld: resolved.middleHeld,
      rightHeld: resolved.rightHeld,
      activeKey: resolved.key,
      relSemitone,
    });
    harmonicaSynth.startNote(relSemitone);
  };

  const handleManualRelease = () => {
    harmonicaSynth.stopNote();
    setFingering((prev) => ({
      ...prev,
      activeKey: null,
      relSemitone: null,
    }));
  };

  // 迷你悬浮胶囊条模式 (Mini Overlay HUD)
  if (miniHud) {
    return (
      <div
        style={{ opacity }}
        className="w-full max-w-[440px] mx-auto rounded-2xl border border-[#d4b88c]/45 bg-[#26201a]/90 backdrop-blur-md p-2.5 shadow-2xl space-y-1.5"
      >
        <div
          data-tauri-drag-region
          className="flex items-center justify-between text-xs px-1 cursor-move"
        >
          <div className="flex items-center gap-2 truncate">
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                localPreviewOnly
                  ? "bg-sky-500/30 text-sky-200 border border-sky-400/40"
                  : "bg-amber-500/30 text-amber-200 border border-amber-400/40"
              }`}
            >
              {localPreviewOnly ? "🎧试听" : "🎮实战"}
            </span>
            <span className="font-medium text-amber-100 truncate">
              {selectedScore.title}
            </span>
            <span className="font-mono text-[11px] text-white/60">
              {formatTimeMs(currentMs)}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleTogglePlay}
              className="p-1 rounded bg-amber-500/30 hover:bg-amber-500/50 text-amber-100"
              title="播放/暂停并切回游戏焦点 (F5)"
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleStop}
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/80"
              title="停止并释放按键 (F6)"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleToggleClickThrough}
              className={`p-1 rounded ${
                clickThrough
                  ? "bg-red-500/40 text-red-100"
                  : "bg-white/10 text-white/70"
              }`}
              title="鼠标穿透开关 (F8)"
            >
              {clickThrough ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <Unlock className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleToggleMiniHud}
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-amber-200"
              title="展开完整工作台"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <VirtualHarmonica
          fingering={fingering}
          compact
          onManualPress={handleManualPress}
          onManualRelease={handleManualRelease}
        />
      </div>
    );
  }

  return (
    <div
      style={{ opacity }}
      className="w-full max-w-[560px] mx-auto rounded-2xl border border-[#d4b88c]/45 bg-[#26201a]/92 backdrop-blur-xl p-3 shadow-2xl space-y-2 text-amber-50"
    >
      {/* 顶部标题与模式切换栏（支持窗口拖拽） */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-[#d4b88c]/25 pb-2 cursor-move"
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-500/25 border border-amber-300/40 flex items-center justify-center text-amber-200">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide text-[#f3e5c8] flex items-center gap-1.5">
              <span>E-Virtuoso</span>
              {hostConnected ? (
                <span
                  className={`text-[10px] font-normal px-1.5 py-0.2 rounded flex items-center gap-0.5 ${
                    isAdmin
                      ? "bg-emerald-500/25 text-emerald-200 border border-emerald-400/40"
                      : "bg-amber-500/25 text-amber-200 border border-amber-400/40"
                  }`}
                  title={
                    isAdmin
                      ? "原生键鼠驱动已就绪（管理员权限）"
                      : "原生键鼠驱动已连接（若游戏为管理员权限，请以管理员身份运行 E-Virtuoso.exe）"
                  }
                >
                  <ShieldCheck className="w-3 h-3" />
                  {isAdmin ? "驱动就绪(管理员)" : "驱动就绪(普通)"}
                </span>
              ) : (
                <span
                  className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-red-500/30 text-red-200 border border-red-400/40 flex items-center gap-0.5"
                  title="请双击运行根目录下的 E-Virtuoso.exe 启动原生键鼠注入服务"
                >
                  <AlertTriangle className="w-3 h-3" />
                  未连接 E-Virtuoso.exe
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 本地试听 vs 游戏实战 切换开关 */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-black/40 p-0.5 border border-[#d4b88c]/25 text-xs">
            <button
              type="button"
              onClick={() => {
                setLocalPreviewOnly(true);
                nativeTriggerNote(-1);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                localPreviewOnly
                  ? "bg-sky-500/35 text-sky-100 border border-sky-400/50 font-medium shadow"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>本地试听</span>
            </button>
            <button
              type="button"
              onClick={() => {
                harmonicaSynth.stopNote();
                setLocalPreviewOnly(false);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                !localPreviewOnly
                  ? "bg-amber-500/40 text-amber-100 border border-amber-300/60 font-medium shadow"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Gamepad2 className="w-3.5 h-3.5" />
              <span>游戏演奏</span>
            </button>
          </div>

          {/* 透明度调节 */}
          <div
            className="flex items-center gap-1 text-[11px] text-white/70 bg-black/30 px-2 py-1 rounded-lg border border-white/10"
            title="悬浮窗半透明度调节"
          >
            <span>透明</span>
            <input
              type="range"
              min={0.35}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => {
                const val = Number(e.target.value);
                setOpacity(val);
                nativeSetWindowOpacity(val);
              }}
              className="w-12 accent-amber-300 cursor-pointer h-1"
            />
          </div>

          <button
            type="button"
            onClick={handleToggleMiniHud}
            title="折叠为迷你游戏悬浮条"
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-amber-100 transition"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 中部：曲谱管理与简谱/MIDI 工作台 */}
      <ScoreManager
        scores={scores}
        selectedScore={selectedScore}
        onSelectScore={handleSelectScore}
        onUpdateScores={handleUpdateScores}
      />

      {/* A-B 片段截取与进度控制条 */}
      <ClipTimeline
        currentMs={currentMs}
        totalDurationMs={selectedScore.totalDurationMs}
        clipStartMs={clipStartMs}
        clipEndMs={clipEndMs || selectedScore.totalDurationMs}
        loopClip={loopClip}
        onSeek={(ms) => {
          currentMsRef.current = ms;
          setCurrentMs(ms);
        }}
        onChangeClipStart={(ms) => {
          setClipStartMs(ms);
          if (currentMsRef.current < ms) {
            currentMsRef.current = ms;
            setCurrentMs(ms);
          }
        }}
        onChangeClipEnd={(ms) => setClipEndMs(ms)}
        onToggleLoopClip={() => setLoopClip((p) => !p)}
        onSaveClipAsScore={handleSaveClipAsScore}
        onResetClip={() => {
          setClipStartMs(0);
          setClipEndMs(selectedScore.totalDurationMs);
        }}
      />

      {/* 播放控制与倍速调节栏 */}
      <div className="flex items-center justify-between rounded-lg border border-[#d4b88c]/25 bg-black/25 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTogglePlay}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500/80 to-amber-600/80 hover:from-amber-500 hover:to-amber-600 text-white font-semibold shadow transition"
          >
            {countdownLeft !== null ? (
              <>
                <Pause className="w-3.5 h-3.5 animate-pulse" />
                <span>准备演奏 {countdownLeft.toFixed(1)}s...</span>
              </>
            ) : isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>暂停 (F5)</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>开始演奏 (F5)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleStop}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/85 transition"
            title="停止并释放所有长按鼠标与键盘键 (F6)"
          >
            <Square className="w-3.5 h-3.5" />
            <span>停止复位 (F6)</span>
          </button>
        </div>

        {/* 变速倍率 */}
        <div className="flex items-center gap-1">
          <span className="text-white/60 mr-1">倍速:</span>
          {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => setSpeed(rate)}
              className={`px-1.5 py-0.5 rounded text-[11px] transition ${
                speed === rate
                  ? "bg-amber-500/40 border border-amber-300/60 text-amber-100 font-semibold"
                  : "bg-white/5 text-white/65 hover:bg-white/15"
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* 试听音量 */}
        <div className="flex items-center gap-1.5 text-white/75">
          <Volume2 className="w-3.5 h-3.5 text-amber-200" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              harmonicaSynth.setVolume(v);
            }}
            className="w-14 accent-amber-400 cursor-pointer h-1"
          />
        </div>
      </div>

      {/* 底部：1:1 游戏口琴按键与鼠标长按状态面板 */}
      <VirtualHarmonica
        fingering={fingering}
        onManualPress={handleManualPress}
        onManualRelease={handleManualRelease}
      />

      {/* 底部目标窗口锁定与热键提示栏 */}
      <div className="flex items-center justify-between text-[11px] text-white/60 px-1">
        <span className="truncate max-w-[310px]">
          {targetWindow
            ? `🎯 已锁定窗口: ${targetWindow}`
            : "🎯 将自动查找并聚焦《三角洲行动》窗口"}
        </span>
        <span className="shrink-0">热键: F5开演 | F6复位 | F7模式 | F8穿透</span>
      </div>
    </div>
  );
};

export default App;
