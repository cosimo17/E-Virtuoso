use serde::{Deserialize, Serialize};

/// 口琴 8 个基础键盘按键
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HarmonicaKey {
    Z,     // 1 (Do)
    X,     // 2 (Re)
    C,     // 3 (Mi)
    V,     // 4 (Fa)
    B,     // 5 (Sol)
    N,     // 6 (La)
    M,     // 7 (Si)
    Comma, // , (高八度 1)
}

impl HarmonicaKey {
    /// 获取对应的 Windows 虚拟键码 (VK_CODE)
    pub fn vk_code(&self) -> u16 {
        match self {
            HarmonicaKey::Z => 0x5A,     // 'Z'
            HarmonicaKey::X => 0x58,     // 'X'
            HarmonicaKey::C => 0x43,     // 'C'
            HarmonicaKey::V => 0x56,     // 'V'
            HarmonicaKey::B => 0x42,     // 'B'
            HarmonicaKey::N => 0x4E,     // 'N'
            HarmonicaKey::M => 0x4D,     // 'M'
            HarmonicaKey::Comma => 0xBC, // VK_OEM_COMMA ','
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            HarmonicaKey::Z => "Z",
            HarmonicaKey::X => "X",
            HarmonicaKey::C => "C",
            HarmonicaKey::V => "V",
            HarmonicaKey::B => "B",
            HarmonicaKey::N => "N",
            HarmonicaKey::M => "M",
            HarmonicaKey::Comma => ",",
        }
    }
}

/// 八度档位状态（由鼠标左键/右键长按控制）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OctaveMode {
    Low,  // 降调：长按鼠标左键
    Mid,  // 中音：释放鼠标左/右键（默认）
    High, // 升调：长按鼠标右键
}

/// 底层输入动作指令
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InputAction {
    MouseLeftDown,
    MouseLeftUp,
    MouseRightDown,
    MouseRightUp,
    MouseMiddleDown,
    MouseMiddleUp,
    KeyDown(HarmonicaKey),
    KeyUp(HarmonicaKey),
    /// 变调与按键之间的稳定等待窗口（毫秒）
    WaitMs(u32),
}

/// 目标演奏配置：(八度档位, 是否半音, 键盘按键)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoteFingering {
    pub octave: OctaveMode,
    pub is_semitone: bool,
    pub key: HarmonicaKey,
}

/// 口琴长按（Hold）状态机
/// 追踪当前鼠标左/中/右键的长按状态与当前按下的键盘音符键
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarmonicaStateMachine {
    pub left_held: bool,
    pub right_held: bool,
    pub middle_held: bool,
    pub active_key: Option<HarmonicaKey>,
    pub lead_time_ms: u32,
}

impl Default for HarmonicaStateMachine {
    fn default() -> Self {
        Self {
            left_held: false,
            right_held: false,
            middle_held: false,
            active_key: None,
            lead_time_ms: 18,
        }
    }
}

impl HarmonicaStateMachine {
    pub fn new(lead_time_ms: u32) -> Self {
        Self {
            lead_time_ms,
            ..Default::default()
        }
    }

    /// 获取当前鼠标长按所对应的八度模式
    pub fn current_octave(&self) -> OctaveMode {
        if self.left_held {
            OctaveMode::Low
        } else if self.right_held {
            OctaveMode::High
        } else {
            OctaveMode::Mid
        }
    }

    /// 将相对半音偏移（0..=36，其中 0 = 低音 1 / C3，12 = 中音 1 / C4，24 = 高音 1 / C5，36 = 倍高音 1 / C6）
    /// 映射为最优的按键指法（含 `,` 逗号键同音异键智能优选）
    pub fn resolve_fingering(&self, rel_semitone: i32) -> Option<NoteFingering> {
        let clamped = rel_semitone.clamp(0, 36);
        let cur_oct = self.current_octave();

        // 特殊同音异键点 1：rel_semitone == 12 (中音 1) 或 13 (中音 #1)
        // 可选方案 A: (Mid, Z)  | 可选方案 B: (Low, Comma)
        if clamped == 12 || clamped == 13 {
            let is_semi = clamped == 13;
            if cur_oct == OctaveMode::Low {
                return Some(NoteFingering {
                    octave: OctaveMode::Low,
                    is_semitone: is_semi,
                    key: HarmonicaKey::Comma,
                });
            } else {
                return Some(NoteFingering {
                    octave: OctaveMode::Mid,
                    is_semitone: is_semi,
                    key: HarmonicaKey::Z,
                });
            }
        }

        // 特殊同音异键点 2：rel_semitone == 24 (高音 1) 或 25 (高音 #1)
        // 可选方案 A: (Mid, Comma) | 可选方案 B: (High, Z)
        if clamped == 24 || clamped == 25 {
            let is_semi = clamped == 25;
            if cur_oct == OctaveMode::High {
                return Some(NoteFingering {
                    octave: OctaveMode::High,
                    is_semitone: is_semi,
                    key: HarmonicaKey::Z,
                });
            } else {
                return Some(NoteFingering {
                    octave: OctaveMode::Mid,
                    is_semitone: is_semi,
                    key: HarmonicaKey::Comma,
                });
            }
        }

        // 特殊最高音：rel_semitone == 36 (倍高音 1)
        if clamped == 36 {
            return Some(NoteFingering {
                octave: OctaveMode::High,
                is_semitone: false,
                key: HarmonicaKey::Comma,
            });
        }

        // 常规映射：按八度拆分
        let octave_idx = clamped / 12; // 0 -> Low, 1 -> Mid, 2 -> High
        let note_in_octave = clamped % 12;

        let octave = match octave_idx {
            0 => OctaveMode::Low,
            1 => OctaveMode::Mid,
            _ => OctaveMode::High,
        };

        let (key, is_semitone) = match note_in_octave {
            0 => (HarmonicaKey::Z, false), // 1
            1 => (HarmonicaKey::Z, true),  // #1
            2 => (HarmonicaKey::X, false), // 2
            3 => (HarmonicaKey::X, true),  // #2
            4 => (HarmonicaKey::C, false), // 3
            5 => (HarmonicaKey::V, false), // 4
            6 => (HarmonicaKey::V, true),  // #4
            7 => (HarmonicaKey::B, false), // 5
            8 => (HarmonicaKey::B, true),  // #5
            9 => (HarmonicaKey::N, false), // 6
            10 => (HarmonicaKey::N, true), // #6
            11 => (HarmonicaKey::M, false), // 7
            _ => return None,
        };

        Some(NoteFingering {
            octave,
            is_semitone,
            key,
        })
    }

    /// 触发音符按下：自动计算最小鼠标长按状态切换序列并按下目标琴键
    pub fn press_note(&mut self, rel_semitone: i32) -> Vec<InputAction> {
        let mut actions = Vec::new();
        let Some(target) = self.resolve_fingering(rel_semitone) else {
            return actions;
        };

        // 1. 若当前有正在按下的键盘键，先释放它
        if let Some(prev_key) = self.active_key.take() {
            actions.push(InputAction::KeyUp(prev_key));
        }

        // 2. 检查是否需要改变鼠标长按状态（Hold Coalescing：状态相同则保持按住不松开）
        let mut modifier_changed = false;

        match target.octave {
            OctaveMode::Mid => {
                if self.left_held {
                    actions.push(InputAction::MouseLeftUp);
                    self.left_held = false;
                    modifier_changed = true;
                }
                if self.right_held {
                    actions.push(InputAction::MouseRightUp);
                    self.right_held = false;
                    modifier_changed = true;
                }
            }
            OctaveMode::Low => {
                if self.right_held {
                    actions.push(InputAction::MouseRightUp);
                    self.right_held = false;
                    modifier_changed = true;
                }
                if !self.left_held {
                    actions.push(InputAction::MouseLeftDown);
                    self.left_held = true;
                    modifier_changed = true;
                }
            }
            OctaveMode::High => {
                if self.left_held {
                    actions.push(InputAction::MouseLeftUp);
                    self.left_held = false;
                    modifier_changed = true;
                }
                if !self.right_held {
                    actions.push(InputAction::MouseRightDown);
                    self.right_held = true;
                    modifier_changed = true;
                }
            }
        }

        if target.is_semitone != self.middle_held {
            if target.is_semitone {
                actions.push(InputAction::MouseMiddleDown);
                self.middle_held = true;
            } else {
                actions.push(InputAction::MouseMiddleUp);
                self.middle_held = false;
            }
            modifier_changed = true;
        }

        // 3. 若鼠标变调状态发生了改变，插入前置稳定缓冲等待窗口
        if modifier_changed && self.lead_time_ms > 0 {
            actions.push(InputAction::WaitMs(self.lead_time_ms));
        }

        // 4. 按下目标音符键
        actions.push(InputAction::KeyDown(target.key));
        self.active_key = Some(target.key);

        actions
    }

    /// 释放当前音符按键（保持鼠标修饰键状态，以便下一个连续同八度音符无需重新按鼠标）
    pub fn release_current_note(&mut self) -> Vec<InputAction> {
        let mut actions = Vec::new();
        if let Some(prev_key) = self.active_key.take() {
            actions.push(InputAction::KeyUp(prev_key));
        }
        actions
    }

    /// 停止/暂停时的幂等复位：释放所有键盘按键与鼠标长按按键，恢复默认中音自然音状态
    pub fn reset_all(&mut self) -> Vec<InputAction> {
        let mut actions = Vec::new();
        if let Some(prev_key) = self.active_key.take() {
            actions.push(InputAction::KeyUp(prev_key));
        }
        if self.left_held {
            actions.push(InputAction::MouseLeftUp);
            self.left_held = false;
        }
        if self.right_held {
            actions.push(InputAction::MouseRightUp);
            self.right_held = false;
        }
        if self.middle_held {
            actions.push(InputAction::MouseMiddleUp);
            self.middle_held = false;
        }
        actions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hold_coalescing_and_reset() {
        let mut sm = HarmonicaStateMachine::new(18);

        // 1. 演奏高音 2 (rel_semitone = 26 -> High + X)
        let actions1 = sm.press_note(26);
        assert_eq!(
            actions1,
            vec![
                InputAction::MouseRightDown,
                InputAction::WaitMs(18),
                InputAction::KeyDown(HarmonicaKey::X)
            ]
        );
        assert!(sm.right_held);

        // 2. 连续演奏高音 3 (rel_semitone = 28 -> High + C)，右键应保持长按不重复触发
        let actions2 = sm.press_note(28);
        assert_eq!(
            actions2,
            vec![
                InputAction::KeyUp(HarmonicaKey::X),
                InputAction::KeyDown(HarmonicaKey::C)
            ]
        );
        assert!(sm.right_held);

        // 3. 停止复位，应释放 C 键并释放鼠标右键
        let reset_actions = sm.reset_all();
        assert_eq!(
            reset_actions,
            vec![
                InputAction::KeyUp(HarmonicaKey::C),
                InputAction::MouseRightUp
            ]
        );
        assert!(!sm.right_held);
    }

    #[test]
    fn test_comma_key_smart_routing() {
        let mut sm = HarmonicaStateMachine::new(15);

        // 默认在中音区 (Mid) 演奏高音 1 (rel_semitone = 24)，应直接选用 Comma 键而不按鼠标右键
        let actions_mid = sm.press_note(24);
        assert_eq!(actions_mid, vec![InputAction::KeyDown(HarmonicaKey::Comma)]);
        assert!(!sm.right_held);

        // 切换到低音 7 (rel_semitone = 11 -> Low + M)
        let _ = sm.press_note(11);
        assert!(sm.left_held);

        // 当前在 Low 状态演奏中音 1 (rel_semitone = 12)，应直接复用 Low 状态的 Comma 键而不松开左键
        let actions_low_to_mid_do = sm.press_note(12);
        assert_eq!(
            actions_low_to_mid_do,
            vec![
                InputAction::KeyUp(HarmonicaKey::M),
                InputAction::KeyDown(HarmonicaKey::Comma)
            ]
        );
        assert!(sm.left_held);
    }
}
