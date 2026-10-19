use crate::state_machine::{HarmonicaKey, InputAction};
use std::thread;
use std::time::Duration;

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, MAPVK_VK_TO_VSC, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP, MOUSEINPUT, VIRTUAL_KEY,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

/// 执行一连串底层键鼠输入动作（纯外部 SendInput 硬件扫描码流，零内存侵入）
pub fn execute_actions(actions: &[InputAction]) {
    for action in actions {
        match action {
            InputAction::WaitMs(ms) => {
                if *ms > 0 {
                    thread::sleep(Duration::from_millis(*ms as u64));
                }
            }
            InputAction::KeyDown(key) => send_key(*key, false),
            InputAction::KeyUp(key) => send_key(*key, true),
            InputAction::MouseLeftDown => send_mouse(MOUSE_LEFT_DOWN),
            InputAction::MouseLeftUp => send_mouse(MOUSE_LEFT_UP),
            InputAction::MouseRightDown => send_mouse(MOUSE_RIGHT_DOWN),
            InputAction::MouseRightUp => send_mouse(MOUSE_RIGHT_UP),
            InputAction::MouseMiddleDown => send_mouse(MOUSE_MIDDLE_DOWN),
            InputAction::MouseMiddleUp => send_mouse(MOUSE_MIDDLE_UP),
        }
    }
}

const MOUSE_LEFT_DOWN: u32 = 1;
const MOUSE_LEFT_UP: u32 = 2;
const MOUSE_RIGHT_DOWN: u32 = 3;
const MOUSE_RIGHT_UP: u32 = 4;
const MOUSE_MIDDLE_DOWN: u32 = 5;
const MOUSE_MIDDLE_UP: u32 = 6;

#[cfg(target_os = "windows")]
fn send_key(key: HarmonicaKey, is_key_up: bool) {
    unsafe {
        let vk = key.vk_code();
        let scan_code = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as u16;
        let mut flags = KEYEVENTF_SCANCODE;
        if is_key_up {
            flags |= KEYEVENTF_KEYUP;
        }

        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: scan_code,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn send_key(_key: HarmonicaKey, _is_key_up: bool) {}

#[cfg(target_os = "windows")]
fn send_mouse(kind: u32) {
    unsafe {
        let flags = match kind {
            MOUSE_LEFT_DOWN => MOUSEEVENTF_LEFTDOWN,
            MOUSE_LEFT_UP => MOUSEEVENTF_LEFTUP,
            MOUSE_RIGHT_DOWN => MOUSEEVENTF_RIGHTDOWN,
            MOUSE_RIGHT_UP => MOUSEEVENTF_RIGHTUP,
            MOUSE_MIDDLE_DOWN => MOUSEEVENTF_MIDDLEDOWN,
            MOUSE_MIDDLE_UP => MOUSEEVENTF_MIDDLEUP,
            _ => return,
        };

        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

#[cfg(not(target_os = "windows"))]
fn send_mouse(_kind: u32) {}

/// 切换悬浮窗口的鼠标穿透状态（WS_EX_TRANSPARENT）
#[cfg(target_os = "windows")]
pub fn set_window_click_through(hwnd_raw: isize, enabled: bool) {
    unsafe {
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        let new_style = if enabled {
            ex_style | (WS_EX_LAYERED.0 as i32) | (WS_EX_TRANSPARENT.0 as i32)
        } else {
            ex_style & !(WS_EX_TRANSPARENT.0 as i32)
        };
        SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_window_click_through(_hwnd_raw: isize, _enabled: bool) {}
