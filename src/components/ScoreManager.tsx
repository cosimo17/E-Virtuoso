import React, { useRef, useState } from "react";
import {
  Upload,
  Download,
  Edit3,
  Trash2,
  Plus,
  Check,
  Music,
  ArrowUpDown,
} from "lucide-react";
import { formatRelSemitoneLabel, Score } from "../types/score";
import {
  parseJianpuToScore,
  parseMidiArrayBuffer,
} from "../utils/jianpuParser";
import { formatTimeMs } from "./ClipTimeline";

interface ScoreManagerProps {
  scores: Score[];
  selectedScore: Score;
  onSelectScore: (score: Score) => void;
  onUpdateScores: (scores: Score[], nextSelected?: Score) => void;
}

export const ScoreManager: React.FC<ScoreManagerProps> = ({
  scores,
  selectedScore,
  onSelectScore,
  onUpdateScores,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [showEditor, setShowEditor] = useState(false);

  const [editTitle, setEditTitle] = useState(selectedScore.title);
  const [editBpm, setEditBpm] = useState(selectedScore.bpm);
  const [editJianpu, setEditJianpu] = useState(
    selectedScore.rawJianpu ||
      selectedScore.notes
        .map((n) => n.label || formatRelSemitoneLabel(n.relSemitone))
        .join(" ")
  );
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const notify = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  // 打开简谱编辑器
  const handleOpenEditor = (isNew = false) => {
    if (isNew) {
      setEditTitle("新建简谱曲目");
      setEditBpm(100);
      setEditJianpu("1 2 3 5 | 6 +1 5 - | 4 3 2 1 | 2 - - 0");
    } else {
      setEditTitle(selectedScore.title);
      setEditBpm(selectedScore.bpm);
      setEditJianpu(
        selectedScore.rawJianpu ||
          selectedScore.notes
            .map((n) => n.label || formatRelSemitoneLabel(n.relSemitone))
            .join(" ")
      );
    }
    setShowEditor(true);
  };

  // 保存简谱编辑
  const handleSaveEditor = (asNew: boolean) => {
    const compiled = parseJianpuToScore(
      editTitle,
      editBpm,
      editJianpu,
      asNew ? undefined : selectedScore.id
    );
    if (compiled.notes.length === 0) {
      notify("简谱中未解析出有效音符，请检查输入格式");
      return;
    }

    if (asNew) {
      const nextList = [compiled, ...scores];
      onUpdateScores(nextList, compiled);
      notify(`已新建曲谱《${compiled.title}》`);
    } else {
      const nextList = scores.map((s) =>
        s.id === selectedScore.id ? compiled : s
      );
      onUpdateScores(nextList, compiled);
      notify(`已更新曲谱《${compiled.title}》`);
    }
    setShowEditor(false);
  };

  // 导入外部文件 (支持多选批量导入 .mid / .midi / .json / .txt)
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = "";

    const importedScores: Score[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
          const buf = await file.arrayBuffer();
          const midiScore = parseMidiArrayBuffer(file.name, buf);
          importedScores.push(midiScore);
        } else if (lower.endsWith(".json")) {
          const text = await file.text();
          const parsed = JSON.parse(text);
          const list: Score[] = Array.isArray(parsed) ? parsed : [parsed];
          const valid = list.filter(
            (item) => item && item.title && Array.isArray(item.notes)
          );
          if (valid.length === 0) throw new Error("JSON 曲谱格式不合法");
          importedScores.push(...valid);
        } else {
          // 作为简谱 TXT 导入
          const text = await file.text();
          const cleanTitle = file.name.replace(/\.[^.]+$/, "");
          const score = parseJianpuToScore(cleanTitle, 100, text);
          importedScores.push(score);
        }
      } catch (err) {
        errors.push(
          `${file.name}: ${err instanceof Error ? err.message : "格式不支持"}`
        );
      }
    }

    if (importedScores.length > 0) {
      const nextList = [...importedScores, ...scores];
      onUpdateScores(nextList, importedScores[0]);
      if (importedScores.length === 1) {
        notify(
          `成功导入《${importedScores[0].title}》(已同步至 scores/custom_scores.json)`
        );
      } else {
        notify(
          `成功批量导入 ${importedScores.length} 首曲谱 (已同步至 scores/custom_scores.json)`
        );
      }
    } else if (errors.length > 0) {
      notify(`导入失败: ${errors[0]}`);
    }
  };

  // 导出当前曲谱为 JSON
  const handleExportCurrent = () => {
    const dataStr = JSON.stringify(selectedScore, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedScore.title}.evscore.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`已导出《${selectedScore.title}.evscore.json》`);
  };

  // 整体移调 (+/- 半音)
  const handleTranspose = (deltaSemitones: number) => {
    const updatedNotes = selectedScore.notes.map((n) => {
      const nextRel = Math.max(0, Math.min(36, n.relSemitone + deltaSemitones));
      return {
        ...n,
        relSemitone: nextRel,
        label: formatRelSemitoneLabel(nextRel),
      };
    });
    const updated: Score = {
      ...selectedScore,
      transposeSemitones: selectedScore.transposeSemitones + deltaSemitones,
      notes: updatedNotes,
      rawJianpu: updatedNotes.map((n) => n.label).join(" "),
    };
    const nextList = scores.map((s) => (s.id === updated.id ? updated : s));
    onUpdateScores(nextList, updated);
    notify(
      `已移调 ${deltaSemitones > 0 ? `+${deltaSemitones}` : deltaSemitones} 半音`
    );
  };

  // 重命名确认
  const handleConfirmRename = (id: string) => {
    if (!renameText.trim()) {
      setRenamingId(null);
      return;
    }
    const nextList = scores.map((s) =>
      s.id === id ? { ...s, title: renameText.trim() } : s
    );
    const nextSel =
      selectedScore.id === id
        ? { ...selectedScore, title: renameText.trim() }
        : selectedScore;
    onUpdateScores(nextList, nextSel);
    setRenamingId(null);
  };

  // 删除曲谱
  const handleDelete = (id: string) => {
    if (scores.length <= 1) {
      notify("至少保留一首曲谱");
      return;
    }
    const nextList = scores.filter((s) => s.id !== id);
    const nextSel =
      selectedScore.id === id ? nextList[0] : selectedScore;
    onUpdateScores(nextList, nextSel);
    notify("已删除曲谱");
  };

  return (
    <div className="grid grid-cols-12 gap-2.5 h-[195px]">
      {/* 左侧：曲谱列表与导入导出工具栏 */}
      <div className="col-span-5 flex flex-col rounded-lg border border-[#d4b88c]/25 bg-black/25 overflow-hidden">
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#d4b88c]/20 bg-black/20">
          <span className="text-xs font-medium text-amber-200 flex items-center gap-1">
            <Music className="w-3.5 h-3.5" />
            曲谱库 ({scores.length})
          </span>
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mid,.midi,.json,.txt"
              onChange={handleFileImport}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="导入 MIDI (.mid) / JSON / TXT 简谱"
              className="p-1 rounded bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border border-amber-400/30 transition"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleOpenEditor(true)}
              title="手写新建简谱"
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-amber-100 transition"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleExportCurrent}
              title="导出当前曲谱为 JSON"
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-amber-100 transition"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/5">
          {scores.map((item) => {
            const isSelected = item.id === selectedScore.id;
            const isRenaming = renamingId === item.id;
            return (
              <div
                key={item.id}
                onClick={() => !isRenaming && onSelectScore(item)}
                className={`group flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer transition ${
                  isSelected
                    ? "bg-amber-500/25 text-amber-100 font-medium"
                    : "text-white/75 hover:bg-white/5"
                }`}
              >
                {isRenaming ? (
                  <div className="flex items-center gap-1 w-full">
                    <input
                      type="text"
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleConfirmRename(item.id)
                      }
                      autoFocus
                      className="w-full bg-black/60 border border-amber-400/50 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleConfirmRename(item.id)}
                      className="p-0.5 text-emerald-300 hover:text-emerald-200"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="truncate pr-1">
                      <div className="truncate">{item.title}</div>
                      <div className="text-[10px] text-white/45">
                        {item.bpm} BPM · {item.notes.length} 音 ·{" "}
                        {formatTimeMs(item.totalDurationMs)}
                      </div>
                    </div>
                    <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(item.id);
                          setRenameText(item.title);
                        }}
                        className="p-1 rounded hover:bg-white/15 text-white/70 hover:text-white"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id);
                        }}
                        className="p-1 rounded hover:bg-red-500/30 text-white/70 hover:text-red-200"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧：曲谱音符预览与简谱编辑面板 */}
      <div className="col-span-7 flex flex-col rounded-lg border border-[#d4b88c]/25 bg-black/25 overflow-hidden">
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[#d4b88c]/20 bg-black/20 text-xs">
          <span className="truncate font-medium text-amber-100">
            {showEditor ? "编辑简谱" : `曲谱预览：${selectedScore.title}`}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {!showEditor ? (
              <>
                <button
                  type="button"
                  onClick={() => handleTranspose(-1)}
                  title="降半音 (-1)"
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[11px] text-amber-100 flex items-center gap-0.5"
                >
                  <ArrowUpDown className="w-2.5 h-2.5" />
                  -1半音
                </button>
                <button
                  type="button"
                  onClick={() => handleTranspose(1)}
                  title="升半音 (+1)"
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[11px] text-amber-100"
                >
                  +1半音
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenEditor(false)}
                  className="px-2 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/40 text-[11px] text-amber-100"
                >
                  编辑简谱
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSaveEditor(false)}
                  className="px-2 py-0.5 rounded bg-emerald-600/50 hover:bg-emerald-600/70 border border-emerald-400/40 text-[11px] text-white"
                >
                  保存修改
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveEditor(true)}
                  className="px-2 py-0.5 rounded bg-amber-600/50 hover:bg-amber-600/70 border border-amber-400/40 text-[11px] text-white"
                >
                  另存为新曲
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[11px] text-white/70"
                >
                  取消
                </button>
              </>
            )}
          </div>
        </div>

        {showEditor ? (
          <div className="p-2 flex-1 flex flex-col gap-1.5 text-xs">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="曲谱名称"
                className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white outline-none focus:border-amber-400/60"
              />
              <div className="flex items-center gap-1">
                <span className="text-white/60 text-[11px]">BPM:</span>
                <input
                  type="number"
                  min={40}
                  max={240}
                  value={editBpm}
                  onChange={(e) => setEditBpm(Number(e.target.value))}
                  className="w-14 bg-black/40 border border-white/15 rounded px-1.5 py-1 text-xs text-white outline-none"
                />
              </div>
            </div>
            <textarea
              value={editJianpu}
              onChange={(e) => setEditJianpu(e.target.value)}
              placeholder="简谱语法：-1~-7低音，1~7中音，+1~+7高音，#4升半音，-延音，_半拍，0休止"
              className="flex-1 w-full bg-black/40 border border-white/15 rounded p-2 font-mono text-xs text-amber-100 outline-none focus:border-amber-400/60 resize-none"
            />
          </div>
        ) : (
          <div className="p-2.5 flex-1 overflow-y-auto font-mono text-xs leading-relaxed text-[#e8dec8]/90 select-text">
            {statusMsg && (
              <div className="mb-1.5 px-2 py-1 rounded bg-amber-500/25 border border-amber-400/40 text-amber-100 text-[11px]">
                {statusMsg}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {selectedScore.notes.map((n, i) => (
                <span
                  key={n.id || i}
                  className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[11px]"
                >
                  {n.label || formatRelSemitoneLabel(n.relSemitone)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
