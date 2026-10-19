use crate::input_simulator::execute_actions;
use crate::midi_parser::Score;
use crate::state_machine::{HarmonicaStateMachine, InputAction};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackConfig {
    /// 是否为本地试听模式（true = 不向游戏发送 SendInput，仅推送事件供前端发声；false = 向游戏发送真实键鼠长按事件）
    pub local_preview_only: bool,
    /// 播放倍速 (0.25 ~ 2.0)
    pub speed: f64,
    /// A-B 截取起点（毫秒）
    pub clip_start_ms: u64,
    /// A-B 截取终点（毫秒，0 表示播放到末尾）
    pub clip_end_ms: u64,
    /// 是否循环播放选中区间
    pub loop_clip: bool,
}

impl Default for PlaybackConfig {
    fn default() -> Self {
        Self {
            local_preview_only: true,
            speed: 1.0,
            clip_start_ms: 0,
            clip_end_ms: 0,
            loop_clip: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStatus {
    pub is_playing: bool,
    pub current_ms: u64,
    pub active_note_id: Option<String>,
    pub active_rel_semitone: Option<i32>,
    pub left_held: bool,
    pub right_held: bool,
    pub middle_held: bool,
    pub active_key: Option<String>,
}

pub struct PlaybackEngine {
    pub config: PlaybackConfig,
    pub current_score: Option<Score>,
    pub is_playing: bool,
    pub current_ms: u64,
    pub state_machine: HarmonicaStateMachine,
}

impl Default for PlaybackEngine {
    fn default() -> Self {
        Self {
            config: PlaybackConfig::default(),
            current_score: None,
            is_playing: false,
            current_ms: 0,
            state_machine: HarmonicaStateMachine::new(18),
        }
    }
}

/// 停止播放并强制释放所有按下的键盘与鼠标左/中/右键（幂等复位）
pub fn stop_and_reset(engine: &Arc<Mutex<PlaybackEngine>>) {
    if let Ok(mut guard) = engine.lock() {
        guard.is_playing = false;
        let reset_actions = guard.state_machine.reset_all();
        if !guard.config.local_preview_only && !reset_actions.is_empty() {
            execute_actions(&reset_actions);
        }
    }
}

/// 启动后台高精度调度线程
pub fn start_playback_loop(engine: Arc<Mutex<PlaybackEngine>>) {
    thread::spawn(move || {
        let mut last_tick = Instant::now();
        let mut current_playing_idx: Option<usize> = None;

        loop {
            thread::sleep(Duration::from_millis(4));
            let now = Instant::now();
            let dt_real_ms = now.duration_since(last_tick).as_secs_f64() * 1000.0;
            last_tick = now;

            let mut pending_actions: Vec<InputAction> = Vec::new();
            let mut local_preview = true;

            {
                let Ok(mut guard) = engine.lock() else {
                    break;
                };
                if !guard.is_playing {
                    // 退出时释放所有按键
                    let reset = guard.state_machine.reset_all();
                    if !guard.config.local_preview_only && !reset.is_empty() {
                        execute_actions(&reset);
                    }
                    break;
                }

                local_preview = guard.config.local_preview_only;
                let speed = guard.config.speed.clamp(0.25, 2.5);
                let next_ms = guard.current_ms + (dt_real_ms * speed).round() as u64;
                guard.current_ms = next_ms;

                let Some(score) = guard.current_score.clone() else {
                    guard.is_playing = false;
                    break;
                };

                let end_limit = if guard.config.clip_end_ms > guard.config.clip_start_ms {
                    guard.config.clip_end_ms.min(score.total_duration_ms)
                } else {
                    score.total_duration_ms
                };

                if guard.current_ms >= end_limit {
                    let reset = guard.state_machine.reset_all();
                    pending_actions.extend(reset);
                    current_playing_idx = None;

                    if guard.config.loop_clip {
                        guard.current_ms = guard.config.clip_start_ms;
                    } else {
                        guard.is_playing = false;
                    }
                } else {
                    // 查找当前时间点应当发声的音符
                    let active_idx = score.notes.iter().position(|n| {
                        guard.current_ms >= n.start_ms
                            && guard.current_ms < n.start_ms + n.duration_ms
                    });

                    if active_idx != current_playing_idx {
                        current_playing_idx = active_idx;
                        if let Some(idx) = active_idx {
                            let note = &score.notes[idx];
                            let actions = guard.state_machine.press_note(note.rel_semitone);
                            pending_actions.extend(actions);
                        } else {
                            let actions = guard.state_machine.release_current_note();
                            pending_actions.extend(actions);
                        }
                    }
                }
            }

            if !local_preview && !pending_actions.is_empty() {
                execute_actions(&pending_actions);
            }
        }
    });
}
