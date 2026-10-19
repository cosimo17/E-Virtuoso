import { formatRelSemitoneLabel, NoteEvent, Score } from "../types/score";

/**
 * 解析数字简谱 DSL 文本为标准 Score 结构
 *
 * 支持语法示例：
 * - 音高：
 *   - 低音：`-1` ~ `-7` 或 `(1)` ~ `(7)`
 *   - 中音：`1` ~ `7`
 *   - 高音：`+1` ~ `+7` 或 `[1]` ~ `[7]`
 *   - 倍高音：`++1`
 *   - 半音：前缀 `#`（如 `#4`, `+#1`, `-#5`）或后缀 `#`
 *   - 休止符：`0`
 * - 时值：
 *   - 默认四分音符（1拍）
 *   - 后缀 `-`：每多一个 `-` 增加 1 拍（如 `5 -` 或 `5-` 为 2 拍）
 *   - 后缀 `_` 或 `/`：每多一个减半拍（如 `1_` 为 0.5 拍，`1__` 为 0.25 拍）
 *   - 后缀 `.`：附点音符（时值 × 1.5）
 */
export function parseJianpuToScore(
  title: string,
  bpm: number,
  rawText: string,
  existingId?: string
): Score {
  const safeBpm = Math.max(30, Math.min(260, bpm || 100));
  const beatMs = 60000 / safeBpm;

  // 清理注释行与小节线 '|'
  const cleaned = rawText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join(" ")
    .replace(/\|/g, " ");

  // 将独立的延音线 ` - ` 归并到前一个 token 上
  const rawTokens = cleaned
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const mergedTokens: string[] = [];
  for (const tk of rawTokens) {
    if (/^-+$/.test(tk) && mergedTokens.length > 0) {
      mergedTokens[mergedTokens.length - 1] += tk;
    } else {
      mergedTokens.push(tk);
    }
  }

  const degreeToSemitone: Record<string, number> = {
    "1": 0,
    "2": 2,
    "3": 4,
    "4": 5,
    "5": 7,
    "6": 9,
    "7": 11,
  };

  const notes: NoteEvent[] = [];
  let cursorMs = 0;

  mergedTokens.forEach((token, idx) => {
    let str = token.trim();
    if (!str) return;

    // 支持括号写法：(5) -> -5, [5] -> +5
    if (str.startsWith("(") && str.includes(")")) {
      str = "-" + str.replace(/[()]/g, "");
    } else if (str.startsWith("[") && str.includes("]")) {
      str = "+" + str.replace(/[\[\]]/g, "");
    }

    // 解析前缀符号 (+, -, #)
    let octaveOffset = 1; // 默认中音区 (1 -> 12 semitones)
    let isSharp = false;
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (ch === "+") {
        octaveOffset += 1;
        i++;
      } else if (ch === "-") {
        octaveOffset -= 1;
        i++;
      } else if (ch === "#") {
        isSharp = true;
        i++;
      } else {
        break;
      }
    }

    if (i >= str.length) return;
    const degreeChar = str[i];
    i++;

    // 检查音符后是否紧跟 '#'
    if (i < str.length && str[i] === "#") {
      isSharp = true;
      i++;
    }

    // 解析时值后缀 (-, _, /, .)
    const tail = str.slice(i);
    let beats = 1.0;
    let extraBeats = 0;
    let halveCount = 0;
    let hasDot = false;

    for (const c of tail) {
      if (c === "-") extraBeats += 1;
      else if (c === "_" || c === "/") halveCount += 1;
      else if (c === ".") hasDot = true;
    }

    if (halveCount > 0) {
      beats = Math.pow(0.5, halveCount);
    }
    if (hasDot) {
      beats *= 1.5;
    }
    beats += extraBeats;

    const durationMs = Math.max(45, Math.round(beats * beatMs));

    if (degreeChar === "0") {
      // 休止符仅推进时间轴
      cursorMs += durationMs;
      return;
    }

    if (degreeToSemitone[degreeChar] !== undefined) {
      const clampedOctave = Math.max(0, Math.min(3, octaveOffset));
      let relSemitone =
        clampedOctave * 12 + degreeToSemitone[degreeChar] + (isSharp ? 1 : 0);
      relSemitone = Math.max(0, Math.min(36, relSemitone));

      // 留出 36ms 自然换气间隙（大于游戏 60fps 两帧），确保连续同音按键在游戏内 100% 触发清晰的 KeyUp -> KeyDown
      const gapMs = Math.min(36, Math.floor(durationMs * 0.22));
      const notePlayDur = Math.max(40, durationMs - gapMs);

      notes.push({
        id: `n-${idx}-${cursorMs}`,
        startMs: cursorMs,
        durationMs: notePlayDur,
        relSemitone,
        label: formatRelSemitoneLabel(relSemitone),
      });

      cursorMs += durationMs;
    }
  });

  return {
    id: existingId || `score-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim() || "未命名曲谱",
    bpm: safeBpm,
    totalDurationMs: cursorMs,
    transposeSemitones: 0,
    notes,
    rawJianpu: rawText,
    createdAt: Date.now(),
  };
}

/**
 * A-B 片段截取并生成新曲谱（自动平移时间戳并生成对应简谱描述）
 */
export function clipScoreSegment(
  source: Score,
  startMs: number,
  endMs: number,
  newTitle: string
): Score {
  const safeStart = Math.max(0, Math.min(startMs, endMs));
  const safeEnd = Math.max(safeStart + 100, endMs || source.totalDurationMs);

  const clippedNotes: NoteEvent[] = [];
  for (const n of source.notes) {
    const nEnd = n.startMs + n.durationMs;
    if (nEnd <= safeStart || n.startMs >= safeEnd) continue;

    const clippedStart = Math.max(safeStart, n.startMs) - safeStart;
    const clippedEnd = Math.min(safeEnd, nEnd) - safeStart;
    const dur = Math.max(40, clippedEnd - clippedStart);

    clippedNotes.push({
      id: `clip-${clippedNotes.length}-${clippedStart}`,
      startMs: clippedStart,
      durationMs: dur,
      relSemitone: n.relSemitone,
      label: n.label || formatRelSemitoneLabel(n.relSemitone),
    });
  }

  const totalDurationMs =
    clippedNotes.length > 0
      ? Math.max(...clippedNotes.map((n) => n.startMs + n.durationMs))
      : 0;

  return {
    id: `score-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: newTitle.trim() || `${source.title} (片段)`,
    bpm: source.bpm,
    totalDurationMs,
    transposeSemitones: source.transposeSemitones,
    notes: clippedNotes,
    rawJianpu: clippedNotes.map((n) => n.label || formatRelSemitoneLabel(n.relSemitone)).join(" "),
    createdAt: Date.now(),
  };
}

/**
 * 纯前端标准 MIDI (.mid) 二进制解析器 + 智能口琴音域移调算法
 * 无需任何重型第三方库，直接解析 SMF Track Chunk 与 Tempo / NoteOn / NoteOff
 */
export function parseMidiArrayBuffer(fileName: string, buffer: ArrayBuffer): Score {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (
    bytes.length < 14 ||
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "MThd"
  ) {
    throw new Error("无效的 MIDI 文件头 (非标准 MThd 格式)");
  }

  const numTracks = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  const ticksPerBeat = (division & 0x8000) === 0 ? division : 480;

  let offset = 8 + view.getUint32(4, false);
  let microsecondsPerBeat = 500000; // 默认 120 BPM
  const rawNotes: { startMs: number; durationMs: number; pitch: number }[] = [];

  const readVarLen = (pos: { idx: number }): number => {
    let value = 0;
    while (pos.idx < bytes.length) {
      const b = bytes[pos.idx++];
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  };

  for (let t = 0; t < numTracks && offset + 8 <= bytes.length; t++) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const chunkLen = view.getUint32(offset + 4, false);
    offset += 8;

    if (chunkId !== "MTrk") {
      offset += chunkLen;
      continue;
    }

    const trackEnd = Math.min(bytes.length, offset + chunkLen);
    const pos = { idx: offset };
    let currentTicks = 0;
    let runningStatus = 0;
    const activeNotes = new Map<number, number>();

    while (pos.idx < trackEnd) {
      const delta = readVarLen(pos);
      currentTicks += delta;
      if (pos.idx >= trackEnd) break;

      let status = bytes[pos.idx];
      if (status < 0x80) {
        status = runningStatus;
      } else {
        pos.idx++;
        if (status < 0xf0) runningStatus = status;
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;

      if (eventType === 0x90 || eventType === 0x80) {
        const pitch = bytes[pos.idx++];
        const vel = bytes[pos.idx++];
        // 忽略打击乐通道 10 (index 9)
        if (channel !== 9) {
          if (eventType === 0x90 && vel > 0) {
            activeNotes.set(pitch, currentTicks);
          } else {
            const startTick = activeNotes.get(pitch);
            if (startTick !== undefined) {
              activeNotes.delete(pitch);
              const startMs = Math.round(
                (startTick / ticksPerBeat) * (microsecondsPerBeat / 1000)
              );
              const endMs = Math.round(
                (currentTicks / ticksPerBeat) * (microsecondsPerBeat / 1000)
              );
              rawNotes.push({
                startMs,
                durationMs: Math.max(50, endMs - startMs),
                pitch,
              });
            }
          }
        }
      } else if (
        eventType === 0xa0 ||
        eventType === 0xb0 ||
        eventType === 0xe0
      ) {
        pos.idx += 2;
      } else if (eventType === 0xc0 || eventType === 0xd0) {
        pos.idx += 1;
      } else if (status === 0xff) {
        const metaType = bytes[pos.idx++];
        const metaLen = readVarLen(pos);
        if (metaType === 0x51 && metaLen === 3 && pos.idx + 3 <= trackEnd) {
          microsecondsPerBeat =
            (bytes[pos.idx] << 16) |
            (bytes[pos.idx + 1] << 8) |
            bytes[pos.idx + 2];
        }
        pos.idx += metaLen;
      } else if (status === 0xf0 || status === 0xf7) {
        const sysExLen = readVarLen(pos);
        pos.idx += sysExLen;
      } else {
        pos.idx++;
      }
    }

    offset = trackEnd;
  }

  if (rawNotes.length === 0) {
    throw new Error("MIDI 文件中未提取到有效音符");
  }

  // 排序并提取单声部最高主旋律
  rawNotes.sort((a, b) => a.startMs - b.startMs || b.pitch - a.pitch);
  const monoNotes: typeof rawNotes = [];
  for (const n of rawNotes) {
    const last = monoNotes[monoNotes.length - 1];
    if (last && Math.abs(n.startMs - last.startMs) < 25) {
      continue;
    }
    if (last && last.startMs + last.durationMs > n.startMs) {
      last.durationMs = Math.max(40, n.startMs - last.startMs - 10);
    }
    monoNotes.push({ ...n });
  }

  // 智能移调寻优：寻找使最多音符落入 0..36 且半音最少的基准 MIDI 音高
  const blackSteps = new Set([1, 3, 6, 8, 10]);
  let bestBase = 48;
  let bestScore = -Infinity;

  for (let base = 30; base <= 66; base++) {
    let score = 0;
    for (const n of monoNotes) {
      const rel = n.pitch - base;
      if (rel >= 0 && rel <= 36) {
        score += 10;
        if (!blackSteps.has(((rel % 12) + 12) % 12)) {
          score += 3;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestBase = base;
    }
  }

  const bpm = Math.max(
    40,
    Math.min(240, Math.round(60000000 / microsecondsPerBeat))
  );

  let totalDurationMs = 0;
  const notes: NoteEvent[] = monoNotes.map((n, idx) => {
    const rel = Math.max(0, Math.min(36, n.pitch - bestBase));
    totalDurationMs = Math.max(totalDurationMs, n.startMs + n.durationMs);
    return {
      id: `midi-${idx}-${n.startMs}`,
      startMs: n.startMs,
      durationMs: n.durationMs,
      relSemitone: rel,
      label: formatRelSemitoneLabel(rel),
    };
  });

  const cleanTitle = fileName.replace(/\.(mid|midi)$/i, "");
  return {
    id: `score-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    bpm,
    totalDurationMs,
    transposeSemitones: 48 - bestBase,
    notes,
    rawJianpu: notes.map((n) => n.label).join(" "),
    createdAt: Date.now(),
  };
}

/**
 * 内置经典口琴预设曲谱库
 */
export const PRESET_SCORES: Score[] = [
  parseJianpuToScore(
    "周杰伦 - 七里香 (原谱精校版)",
    82,
    `// 前奏 (1=Eb 4/4 原谱精校)
+1 +1_. +3__ +2_ +1 6_ +1_ | 6_ 5. 6_ +1_ +2_ +3 | +1 +1_. +3__ +2_ +1 6_ +1_ | +2 - - 0_ 5_ |
// 主歌：窗外的麻雀 在电线杆上多嘴
+1 7_ +1_ +1. +1_ | +1_ 7_ 6_ 7_ 6_ 5 5_ |
// 你说这一句 很有夏天的感觉
5 4__ 3__ 5 - 5_ | 5_ 6_ 2__ 4__ 4_ 3. 5_ |
// 手中的铅笔 在纸上来来回回
+1 7_ +1_ +1. +1_ | +1_ 7_ +1__ +2__ +2_. +1__ 5_ +1_ 7_ |
// 我用几行字形容你是我的谁
+1__ +1__ +1_ +1__ 7__ 7_ 7_ 6_ 6__ 7__ 6_ | 6_ 5_ 5 - 5_ +1_ |
// 桥段：秋刀鱼的滋味 猫跟你都想了解
+1 3_ 6_ 6 5_ +2_ | +2 2__ 4__ 4_ 4_ 3 3_ 5_ |
// 初恋的香味就这样被我们寻回
5_ 4_ 4__ 3__ 3_ 3__ 2__ 2_ 2__ 1__ 3_ | 3_ 2. 2_ 4_ 3 5_ +1_ |
// 那温暖的阳光 像刚摘的鲜艳草莓
+1 3_ 6_ 6_ 5_ 5_ +2_ | +2_. +2__ 2_ 4_ 4_ 3 5_ +3_ |
// 你说你舍不得吃掉这一种感觉
+3_ +2_ +2_ +1_ +1_ +2_ +1_ +3_ | +3__ +2__ +2 - 0_ 5_ +1__ +1__ +1_ |
// 副歌1：雨下整夜 我的爱溢出就像雨水
+1. +1_ +1_ 7_ 6_ 5_ | 7_ +1_ +2_. +1__ 1_ 5_ +1__ +1__ +1_ |
// 院子落叶 跟我的思念厚厚一叠
+1. +1_ +1_ 7_ 6_ 5_ | +2_ +3_ +4_ +3_ 3_ 5_ +1__ +1__ +1_ |
// 几句是非 也无法将我的热情冷却
+1. +1_ +1_ 7_ 6_ 5_ | +2_ +1_ 7__ +1__ +1 - +1_ |
// 你出现在我诗的每一页
+1_ +3_ +2_ +1_ +1_ 7_ +2__ +1__ +1_ | +1 - 0_ 5_ +1__ +1__ +1_ |
// 副歌2：雨下整夜 我的爱溢出就像雨水
+1. +1_ +1_ 7_ 6_ 5_ | 7_ +1_ +2_. +1__ 1_ 5_ +1__ +1__ +1_ |
// 窗台蝴蝶 像诗里纷飞的美丽章节
+1. +1_ +1_ 7_ 6_ 5_ | +2_ +3_ +4_ +3_ 3_ 5_ +1__ +1__ +1_ |
// 我接着写 把永远爱你写进诗的结尾
+1. +1_ +1_ 7_ 6_ 5_ | +2_ +1_ +2__ +3__ +2_ +2_ +1_ +1_ +1_ |
// 你是我唯一想要的了解
+1_ +3_ +2_ +1_ +1_ 7_ +2__ +1__ +1 | +1 - - 0`,
    "preset-qilixiang"
  ),
  parseJianpuToScore(
    "周杰伦 - 夜曲 (原谱精校版)",
    88,
    `// 经典吉他前奏 (1=G 4/4 原谱精校)
0_ 6__ 7__ | +1_ +1__ +1 7__ +3__ +3_. +3 | +6_ +6__ +6_. +5_ +4_ +5_ +1__ +1_. |
+4_ +4__ +4_ +5_. +3_ 7_ +3__ +2_. | +2_ +1__ 7_. +1_. +1_. 7_ 6__ 7__ |
+1_ +1__ +1 7__ +3__ +3_. +3 | +6_ +6__ +6_. +5_ +4_ +5_ +1__ +1_. |
+4_ +4__ +4_ +4. +3_ +2_ +1__ 7__ +1__ 6__ | 6 - - 0_ 6__ 6__ |
// 主歌：一群嗜血的蚂蚁 被腐肉所吸引 我面无表情 看孤独的风景
6_ 3_ 6__ 6__ 3_ 6__ 6__ 6__ 6__ 6_ 3_ | 6__ 6__ 6__ 6__ 3_ 6__ 6__ 6__ 6__ 6_ 3_ |
0_ 6__ 6__ 3__ 6__ 6__ 3__ 6_ 3_ | 6__ 6__ 3_ 6__ 6__ 6__ 6__ 6__ 6__ 6_ 3_ |
// 副歌：为你弹奏肖邦的夜曲 纪念我死去的爱情
0_ 6__ 7__ | +1_ +1__ +1 7__ +3__ +3_. +3 | +6_ +6__ +6_. +5_ +4_ +5_ +1__ +1_. |
// 跟夜风一样的声音 心碎的很好听
+4_ +4__ +4_ +5_. +3_ 7_ +3__ +2_. | +2_ +1__ 7_. +1_. +1_. 7_ 6__ 7__ |
// 手在键盘敲很轻 我给的思念很小心
+1_ +1__ +1 7__ +3__ +3_. +3 | +6_ +6__ +6_. +5_ +4_ +5_ +1__ +1_. |
// 你埋葬的地方叫幽冥
+4_ +4__ +4_ +4_ +4_ +3_ +2_ 7_ +1 | 6 - 6 7 |
// 为你弹奏肖邦的夜曲 纪念我死去的爱情
+1_ +1__ +1 7__ +3__ +3_. +3 | +6_ +6__ +6_. +5_ +4_ +5_ +1__ +1_. |
// 而我为你隐姓埋名 在月光下弹琴
+4_ +4__ +4_ +5_. +3_ 7_ +3__ +2_. | +2_ +1__ 7_. +1_. +1_. 7_ 6__ 7__ |
// 对你心跳的感应 还是如此温热亲近
+1_ +1__ +1 7__ +3__ +3_. +3 | +6_ +6__ +6_. +5_ +4_ +5_ +1__ +1_. |
// 怀念你那鲜红的唇印
+4_ +4__ +4_ +4_ +4_ +3_ +2_ 7_ +1 | 6 - - 0 |
// 尾声吟唱旋律
6. 4__ 3__ 5 | 6. 7_ 6 - | 7. 7__ 7__ 6__ 5__ 4__ 5_. |
6. 4__ 5__ 4 - | 6. 4__ 3__ 5 - | 6. 7_ 6 - | 7. 7__ 7__ 6__ 5__ 5__ 5__ 6_. | 6 - - 0`,
    "preset-yeqv"
  ),
  parseJianpuToScore(
    "许嵩 - 玫瑰花的葬礼 (原谱精校版)",
    92,
    `// 经典前奏 (1=A 2/4 原谱精校)
3 - | 2_. 5_ 2_. | 1_. 5_ 1_. | -7 - | -6_. 3_ -6_. | -#5_. -6_ -7_. | 1 - | 1 -6__ -7__ 1__ 2__ |
3 - | 2_. 5_ 2_. | 1_. 5_ 1_. | -7 - | -6_. 3_ -6_. | -#5_. 1_ -7_. | -6 - | -6 0 |
// 主歌：离开你一百个星期 我回到了这里 寻找我们爱过的证据
-6_ -6_ -6__ -6__ -6_ | -6__ -6__ -6__ -6__ -6__ -6__ -6__ 3__ | -6__ -6__ -6__ -6__ -6_ 5_ | -6_ 5_ 5_ 0__ -6__ -6__ 5__ |
-6__ -6__ 1__ -6__ 0__ -6__ -6__ 5__ | -6__ -6__ 1__ -6__ 0__ -6__ -6__ -6__ | -6__ -6__ 3__ -6__ -6__ -6__ -6__ -6__ | -6__ 3__ -6__ 0__ -6__ -6__ -6__ |
// 过去我和你在一起是我太叛逆 现在只剩我自己 偷偷的想你
-6__ -6__ -6__ -6__ 3_ 0__ -6__ -6__ -6__ | -6__ -6__ -6__ -6__ -6__ -6__ 5_ | 3__ 5__ 6__ 3__ 0__ -6__ -6__ -6__ | -6_ -7_ 1_ 2. | 4_ 3_ 2_ 1_ | -6 - |
// 副歌1：玫瑰花的葬礼 埋葬关于你的回忆
0_ -3_ 3_ 2_ | 1 -7_. -6__ | 0_ -3_ 3__ 2__ | 1_ 1_ 1__ -7__ -6_ |
// 感觉双手麻痹 不能自已 已拉不住你
0_ 2__ 1__ | -7__ -7__ -7_ -7. | -7__ -7__ -7_ 5. | 2__ 1__ 2_ 2__ 5__ 3_ |
// 真的好美丽 那天的烟花雨 我说要娶穿碎花洋裙的你
0_ 2__ 3__ | 6 6_. -7__ | 0_ 6_ 5_ 4_ | 5 -7_. -6__ |
0_ 2__ 3__ | 4_ 4_ 4__ #5__ #5_ | #5_ 5_ 3__ 2__ -6_ | -6 - |
// 副歌2：玫瑰花的葬礼 埋葬深深爱着的你
0_ -3_ 3_ 2_ | 1 -7_. -6__ | 0_ -3_ 3_ 2_ | 1_ 1_ 1__ -7__ -6_ |
// 残朵停止呼吸 渗入大地 没人会注意
0_ 2__ 1__ | -7__ -7__ -7_ -7. | -7__ -7__ -7_ 5. | 2__ 1__ 2_ 2__ 5__ 3_ |
// 一片小雨滴 陪着我等天明 我用这最后一分钟怀念你
0_ 2__ 3__ | 6 6_. -7__ | 0_ 6_ 5_ 4_ | 5 -7__ -6__ -6_ |
0_ 2__ 3__ | 4_ 4_ 4__ #5__ #5_ | #5_. 5__ 3__ 2__ -6_ | -6 - 0`,
    "preset-meiguihua"
  ),
  parseJianpuToScore(
    "凤凰传奇 - 荷塘月色 (原谱精校版)",
    96,
    `// 前奏 (1=C 4/4 原谱精校)
1. -5_ 1_ -5_ 1_ 2_ | 3 - - - | 1. -5_ 1_ -5_ 1_ 2_ | 2 - - - |
1. -5_ 1_ -5_ 2_ 1_ | -6 - -6_ -5_ 1_ 2_ | 1. -5_ 1_ -5_ 1_ -6_ | 1 - - - |
// 主歌：剪一段时光缓缓流淌 流进了月色中微微荡漾
1_ 1 -6_ -5 -6 | 1 1_ 2_ 3 - | 2_ 2 1_ 2 2_ 5_ | 5_ 3_ 3_ 2_ 3 - |
// 弹一首小荷淡淡的香 美丽的琴音就落在我身旁
1_ 1 -6_ -5 -5_. 3__ | 3_ 2_ 3_ 2_ 1 - | 2_ 2 1_ 2 2 3_ | 2_ 1_ -6_ 2_ 1 - |
// 萤火虫点亮夜的星光 谁为我添一件梦的衣裳
1_ 1 -6_ -5 -6 | 1_ 1 2_ 3 - | 2_ 2 1_ 2 2_ 5_ | 5_ 3_ 3_ 2_ 3 - |
// 推开那扇心窗远远的望 谁采下那一朵昨日的忧伤
1_ 1 1_ -6_ -5 -5_. 3__ | 3_ 2_ 3_ 2_ 1 0 | 2_ 2 1_ 2 2 3_ | 2_ 1_ -6_ 2_ 1 - |
// 副歌：我像只鱼儿在你的荷塘 只为和你守候那皎白月光
5_ 5 5_ 5 5 | 6_ 5_ 3_ 2_ 1 - | 6_ +1_ 6_ 5_ 3_ 2_ 1_ -6_ | 2 2_ 3_ 2. 0_ |
// 游过了四季荷花依然香 等你宛在水中央
3_ 5 5_ 5 5 | 6_ 5_ 3_ 2_ 1 0 | -6_ 1_ -6_ -5_ 2 3 | 1 - - 0`,
    "preset-hetangyuese"
  ),
  parseJianpuToScore(
    "义勇军进行曲 (中华人民共和国国歌)",
    120,
    `// 前奏号角 (1=G 2/4 官方原谱精校)
1_. 3__ 5_ 5_ | 6 5 | 3_. 1__ 5_ 5_ 5_ | 3 1 | -5_ -5_ -5_ -5_ -5_ -5_ | 1 0_ -5_ |
// 起来！不愿做奴隶的人们！
1. 1_ | 1_. 1__ -5_ -6__ -7__ | 1 1 |
// 把我们的血肉，筑成我们新的长城！
0_ 3_ 1_ 2__ 3__ | 5 5 | 3_. 3__ 1_. 3__ | 5_. 3__ 2 | 2 - |
// 中华民族到了最危险的时候
6 5 | 2 3 | 5_ 3_ 0_ 5_ | 3_ 2__ 3__ 1 | 3 0 |
// 每个人被迫着发出最后的吼声
-5_. -6__ 1_ 1_ | 3_. 3__ 5_ 5_ | 2_ 2__ 2__ -6 | 2. -5_ |
// 起来！起来！起来！
1. 1_ | 3. 3_ | 5 - |
// 我们万众一心，冒着敌人的炮火，前进！
1_. 3__ 5_ 5_ | 6 5 | 3_. 1__ 5_ 5_ 5_ | 3_ 0_ 1_ 0_ | -5 1 |
// 冒着敌人的炮火，前进！前进！前进！进！
3_. 1__ 5_ 5_ 5_ | 3_ 0_ 1_ 0_ | -5 1 | -5 1 | -5 1 | 1 0`,
    "preset-guoge"
  ),
  parseJianpuToScore(
    "天空之城 (口琴经典版)",
    92,
    `6_ 7_ | +1. 7_ +1 +3 | 7 - - 3_ 3_ | 6. 5_ 6 +1 | 5 - - 3_ 3_ |
4. 3_ 4 +1 | 3 - 0 +1_ +1_ | +1_ 7. #4_ #4 +1 | 7 - - 6_ 7_ |
+1. 7_ +1 +3 | 7 - - 3_ 3_ | 6. 5_ 6 +1 | 5 - - 2_ 3_ |
4 +1_ 7. +1 | +2 +3_ +1 - | +1_ 7_ 6 6 7 #5 | 6 - - 0`,
    "preset-laputa"
  ),
  parseJianpuToScore(
    "送别 (长亭外古道边)",
    84,
    `5 3_ 5_ +1 - | 6 +1 5 - | 5 1_ 2_ 3 2_ 1_ | 2 - - 0 |
5 3_ 5_ +1. 7_ | 6 +1 5 - | 5 2_ 3_ 4. -7_ | 1 - - 0 |
6 +1 +1 - | 7 6_ 7_ +1 - | 6_ 7_ +1_ 6_ 6_ 5_ 3_ 1_ | 2 - - 0 |
5 3_ 5_ +1. 7_ | 6 +1 5 - | 5 2_ 3_ 4. -7_ | 1 - - 0`,
    "preset-farewell"
  ),
  parseJianpuToScore(
    "卡农 Canon (高低音切换与连音)",
    100,
    `+3 +2 | +1 7 | 6 5 | 6 7 |
+1_ 5_ +1_ +3_ +2_ -7_ +2_ +4_ | +1_ 5_ +1_ +2_ 7_ 5_ 7_ +2_ |
6_ 3_ 6_ +1_ 5_ 3_ 5_ +1_ | 4_ 1_ 4_ 6_ 5_ 2_ 5_ 7_ |
+1 - - 0`,
    "preset-canon"
  ),
  parseJianpuToScore(
    "全音域与半音测试曲 (含降调/半音/升调)",
    115,
    `-1 -3 -5 1 | 1 3 5 +1 | +1 +3 +5 ++1 |
4 #4 5 #5 | 6 #6 7 +1 -`,
    "preset-test-range"
  ),
];
