using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace EVirtuoso
{
    internal static class NativeMethods
    {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKeyW(uint uCode, uint uMapType);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

        public const int LOGPIXELSX = 88;
        public const int SW_RESTORE = 9;

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern int GetWindowLongW(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        public static extern int SetWindowLongW(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

        [DllImport("user32.dll")]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_SHOWWINDOW = 0x0040;

        public const int GWL_EXSTYLE = -20;
        public const int WS_EX_LAYERED = 0x00080000;
        public const int WS_EX_TRANSPARENT = 0x00000020;
        public const int WS_EX_TOPMOST = 0x00000008;
        public const uint LWA_ALPHA = 0x00000002;

        public const int INPUT_MOUSE = 0;
        public const int INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_SCANCODE = 0x0008;
        public const uint MAPVK_VK_TO_VSC = 0;

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;

        /// <summary>
        /// 使用 IntPtr type 保证在 32位 (4+24=28字节) 与 64位 (8+32=40字节) 下与 Win32 C++ tagINPUT 内存布局 100% 严丝合缝
        /// </summary>
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public IntPtr type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }
    }

    /// <summary>
    /// 口琴长按 (Hold) 状态机与底层硬件扫描码模拟器
    /// </summary>
    internal sealed class HarmonicaHardwareController
    {
        private readonly object _lock = new object();
        private bool _leftHeld;
        private bool _rightHeld;
        private bool _middleHeld;
        private ushort _activeVk;
        private long _lastSeq;

        private string CurrentOctave()
        {
            if (_leftHeld) return "low";
            if (_rightHeld) return "high";
            return "mid";
        }

        public void TriggerNote(int relSemitone, long seq = 0)
        {
            lock (_lock)
            {
                if (seq > 0)
                {
                    if (seq < _lastSeq) return;
                    _lastSeq = seq;
                }

                if (relSemitone < 0)
                {
                    ResetAllInternal();
                    return;
                }

                int clamped = Math.Max(0, Math.Min(36, relSemitone));
                string curOct = CurrentOctave();
                string targetOct;
                bool targetSemi;
                ushort targetVk;

                // 同音异键优选 1：中音 1 (12) / #1 (13)
                if (clamped == 12 || clamped == 13)
                {
                    targetSemi = (clamped == 13);
                    if (curOct == "low")
                    {
                        targetOct = "low";
                        targetVk = 0xBC; // ','
                    }
                    else
                    {
                        targetOct = "mid";
                        targetVk = 0x5A; // 'Z'
                    }
                }
                // 同音异键优选 2：高音 1 (24) / #1 (25)
                else if (clamped == 24 || clamped == 25)
                {
                    targetSemi = (clamped == 25);
                    if (curOct == "high")
                    {
                        targetOct = "high";
                        targetVk = 0x5A; // 'Z'
                    }
                    else
                    {
                        targetOct = "mid";
                        targetVk = 0xBC; // ','
                    }
                }
                // 倍高音 1 (36)
                else if (clamped == 36)
                {
                    targetOct = "high";
                    targetSemi = false;
                    targetVk = 0xBC; // ','
                }
                else
                {
                    int octIdx = clamped / 12;
                    int step = clamped % 12;
                    targetOct = octIdx == 0 ? "low" : (octIdx == 1 ? "mid" : "high");
                    MapStep(step, out targetVk, out targetSemi);
                }

                // 1. 先释放当前按下的键盘键，等待 20ms (>60fps 单帧 16.7ms)，确保连续同音在游戏内 100% 重新触发
                if (_activeVk != 0)
                {
                    SendKey(_activeVk, true);
                    _activeVk = 0;
                    Thread.Sleep(20);
                }

                // 2. 更新鼠标长按状态（Hold Coalescing：同音区保持长按不松开）
                bool modChanged = false;
                if (targetOct == "mid")
                {
                    if (_leftHeld) { SendMouse(NativeMethods.MOUSEEVENTF_LEFTUP); _leftHeld = false; modChanged = true; }
                    if (_rightHeld) { SendMouse(NativeMethods.MOUSEEVENTF_RIGHTUP); _rightHeld = false; modChanged = true; }
                }
                else if (targetOct == "low")
                {
                    if (_rightHeld) { SendMouse(NativeMethods.MOUSEEVENTF_RIGHTUP); _rightHeld = false; modChanged = true; }
                    if (!_leftHeld) { SendMouse(NativeMethods.MOUSEEVENTF_LEFTDOWN); _leftHeld = true; modChanged = true; }
                }
                else if (targetOct == "high")
                {
                    if (_leftHeld) { SendMouse(NativeMethods.MOUSEEVENTF_LEFTUP); _leftHeld = false; modChanged = true; }
                    if (!_rightHeld) { SendMouse(NativeMethods.MOUSEEVENTF_RIGHTDOWN); _rightHeld = true; modChanged = true; }
                }

                if (targetSemi != _middleHeld)
                {
                    if (targetSemi)
                    {
                        SendMouse(NativeMethods.MOUSEEVENTF_MIDDLEDOWN);
                        _middleHeld = true;
                    }
                    else
                    {
                        SendMouse(NativeMethods.MOUSEEVENTF_MIDDLEUP);
                        _middleHeld = false;
                    }
                    modChanged = true;
                }

                // 3. 若鼠标变调状态切换，预留 28ms 稳定间隔，确保游戏完成升/降调状态切换后再按下琴键
                if (modChanged)
                {
                    Thread.Sleep(28);
                }

                // 4. 按下目标音符键
                SendKey(targetVk, false);
                _activeVk = targetVk;
            }
        }

        /// <summary>
        /// 仅释放当前正在吹奏的键盘按键，保持鼠标长按状态
        /// </summary>
        public void ReleaseNoteOnly(long seq = 0)
        {
            lock (_lock)
            {
                if (seq > 0)
                {
                    if (seq < _lastSeq) return;
                    _lastSeq = seq;
                }
                if (_activeVk != 0)
                {
                    SendKey(_activeVk, true);
                    _activeVk = 0;
                }
            }
        }

        public void ResetAll(long seq = 0)
        {
            lock (_lock)
            {
                if (seq > 0 && seq > _lastSeq)
                {
                    _lastSeq = seq;
                }
                ResetAllInternal();
            }
        }

        private void ResetAllInternal()
        {
            if (_activeVk != 0)
            {
                SendKey(_activeVk, true);
                _activeVk = 0;
            }
            if (_leftHeld)
            {
                SendMouse(NativeMethods.MOUSEEVENTF_LEFTUP);
                _leftHeld = false;
            }
            if (_rightHeld)
            {
                SendMouse(NativeMethods.MOUSEEVENTF_RIGHTUP);
                _rightHeld = false;
            }
            if (_middleHeld)
            {
                SendMouse(NativeMethods.MOUSEEVENTF_MIDDLEUP);
                _middleHeld = false;
            }
        }

        private static void MapStep(int step, out ushort vk, out bool semi)
        {
            switch (step)
            {
                case 0: vk = 0x5A; semi = false; break; // Z (1)
                case 1: vk = 0x5A; semi = true; break;  // Z (#1)
                case 2: vk = 0x58; semi = false; break; // X (2)
                case 3: vk = 0x58; semi = true; break;  // X (#2)
                case 4: vk = 0x43; semi = false; break; // C (3)
                case 5: vk = 0x56; semi = false; break; // V (4)
                case 6: vk = 0x56; semi = true; break;  // V (#4)
                case 7: vk = 0x42; semi = false; break; // B (5)
                case 8: vk = 0x42; semi = true; break;  // B (#5)
                case 9: vk = 0x4E; semi = false; break; // N (6)
                case 10: vk = 0x4E; semi = true; break; // N (#6)
                case 11: vk = 0x4D; semi = false; break;// M (7)
                default: vk = 0x5A; semi = false; break;
            }
        }

        public static void SendKey(ushort vk, bool keyUp)
        {
            ushort scan = (ushort)NativeMethods.MapVirtualKeyW(vk, NativeMethods.MAPVK_VK_TO_VSC);
            // 同时携带虚拟键码 wVk 与硬件扫描码 wScan，兼容 WM_KEYDOWN 与 DirectInput/RawInput
            uint flags = keyUp ? NativeMethods.KEYEVENTF_KEYUP : 0;
            var inputScan = new NativeMethods.INPUT
            {
                type = new IntPtr(NativeMethods.INPUT_KEYBOARD),
                U = new NativeMethods.InputUnion
                {
                    ki = new NativeMethods.KEYBDINPUT
                    {
                        wVk = vk,
                        wScan = scan,
                        dwFlags = flags | NativeMethods.KEYEVENTF_SCANCODE,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
            uint sent = NativeMethods.SendInput(1, new[] { inputScan }, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
            if (sent == 0)
            {
                NativeMethods.keybd_event((byte)vk, (byte)scan, flags, UIntPtr.Zero);
            }
        }

        public static void SendMouse(uint mouseFlags)
        {
            var input = new NativeMethods.INPUT
            {
                type = new IntPtr(NativeMethods.INPUT_MOUSE),
                U = new NativeMethods.InputUnion
                {
                    mi = new NativeMethods.MOUSEINPUT
                    {
                        dx = 0,
                        dy = 0,
                        mouseData = 0,
                        dwFlags = mouseFlags,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };
            uint sent = NativeMethods.SendInput(1, new[] { input }, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
            if (sent == 0)
            {
                NativeMethods.mouse_event(mouseFlags, 0, 0, 0, UIntPtr.Zero);
            }
        }
    }

    /// <summary>
    /// 全局热键监听器：结合 RegisterHotKey 与 GetAsyncKeyState 硬件状态轮询双保险，
    /// 确保在《三角洲行动》等游戏全屏/前台焦点下 100% 稳定响应 F5/F6/F7/F8！
    /// </summary>
    internal sealed class HotkeyMessageWindow : Form
    {
        private readonly ConcurrentQueue<string> _hotkeyQueue;
        private readonly HarmonicaHardwareController _controller;
        private readonly Action _toggleClickThroughAction;
        private readonly object _dispatchLock = new object();
        private long _lastDispatchTick = 0;
        private string _lastDispatchedKey = "";

        public HotkeyMessageWindow(
            ConcurrentQueue<string> hotkeyQueue,
            HarmonicaHardwareController controller,
            Action toggleClickThroughAction)
        {
            _hotkeyQueue = hotkeyQueue;
            _controller = controller;
            _toggleClickThroughAction = toggleClickThroughAction;
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            FormBorderStyle = FormBorderStyle.None;

            // 显式创建窗口句柄，确保 SetVisibleCore(false) 下 OnHandleCreated 依然立即执行！
            if (!IsHandleCreated)
            {
                CreateHandle();
            }

            // 启动 GetAsyncKeyState 硬件按键上升沿轮询线程（穿透 DirectInput/RawInput 游戏独占）
            Thread pollThread = new Thread(PollAsyncKeysLoop)
            {
                IsBackground = true
            };
            pollThread.Start();
        }

        private void DispatchHotkey(string key)
        {
            lock (_dispatchLock)
            {
                long now = Environment.TickCount & int.MaxValue;
                if (key == _lastDispatchedKey && Math.Abs(now - _lastDispatchTick) < 260)
                {
                    return;
                }
                _lastDispatchedKey = key;
                _lastDispatchTick = now;
            }

            if (key == "F5")
            {
                _hotkeyQueue.Enqueue("F5");
            }
            else if (key == "F6")
            {
                _controller.ResetAll();
                _hotkeyQueue.Enqueue("F6");
            }
            else if (key == "F7")
            {
                _controller.ResetAll();
                _hotkeyQueue.Enqueue("F7");
            }
            else if (key == "F8")
            {
                _toggleClickThroughAction();
                _hotkeyQueue.Enqueue("F8");
            }
        }

        private void PollAsyncKeysLoop()
        {
            int[] vks = new[] { 0x74, 0x75, 0x76, 0x77 };
            string[] names = new[] { "F5", "F6", "F7", "F8" };
            bool[] wasDown = new bool[4];

            while (true)
            {
                Thread.Sleep(15);
                for (int i = 0; i < 4; i++)
                {
                    bool isDown = (NativeMethods.GetAsyncKeyState(vks[i]) & 0x8000) != 0;
                    if (isDown && !wasDown[i])
                    {
                        DispatchHotkey(names[i]);
                    }
                    wasDown[i] = isDown;
                }
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeMethods.RegisterHotKey(Handle, 105, 0, 0x74); // F5
            NativeMethods.RegisterHotKey(Handle, 106, 0, 0x75); // F6
            NativeMethods.RegisterHotKey(Handle, 107, 0, 0x76); // F7
            NativeMethods.RegisterHotKey(Handle, 108, 0, 0x77); // F8
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            NativeMethods.UnregisterHotKey(Handle, 105);
            NativeMethods.UnregisterHotKey(Handle, 106);
            NativeMethods.UnregisterHotKey(Handle, 107);
            NativeMethods.UnregisterHotKey(Handle, 108);
            base.OnHandleDestroyed(e);
        }

        protected override void SetVisibleCore(bool value)
        {
            base.SetVisibleCore(false);
        }

        protected override void WndProc(ref Message m)
        {
            const int WM_HOTKEY = 0x0312;
            if (m.Msg == WM_HOTKEY)
            {
                int id = m.WParam.ToInt32();
                if (id == 105) DispatchHotkey("F5");
                else if (id == 106) DispatchHotkey("F6");
                else if (id == 107) DispatchHotkey("F7");
                else if (id == 108) DispatchHotkey("F8");
            }
            base.WndProc(ref m);
        }
    }

    internal static class Program
    {
        private static readonly HarmonicaHardwareController Controller = new HarmonicaHardwareController();
        private static readonly ConcurrentQueue<string> HotkeyQueue = new ConcurrentQueue<string>();
        private static IntPtr _overlayHwnd = IntPtr.Zero;
        private static IntPtr _lastExternalHwnd = IntPtr.Zero;
        private static bool _isClickThrough = false;
        private static byte _currentAlpha = 232;
        private static bool _isAdmin = false;

        private static bool CheckIsAdministrator()
        {
            try
            {
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                {
                    WindowsPrincipal principal = new WindowsPrincipal(identity);
                    return principal.IsInRole(WindowsBuiltInRole.Administrator);
                }
            }
            catch
            {
                return false;
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            try { NativeMethods.SetProcessDPIAware(); } catch { }
            _isAdmin = CheckIsAdministrator();

            // 若当前不是管理员权限且未带 --no-elevate 参数，自动申请管理员权限以突破游戏 UIPI 隔离
            if (!_isAdmin && Array.IndexOf(args, "--no-elevate") < 0)
            {
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = Application.ExecutablePath,
                        Arguments = "--elevated",
                        Verb = "runas",
                        UseShellExecute = true
                    };
                    Process.Start(psi);
                    return;
                }
                catch
                {
                    // 若用户取消了 UAC 提示，继续以普通模式启动并在界面提示
                }
            }

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string distDir = Path.Combine(baseDir, "dist");
            if (!Directory.Exists(distDir))
            {
                string parentDist = Path.Combine(baseDir, "..", "dist");
                if (Directory.Exists(parentDist)) distDir = Path.GetFullPath(parentDist);
            }

            // 清理之前残留的旧 E-Virtuoso 进程，释放 17890 端口
            KillExistingInstances();

            // 1. 先同步绑定 127.0.0.1:17890 端口，确保服务 100% 就绪后再打开界面
            TcpListener listener = StartListenerWithRetry();
            if (listener == null)
            {
                MessageBox.Show("无法绑定本地端口 127.0.0.1:17890，请检查是否有其他实例占用。", "E-Virtuoso", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            Thread serverThread = new Thread(() => AcceptClientsLoop(listener, distDir))
            {
                IsBackground = true
            };
            serverThread.Start();

            // 2. 启动后台焦点追踪线程（实时记录除本工具外的最后一个活动窗口，即游戏窗口 HWND）
            Thread focusTrackerThread = new Thread(TrackLastGameWindowLoop)
            {
                IsBackground = true
            };
            focusTrackerThread.Start();

            // 3. 启动悬浮窗 UI 并自动附加置顶与分层透明样式
            Thread launcherThread = new Thread(LaunchAndAttachOverlayWindow)
            {
                IsBackground = true
            };
            launcherThread.Start();

            AppDomain.CurrentDomain.ProcessExit += (s, e) => Controller.ResetAll();

            // 4. 运行全局热键消息循环
            Application.Run(new HotkeyMessageWindow(HotkeyQueue, Controller, ToggleClickThroughNative));
        }

        private static void KillExistingInstances()
        {
            try
            {
                int currentId = Process.GetCurrentProcess().Id;
                foreach (var proc in Process.GetProcessesByName("E-Virtuoso"))
                {
                    if (proc.Id != currentId)
                    {
                        try { proc.Kill(); proc.WaitForExit(1000); } catch { }
                    }
                }
            }
            catch { }
        }

        private static TcpListener StartListenerWithRetry()
        {
            for (int i = 0; i < 10; i++)
            {
                try
                {
                    var listener = new TcpListener(IPAddress.Loopback, 17890);
                    listener.Start();
                    return listener;
                }
                catch
                {
                    Thread.Sleep(200);
                }
            }
            return null;
        }

        /// <summary>
        /// 自动查找《三角洲行动》(Delta Force) 游戏窗口句柄
        /// </summary>
        private static IntPtr FindDeltaForceWindow()
        {
            IntPtr exactMatch = IntPtr.Zero;
            IntPtr fallbackMatch = IntPtr.Zero;

            NativeMethods.EnumWindows((hWnd, lParam) =>
            {
                if (!NativeMethods.IsWindowVisible(hWnd)) return true;
                if (hWnd == _overlayHwnd) return true;

                var sb = new StringBuilder(256);
                NativeMethods.GetWindowTextW(hWnd, sb, sb.Capacity);
                string title = sb.ToString().Trim();
                if (string.IsNullOrEmpty(title) || title.Contains("E-Virtuoso")) return true;

                bool titleMatches = title.Contains("三角洲行动") ||
                                    title.IndexOf("Delta Force", StringComparison.OrdinalIgnoreCase) >= 0;

                if (titleMatches)
                {
                    if (title.StartsWith("三角洲行动") || title.StartsWith("Delta Force", StringComparison.OrdinalIgnoreCase))
                    {
                        exactMatch = hWnd;
                        return false;
                    }
                    if (fallbackMatch == IntPtr.Zero)
                    {
                        fallbackMatch = hWnd;
                    }
                }
                return true;
            }, IntPtr.Zero);

            return exactMatch != IntPtr.Zero ? exactMatch : fallbackMatch;
        }

        /// <summary>
        /// 实时追踪《三角洲行动》窗口（若未启动则回退追踪最近一次处于前台的外部窗口）
        /// </summary>
        private static void TrackLastGameWindowLoop()
        {
            while (true)
            {
                Thread.Sleep(200);

                // 优先自动锁定《三角洲行动》游戏窗口
                IntPtr deltaHwnd = FindDeltaForceWindow();
                if (deltaHwnd != IntPtr.Zero)
                {
                    _lastExternalHwnd = deltaHwnd;
                    continue;
                }

                IntPtr fg = NativeMethods.GetForegroundWindow();
                if (fg == IntPtr.Zero || fg == _overlayHwnd) continue;

                var sb = new StringBuilder(256);
                NativeMethods.GetWindowTextW(fg, sb, sb.Capacity);
                string title = sb.ToString();
                if (title.Contains("E-Virtuoso"))
                {
                    _overlayHwnd = fg;
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(title))
                {
                    _lastExternalHwnd = fg;
                }
            }
        }

        /// <summary>
        /// 强制将系统输入焦点切换到《三角洲行动》或目标游戏窗口
        /// </summary>
        private static void RestoreFocusToGameWindow()
        {
            IntPtr deltaHwnd = FindDeltaForceWindow();
            if (deltaHwnd != IntPtr.Zero)
            {
                _lastExternalHwnd = deltaHwnd;
            }

            IntPtr target = _lastExternalHwnd;
            if (target == IntPtr.Zero || target == _overlayHwnd || !NativeMethods.IsWindow(target)) return;

            if (NativeMethods.IsIconic(target))
            {
                NativeMethods.ShowWindow(target, NativeMethods.SW_RESTORE);
            }

            IntPtr fg = NativeMethods.GetForegroundWindow();
            if (fg == target) return;

            uint processId;
            uint fgThread = NativeMethods.GetWindowThreadProcessId(fg, out processId);
            uint targetThread = NativeMethods.GetWindowThreadProcessId(target, out processId);
            uint curThread = NativeMethods.GetCurrentThreadId();

            try
            {
                // 模拟空 Alt 键事件解除 Windows 前台窗口焦点锁限制
                NativeMethods.keybd_event(0x12, 0, 0, UIntPtr.Zero);
                NativeMethods.keybd_event(0x12, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);

                if (fgThread != curThread) NativeMethods.AttachThreadInput(curThread, fgThread, true);
                if (targetThread != curThread) NativeMethods.AttachThreadInput(curThread, targetThread, true);

                NativeMethods.BringWindowToTop(target);
                NativeMethods.SetForegroundWindow(target);

                if (targetThread != curThread) NativeMethods.AttachThreadInput(curThread, targetThread, false);
                if (fgThread != curThread) NativeMethods.AttachThreadInput(curThread, fgThread, false);
            }
            catch
            {
                NativeMethods.SetForegroundWindow(target);
            }
        }

        private static void ToggleClickThroughNative()
        {
            _isClickThrough = !_isClickThrough;
            ApplyWindowAttributes(_isClickThrough, _currentAlpha, null);
        }

        private static IntPtr FindOverlayHwnd()
        {
            if (_overlayHwnd != IntPtr.Zero && NativeMethods.IsWindow(_overlayHwnd))
            {
                return _overlayHwnd;
            }
            IntPtr found = IntPtr.Zero;
            NativeMethods.EnumWindows((hWnd, lParam) =>
            {
                var sb = new StringBuilder(256);
                NativeMethods.GetWindowTextW(hWnd, sb, sb.Capacity);
                string title = sb.ToString();
                if (title.Contains("E-Virtuoso 口琴自动演奏助手"))
                {
                    found = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            _overlayHwnd = found;
            return found;
        }

        private static void ApplyWindowAttributes(bool? clickThrough, byte? alpha, bool? miniMode)
        {
            IntPtr hwnd = FindOverlayHwnd();
            if (hwnd == IntPtr.Zero) return;

            int exStyle = NativeMethods.GetWindowLongW(hwnd, NativeMethods.GWL_EXSTYLE);
            exStyle |= NativeMethods.WS_EX_LAYERED | NativeMethods.WS_EX_TOPMOST;

            if (clickThrough.HasValue)
            {
                _isClickThrough = clickThrough.Value;
                if (_isClickThrough) exStyle |= NativeMethods.WS_EX_TRANSPARENT;
                else exStyle &= ~NativeMethods.WS_EX_TRANSPARENT;
            }

            NativeMethods.SetWindowLongW(hwnd, NativeMethods.GWL_EXSTYLE, exStyle);

            if (alpha.HasValue)
            {
                _currentAlpha = alpha.Value;
            }
            NativeMethods.SetLayeredWindowAttributes(hwnd, 0, _currentAlpha, NativeMethods.LWA_ALPHA);

            if (miniMode.HasValue)
            {
                double scale = GetDpiScale();
                int w = (int)Math.Round((miniMode.Value ? 470 : 600) * scale);
                int h = (int)Math.Round((miniMode.Value ? 230 : 700) * scale);
                NativeMethods.SetWindowPos(hwnd, NativeMethods.HWND_TOPMOST, 0, 0, w, h, NativeMethods.SWP_NOMOVE | NativeMethods.SWP_SHOWWINDOW);
            }
            else
            {
                NativeMethods.SetWindowPos(hwnd, NativeMethods.HWND_TOPMOST, 0, 0, 0, 0, NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_SHOWWINDOW);
            }
        }

        private static double GetDpiScale()
        {
            try
            {
                IntPtr hdc = NativeMethods.GetDC(IntPtr.Zero);
                if (hdc != IntPtr.Zero)
                {
                    int dpiX = NativeMethods.GetDeviceCaps(hdc, NativeMethods.LOGPIXELSX);
                    NativeMethods.ReleaseDC(IntPtr.Zero, hdc);
                    if (dpiX >= 96) return dpiX / 96.0;
                }
            }
            catch { }
            return 1.0;
        }

        private static void LaunchAndAttachOverlayWindow()
        {
            string url = "http://127.0.0.1:17890/?host=native";
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (!File.Exists(edgePath))
            {
                edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
            }

            if (File.Exists(edgePath))
            {
                string tempProfile = Path.Combine(Path.GetTempPath(), "EVirtuoso_Overlay_Profile");
                Process.Start(new ProcessStartInfo
                {
                    FileName = edgePath,
                    Arguments = string.Format("--app=\"{0}\" --window-size=600,700 --disable-background-timer-throttling --disable-renderer-backgrounding --user-data-dir=\"{1}\"", url, tempProfile),
                    UseShellExecute = false
                });
            }
            else
            {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            }

            // 等待窗口创建并挂载 TOPMOST + LAYERED 半透明属性
            IntPtr trackedHwnd = IntPtr.Zero;
            for (int i = 0; i < 60; i++)
            {
                Thread.Sleep(250);
                trackedHwnd = FindOverlayHwnd();
                if (trackedHwnd != IntPtr.Zero)
                {
                    ApplyWindowAttributes(false, _currentAlpha, false);
                    break;
                }
            }

            // 只有当成功关联到悬浮窗 HWND，且该 HWND 后来被用户关闭（!IsWindow）时，才退出宿主进程！
            // 严禁使用 browserProc.WaitForExit()，因为 Edge 启动器进程移交窗口后会立即退出。
            if (trackedHwnd != IntPtr.Zero)
            {
                while (NativeMethods.IsWindow(trackedHwnd))
                {
                    Thread.Sleep(500);
                }
                Controller.ResetAll();
                Environment.Exit(0);
            }
        }

        private static void AcceptClientsLoop(TcpListener listener, string distDir)
        {
            while (true)
            {
                try
                {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(_ => HandleClient(client, distDir));
                }
                catch
                {
                    break;
                }
            }
        }

        private static readonly object _scoresFileLock = new object();

        private static string GetScoresDirectory()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string scoresDir = Path.Combine(baseDir, "scores");
            if (!Directory.Exists(scoresDir))
            {
                string parentScores = Path.Combine(baseDir, "..", "scores");
                if (Directory.Exists(parentScores)) scoresDir = Path.GetFullPath(parentScores);
                else Directory.CreateDirectory(scoresDir);
            }
            return scoresDir;
        }

        private static void HandleClient(TcpClient client, string distDir)
        {
            using (client)
            using (NetworkStream stream = client.GetStream())
            {
                stream.ReadTimeout = 5000;
                byte[] buf = new byte[8192];
                using (MemoryStream ms = new MemoryStream())
                {
                    int headerEndByteIdx = -1;
                    int contentLength = 0;

                    while (true)
                    {
                        int read = stream.Read(buf, 0, buf.Length);
                        if (read <= 0) break;
                        ms.Write(buf, 0, read);

                        if (headerEndByteIdx < 0)
                        {
                            byte[] cur = ms.ToArray();
                            for (int i = 0; i <= cur.Length - 4; i++)
                            {
                                if (cur[i] == '\r' && cur[i + 1] == '\n' && cur[i + 2] == '\r' && cur[i + 3] == '\n')
                                {
                                    headerEndByteIdx = i + 4;
                                    string headerStr = Encoding.ASCII.GetString(cur, 0, headerEndByteIdx);
                                    Match mLen = Regex.Match(headerStr, @"Content-Length\s*:\s*(\d+)", RegexOptions.IgnoreCase);
                                    if (mLen.Success)
                                    {
                                        contentLength = int.Parse(mLen.Groups[1].Value);
                                    }
                                    break;
                                }
                            }
                        }

                        if (headerEndByteIdx >= 0 && ms.Length >= headerEndByteIdx + contentLength)
                        {
                            break;
                        }
                    }

                    if (ms.Length == 0 || headerEndByteIdx < 0) return;

                    byte[] allBytes = ms.ToArray();
                    string headerPart = Encoding.UTF8.GetString(allBytes, 0, headerEndByteIdx);
                    int actualBodyLen = Math.Max(0, Math.Min(contentLength, allBytes.Length - headerEndByteIdx));
                    string body = actualBodyLen > 0 ? Encoding.UTF8.GetString(allBytes, headerEndByteIdx, actualBodyLen) : "";

                    string[] lines = headerPart.Split(new[] { "\r\n" }, StringSplitOptions.None);
                    if (lines.Length == 0) return;

                    string[] firstLine = lines[0].Split(' ');
                    if (firstLine.Length < 2) return;

                    string method = firstLine[0];
                    string rawPath = firstLine[1].Split('?')[0];

                    if (method == "OPTIONS")
                    {
                        WriteJsonResponse(stream, "{\"ok\":true}");
                        return;
                    }

                    if (rawPath == "/api/scores_sync")
                    {
                        string scoresDir = GetScoresDirectory();
                        string customFile = Path.Combine(scoresDir, "custom_scores.json");

                        if (method == "GET")
                        {
                            string customJson = "[]";
                            lock (_scoresFileLock)
                            {
                                if (File.Exists(customFile))
                                {
                                    try
                                    {
                                        string txt = File.ReadAllText(customFile, Encoding.UTF8).Trim();
                                        if (txt.StartsWith("[") && txt.EndsWith("]")) customJson = txt;
                                    }
                                    catch { }
                                }
                            }

                            var midiSb = new StringBuilder("[");
                            try
                            {
                                string[] files = Directory.GetFiles(scoresDir);
                                bool first = true;
                                foreach (string f in files)
                                {
                                    string ext = Path.GetExtension(f).ToLowerInvariant();
                                    if (ext == ".mid" || ext == ".midi")
                                    {
                                        byte[] fBytes = File.ReadAllBytes(f);
                                        string b64 = Convert.ToBase64String(fBytes);
                                        string safeName = Path.GetFileName(f).Replace("\\", "\\\\").Replace("\"", "\\\"");
                                        if (!first) midiSb.Append(",");
                                        first = false;
                                        midiSb.AppendFormat("{{\"name\":\"{0}\",\"base64\":\"{1}\"}}", safeName, b64);
                                    }
                                }
                            }
                            catch { }
                            midiSb.Append("]");

                            string respJson = string.Format("{{\"customScores\":{0},\"midiFiles\":{1}}}", customJson, midiSb.ToString());
                            WriteJsonResponse(stream, respJson);
                            return;
                        }
                        else if (method == "POST")
                        {
                            string trimmed = body.Trim();
                            if (trimmed.StartsWith("[") && trimmed.EndsWith("]"))
                            {
                                lock (_scoresFileLock)
                                {
                                    File.WriteAllText(customFile, trimmed, Encoding.UTF8);
                                }
                            }
                            WriteJsonResponse(stream, "{\"ok\":true}");
                            return;
                        }
                    }

                    if (method == "POST" && rawPath == "/api/focus_game")
                    {
                        RestoreFocusToGameWindow();
                        WriteJsonResponse(stream, "{\"ok\":true}");
                        return;
                    }

                    if (method == "POST" && rawPath == "/api/trigger_note")
                    {
                        Match m = Regex.Match(body, @"""relSemitone""\s*:\s*(-?\d+)");
                        Match mSeq = Regex.Match(body, @"""seq""\s*:\s*(\d+)");
                        long seq = mSeq.Success ? long.Parse(mSeq.Groups[1].Value) : 0;
                        if (m.Success)
                        {
                            int semi = int.Parse(m.Groups[1].Value);
                            if (semi == -2)
                            {
                                // -2 表示音符间隙仅松开键盘琴键，保持鼠标长按
                                Controller.ReleaseNoteOnly(seq);
                            }
                            else if (semi < 0)
                            {
                                // -1 表示完全停止并释放所有键盘与鼠标键
                                Controller.ResetAll(seq);
                            }
                            else
                            {
                                // 确保焦点在游戏窗口，而不是停留在工具窗口上
                                if (NativeMethods.GetForegroundWindow() == _overlayHwnd && _lastExternalHwnd != IntPtr.Zero)
                                {
                                    RestoreFocusToGameWindow();
                                }
                                Controller.TriggerNote(semi, seq);
                            }
                        }
                        WriteJsonResponse(stream, "{\"ok\":true}");
                        return;
                    }

                    if (method == "POST" && rawPath == "/api/window")
                    {
                        Match mOpacity = Regex.Match(body, @"""opacity""\s*:\s*([0-9.]+)");
                        if (mOpacity.Success)
                        {
                            double op = double.Parse(mOpacity.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
                            byte alpha = (byte)Math.Max(80, Math.Min(255, (int)Math.Round(op * 255)));
                            ApplyWindowAttributes(null, alpha, null);
                        }
                        Match mClick = Regex.Match(body, @"""clickThrough""\s*:\s*(true|false)");
                        if (mClick.Success)
                        {
                            bool ct = mClick.Groups[1].Value == "true";
                            ApplyWindowAttributes(ct, null, null);
                        }
                        Match mMini = Regex.Match(body, @"""mini""\s*:\s*(true|false)");
                        if (mMini.Success)
                        {
                            bool mini = mMini.Groups[1].Value == "true";
                            ApplyWindowAttributes(null, null, mini);
                        }
                        WriteJsonResponse(stream, "{\"ok\":true}");
                        return;
                    }

                    if (rawPath == "/api/poll_hotkey")
                    {
                        string hk;
                        string lastWindowTitle = "";
                        if (_lastExternalHwnd != IntPtr.Zero)
                        {
                            var sb = new StringBuilder(128);
                            NativeMethods.GetWindowTextW(_lastExternalHwnd, sb, sb.Capacity);
                            lastWindowTitle = sb.ToString().Replace("\"", "\\\"");
                        }
                        if (HotkeyQueue.TryDequeue(out hk))
                        {
                            WriteJsonResponse(stream, string.Format("{{\"hotkey\":\"{0}\",\"isAdmin\":{1},\"targetWindow\":\"{2}\"}}", hk, _isAdmin ? "true" : "false", lastWindowTitle));
                        }
                        else
                        {
                            WriteJsonResponse(stream, string.Format("{{\"hotkey\":null,\"isAdmin\":{0},\"targetWindow\":\"{1}\"}}", _isAdmin ? "true" : "false", lastWindowTitle));
                        }
                        return;
                    }

                    string relFile = rawPath == "/" ? "index.html" : rawPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string fullPath = Path.Combine(distDir, relFile);
                    if (!File.Exists(fullPath))
                    {
                        fullPath = Path.Combine(distDir, "index.html");
                    }

                    if (File.Exists(fullPath))
                    {
                        byte[] content = File.ReadAllBytes(fullPath);
                        string mime = GetMimeType(fullPath);
                        string header = "HTTP/1.1 200 OK\r\nContent-Type: " + mime + "\r\nContent-Length: " + content.Length + "\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
                        byte[] headerBytes = Encoding.UTF8.GetBytes(header);
                        stream.Write(headerBytes, 0, headerBytes.Length);
                        stream.Write(content, 0, content.Length);
                    }
                    else
                    {
                        WriteJsonResponse(stream, "{\"error\":\"not found\"}");
                    }
                }
            }
        }

        private static void WriteJsonResponse(NetworkStream stream, string json)
        {
            byte[] body = Encoding.UTF8.GetBytes(json);
            string header = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + body.Length + "\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
            byte[] headerBytes = Encoding.UTF8.GetBytes(header);
            stream.Write(headerBytes, 0, headerBytes.Length);
            stream.Write(body, 0, body.Length);
        }

        private static string GetMimeType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext == ".html") return "text/html; charset=utf-8";
            if (ext == ".js") return "application/javascript; charset=utf-8";
            if (ext == ".css") return "text/css; charset=utf-8";
            if (ext == ".json") return "application/json; charset=utf-8";
            if (ext == ".svg") return "image/svg+xml";
            return "application/octet-stream";
        }
    }
}
