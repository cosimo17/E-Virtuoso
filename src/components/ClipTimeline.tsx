import React from "react";
import { Scissors, Repeat } from "lucide-react";

interface ClipTimelineProps {
  currentMs: number;
  totalDurationMs: number;
  clipStartMs: number;
  clipEndMs: number;
  loopClip: boolean;
  onSeek: (ms: number) => void;
  onChangeClipStart: (ms: number) => void;
  onChangeClipEnd: (ms: number) => void;
  onToggleLoopClip: () => void;
  onSaveClipAsScore: () => void;
  onResetClip: () => void;
}

export function formatTimeMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${tenths}`;
}

export const ClipTimeline: React.FC<ClipTimelineProps> = ({
  currentMs,
  totalDurationMs,
  clipStartMs,
  clipEndMs,
  loopClip,
  onSeek,
  onChangeClipStart,
  onChangeClipEnd,
  onToggleLoopClip,
  onSaveClipAsScore,
  onResetClip,
}) => {
  const safeTotal = Math.max(1000, totalDurationMs);
  const effectiveEnd = clipEndMs > clipStartMs ? clipEndMs : safeTotal;
  const isClipped = clipStartMs > 0 || (clipEndMs > 0 && clipEndMs < safeTotal);

  const startPct = Math.min(100, (clipStartMs / safeTotal) * 100);
  const endPct = Math.min(100, (effectiveEnd / safeTotal) * 100);
  const curPct = Math.min(100, (currentMs / safeTotal) * 100);

  return (
    <div className="rounded-lg border border-[#d4b88c]/25 bg-black/25 p-2.5 space-y-2 text-xs">
      {/* 顶部时间与 A-B 区间状态 */}
      <div className="flex items-center justify-between text-[#e8dec8]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-amber-200 font-semibold">
            {formatTimeMs(currentMs)}
          </span>
          <span className="text-white/40">/</span>
          <span className="font-mono text-white/70">
            {formatTimeMs(totalDurationMs)}
          </span>
          {isClipped && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] text-amber-200">
              A-B 区间: {formatTimeMs(clipStartMs)} ~ {formatTimeMs(effectiveEnd)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleLoopClip}
            title="区间循环播放"
            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] transition ${
              loopClip
                ? "bg-amber-500/30 border-amber-300/60 text-amber-100"
                : "bg-white/5 border-white/10 text-white/60 hover:text-white"
            }`}
          >
            <Repeat className="w-3 h-3" />
            <span>循环</span>
          </button>

          {isClipped && (
            <>
              <button
                type="button"
                onClick={onSaveClipAsScore}
                title="将当前选中的 A-B 区间截取另存为独立新曲谱"
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-600/40 hover:bg-amber-600/60 border border-amber-300/50 text-amber-100 text-[11px] transition"
              >
                <Scissors className="w-3 h-3" />
                <span>截取另存</span>
              </button>
              <button
                type="button"
                onClick={onResetClip}
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-white/70 text-[11px]"
              >
                重置区间
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主播放进度条（含高亮 A-B 区间带） */}
      <div className="relative h-5 flex items-center">
        <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden relative">
          {/* A-B 选中区域高亮带 */}
          <div
            className="absolute top-0 bottom-0 bg-amber-500/25 border-x border-amber-400/60"
            style={{
              left: `${startPct}%`,
              width: `${Math.max(0, endPct - startPct)}%`,
            }}
          />
          {/* 当前播放进度 */}
          <div
            className="absolute top-0 bottom-0 bg-gradient-to-r from-amber-400 to-amber-200"
            style={{ width: `${curPct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={safeTotal}
          value={currentMs}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
      </div>

      {/* A-B 片段起点与终点微调滑块 */}
      <div className="grid grid-cols-2 gap-3 pt-0.5 text-[11px] text-white/75">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-amber-200/80">起点 A:</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, effectiveEnd - 200)}
            step={100}
            value={clipStartMs}
            onChange={(e) => onChangeClipStart(Number(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer h-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-amber-200/80">终点 B:</span>
          <input
            type="range"
            min={Math.min(safeTotal, clipStartMs + 200)}
            max={safeTotal}
            step={100}
            value={effectiveEnd}
            onChange={(e) => onChangeClipEnd(Number(e.target.value))}
            className="w-full accent-amber-400 cursor-pointer h-1"
          />
        </div>
      </div>
    </div>
  );
};
