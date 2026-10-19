export type HarmonicaKeyCode = "Z" | "X" | "C" | "V" | "B" | "N" | "M" | ",";

export type OctaveMode = "low" | "mid" | "high";

export interface NoteEvent {
  id: string;
  /** 距离曲谱起点的开始时间 (ms) */
  startMs: number;
  /** 音符持续时长 (ms) */
  durationMs: number;
  /**
   * 相对口琴最低音 (低音1 = 0, 中音1 = 12, 高音1 = 24, 倍高音1 = 36) 的半音偏移
   * 范围: 0 ~ 36
   */
  relSemitone: number;
  /** 可选简谱记号展示文本，如 "1", "#4", "+5" */
  label?: string;
}

export interface Score {
  id: string;
  title: string;
  bpm: number;
  totalDurationMs: number;
  transposeSemitones: number;
  notes: NoteEvent[];
  rawJianpu?: string;
  createdAt: number;
}

export interface FingeringState {
  octave: OctaveMode;
  leftHeld: boolean;   // 鼠标左键长按 = 降调 (低音)
  middleHeld: boolean; // 鼠标中键长按 = 半音 (#)
  rightHeld: boolean;  // 鼠标右键长按 = 升调 (高音)
  activeKey: HarmonicaKeyCode | null;
  relSemitone: number | null;
}

export const HARMONICA_KEYS: {
  key: HarmonicaKeyCode;
  vkCode: number;
  degree: string;
  isTopDo?: boolean;
}[] = [
  { key: "Z", vkCode: 0x5a, degree: "1" },
  { key: "X", vkCode: 0x58, degree: "2" },
  { key: "C", vkCode: 0x43, degree: "3" },
  { key: "V", vkCode: 0x56, degree: "4" },
  { key: "B", vkCode: 0x42, degree: "5" },
  { key: "N", vkCode: 0x4e, degree: "6" },
  { key: "M", vkCode: 0x4d, degree: "7" },
  { key: ",", vkCode: 0xbc, degree: "1", isTopDo: true },
];

/**
 * 根据相对半音偏移 (0..36) 与当前鼠标长按八度状态，计算最优口琴按键与鼠标长按组合
 * 包含 `,` (逗号键) 同音异键智能寻路，减少不必要的鼠标松按切换
 */
export function resolveHarmonicaFingering(
  relSemitone: number,
  currentOctave: OctaveMode = "mid"
): {
  octave: OctaveMode;
  leftHeld: boolean;
  middleHeld: boolean;
  rightHeld: boolean;
  key: HarmonicaKeyCode;
} {
  const clamped = Math.max(0, Math.min(36, Math.round(relSemitone)));

  // 同音异键优选 1：中音 1 (12) 或 中音 #1 (13)
  // 若当前已长按左键处于 Low 降调模式，直接按 `,` 键即可发出中音 1，无需松开左键
  if (clamped === 12 || clamped === 13) {
    const isSemi = clamped === 13;
    if (currentOctave === "low") {
      return {
        octave: "low",
        leftHeld: true,
        middleHeld: isSemi,
        rightHeld: false,
        key: ",",
      };
    }
    return {
      octave: "mid",
      leftHeld: false,
      middleHeld: isSemi,
      rightHeld: false,
      key: "Z",
    };
  }

  // 同音异键优选 2：高音 1 (24) 或 高音 #1 (25)
  // 若当前处于 Mid 中音模式（未长按右键），直接按 `,` 键即可发出高音 1，无需长按右键
  if (clamped === 24 || clamped === 25) {
    const isSemi = clamped === 25;
    if (currentOctave === "high") {
      return {
        octave: "high",
        leftHeld: false,
        middleHeld: isSemi,
        rightHeld: true,
        key: "Z",
      };
    }
    return {
      octave: "mid",
      leftHeld: false,
      middleHeld: isSemi,
      rightHeld: false,
      key: ",",
    };
  }

  // 最高音：倍高音 1 (36) -> 长按右键 (High) + `,` 键
  if (clamped === 36) {
    return {
      octave: "high",
      leftHeld: false,
      middleHeld: false,
      rightHeld: true,
      key: ",",
    };
  }

  const octaveIdx = Math.floor(clamped / 12);
  const noteInOctave = clamped % 12;

  const octave: OctaveMode =
    octaveIdx === 0 ? "low" : octaveIdx === 1 ? "mid" : "high";

  const stepMap: Record<number, { key: HarmonicaKeyCode; semi: boolean }> = {
    0: { key: "Z", semi: false },
    1: { key: "Z", semi: true },
    2: { key: "X", semi: false },
    3: { key: "X", semi: true },
    4: { key: "C", semi: false },
    5: { key: "V", semi: false },
    6: { key: "V", semi: true },
    7: { key: "B", semi: false },
    8: { key: "B", semi: true },
    9: { key: "N", semi: false },
    10: { key: "N", semi: true },
    11: { key: "M", semi: false },
  };

  const mapped = stepMap[noteInOctave] || { key: "Z", semi: false };

  return {
    octave,
    leftHeld: octave === "low",
    middleHeld: mapped.semi,
    rightHeld: octave === "high",
    key: mapped.key,
  };
}

/**
 * 将相对半音 (0..36) 格式化为简谱可读字符串
 */
export function formatRelSemitoneLabel(relSemitone: number): string {
  const clamped = Math.max(0, Math.min(36, Math.round(relSemitone)));
  if (clamped === 36) return "++1";
  const oct = Math.floor(clamped / 12);
  const step = clamped % 12;
  const names = ["1", "#1", "2", "#2", "3", "4", "#4", "5", "#5", "6", "#6", "7"];
  const prefix = oct === 0 ? "-" : oct === 2 ? "+" : "";
  return `${prefix}${names[step]}`;
}
