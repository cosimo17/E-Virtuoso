import React from "react";
import { FingeringState, HARMONICA_KEYS, HarmonicaKeyCode } from "../types/score";

interface VirtualHarmonicaProps {
  fingering: FingeringState;
  compact?: boolean;
  onManualPress?: (relSemitone: number) => void;
  onManualRelease?: () => void;
}

export const VirtualHarmonica: React.FC<VirtualHarmonicaProps> = ({
  fingering,
  compact = false,
  onManualPress,
  onManualRelease,
}) => {
  const { octave, leftHeld, middleHeld, rightHeld, activeKey } = fingering;

  // 计算点击某个虚拟键时对应的相对半音偏移
  const getSemitoneForKey = (key: HarmonicaKeyCode): number => {
    const baseOct = octave === "low" ? 0 : octave === "mid" ? 12 : 24;
    const stepMap: Record<HarmonicaKeyCode, number> = {
      Z: 0,
      X: 2,
      C: 4,
      V: 5,
      B: 7,
      N: 9,
      M: 11,
      ",": 12,
    };
    return Math.min(36, baseOct + stepMap[key] + (middleHeld ? 1 : 0));
  };

  return (
    <div
      className={`rounded-xl border border-[#d4b88c]/35 bg-[#3a3127]/80 backdrop-blur-md shadow-inner select-none ${
        compact ? "px-2.5 py-1.5" : "px-4 py-2.5"
      }`}
    >
      {/* 上排 8 个口琴音符按键 (Z ~ ,) */}
      <div className="grid grid-cols-8 gap-1.5">
        {HARMONICA_KEYS.map((item) => {
          const isActive = activeKey === item.key;

          // 计算音符上下方的八度圆点（完全还原游戏截图视觉）
          // 默认中音：Z~M 无圆点，`,` 有 1 个上圆点
          // 升调 (rightHeld)：Z~M 有 1 个上圆点，`,` 有 2 个上圆点
          // 降调 (leftHeld)：Z~M 有 1 个下圆点，`,` 无圆点（中音1）
          let topDots = 0;
          let bottomDots = 0;
          if (octave === "high") {
            topDots = item.isTopDo ? 2 : 1;
          } else if (octave === "mid") {
            topDots = item.isTopDo ? 1 : 0;
          } else {
            bottomDots = item.isTopDo ? 0 : 1;
          }

          return (
            <button
              key={item.key}
              type="button"
              onMouseDown={() => onManualPress?.(getSemitoneForKey(item.key))}
              onMouseUp={() => onManualRelease?.()}
              onMouseLeave={() => isActive && onManualRelease?.()}
              className={`relative flex flex-col items-center justify-between rounded-lg transition-all duration-75 ${
                compact ? "py-1 px-1" : "py-2 px-1.5"
              } ${
                isActive
                  ? "bg-[#cbbba0]/55 shadow-[0_0_12px_rgba(235,215,175,0.45)] scale-[1.03] border border-[#f5e6c8]/60"
                  : "bg-black/15 hover:bg-white/10 border border-transparent"
              }`}
            >
              {/* 上方高音点 */}
              <div className="h-2.5 flex flex-col items-center justify-end gap-[1.5px]">
                {topDots === 2 && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-[#f0e6d2]" />
                    <span className="w-1 h-1 rounded-full bg-[#f0e6d2]" />
                  </>
                )}
                {topDots === 1 && (
                  <span className="w-1 h-1 rounded-full bg-[#f0e6d2]" />
                )}
              </div>

              {/* 简谱数字 */}
              <div
                className={`font-semibold tracking-tight leading-none ${
                  compact ? "text-sm my-0.5" : "text-lg my-1"
                } ${isActive ? "text-white" : "text-[#e8dec8]"}`}
              >
                {middleHeld ? "#" : ""}
                {item.degree}
              </div>

              {/* 下方低音点 */}
              <div className="h-1.5 flex items-center justify-center mb-1">
                {bottomDots === 1 && (
                  <span className="w-1 h-1 rounded-full bg-[#f0e6d2]" />
                )}
              </div>

              {/* 键盘键帽 */}
              <span
                className={`inline-flex items-center justify-center rounded font-bold shadow-sm ${
                  compact
                    ? "w-5 h-4 text-[10px]"
                    : "w-6 h-5 text-xs"
                } ${
                  isActive
                    ? "bg-white text-[#2b241d]"
                    : "bg-[#ded8ce] text-[#3b332b]"
                }`}
              >
                {item.key}
              </span>
            </button>
          );
        })}
      </div>

      {/* 下排鼠标长按状态栏：降调 (左键长按) | 半音 (中键长按) | 升调 (右键长按) */}
      <div
        className={`flex items-center justify-center gap-3 border-t border-[#d4b88c]/20 ${
          compact ? "mt-1.5 pt-1 text-[11px]" : "mt-2.5 pt-2 text-xs"
        }`}
      >
        <div
          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded transition-all ${
            leftHeld
              ? "bg-[#cbbba0]/60 text-white font-semibold shadow-sm"
              : "text-[#d6cbb9]/75"
          }`}
        >
          <span className="inline-block px-1 py-0.2 text-[10px] rounded bg-black/30 border border-white/20">
            LMB长按
          </span>
          <span>降调</span>
        </div>

        <span className="text-[#d4b88c]/30">|</span>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded transition-all ${
            middleHeld
              ? "bg-[#cbbba0]/60 text-white font-semibold shadow-sm"
              : "text-[#d6cbb9]/75"
          }`}
        >
          <span className="inline-block px-1 py-0.2 text-[10px] rounded bg-black/30 border border-white/20">
            MMB长按
          </span>
          <span>半音 (#)</span>
        </div>

        <span className="text-[#d4b88c]/30">|</span>

        <div
          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded transition-all ${
            rightHeld
              ? "bg-[#cbbba0]/60 text-white font-semibold shadow-sm"
              : "text-[#d6cbb9]/75"
          }`}
        >
          <span className="inline-block px-1 py-0.2 text-[10px] rounded bg-black/30 border border-white/20">
            RMB长按
          </span>
          <span>升调</span>
        </div>
      </div>
    </div>
  );
};
