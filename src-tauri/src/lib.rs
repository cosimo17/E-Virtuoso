pub mod input_simulator;
pub mod midi_parser;
pub mod scheduler;
pub mod state_machine;

use input_simulator::{execute_actions, set_window_click_through};
use midi_parser::{parse_midi_bytes, Score};
use scheduler::{start_playback_loop, stop_and_reset, PlaybackConfig, PlaybackEngine};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub engine: Arc<Mutex<PlaybackEngine>>,
}

#[tauri::command]
fn load_score(state: State<'_, AppState>, score: Score) -> Result<(), String> {
    stop_and_reset(&state.engine);
    if let Ok(mut guard) = state.engine.lock() {
        guard.current_ms = guard.config.clip_start_ms;
        guard.current_score = Some(score);
    }
    Ok(())
}

#[tauri::command]
fn import_midi_file(title: String, bytes: Vec<u8>) -> Result<Score, String> {
    parse_midi_bytes(&title, &bytes)
}

#[tauri::command]
fn update_playback_config(state: State<'_, AppState>, config: PlaybackConfig) -> Result<(), String> {
    if let Ok(mut guard) = state.engine.lock() {
        // 如果从实战模式切换到本地试听模式，立即释放所有已按下的游戏键鼠
        if !guard.config.local_preview_only && config.local_preview_only {
            let reset = guard.state_machine.reset_all();
            execute_actions(&reset);
        }
        guard.config = config;
    }
    Ok(())
}

#[tauri::command]
fn toggle_playback(state: State<'_, AppState>, start_ms: Option<u64>) -> Result<bool, String> {
    let should_start = {
        let mut guard = state.engine.lock().map_err(|e| e.to_string())?;
        if guard.is_playing {
            guard.is_playing = false;
            let reset = guard.state_machine.reset_all();
            if !guard.config.local_preview_only {
                execute_actions(&reset);
            }
            false
        } else {
            if let Some(ms) = start_ms {
                guard.current_ms = ms;
            }
            guard.is_playing = true;
            true
        }
    };

    if should_start {
        start_playback_loop(Arc::clone(&state.engine));
    }
    Ok(should_start)
}

#[tauri::command]
fn stop_playback(state: State<'_, AppState>) -> Result<(), String> {
    stop_and_reset(&state.engine);
    if let Ok(mut guard) = state.engine.lock() {
        guard.current_ms = guard.config.clip_start_ms;
    }
    Ok(())
}

#[tauri::command]
fn trigger_single_note(
    state: State<'_, AppState>,
    rel_semitone: Option<i32>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.engine.lock() {
        if guard.config.local_preview_only {
            return Ok(());
        }
        let actions = match rel_semitone {
            Some(semi) => guard.state_machine.press_note(semi),
            None => guard.state_machine.reset_all(),
        };
        execute_actions(&actions);
    }
    Ok(())
}

#[tauri::command]
fn set_click_through(window: tauri::Window, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            set_window_click_through(hwnd.0 as isize, enabled);
        }
    }
    let _ = window.set_ignore_cursor_events(enabled);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let engine = Arc::new(Mutex::new(PlaybackEngine::default()));

    tauri::Builder::default()
        .manage(AppState { engine })
        .invoke_handler(tauri::generate_handler![
            load_score,
            import_midi_file,
            update_playback_config,
            toggle_playback,
            stop_playback,
            trigger_single_note,
            set_click_through
        ])
        .run(tauri::generate_context!())
        .expect("error while running E-Virtuoso application");
}
