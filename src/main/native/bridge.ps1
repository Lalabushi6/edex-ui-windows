# eDEX-UI native bridge.
#
# A long-lived helper process that gives the Electron main process access to
# Win32 APIs Node cannot reach on its own (top-level window enumeration and
# activation, media keys, master volume, performance counters, Start menu apps).
#
# Protocol: one JSON request per stdin line  {"id":1,"cmd":"windows","args":{}}
#           one JSON response per stdout line {"id":1,"ok":true,"data":...}
# The first line written is {"ready":true} once the interop types are loaded.
param([string]$CacheDir = $env:TEMP)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding  = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int j();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexMMDevice {
    int Activate(ref Guid id, int clsCtx, int activationParams, out IEdexAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexMMDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IEdexMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class EdexMMDeviceEnumeratorComObject { }

public static class EdexNative {
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hWnd, int idx);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int val, int size);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder sb, ref uint size);
    [DllImport("powrprof.dll")] static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake);
    [DllImport("user32.dll")] static extern bool LockWorkStation();

    const uint GW_OWNER = 4;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const int WS_EX_APPWINDOW = 0x40000;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const int DWMWA_CLOAKED = 14;
    const uint WM_CLOSE = 0x0010;
    const int SW_MAXIMIZE = 3, SW_MINIMIZE = 6, SW_RESTORE = 9;
    const uint KEYEVENTF_EXTENDEDKEY = 1, KEYEVENTF_KEYUP = 2;

    static readonly HashSet<string> SkipClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
        "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "XamlExplorerHostIslandWindow"
    };
    static readonly Dictionary<uint, string> ExeCache = new Dictionary<uint, string>();

    public static string Q(string s) {
        if (s == null) return "null";
        var sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        foreach (char c in s) {
            switch (c) {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || (int)c == 0x2028 || (int)c == 0x2029) sb.AppendFormat("\\u{0:x4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    static string N(double v) {
        if (double.IsNaN(v) || double.IsInfinity(v)) return "null";
        return v.ToString("0.###", CultureInfo.InvariantCulture);
    }

    static string ExePath(uint pid) {
        string cached;
        if (ExeCache.TryGetValue(pid, out cached)) return cached;
        string result = "";
        IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if (h != IntPtr.Zero) {
            try {
                var sb = new StringBuilder(1024);
                uint size = (uint)sb.Capacity;
                if (QueryFullProcessImageName(h, 0, sb, ref size)) result = sb.ToString();
            } finally { CloseHandle(h); }
        }
        if (ExeCache.Count > 600) ExeCache.Clear();
        ExeCache[pid] = result;
        return result;
    }

    public static string ListWindows(long[] excludePids) {
        var exclude = new HashSet<uint>();
        if (excludePids != null) foreach (var p in excludePids) exclude.Add((uint)p);
        IntPtr fg = GetForegroundWindow();
        var sb = new StringBuilder("[");
        bool first = true;
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;
            int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
            bool owned = GetWindow(hWnd, GW_OWNER) != IntPtr.Zero;
            bool appWindow = (ex & WS_EX_APPWINDOW) != 0;
            if (!appWindow && (owned || (ex & WS_EX_TOOLWINDOW) != 0)) return true;
            if ((ex & WS_EX_NOACTIVATE) != 0 && !appWindow) return true;
            int cloaked;
            if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;
            var cls = new StringBuilder(256);
            GetClassName(hWnd, cls, cls.Capacity);
            if (SkipClasses.Contains(cls.ToString())) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (exclude.Contains(pid)) return true;
            var title = new StringBuilder(len + 1);
            GetWindowText(hWnd, title, title.Capacity);
            string exe = ExePath(pid);
            if (!first) sb.Append(',');
            first = false;
            sb.Append("{\"hwnd\":").Append(hWnd.ToInt64().ToString(CultureInfo.InvariantCulture))
              .Append(",\"pid\":").Append(pid.ToString(CultureInfo.InvariantCulture))
              .Append(",\"title\":").Append(Q(title.ToString()))
              .Append(",\"cls\":").Append(Q(cls.ToString()))
              .Append(",\"exe\":").Append(Q(exe))
              .Append(",\"minimized\":").Append(IsIconic(hWnd) ? "true" : "false")
              .Append(",\"maximized\":").Append(IsZoomed(hWnd) ? "true" : "false")
              .Append(",\"active\":").Append(hWnd == fg ? "true" : "false")
              .Append('}');
            return true;
        }, IntPtr.Zero);
        sb.Append(']');
        return sb.ToString();
    }

    public static bool Focus(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return false;
        if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
        if (SetForegroundWindow(hWnd) && GetForegroundWindow() == hWnd) return true;

        // Foreground lock: borrow the current foreground thread's input state.
        uint dummy;
        IntPtr fg = GetForegroundWindow();
        uint fgThread = GetWindowThreadProcessId(fg, out dummy);
        uint self = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != self && AttachThreadInput(self, fgThread, true);
        try {
            BringWindowToTop(hWnd);
            SetForegroundWindow(hWnd);
        } finally {
            if (attached) AttachThreadInput(self, fgThread, false);
        }
        if (GetForegroundWindow() == hWnd) return true;

        // Last resort: a synthetic ALT tap satisfies the "received last input" rule.
        keybd_event(0x12, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(0x12, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
        SetForegroundWindow(hWnd);
        return GetForegroundWindow() == hWnd;
    }

    public static bool Minimize(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        return IsWindow(hWnd) && ShowWindow(hWnd, SW_MINIMIZE);
    }

    public static bool ToggleMaximize(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return false;
        return ShowWindow(hWnd, IsZoomed(hWnd) ? SW_RESTORE : SW_MAXIMIZE);
    }

    public static bool Close(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        return IsWindow(hWnd) && PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
    }

    public static bool MediaKey(string key) {
        byte vk;
        switch (key) {
            case "playpause": vk = 0xB3; break;
            case "next": vk = 0xB0; break;
            case "prev": vk = 0xB1; break;
            case "stop": vk = 0xB2; break;
            case "mute": vk = 0xAD; break;
            case "voldown": vk = 0xAE; break;
            case "volup": vk = 0xAF; break;
            default: return false;
        }
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
        return true;
    }

    static IEdexAudioEndpointVolume Endpoint() {
        var enumerator = new EdexMMDeviceEnumeratorComObject() as IEdexMMDeviceEnumerator;
        IEdexMMDevice dev = null;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
        IEdexAudioEndpointVolume epv = null;
        Guid iid = typeof(IEdexAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out epv));
        return epv;
    }

    public static string GetVolume() {
        var ep = Endpoint();
        float level; bool muted;
        Marshal.ThrowExceptionForHR(ep.GetMasterVolumeLevelScalar(out level));
        Marshal.ThrowExceptionForHR(ep.GetMute(out muted));
        return "{\"level\":" + N(Math.Round(level * 100)) + ",\"muted\":" + (muted ? "true" : "false") + "}";
    }

    public static string SetVolume(double percent) {
        var ep = Endpoint();
        float level = (float)Math.Max(0, Math.Min(1, percent / 100.0));
        Marshal.ThrowExceptionForHR(ep.SetMasterVolumeLevelScalar(level, Guid.Empty));
        if (level > 0) ep.SetMute(false, Guid.Empty);
        return GetVolume();
    }

    public static string SetMute(bool muted) {
        Marshal.ThrowExceptionForHR(Endpoint().SetMute(muted, Guid.Empty));
        return GetVolume();
    }

    static PerformanceCounter diskRead, diskWrite;
    static bool diskFailed;
    static readonly Dictionary<string, PerformanceCounter> gpuEngines = new Dictionary<string, PerformanceCounter>();
    static readonly List<PerformanceCounter> gpuMemDedicated = new List<PerformanceCounter>();
    static readonly List<PerformanceCounter> gpuMemShared = new List<PerformanceCounter>();
    static DateTime gpuEnumeratedAt = DateTime.MinValue;
    static bool gpuFailed;

    static string DiskJson() {
        if (diskFailed) return "null";
        try {
            if (diskRead == null) {
                diskRead = new PerformanceCounter("PhysicalDisk", "Disk Read Bytes/sec", "_Total");
                diskWrite = new PerformanceCounter("PhysicalDisk", "Disk Write Bytes/sec", "_Total");
                diskRead.NextValue(); diskWrite.NextValue();
            }
            return "{\"r\":" + N(diskRead.NextValue()) + ",\"w\":" + N(diskWrite.NextValue()) + "}";
        } catch { diskFailed = true; return "null"; }
    }

    static void RefreshGpuCounters() {
        var engineCat = new PerformanceCounterCategory("GPU Engine");
        var keep = new HashSet<string>();
        foreach (var name in engineCat.GetInstanceNames()) {
            if (!name.EndsWith("engtype_3D", StringComparison.OrdinalIgnoreCase)) continue;
            keep.Add(name);
            if (!gpuEngines.ContainsKey(name)) {
                var pc = new PerformanceCounter("GPU Engine", "Utilization Percentage", name);
                try { pc.NextValue(); } catch { }
                gpuEngines[name] = pc;
            }
        }
        foreach (var key in new List<string>(gpuEngines.Keys)) {
            if (!keep.Contains(key)) { gpuEngines[key].Dispose(); gpuEngines.Remove(key); }
        }
        if (gpuMemDedicated.Count == 0 && PerformanceCounterCategory.Exists("GPU Adapter Memory")) {
            var memCat = new PerformanceCounterCategory("GPU Adapter Memory");
            foreach (var name in memCat.GetInstanceNames()) {
                gpuMemDedicated.Add(new PerformanceCounter("GPU Adapter Memory", "Dedicated Usage", name));
                gpuMemShared.Add(new PerformanceCounter("GPU Adapter Memory", "Shared Usage", name));
            }
        }
        gpuEnumeratedAt = DateTime.UtcNow;
    }

    static string GpuJson() {
        if (gpuFailed) return "null";
        try {
            if ((DateTime.UtcNow - gpuEnumeratedAt).TotalSeconds > 15) RefreshGpuCounters();
            double util = 0, dedicated = 0, shared = 0;
            foreach (var pc in gpuEngines.Values) { try { util += pc.NextValue(); } catch { } }
            foreach (var pc in gpuMemDedicated) { try { dedicated += pc.NextValue(); } catch { } }
            foreach (var pc in gpuMemShared) { try { shared += pc.NextValue(); } catch { } }
            return "{\"util\":" + N(Math.Min(100, util)) + ",\"dedicated\":" + N(dedicated) + ",\"shared\":" + N(shared) + "}";
        } catch { gpuFailed = true; return "null"; }
    }

    public static string Perf() {
        return "{\"disk\":" + DiskJson() + ",\"gpu\":" + GpuJson() + "}";
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHELLEXECUTEINFO {
        public int cbSize; public uint fMask; public IntPtr hwnd;
        public string lpVerb; public string lpFile; public string lpParameters; public string lpDirectory;
        public int nShow; public IntPtr hInstApp; public IntPtr lpIDList; public string lpClass;
        public IntPtr hkeyClass; public uint dwHotKey; public IntPtr hIcon; public IntPtr hProcess;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern bool ShellExecuteEx(ref SHELLEXECUTEINFO info);

    // Opens the Windows Properties sheet. It runs on a shell-owned thread
    // inside this process, which stays alive, so the sheet stays open.
    public static bool Properties(string path) {
        var info = new SHELLEXECUTEINFO();
        info.cbSize = Marshal.SizeOf(info);
        info.lpVerb = "properties";
        info.lpFile = path;
        info.nShow = 5;
        info.fMask = 0x0000000C; // SEE_MASK_INVOKEIDLIST
        return ShellExecuteEx(ref info);
    }

    public static bool Sleep() { return SetSuspendState(false, false, false); }
    public static bool Lock() { return LockWorkStation(); }
}
'@

function Write-Line([string]$text) {
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()
}

# Compiling the interop types costs ~1-2 s, so the assembly is cached on disk
# keyed by a hash of its source and reused on later launches.
try {
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $hash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($source)) | ForEach-Object { $_.ToString('x2') }) -join ''
    $dll = Join-Path $CacheDir ("edex-native-" + $hash.Substring(0, 12) + ".dll")
    if (-not (Test-Path $dll)) {
        Add-Type -TypeDefinition $source -OutputAssembly $dll -OutputType Library
    }
    Add-Type -Path $dll
} catch {
    Add-Type -TypeDefinition $source
}

Write-Line '{"ready":true}'

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().Length -eq 0) { continue }
    $id = 0
    try {
        $req = $line | ConvertFrom-Json
        $id = [int]$req.id
        $a = $req.args
        switch ($req.cmd) {
            'ping'      { $data = '"pong"' }
            'windows'   { $data = [EdexNative]::ListWindows([long[]]@($a.exclude | Where-Object { $_ -ne $null })) }
            'focus'     { $data = if ([EdexNative]::Focus([long]$a.hwnd)) { 'true' } else { 'false' } }
            'minimize'  { $data = if ([EdexNative]::Minimize([long]$a.hwnd)) { 'true' } else { 'false' } }
            'maximize'  { $data = if ([EdexNative]::ToggleMaximize([long]$a.hwnd)) { 'true' } else { 'false' } }
            'close'     { $data = if ([EdexNative]::Close([long]$a.hwnd)) { 'true' } else { 'false' } }
            'media'     { $data = if ([EdexNative]::MediaKey([string]$a.key)) { 'true' } else { 'false' } }
            'volume'    { $data = [EdexNative]::GetVolume() }
            'setVolume' { $data = [EdexNative]::SetVolume([double]$a.level) }
            'setMute'   { $data = [EdexNative]::SetMute([bool]$a.muted) }
            'perf'      { $data = [EdexNative]::Perf() }
            'properties' { $data = if ([EdexNative]::Properties([string]$a.path)) { 'true' } else { 'false' } }
            'lock'      { $data = if ([EdexNative]::Lock()) { 'true' } else { 'false' } }
            'sleep'     { $data = if ([EdexNative]::Sleep()) { 'true' } else { 'false' } }
            'startApps' {
                $items = @(Get-StartApps | ForEach-Object { '{"name":' + [EdexNative]::Q($_.Name) + ',"appId":' + [EdexNative]::Q($_.AppID) + '}' })
                $data = '[' + ($items -join ',') + ']'
            }
            default     { throw "Unknown command: $($req.cmd)" }
        }
        Write-Line ('{"id":' + $id + ',"ok":true,"data":' + $data + '}')
    } catch {
        Write-Line ('{"id":' + $id + ',"ok":false,"error":' + [EdexNative]::Q($_.Exception.Message) + '}')
    }
}
