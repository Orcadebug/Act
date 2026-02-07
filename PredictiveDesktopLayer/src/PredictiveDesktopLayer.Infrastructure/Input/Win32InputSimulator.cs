using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using PredictiveDesktopLayer.Domain.Interfaces;

namespace PredictiveDesktopLayer.Infrastructure.Input;

public class Win32InputSimulator : IInputSimulator
{
    private readonly ILogger<Win32InputSimulator> _logger;

    private const int INPUT_MOUSE = 0;
    private const int INPUT_KEYBOARD = 1;

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public int type;
        public InputUnion u;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public int mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    public Win32InputSimulator(ILogger<Win32InputSimulator> logger)
    {
        _logger = logger;
    }

    public async Task MoveMouseAsync(int x, int y, CancellationToken cancellationToken = default)
    {
        await Task.Run(() => SetCursorPos(x, y), cancellationToken);
    }

    public async Task ClickAsync(int x, int y, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Click at ({X}, {Y})", x, y);

        await MoveMouseAsync(x, y, cancellationToken);
        await Task.Delay(50, cancellationToken);

        var inputs = new INPUT[]
        {
            CreateMouseInput(MOUSEEVENTF_LEFTDOWN),
            CreateMouseInput(MOUSEEVENTF_LEFTUP)
        };

        await Task.Run(() => SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>()), cancellationToken);
    }

    public async Task RightClickAsync(int x, int y, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Right click at ({X}, {Y})", x, y);

        await MoveMouseAsync(x, y, cancellationToken);
        await Task.Delay(50, cancellationToken);

        var inputs = new INPUT[]
        {
            CreateMouseInput(MOUSEEVENTF_RIGHTDOWN),
            CreateMouseInput(MOUSEEVENTF_RIGHTUP)
        };

        await Task.Run(() => SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>()), cancellationToken);
    }

    public async Task DoubleClickAsync(int x, int y, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Double click at ({X}, {Y})", x, y);

        await ClickAsync(x, y, cancellationToken);
        await Task.Delay(100, cancellationToken);
        await ClickAsync(x, y, cancellationToken);
    }

    public async Task TypeTextAsync(string text, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Typing text: {Text}", text);

        var inputs = new List<INPUT>();

        foreach (var c in text)
        {
            inputs.Add(CreateKeyboardInput(c, false));
            inputs.Add(CreateKeyboardInput(c, true));
        }

        await Task.Run(() => SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>()), cancellationToken);
    }

    public async Task PressKeysAsync(string keys, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Pressing keys: {Keys}", keys);

        var keyParts = keys.ToLowerInvariant().Split('+');
        var virtualKeys = keyParts.Select(ParseKey).Where(k => k != 0).ToList();

        var inputs = new List<INPUT>();

        foreach (var vk in virtualKeys)
        {
            inputs.Add(CreateKeyboardInputVk(vk, false));
        }

        foreach (var vk in virtualKeys.AsEnumerable().Reverse())
        {
            inputs.Add(CreateKeyboardInputVk(vk, true));
        }

        await Task.Run(() => SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>()), cancellationToken);
    }

    public async Task DragAsync(int startX, int startY, int endX, int endY, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Drag from ({StartX}, {StartY}) to ({EndX}, {EndY})", startX, startY, endX, endY);

        await MoveMouseAsync(startX, startY, cancellationToken);
        await Task.Delay(50, cancellationToken);

        var downInput = new INPUT[] { CreateMouseInput(MOUSEEVENTF_LEFTDOWN) };
        await Task.Run(() => SendInput(1, downInput, Marshal.SizeOf<INPUT>()), cancellationToken);

        var steps = 20;
        for (int i = 1; i <= steps; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var x = startX + (endX - startX) * i / steps;
            var y = startY + (endY - startY) * i / steps;
            await MoveMouseAsync(x, y, cancellationToken);
            await Task.Delay(10, cancellationToken);
        }

        var upInput = new INPUT[] { CreateMouseInput(MOUSEEVENTF_LEFTUP) };
        await Task.Run(() => SendInput(1, upInput, Marshal.SizeOf<INPUT>()), cancellationToken);
    }

    public async Task ScrollAsync(int x, int y, int amount, CancellationToken cancellationToken = default)
    {
        _logger.LogDebug("Scroll at ({X}, {Y}) by {Amount}", x, y, amount);

        await MoveMouseAsync(x, y, cancellationToken);
        await Task.Delay(50, cancellationToken);

        var input = new INPUT
        {
            type = INPUT_MOUSE,
            u = new InputUnion
            {
                mi = new MOUSEINPUT
                {
                    mouseData = amount * 120,
                    dwFlags = MOUSEEVENTF_WHEEL
                }
            }
        };

        await Task.Run(() => SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>()), cancellationToken);
    }

    private static INPUT CreateMouseInput(uint flags)
    {
        return new INPUT
        {
            type = INPUT_MOUSE,
            u = new InputUnion
            {
                mi = new MOUSEINPUT
                {
                    dwFlags = flags
                }
            }
        };
    }

    private static INPUT CreateKeyboardInput(char c, bool keyUp)
    {
        return new INPUT
        {
            type = INPUT_KEYBOARD,
            u = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = 0,
                    wScan = c,
                    dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0)
                }
            }
        };
    }

    private static INPUT CreateKeyboardInputVk(ushort vk, bool keyUp)
    {
        return new INPUT
        {
            type = INPUT_KEYBOARD,
            u = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = vk,
                    wScan = 0,
                    dwFlags = keyUp ? KEYEVENTF_KEYUP : 0
                }
            }
        };
    }

    private static ushort ParseKey(string key)
    {
        return key.Trim() switch
        {
            "ctrl" or "control" => 0x11,
            "alt" => 0x12,
            "shift" => 0x10,
            "win" or "windows" => 0x5B,
            "enter" or "return" => 0x0D,
            "tab" => 0x09,
            "escape" or "esc" => 0x1B,
            "backspace" => 0x08,
            "delete" or "del" => 0x2E,
            "insert" or "ins" => 0x2D,
            "home" => 0x24,
            "end" => 0x23,
            "pageup" or "pgup" => 0x21,
            "pagedown" or "pgdn" => 0x22,
            "up" => 0x26,
            "down" => 0x28,
            "left" => 0x25,
            "right" => 0x27,
            "space" => 0x20,
            "f1" => 0x70, "f2" => 0x71, "f3" => 0x72, "f4" => 0x73,
            "f5" => 0x74, "f6" => 0x75, "f7" => 0x76, "f8" => 0x77,
            "f9" => 0x78, "f10" => 0x79, "f11" => 0x7A, "f12" => 0x7B,
            "a" => 0x41, "b" => 0x42, "c" => 0x43, "d" => 0x44,
            "e" => 0x45, "f" => 0x46, "g" => 0x47, "h" => 0x48,
            "i" => 0x49, "j" => 0x4A, "k" => 0x4B, "l" => 0x4C,
            "m" => 0x4D, "n" => 0x4E, "o" => 0x4F, "p" => 0x50,
            "q" => 0x51, "r" => 0x52, "s" => 0x53, "t" => 0x54,
            "u" => 0x55, "v" => 0x56, "w" => 0x57, "x" => 0x58,
            "y" => 0x59, "z" => 0x5A,
            "0" => 0x30, "1" => 0x31, "2" => 0x32, "3" => 0x33,
            "4" => 0x34, "5" => 0x35, "6" => 0x36, "7" => 0x37,
            "8" => 0x38, "9" => 0x39,
            _ => 0
        };
    }
}
