use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 单个音符事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEvent {
    pub id: String,
    /// 距离曲谱起点的开始时间（毫秒）
    pub start_ms: u64,
    /// 音符持续时长（毫秒）
    pub duration_ms: u64,
    /// 相对口琴最低音（低音 1 = 0, 中音 1 = 12, 高音 1 = 24, 倍高音 1 = 36）的半音偏移
    pub rel_semitone: i32,
}

/// 统一曲谱数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    pub id: String,
    pub title: String,
    pub bpm: u32,
    pub total_duration_ms: u64,
    pub transpose_semitones: i32,
    pub notes: Vec<NoteEvent>,
    pub raw_jianpu: Option<String>,
}

/// 解析标准 MIDI 字节流并自动计算最佳口琴音域移调
pub fn parse_midi_bytes(title: &str, data: &[u8]) -> Result<Score, String> {
    let smf = Smf::parse(data).map_err(|e| format!("MIDI 解析失败: {e}"))?;

    let ticks_per_beat = match smf.header.timing {
        Timing::Metrical(t) => t.as_int() as f64,
        Timing::Timecode(fps, sub) => (fps.as_f32() * sub as f32) as f64,
    };

    // 默认 120 BPM (500,000 微秒/拍)
    let mut microseconds_per_beat = 500_000.0;
    let mut raw_notes: Vec<(u64, u64, i32)> = Vec::new(); // (start_ms, duration_ms, midi_pitch)

    for track in &smf.tracks {
        let mut current_ticks: u64 = 0;
        let mut active_notes: HashMap<u8, u64> = HashMap::new();

        for event in track {
            current_ticks += event.delta.as_int() as u64;
            match event.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(tempo)) => {
                    microseconds_per_beat = tempo.as_int() as f64;
                }
                TrackEventKind::Midi { channel, message } => {
                    // 跳过 MIDI 通道 10 (索引 9) 打击乐音轨
                    if channel.as_int() == 9 {
                        continue;
                    }
                    match message {
                        MidiMessage::NoteOn { key, vel } => {
                            let k = key.as_int();
                            if vel.as_int() > 0 {
                                active_notes.insert(k, current_ticks);
                            } else if let Some(start_tick) = active_notes.remove(&k) {
                                let start_ms = ticks_to_ms(
                                    start_tick,
                                    ticks_per_beat,
                                    microseconds_per_beat,
                                );
                                let end_ms = ticks_to_ms(
                                    current_ticks,
                                    ticks_per_beat,
                                    microseconds_per_beat,
                                );
                                let dur = end_ms.saturating_sub(start_ms).max(60);
                                raw_notes.push((start_ms, dur, k as i32));
                            }
                        }
                        MidiMessage::NoteOff { key, .. } => {
                            let k = key.as_int();
                            if let Some(start_tick) = active_notes.remove(&k) {
                                let start_ms = ticks_to_ms(
                                    start_tick,
                                    ticks_per_beat,
                                    microseconds_per_beat,
                                );
                                let end_ms = ticks_to_ms(
                                    current_ticks,
                                    ticks_per_beat,
                                    microseconds_per_beat,
                                );
                                let dur = end_ms.saturating_sub(start_ms).max(60);
                                raw_notes.push((start_ms, dur, k as i32));
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    if raw_notes.is_empty() {
        return Err("MIDI 文件中未找到有效旋律音符".to_string());
    }

    // 按开始时间排序，对于同一时刻的和弦音，保留最高主旋律音（口琴单旋律优化）
    raw_notes.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.2.cmp(&a.2)));
    let mut monophonic_notes: Vec<(u64, u64, i32)> = Vec::new();
    for note in raw_notes {
        if let Some(last) = monophonic_notes.last_mut() {
            if note.0.abs_diff(last.0) < 25 {
                // 同一时刻和弦只取最高音，已在排序时排在前面，忽略同时间低音
                continue;
            }
            // 截断前一个音符重叠的部分，保证单声部清晰触发
            if last.0 + last.1 > note.0 {
                last.1 = (note.0 - last.0).max(40);
            }
        }
        monophonic_notes.push(note);
    }

    // 智能计算最佳移调偏移（目标：将 MIDI 音高映射到 0..=36 的口琴相对半音范围，且黑键半音最少）
    let best_base_midi = find_best_base_midi(&monophonic_notes);
    let bpm = (60_000_000.0 / microseconds_per_beat).round() as u32;

    let mut notes = Vec::with_capacity(monophonic_notes.len());
    let mut total_duration_ms = 0;

    for (idx, (start_ms, duration_ms, midi_pitch)) in monophonic_notes.into_iter().enumerate() {
        let rel = (midi_pitch - best_base_midi).clamp(0, 36);
        total_duration_ms = total_duration_ms.max(start_ms + duration_ms);
        notes.push(NoteEvent {
            id: format!("n-{idx}"),
            start_ms,
            duration_ms,
            rel_semitone: rel,
        });
    }

    Ok(Score {
        id: format!("midi-{}", notes.len()),
        title: title.to_string(),
        bpm: bpm.clamp(40, 240),
        total_duration_ms,
        transpose_semitones: 48 - best_base_midi,
        notes,
        raw_jianpu: None,
    })
}

fn ticks_to_ms(ticks: u64, ticks_per_beat: f64, us_per_beat: f64) -> u64 {
    ((ticks as f64 / ticks_per_beat) * (us_per_beat / 1000.0)).round() as u64
}

/// 寻找最佳的基准低音 Do 对应的 MIDI 编号（默认 C3 = 48 附近）
fn find_best_base_midi(notes: &[(u64, u64, i32)]) -> i32 {
    let black_keys = [1, 3, 6, 8, 10];
    let mut best_base = 48;
    let mut best_score = i64::MIN;

    for candidate_base in 30..=66 {
        let mut in_range_count = 0i64;
        let mut natural_count = 0i64;

        for &(_, _, pitch) in notes {
            let rel = pitch - candidate_base;
            if (0..=36).contains(&rel) {
                in_range_count += 10;
                let step = rel.rem_euclid(12);
                if !black_keys.contains(&step) {
                    natural_count += 3;
                }
            }
        }

        let score = in_range_count + natural_count;
        if score > best_score {
            best_score = score;
            best_base = candidate_base;
        }
    }

    best_base
}
