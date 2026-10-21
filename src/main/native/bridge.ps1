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
using System.Management;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

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

    // The focused window's program, for screen time: executable path, the
    // file's description ("Google Chrome") and, for hosted Store apps, the
    // window title.
    static readonly Dictionary<string, string> DescCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public static string Foreground() {
        IntPtr fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return "null";
        uint pid;
        GetWindowThreadProcessId(fg, out pid);
        string exe = ExePath(pid);
        string desc = "";
        if (exe.Length > 0 && !DescCache.TryGetValue(exe, out desc)) {
            try { desc = (FileVersionInfo.GetVersionInfo(exe).FileDescription ?? "").Trim(); } catch { desc = ""; }
            if (DescCache.Count > 400) DescCache.Clear();
            DescCache[exe] = desc;
        }
        int len = GetWindowTextLength(fg);
        var title = new StringBuilder(Math.Max(1, len + 1));
        if (len > 0) GetWindowText(fg, title, title.Capacity);
        var cls = new StringBuilder(128);
        GetClassName(fg, cls, cls.Capacity);
        return "{\"pid\":" + pid.ToString(CultureInfo.InvariantCulture) + ",\"exe\":" + Q(exe) + ",\"desc\":" + Q(desc ?? "") +
            ",\"title\":" + Q(title.ToString()) + ",\"cls\":" + Q(cls.ToString()) + "}";
    }

    public static string ProcessPath(uint pid) { return ExePath(pid); }

    // A program's file description ("Google Chrome"), cached.
    public static string Describe(string exe) {
        if (string.IsNullOrEmpty(exe)) return "";
        string desc;
        if (DescCache.TryGetValue(exe, out desc)) return desc;
        try { desc = (FileVersionInfo.GetVersionInfo(exe).FileDescription ?? "").Trim(); } catch { desc = ""; }
        if (DescCache.Count > 400) DescCache.Clear();
        DescCache[exe] = desc;
        return desc;
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

// System telemetry collected in-process, so the main app never has to spawn
// short-lived PowerShell/WMI processes to read it.
public static class EdexSys {
    static string N(double v) {
        if (double.IsNaN(v) || double.IsInfinity(v)) return "null";
        return v.ToString("0.###", CultureInfo.InvariantCulture);
    }
    static string S(object o) { return EdexNative.Q(o == null ? null : o.ToString().Trim()); }

    // -- Memory --------------------------------------------------------------
    [StructLayout(LayoutKind.Sequential)]
    class MEMORYSTATUSEX {
        public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        public uint dwMemoryLoad; public ulong ullTotalPhys; public ulong ullAvailPhys;
        public ulong ullTotalPageFile; public ulong ullAvailPageFile; public ulong ullTotalVirtual;
        public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;
    }
    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX m);

    public static string Mem() {
        var m = new MEMORYSTATUSEX();
        if (!GlobalMemoryStatusEx(m)) return "null";
        double swapTotal = Math.Max(0, (double)m.ullTotalPageFile - m.ullTotalPhys);
        double commitUsed = (double)m.ullTotalPageFile - m.ullAvailPageFile;
        double physUsed = (double)m.ullTotalPhys - m.ullAvailPhys;
        double swapUsed = Math.Max(0, Math.Min(swapTotal, commitUsed - physUsed));
        return "{\"total\":" + N(m.ullTotalPhys) + ",\"available\":" + N(m.ullAvailPhys) +
               ",\"swapTotal\":" + N(swapTotal) + ",\"swapUsed\":" + N(swapUsed) + "}";
    }

    // -- Network -------------------------------------------------------------
    class Nic { public NetworkInterface Ni; public string Json; }
    static List<Nic> nics;
    static DateTime nicsAt = DateTime.MinValue;

    static void RefreshNics() {
        var list = new List<Nic>();
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces()) {
            try {
                var t = ni.NetworkInterfaceType;
                if (t == NetworkInterfaceType.Loopback || t == NetworkInterfaceType.Tunnel) continue;
                var props = ni.GetIPProperties();
                string ip4 = null;
                foreach (var ua in props.UnicastAddresses) {
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork) { ip4 = ua.Address.ToString(); break; }
                }
                bool gw = false;
                foreach (var g in props.GatewayAddresses) {
                    if (g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(System.Net.IPAddress.Any)) { gw = true; break; }
                }
                string json = "\"name\":" + EdexNative.Q(ni.Name) + ",\"desc\":" + EdexNative.Q(ni.Description) +
                    ",\"type\":" + EdexNative.Q(t.ToString()) + ",\"up\":" + (ni.OperationalStatus == OperationalStatus.Up ? "true" : "false") +
                    ",\"speed\":" + N(ni.Speed) + ",\"ip4\":" + EdexNative.Q(ip4) + ",\"mac\":" + EdexNative.Q(ni.GetPhysicalAddress().ToString()) +
                    ",\"gw\":" + (gw ? "true" : "false");
                list.Add(new Nic { Ni = ni, Json = json });
            } catch { }
        }
        nics = list;
        nicsAt = DateTime.UtcNow;
    }

    public static string Net() {
        if (nics == null || (DateTime.UtcNow - nicsAt).TotalSeconds > 10) RefreshNics();
        var sb = new StringBuilder("[");
        bool first = true;
        foreach (var n in nics) {
            long rx = 0, tx = 0;
            try { var st = n.Ni.GetIPStatistics(); rx = st.BytesReceived; tx = st.BytesSent; } catch { }
            if (!first) sb.Append(',');
            first = false;
            sb.Append('{').Append(n.Json).Append(",\"rx\":").Append(N(rx)).Append(",\"tx\":").Append(N(tx)).Append('}');
        }
        return sb.Append(']').ToString();
    }

    // -- CPU frequency (what Task Manager calls "Speed") ---------------------
    static PerformanceCounter cpuPerf;
    static bool cpuPerfFailed;
    static double baseMhz = -1;

    static string Freq() {
        if (baseMhz < 0) {
            baseMhz = 0;
            try {
                using (var k = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0")) {
                    if (k != null) baseMhz = Convert.ToDouble(k.GetValue("~MHz", 0));
                }
            } catch { }
        }
        if (cpuPerfFailed || baseMhz <= 0) return baseMhz > 0 ? N(baseMhz) : "null";
        try {
            if (cpuPerf == null) {
                cpuPerf = new PerformanceCounter("Processor Information", "% Processor Performance", "_Total");
                cpuPerf.NextValue();
            }
            return N(baseMhz * cpuPerf.NextValue() / 100.0);
        } catch { cpuPerfFailed = true; return N(baseMhz); }
    }

    // One round trip for everything the side panels refresh every second or two.
    public static string Live() {
        return "{\"mem\":" + Mem() + ",\"net\":" + Net() + ",\"perf\":" + EdexNative.Perf() + ",\"mhz\":" + Freq() + "}";
    }

    // -- Processes -----------------------------------------------------------
    // A single NtQuerySystemInformation snapshot carries times and memory for
    // every process, without opening a handle to any of them.
    [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int cls, IntPtr buf, int len, out int ret);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder sb, ref uint size);

    static IntPtr procBuf = IntPtr.Zero;
    static int procBufLen;
    static Dictionary<long, long> prevCpu = new Dictionary<long, long>();
    static Dictionary<long, long> prevCreate = new Dictionary<long, long>();
    static long prevStamp;
    static readonly Dictionary<string, string> pathCache = new Dictionary<string, string>();

    static string PathFor(long pid, long create) {
        string key = pid + ":" + create;
        string cached;
        if (pathCache.TryGetValue(key, out cached)) return cached;
        string result = "";
        IntPtr h = OpenProcess(0x1000, false, (uint)pid);
        if (h != IntPtr.Zero) {
            try {
                var sb = new StringBuilder(1024);
                uint size = (uint)sb.Capacity;
                if (QueryFullProcessImageName(h, 0, sb, ref size)) result = sb.ToString();
            } finally { CloseHandle(h); }
        }
        if (pathCache.Count > 2000) pathCache.Clear();
        pathCache[key] = result;
        return result;
    }

    public static string Processes(bool withPaths) {
        if (IntPtr.Size != 8) throw new Exception("64-bit helper required");
        if (procBuf == IntPtr.Zero) { procBufLen = 1 << 20; procBuf = Marshal.AllocHGlobal(procBufLen); }
        int needed, status;
        while ((status = NtQuerySystemInformation(5, procBuf, procBufLen, out needed)) == unchecked((int)0xC0000004)) {
            Marshal.FreeHGlobal(procBuf);
            procBufLen = Math.Max(needed + 131072, procBufLen * 2);
            procBuf = Marshal.AllocHGlobal(procBufLen);
        }
        if (status != 0) throw new Exception("Process snapshot failed: 0x" + status.ToString("x"));

        long now = DateTime.UtcNow.Ticks;
        double wall = prevStamp == 0 ? 0 : (double)(now - prevStamp);
        int cores = Environment.ProcessorCount;
        var nextCpu = new Dictionary<long, long>();
        var nextCreate = new Dictionary<long, long>();
        var sb = new StringBuilder("[");
        bool first = true;
        int count = 0;
        long threadTotal = 0;
        long offset = 0;
        while (true) {
            IntPtr p = new IntPtr(procBuf.ToInt64() + offset);
            int next = Marshal.ReadInt32(p, 0);
            int threads = Marshal.ReadInt32(p, 4);
            long create = Marshal.ReadInt64(p, 0x20);
            long total = Marshal.ReadInt64(p, 0x28) + Marshal.ReadInt64(p, 0x30);
            int nameLen = (ushort)Marshal.ReadInt16(p, 0x38);
            IntPtr nameBuf = Marshal.ReadIntPtr(p, 0x40);
            long pid = Marshal.ReadIntPtr(p, 0x50).ToInt64();
            long ppid = Marshal.ReadIntPtr(p, 0x58).ToInt64();
            int handles = Marshal.ReadInt32(p, 0x60);
            long ws = Marshal.ReadIntPtr(p, 0x90).ToInt64();
            long priv = Marshal.ReadIntPtr(p, 0xC8).ToInt64();
            count++;
            threadTotal += threads;
            double cpu = 0;
            long prev, prevC;
            if (wall > 0 && prevCpu.TryGetValue(pid, out prev) && prevCreate.TryGetValue(pid, out prevC) && prevC == create) {
                cpu = Math.Max(0, Math.Min(100, (total - prev) / wall / cores * 100.0));
            }
            nextCpu[pid] = total;
            nextCreate[pid] = create;
            if (pid != 0) {
                string name = nameLen > 0 && nameBuf != IntPtr.Zero ? Marshal.PtrToStringUni(nameBuf, nameLen / 2) : "System";
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"pid\":").Append(pid.ToString(CultureInfo.InvariantCulture))
                  .Append(",\"ppid\":").Append(ppid.ToString(CultureInfo.InvariantCulture))
                  .Append(",\"name\":").Append(EdexNative.Q(name))
                  .Append(",\"cpu\":").Append(N(Math.Round(cpu, 2)))
                  .Append(",\"ws\":").Append(ws.ToString(CultureInfo.InvariantCulture))
                  .Append(",\"priv\":").Append(priv.ToString(CultureInfo.InvariantCulture))
                  .Append(",\"threads\":").Append(threads.ToString(CultureInfo.InvariantCulture))
                  .Append(",\"handles\":").Append(handles.ToString(CultureInfo.InvariantCulture));
                if (withPaths) sb.Append(",\"path\":").Append(EdexNative.Q(PathFor(pid, create)));
                sb.Append('}');
            }
            if (next == 0) break;
            offset += next;
        }
        prevCpu = nextCpu;
        prevCreate = nextCreate;
        prevStamp = now;
        return "{\"count\":" + count + ",\"threads\":" + threadTotal + ",\"cores\":" + cores + ",\"list\":" + sb.Append(']').ToString() + "}";
    }

    // -- Drives --------------------------------------------------------------
    // Fixed and removable only: IsReady on a disconnected network drive can
    // block for many seconds.
    public static string Drives() {
        var sb = new StringBuilder("[");
        bool first = true;
        foreach (var d in DriveInfo.GetDrives()) {
            try {
                if (d.DriveType != DriveType.Fixed && d.DriveType != DriveType.Removable) continue;
                if (!d.IsReady || d.TotalSize <= 0) continue;
                string mount = d.Name.TrimEnd('\\');
                double used = (double)d.TotalSize - d.TotalFreeSpace;
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"mount\":").Append(EdexNative.Q(mount)).Append(",\"fs\":").Append(EdexNative.Q(mount))
                  .Append(",\"type\":").Append(EdexNative.Q(d.DriveFormat)).Append(",\"label\":").Append(EdexNative.Q(d.VolumeLabel))
                  .Append(",\"removable\":").Append(d.DriveType == DriveType.Removable ? "true" : "false")
                  .Append(",\"size\":").Append(N(d.TotalSize)).Append(",\"used\":").Append(N(used))
                  .Append(",\"use\":").Append(N(Math.Round(used / d.TotalSize * 100, 1))).Append('}');
            } catch { }
        }
        return sb.Append(']').ToString();
    }

    // -- Battery -------------------------------------------------------------
    [StructLayout(LayoutKind.Sequential)]
    struct SYSTEM_POWER_STATUS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public int BatteryLifeTime; public int BatteryFullLifeTime; }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);

    public static string Battery() {
        SYSTEM_POWER_STATUS s;
        if (!GetSystemPowerStatus(out s)) return "null";
        bool has = s.BatteryFlag != 128 && s.BatteryFlag != 255;
        return "{\"hasBattery\":" + (has ? "true" : "false") +
               ",\"percent\":" + (s.BatteryLifePercent == 255 ? "null" : s.BatteryLifePercent.ToString(CultureInfo.InvariantCulture)) +
               ",\"ac\":" + (s.ACLineStatus == 1 ? "true" : "false") +
               ",\"charging\":" + ((s.BatteryFlag & 8) != 0 ? "true" : "false") +
               ",\"secondsLeft\":" + (s.BatteryLifeTime < 0 ? "null" : s.BatteryLifeTime.ToString(CultureInfo.InvariantCulture)) +
               ",\"saver\":" + ((s.SystemStatusFlag & 1) != 0 ? "true" : "false") + "}";
    }

    // -- Static hardware/OS information (WMI, once per session) --------------
    static string First(string query, string[] props) {
        try {
            using (var searcher = new ManagementObjectSearcher(query)) {
                foreach (ManagementObject o in searcher.Get()) {
                    var parts = new List<string>();
                    foreach (var prop in props) {
                        object v = o[prop];
                        string json;
                        if (v is ushort[]) json = ((ushort[])v).Length > 0 ? ((ushort[])v)[0].ToString(CultureInfo.InvariantCulture) : "null";
                        else if (v is uint || v is ushort || v is int || v is ulong) json = Convert.ToDouble(v).ToString(CultureInfo.InvariantCulture);
                        else json = S(v);
                        parts.Add("\"" + prop + "\":" + json);
                    }
                    return "{" + string.Join(",", parts.ToArray()) + "}";
                }
            }
        } catch { }
        return "null";
    }

    public static string Static() {
        var gpus = new List<string>();
        try {
            using (var searcher = new ManagementObjectSearcher("SELECT Name, AdapterCompatibility, AdapterRAM FROM Win32_VideoController")) {
                foreach (ManagementObject o in searcher.Get()) {
                    gpus.Add("{\"model\":" + S(o["Name"]) + ",\"vendor\":" + S(o["AdapterCompatibility"]) +
                             ",\"vram\":" + (o["AdapterRAM"] == null ? "null" : Convert.ToDouble(o["AdapterRAM"]).ToString(CultureInfo.InvariantCulture)) + "}");
                }
            }
        } catch { }
        return "{\"system\":" + First("SELECT Manufacturer, Model FROM Win32_ComputerSystem", new[] { "Manufacturer", "Model" }) +
               ",\"chassis\":" + First("SELECT ChassisTypes FROM Win32_SystemEnclosure", new[] { "ChassisTypes" }) +
               ",\"os\":" + First("SELECT Caption, Version, BuildNumber, OSArchitecture FROM Win32_OperatingSystem", new[] { "Caption", "Version", "BuildNumber", "OSArchitecture" }) +
               ",\"cpu\":" + First("SELECT Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed FROM Win32_Processor", new[] { "Name", "Manufacturer", "NumberOfCores", "NumberOfLogicalProcessors", "MaxClockSpeed" }) +
               ",\"gpus\":[" + string.Join(",", gpus.ToArray()) + "]}";
    }

    // Thermal zones are usually only readable by elevated processes.
    public static string Temp() {
        try {
            using (var searcher = new ManagementObjectSearcher("root\\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature")) {
                double max = 0;
                foreach (ManagementObject o in searcher.Get()) {
                    double c = Convert.ToDouble(o["CurrentTemperature"]) / 10.0 - 273.15;
                    if (c > max && c < 150) max = c;
                }
                return max > 0 ? N(Math.Round(max, 1)) : "null";
            }
        } catch { return "null"; }
    }

    // -- Shell icons ---------------------------------------------------------
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct SHFILEINFO {
        public IntPtr hIcon; public int iIcon; public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }
    [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IImageList {
        [PreserveSig] int Add(IntPtr hbmImage, IntPtr hbmMask, ref int pi);
        [PreserveSig] int ReplaceIcon(int i, IntPtr hicon, ref int pi);
        [PreserveSig] int SetOverlayImage(int iImage, int iOverlay);
        [PreserveSig] int Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
        [PreserveSig] int AddMasked(IntPtr hbmImage, int crMask, ref int pi);
        [PreserveSig] int Draw(IntPtr pimldp);
        [PreserveSig] int Remove(int i);
        [PreserveSig] int GetIcon(int i, int flags, ref IntPtr picon);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string path, uint attr, ref SHFILEINFO info, uint size, uint flags);
    [DllImport("shell32.dll", EntryPoint = "SHGetFileInfoW", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfoPidl(IntPtr pidl, uint attr, ref SHFILEINFO info, uint size, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr bindCtx, out IntPtr pidl, uint sfgaoIn, out uint sfgaoOut);
    [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);
    [DllImport("shell32.dll", EntryPoint = "#727")] static extern int SHGetImageList(int list, ref Guid riid, out IImageList ppv);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    static IImageList imageList;

    // The 48px shell icon, resolved exactly as Explorer does it (shortcut
    // targets, .ico files, icon handlers), as a PNG data URL. Shell parse
    // names such as shell:AppsFolder\<AppUserModelID> give Store app logos.
    static string IconPng(string path) {
        var info = new SHFILEINFO();
        uint size = (uint)Marshal.SizeOf(info);
        if (path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) {
            IntPtr pidl;
            uint attrs;
            if (SHParseDisplayName(path, IntPtr.Zero, out pidl, 0, out attrs) != 0 || pidl == IntPtr.Zero) return "null";
            try {
                if (SHGetFileInfoPidl(pidl, 0, ref info, size, 0x4000 | 0x8) == IntPtr.Zero) return "null"; // SYSICONINDEX | PIDL
            } finally { CoTaskMemFree(pidl); }
        } else if (SHGetFileInfo(path, 0, ref info, size, 0x4000) == IntPtr.Zero) {
            return "null"; // SHGFI_SYSICONINDEX
        }
        if (imageList == null) {
            Guid iid = typeof(IImageList).GUID;
            if (SHGetImageList(2, ref iid, out imageList) != 0) { imageList = null; return "null"; } // SHIL_EXTRALARGE
        }
        IntPtr hIcon = IntPtr.Zero;
        imageList.GetIcon(info.iIcon, 1, ref hIcon); // ILD_TRANSPARENT
        if (hIcon == IntPtr.Zero) return "null";
        try {
            using (var icon = System.Drawing.Icon.FromHandle(hIcon))
            using (var bmp = icon.ToBitmap())
            using (var ms = new MemoryStream()) {
                bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                return "\"data:image/png;base64," + Convert.ToBase64String(ms.ToArray()) + "\"";
            }
        } finally { DestroyIcon(hIcon); }
    }

    public static string Icons(string[] paths) {
        var sb = new StringBuilder("{");
        bool first = true;
        foreach (var p in paths) {
            if (string.IsNullOrEmpty(p)) continue;
            string png;
            try { png = IconPng(p); } catch { png = "null"; }
            if (!first) sb.Append(',');
            first = false;
            sb.Append(EdexNative.Q(p)).Append(':').Append(png);
        }
        return sb.Append('}').ToString();
    }

    // -- Clipboard change counter -------------------------------------------
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    public static string ClipSeq() { return GetClipboardSequenceNumber().ToString(CultureInfo.InvariantCulture); }

    // -- Display brightness (laptop panels; external monitors report none) ---
    public static string GetBrightness() {
        try {
            using (var searcher = new ManagementObjectSearcher("root\\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness")) {
                foreach (ManagementObject o in searcher.Get()) return Convert.ToInt32(o["CurrentBrightness"]).ToString(CultureInfo.InvariantCulture);
            }
        } catch { }
        return "null";
    }

    public static string SetBrightness(int level) {
        level = Math.Max(0, Math.Min(100, level));
        using (var searcher = new ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightnessMethods")) {
            foreach (ManagementObject o in searcher.Get()) {
                o.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)level });
                return level.ToString(CultureInfo.InvariantCulture);
            }
        }
        return "null";
    }
}

// Desktop takeover: hides the Windows taskbar(s) while eDEX is the desktop
// and switches the taskbar to auto-hide so maximised windows get the full
// screen. Show() always puts back the auto-hide state found before hiding.
// RestoreIfHidden() runs when the helper's input closes, so a crashed eDEX
// still gets the taskbar back.
public static class EdexShell {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct APPBARDATA { public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

    const uint ABM_GETSTATE = 4, ABM_SETSTATE = 10;
    const int ABS_AUTOHIDE = 1;
    const int SW_HIDE = 0, SW_SHOWNA = 8;
    static bool hidden;
    static int prevState = -1;

    static List<IntPtr> Bars() {
        var list = new List<IntPtr>();
        IntPtr main = FindWindow("Shell_TrayWnd", null);
        if (main != IntPtr.Zero) list.Add(main);
        IntPtr h = IntPtr.Zero;
        while ((h = FindWindowEx(IntPtr.Zero, h, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) list.Add(h);
        return list;
    }

    static APPBARDATA Data() {
        var d = new APPBARDATA();
        d.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
        d.hWnd = FindWindow("Shell_TrayWnd", null);
        return d;
    }

    static int GetState() {
        var d = Data();
        return (int)SHAppBarMessage(ABM_GETSTATE, ref d).ToUInt32();
    }

    static void SetState(int state) {
        var d = Data();
        d.lParam = new IntPtr(state);
        SHAppBarMessage(ABM_SETSTATE, ref d);
    }

    // knownPrev: the state recorded by an earlier session (crash recovery),
    // or -1 to read it now.
    public static string Hide(int knownPrev) {
        if (!hidden) {
            prevState = knownPrev >= 0 ? knownPrev : GetState();
            hidden = true;
        }
        if ((GetState() & ABS_AUTOHIDE) == 0) {
            SetState(prevState | ABS_AUTOHIDE);
            // Explorer re-lays out (and re-shows) the bar after a state
            // change; hiding before it settles would be undone.
            System.Threading.Thread.Sleep(400);
        }
        foreach (IntPtr b in Bars()) ShowWindow(b, SW_HIDE);
        return State();
    }

    public static string Show(int knownPrev) {
        int restore = knownPrev >= 0 ? knownPrev : prevState;
        foreach (IntPtr b in Bars()) ShowWindow(b, SW_SHOWNA);
        if (restore >= 0 && restore != GetState()) SetState(restore);
        hidden = false;
        prevState = -1;
        return State();
    }

    // Full-screen fit for the eDEX window: Windows 11 rounds (and outlines)
    // every window that is not maximised, which leaves the four screen
    // corners showing what is behind. Rounding and the border are switched
    // off, and the window is placed on the monitor's exact physical pixels
    // (fractional scaling can otherwise leave a one-pixel edge).
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hWnd, int attr, ref int value, int size);

    const int DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_DONOTROUND = 1;
    const int DWMWA_BORDER_COLOR = 34;
    const int DWMWA_COLOR_NONE = unchecked((int)0xFFFFFFFE);
    const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_NOOWNERZORDER = 0x0200;

    public static string FitWindow(long handle, bool cover) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return "null";
        int pref = DWMWCP_DONOTROUND;
        int cornerHr = DwmSetWindowAttribute(hWnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, 4);
        int none = DWMWA_COLOR_NONE;
        DwmSetWindowAttribute(hWnd, DWMWA_BORDER_COLOR, ref none, 4);
        var mi = new MONITORINFO();
        mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(MonitorFromWindow(hWnd, 2), ref mi)) return "null";
        RECT target = cover ? mi.rcMonitor : mi.rcWork;
        RECT before;
        GetWindowRect(hWnd, out before);
        bool moved = false;
        if (before.left != target.left || before.top != target.top || before.right != target.right || before.bottom != target.bottom) {
            SetWindowPos(hWnd, IntPtr.Zero, target.left, target.top, target.right - target.left, target.bottom - target.top,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
            moved = true;
        }
        return "{\"moved\":" + (moved ? "true" : "false") +
            ",\"corners\":" + (cornerHr == 0 ? "\"square\"" : "\"unsupported\"") +
            ",\"rect\":[" + target.left + "," + target.top + "," + target.right + "," + target.bottom + "]}";
    }

    // Shows the bars without touching the auto-hide state (a short "peek"
    // for the notification area while eDEX keeps the desktop).
    public static string Peek() {
        foreach (IntPtr b in Bars()) ShowWindow(b, SW_SHOWNA);
        return State();
    }

    public static string State() {
        bool visible = false;
        foreach (IntPtr b in Bars()) if (IsWindowVisible(b)) visible = true;
        int s = GetState();
        return "{\"visible\":" + (visible ? "true" : "false") +
            ",\"autohide\":" + ((s & ABS_AUTOHIDE) != 0 ? "true" : "false") +
            ",\"state\":" + s.ToString(CultureInfo.InvariantCulture) +
            ",\"hiddenByUs\":" + (hidden ? "true" : "false") +
            ",\"prev\":" + prevState.ToString(CultureInfo.InvariantCulture) + "}";
    }

    public static void RestoreIfHidden() {
        if (hidden) Show(-1);
    }

    // Console control events. eDEX is often started from a console
    // (npm start); Ctrl+C / Ctrl+Break there must not kill the helper before
    // eDEX has asked it to restore the taskbar, so those are ignored (the
    // helper still exits when eDEX closes its input). On console close,
    // log-off or shutdown the taskbar is restored before Windows ends us.
    delegate bool ConsoleCtrlDelegate(int ctrlType);
    [DllImport("kernel32.dll")] static extern bool SetConsoleCtrlHandler(ConsoleCtrlDelegate handler, bool add);
    static ConsoleCtrlDelegate ctrlHandler;

    public static void GuardConsole() {
        ctrlHandler = OnConsoleCtrl;
        SetConsoleCtrlHandler(ctrlHandler, true);
    }

    static bool OnConsoleCtrl(int ctrlType) {
        if (ctrlType == 0 || ctrlType == 1) return true;
        try { RestoreIfHidden(); } catch { }
        return false;
    }
}

// WinRT streams reach PowerShell as bare COM objects; this reads one through
// the classic IStream adapter (album art for Now playing).
public static class EdexStreams {
    [DllImport("shcore.dll")]
    static extern int CreateStreamOverRandomAccessStream([MarshalAs(UnmanagedType.IUnknown)] object stream, ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out System.Runtime.InteropServices.ComTypes.IStream result);

    public static string DataUrl(object randomAccessStream, int max) {
        Guid iid = new Guid("0000000c-0000-0000-C000-000000000046");
        System.Runtime.InteropServices.ComTypes.IStream s;
        Marshal.ThrowExceptionForHR(CreateStreamOverRandomAccessStream(randomAccessStream, ref iid, out s));
        var ms = new MemoryStream();
        var buf = new byte[65536];
        IntPtr read = Marshal.AllocHGlobal(4);
        try {
            while (ms.Length <= max) {
                s.Read(buf, buf.Length, read);
                int n = Marshal.ReadInt32(read);
                if (n <= 0) break;
                ms.Write(buf, 0, n);
            }
        } finally { Marshal.FreeHGlobal(read); Marshal.ReleaseComObject(s); }
        if (ms.Length == 0 || ms.Length > max) return "null";
        byte[] b = ms.ToArray();
        string type = b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 ? "image/jpeg"
            : b.Length > 11 && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P' ? "image/webp"
            : b.Length > 2 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' ? "image/gif" : "image/png";
        return "\"data:" + type + ";base64," + Convert.ToBase64String(b) + "\"";
    }
}

// -- Per-app volume and output devices (Core Audio) --------------------------
[StructLayout(LayoutKind.Sequential)] public struct EdexPropKey { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Explicit)]
public struct EdexPropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }

[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexPropertyStore {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetAt(int index, out EdexPropKey key);
    [PreserveSig] int GetValue(ref EdexPropKey key, out EdexPropVariant value);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IEdexAMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IEdexAMMDevice endpoint);
}
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAMMDeviceCollection {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int Item(int index, out IEdexAMMDevice device);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig] int OpenPropertyStore(int access, out IEdexPropertyStore store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr ctl);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr vol);
    [PreserveSig] int GetSessionEnumerator(out IEdexAudioSessionEnumerator sessions);
}
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
}
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
    [PreserveSig] int GetGroupingParam(out Guid g);
    [PreserveSig] int SetGroupingParam(ref Guid g, ref Guid ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexSimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
// The interface Windows' own Sound settings use to change the default device.
// Only SetDefaultEndpoint is called; the earlier slots just keep the layout.
[Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEdexPolicyConfig {
    [PreserveSig] int GetMixFormat(); [PreserveSig] int GetDeviceFormat(); [PreserveSig] int ResetDeviceFormat(); [PreserveSig] int SetDeviceFormat();
    [PreserveSig] int GetProcessingPeriod(); [PreserveSig] int SetProcessingPeriod(); [PreserveSig] int GetShareMode(); [PreserveSig] int SetShareMode();
    [PreserveSig] int GetPropertyValue(); [PreserveSig] int SetPropertyValue();
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
}
[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
class EdexPolicyConfigClient { }

public static class EdexAudio {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref EdexPropVariant pv);
    static readonly Guid IID_SESSION_MANAGER2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    static readonly Dictionary<string, string> NameCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    static IEdexAMMDeviceEnumerator Enumerator() { return (IEdexAMMDeviceEnumerator)new EdexMMDeviceEnumeratorComObject(); }

    static string FriendlyName(IEdexAMMDevice dev) {
        IEdexPropertyStore store;
        if (dev.OpenPropertyStore(0, out store) != 0 || store == null) return "";
        var key = new EdexPropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        var pv = new EdexPropVariant();
        try {
            if (store.GetValue(ref key, out pv) != 0) return "";
            return pv.vt == 31 && pv.p != IntPtr.Zero ? Marshal.PtrToStringUni(pv.p) : "";
        } finally { PropVariantClear(ref pv); }
    }

    static string DefaultId() {
        IEdexAMMDevice def;
        string id = "";
        if (Enumerator().GetDefaultAudioEndpoint(0, 1, out def) == 0 && def != null) def.GetId(out id);
        return id ?? "";
    }

    public static string Devices() {
        string defId = DefaultId();
        IEdexAMMDeviceCollection col;
        Marshal.ThrowExceptionForHR(Enumerator().EnumAudioEndpoints(0, 1, out col)); // render, active
        int n;
        col.GetCount(out n);
        var sb = new StringBuilder("[");
        for (int i = 0; i < n; i++) {
            IEdexAMMDevice d;
            if (col.Item(i, out d) != 0 || d == null) continue;
            string id;
            d.GetId(out id);
            if (sb.Length > 1) sb.Append(',');
            sb.Append("{\"id\":").Append(EdexNative.Q(id)).Append(",\"name\":").Append(EdexNative.Q(FriendlyName(d)))
              .Append(",\"default\":").Append(id == defId ? "true" : "false").Append('}');
        }
        return sb.Append(']').ToString();
    }

    public static string SetDefault(string id) {
        var pc = (IEdexPolicyConfig)new EdexPolicyConfigClient();
        for (int role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, role));
        return Devices();
    }

    static IEdexAudioSessionEnumerator SessionList() {
        IEdexAMMDevice dev;
        Marshal.ThrowExceptionForHR(Enumerator().GetDefaultAudioEndpoint(0, 1, out dev));
        Guid iid = IID_SESSION_MANAGER2;
        object o;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
        IEdexAudioSessionEnumerator list;
        Marshal.ThrowExceptionForHR(((IEdexAudioSessionManager2)o).GetSessionEnumerator(out list));
        return list;
    }

    // One entry per audio session on the default output device: pid -1 is
    // Windows' system sounds.
    public static string Sessions() {
        var list = SessionList();
        int n;
        list.GetCount(out n);
        var sb = new StringBuilder("[");
        var seen = new HashSet<long>();
        for (int i = 0; i < n; i++) {
            object o;
            if (list.GetSession(i, out o) != 0 || o == null) continue;
            var ctl = o as IEdexAudioSessionControl2;
            var vol = o as IEdexSimpleAudioVolume;
            if (ctl == null || vol == null) continue;
            int state;
            ctl.GetState(out state);
            if (state == 2) continue; // expired
            bool system = ctl.IsSystemSoundsSession() == 0;
            uint pid = 0;
            ctl.GetProcessId(out pid);
            long key = system ? -1L : (long)pid;
            if (!seen.Add(key)) continue;
            float level;
            bool muted;
            vol.GetMasterVolume(out level);
            vol.GetMute(out muted);
            string exe = system ? "" : EdexNative.ProcessPath(pid);
            string name = system ? "System sounds" : EdexNative.Describe(exe);
            if (string.IsNullOrEmpty(name)) {
                string display;
                ctl.GetDisplayName(out display);
                name = !string.IsNullOrEmpty(display) && !display.StartsWith("@") ? display : (exe.Length > 0 ? Path.GetFileNameWithoutExtension(exe) : "Process " + pid);
            }
            if (sb.Length > 1) sb.Append(',');
            sb.Append("{\"pid\":").Append(key.ToString(CultureInfo.InvariantCulture))
              .Append(",\"name\":").Append(EdexNative.Q(name))
              .Append(",\"exe\":").Append(EdexNative.Q(exe))
              .Append(",\"level\":").Append(Math.Round(level * 100).ToString(CultureInfo.InvariantCulture))
              .Append(",\"muted\":").Append(muted ? "true" : "false")
              .Append(",\"active\":").Append(state == 1 ? "true" : "false").Append('}');
        }
        return sb.Append(']').ToString();
    }

    // level: 0-100 or -1 to keep; mute: 0/1 or -1 to keep.
    public static string SetSession(long pid, double level, int mute) {
        var list = SessionList();
        int n;
        list.GetCount(out n);
        Guid ctx = Guid.Empty;
        for (int i = 0; i < n; i++) {
            object o;
            if (list.GetSession(i, out o) != 0 || o == null) continue;
            var ctl = o as IEdexAudioSessionControl2;
            var vol = o as IEdexSimpleAudioVolume;
            if (ctl == null || vol == null) continue;
            uint p = 0;
            ctl.GetProcessId(out p);
            bool system = ctl.IsSystemSoundsSession() == 0;
            if (pid == -1 ? !system : (system || p != pid)) continue;
            if (level >= 0) vol.SetMasterVolume((float)Math.Max(0, Math.Min(1, level / 100.0)), ref ctx);
            if (mute >= 0) vol.SetMute(mute == 1, ref ctx);
        }
        return Sessions();
    }
}

// -- Window placement (tiling and saved arrangements) ------------------------
// Coordinates are physical pixels: the helper is not DPI-aware, so each call
// switches its thread to per-monitor awareness first.
public static class EdexWin {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT r, int size);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
    [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr ctx);
    [DllImport("powrprof.dll")] static extern uint CallNtPowerInformation(int level, IntPtr inBuf, uint inLen, out uint outBuf, uint outLen);

    const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;

    static IntPtr Aware() { try { return SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { return IntPtr.Zero; } }
    static void Restore(IntPtr old) { if (old != IntPtr.Zero) { try { SetThreadDpiAwarenessContext(old); } catch { } } }

    // What the user sees as the window: without the invisible resize borders.
    static RECT Frame(IntPtr h) {
        RECT r;
        if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
        return r;
    }

    static string R(RECT r) { return "[" + r.left + "," + r.top + "," + (r.right - r.left) + "," + (r.bottom - r.top) + "]"; }

    public static string Monitors() {
        IntPtr old = Aware();
        try {
            var sb = new StringBuilder("[");
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data) {
                var mi = new MONITORINFO();
                mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
                if (GetMonitorInfo(hMon, ref mi)) {
                    if (sb.Length > 1) sb.Append(',');
                    sb.Append("{\"bounds\":").Append(R(mi.rcMonitor)).Append(",\"work\":").Append(R(mi.rcWork))
                      .Append(",\"primary\":").Append((mi.dwFlags & 1) != 0 ? "true" : "false").Append('}');
                }
                return true;
            }, IntPtr.Zero);
            return sb.Append(']').ToString();
        } finally { Restore(old); }
    }

    public static string GetRect(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return "null";
        IntPtr old = Aware();
        try {
            return "{\"rect\":" + R(Frame(hWnd)) + ",\"minimized\":" + (IsIconic(hWnd) ? "true" : "false") +
                ",\"maximized\":" + (IsZoomed(hWnd) ? "true" : "false") + "}";
        } finally { Restore(old); }
    }

    static void PlaceAware(IntPtr hWnd, int x, int y, int w, int h, string state) {
        if (IsIconic(hWnd) || IsZoomed(hWnd)) ShowWindow(hWnd, 9); // SW_RESTORE
        RECT wr;
        GetWindowRect(hWnd, out wr);
        RECT fr = Frame(hWnd);
        int l = Math.Max(0, fr.left - wr.left), t = Math.Max(0, fr.top - wr.top);
        int r = Math.Max(0, wr.right - fr.right), b = Math.Max(0, wr.bottom - fr.bottom);
        SetWindowPos(hWnd, IntPtr.Zero, x - l, y - t, w + l + r, h + t + b, SWP_NOZORDER | SWP_NOACTIVATE);
        if (state == "max") ShowWindow(hWnd, 3);
        else if (state == "min") ShowWindow(hWnd, 7); // SW_SHOWMINNOACTIVE
    }

    // Places a window so its visible frame covers x, y, w, h.
    public static string Place(long handle, int x, int y, int w, int h, string state) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd) || w < 50 || h < 50) return "false";
        IntPtr old = Aware();
        try { PlaceAware(hWnd, x, y, w, h, state); return "true"; } finally { Restore(old); }
    }

    // Puts a window at the bottom of the z-order without activating it (the
    // HUD on secondary displays stays behind ordinary windows).
    public static string SendToBack(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return "false";
        return SetWindowPos(hWnd, new IntPtr(1), 0, 0, 0, 0, 0x0001 | 0x0002 | SWP_NOACTIVATE) ? "true" : "false";
    }

    // Minimises without activating whatever window is next (app tabs).
    public static string MinimizeQuiet(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return "false";
        ShowWindow(hWnd, 7); // SW_SHOWMINNOACTIVE
        return "true";
    }

    // Screen saver guard: is a full-screen app running (games, full-screen
    // video, presentations), and has any program asked Windows to keep the
    // display on (playback, calls)? "Full screen" is Windows' own judgement,
    // the one Focus Assist uses: QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN,
    // QUNS_PRESENTATION_MODE. A window that merely fills the screen (a
    // borderless browser with an auto-hiding taskbar) doesn't count.
    public static string SaverBlocked(long[] excludePids) {
        bool display = false;
        uint st;
        if (CallNtPowerInformation(16, IntPtr.Zero, 0, out st, 4) == 0) display = (st & 0x2) != 0; // SystemExecutionState, ES_DISPLAY_REQUIRED
        int quns = 0;
        try { SHQueryUserNotificationState(out quns); } catch { quns = 0; }
        bool full = quns == 2 || quns == 3 || quns == 4;
        if (full) {
            // eDEX's own full-screen window isn't "an app in front".
            IntPtr fg = GetForegroundWindow();
            uint pid;
            GetWindowThreadProcessId(fg, out pid);
            if (excludePids != null) foreach (var p in excludePids) if ((uint)p == pid) full = false;
        }
        return "{\"display\":" + (display ? "true" : "false") + ",\"fullscreen\":" + (full ? "true" : "false") + ",\"state\":" + quns + "}";
    }

    // A picture of a window (even while covered), as a JPEG data URL no wider
    // than maxWidth. PW_RENDERFULLCONTENT also captures GPU-drawn windows.
    // The thread takes the window's own DPI mode: Windows draws a DPI-unaware
    // (or system-aware) window at its unscaled size, so measuring it in
    // physical pixels would leave it small in a corner of the picture.
    public static string Snapshot(long handle, int maxWidth) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd) || IsIconic(hWnd)) return "null";
        int awareness = 2;
        try { awareness = GetAwarenessFromDpiAwarenessContext(GetWindowDpiAwarenessContext(hWnd)); } catch { awareness = 2; }
        bool perMonitor = awareness == 2;
        IntPtr old = IntPtr.Zero;
        try { old = SetThreadDpiAwarenessContext(new IntPtr(awareness == 0 ? -1 : awareness == 1 ? -2 : -4)); } catch { old = IntPtr.Zero; }
        try {
            RECT r;
            GetWindowRect(hWnd, out r);
            int w = r.right - r.left, h = r.bottom - r.top;
            if (w < 20 || h < 20 || w > 16384 || h > 16384) return "null";
            using (var bmp = new System.Drawing.Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                using (var g = System.Drawing.Graphics.FromImage(bmp)) {
                    IntPtr hdc = g.GetHdc();
                    bool ok;
                    try { ok = PrintWindow(hWnd, hdc, 2); } finally { g.ReleaseHdc(hdc); }
                    if (!ok) return "null";
                }
                // The visible frame (without the invisible resize borders) is
                // reported in physical pixels, so it only lines up with
                // per-monitor-aware windows; others keep the whole picture.
                int cx = 0, cy = 0, cw = w, ch = h;
                if (perMonitor) {
                    RECT fr = Frame(hWnd);
                    cx = Math.Max(0, fr.left - r.left);
                    cy = Math.Max(0, fr.top - r.top);
                    cw = Math.Min(w - cx, fr.right - fr.left);
                    ch = Math.Min(h - cy, fr.bottom - fr.top);
                }
                if (cw < 20 || ch < 20) return "null";
                double scale = Math.Min(1.0, (double)Math.Max(160, maxWidth) / cw);
                int ow = Math.Max(1, (int)(cw * scale)), oh = Math.Max(1, (int)(ch * scale));
                using (var outBmp = new System.Drawing.Bitmap(ow, oh)) {
                    using (var g2 = System.Drawing.Graphics.FromImage(outBmp)) {
                        g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                        g2.DrawImage(bmp, new System.Drawing.Rectangle(0, 0, ow, oh), new System.Drawing.Rectangle(cx, cy, cw, ch), System.Drawing.GraphicsUnit.Pixel);
                    }
                    System.Drawing.Imaging.ImageCodecInfo codec = null;
                    foreach (var c in System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") codec = c;
                    var ep = new System.Drawing.Imaging.EncoderParameters(1);
                    ep.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 78L);
                    using (var ms = new MemoryStream()) {
                        outBmp.Save(ms, codec, ep);
                        return "\"data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray()) + "\"";
                    }
                }
            }
        } catch { return "null"; } finally { Restore(old); }
    }

    // A share of the work area of the monitor the window is on (fractions).
    public static string Tile(long handle, double fx, double fy, double fw, double fh) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return "false";
        IntPtr old = Aware();
        try {
            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(MonitorFromWindow(hWnd, 2), ref mi)) return "false";
            RECT wa = mi.rcWork;
            int W = wa.right - wa.left, H = wa.bottom - wa.top;
            int x = wa.left + (int)Math.Round(W * fx), y = wa.top + (int)Math.Round(H * fy);
            int x2 = wa.left + (int)Math.Round(W * (fx + fw)), y2 = wa.top + (int)Math.Round(H * (fy + fh));
            PlaceAware(hWnd, x, y, x2 - x, y2 - y, fw >= 1 && fh >= 1 ? "max" : "");
            return "true";
        } finally { Restore(old); }
    }
}

// -- Live wallpaper -----------------------------------------------------------
// Puts an eDEX window behind the desktop icons. Message 0x052C asks Explorer
// to split the desktop into a wallpaper layer and the icon layer. On the
// classic layout (up to Windows 11 23H2) that makes a top-level WorkerW
// behind the icons' WorkerW, which becomes the parent. On the "raised"
// layout (24H2 and later) the icons (SHELLDLL_DefView) and the wallpaper
// WorkerW are both children of Progman: the window becomes a layered child
// of Progman placed directly below the icons.
public static class EdexWall {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int idx);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int idx, IntPtr v);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr h, IntPtr rect, IntPtr rgn, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);

    const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    const long WS_CHILD = 0x40000000L, WS_POPUP = 0x80000000L, WS_CAPTION = 0x00C00000L, WS_THICKFRAME = 0x00040000L;
    const long WS_EX_LAYERED = 0x00080000L, WS_EX_APPWINDOW = 0x00040000L, WS_EX_TOOLWINDOW = 0x00000080L, WS_EX_NOACTIVATE = 0x08000000L;
    const uint SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_NOZORDER = 0x0004, SWP_FRAMECHANGED = 0x0020;

    static IntPtr progman, defView, workerW;
    static string mode = "none";

    static IntPtr Aware() { try { return SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { return IntPtr.Zero; } }
    static void Restore(IntPtr old) { if (old != IntPtr.Zero) { try { SetThreadDpiAwarenessContext(old); } catch { } } }

    static void Split() {
        IntPtr r;
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
        SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
    }

    static bool Find() {
        IntPtr dv = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
        if (dv != IntPtr.Zero) {
            IntPtr w = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
            if (w != IntPtr.Zero) { defView = dv; workerW = w; mode = "raised"; return true; }
            return false;
        }
        IntPtr host = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { host = h; return false; }
            return true;
        }, IntPtr.Zero);
        if (host == IntPtr.Zero) return false;
        IntPtr behind = FindWindowEx(IntPtr.Zero, host, "WorkerW", null);
        if (behind == IntPtr.Zero) return false;
        defView = FindWindowEx(host, IntPtr.Zero, "SHELLDLL_DefView", null);
        workerW = behind;
        mode = "classic";
        return true;
    }

    public static string Locate() {
        progman = FindWindow("Progman", null);
        mode = "none";
        if (progman == IntPtr.Zero) return "\"none\"";
        if (!Find()) {
            Split();
            for (int i = 0; i < 25 && !Find(); i++) System.Threading.Thread.Sleep(80);
        }
        return EdexNative.Q(mode);
    }

    // Parents the window behind the icons; x, y, w, h in physical screen pixels.
    public static string Attach(long handle, int x, int y, int w, int h) {
        IntPtr hWnd = new IntPtr(handle);
        if (!IsWindow(hWnd)) return "{\"ok\":false,\"mode\":\"none\"}";
        if (mode == "none" || !IsWindow(progman) || !IsWindow(workerW)) Locate();
        if (mode == "none") return "{\"ok\":false,\"mode\":\"none\"}";
        IntPtr old = Aware();
        try {
            long style = GetWindowLongPtr(hWnd, GWL_STYLE).ToInt64();
            style = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD;
            SetWindowLongPtr(hWnd, GWL_STYLE, new IntPtr(style));
            long ex = GetWindowLongPtr(hWnd, GWL_EXSTYLE).ToInt64();
            ex = (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            IntPtr parent = mode == "raised" ? progman : workerW;
            if (mode == "raised") ex |= WS_EX_LAYERED;
            SetWindowLongPtr(hWnd, GWL_EXSTYLE, new IntPtr(ex));
            SetParent(hWnd, parent);
            if (mode == "raised") SetLayeredWindowAttributes(hWnd, 0, 255, 2); // LWA_ALPHA
            POINT p; p.x = x; p.y = y;
            ScreenToClient(parent, ref p);
            if (mode == "raised") SetWindowPos(hWnd, defView, p.x, p.y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
            else SetWindowPos(hWnd, IntPtr.Zero, p.x, p.y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOZORDER | SWP_FRAMECHANGED);
            return "{\"ok\":true,\"mode\":" + EdexNative.Q(mode) + "}";
        } finally { Restore(old); }
    }

    // Is the window still behind the icons (Explorer restarts destroy that)?
    public static string Check(long handle) {
        IntPtr hWnd = new IntPtr(handle);
        bool ok = IsWindow(hWnd) && (GetParent(hWnd) == progman || GetParent(hWnd) == workerW) && IsWindow(progman);
        return ok ? "true" : "false";
    }

    // After the windows close: let Explorer repaint the normal wallpaper.
    public static string Refresh() {
        IntPtr target = mode == "raised" ? progman : workerW;
        if (target != IntPtr.Zero && IsWindow(target)) RedrawWindow(target, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0004 | 0x0080 | 0x0100 | 0x0400);
        if (progman != IntPtr.Zero && IsWindow(progman)) RedrawWindow(progman, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0004 | 0x0080 | 0x0100);
        return "true";
    }

    // Is a maximised or full-screen window in front on the monitor containing
    // the point (the wallpaper can't be seen there, so it pauses)?
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int max);
    public static string Covered() {
        IntPtr old = Aware();
        try {
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return "null";
            // The desktop itself (clicked on) spans the monitor too.
            var cls = new System.Text.StringBuilder(64);
            GetClassName(fg, cls, 64);
            string c = cls.ToString();
            if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return "null";
            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(MonitorFromWindow(fg, 2), ref mi)) return "null";
            RECT r;
            GetWindowRect(fg, out r);
            RECT m = mi.rcMonitor;
            bool full = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
            if (!IsZoomed(fg) && !full) return "null";
            return "[" + m.left + "," + m.top + "," + (m.right - m.left) + "," + (m.bottom - m.top) + "]";
        } finally { Restore(old); }
    }
}

// -- Disk usage scan ---------------------------------------------------------
// Runs on a background thread so the helper keeps answering while it walks
// the tree. FindFirstFileEx with large fetches returns sizes with the listing
// (no per-file stat). Junctions and symbolic links are not followed.
public static class EdexDisk {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WIN32_FIND_DATA {
        public uint dwFileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime, ftLastAccessTime, ftLastWriteTime;
        public uint nFileSizeHigh, nFileSizeLow, dwReserved0, dwReserved1;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string cFileName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string cAlternateFileName;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindFirstFileEx(string name, int infoLevel, out WIN32_FIND_DATA data, int searchOp, IntPtr filter, int flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool FindNextFile(IntPtr h, out WIN32_FIND_DATA data);
    [DllImport("kernel32.dll")] static extern bool FindClose(IntPtr h);

    class Node {
        public string Name; public long Size; public long Files; public long Own;
        public List<Node> Dirs = new List<Node>();
        public List<KeyValuePair<string, long>> Big;
    }

    static Node root;
    static string rootPath = "";
    static System.Threading.Thread worker;
    static volatile bool cancel, done;
    static long files, dirs, bytes, denied;
    static string current = "";
    static DateTime started;

    public static string Start(string path) {
        Cancel();
        rootPath = path.TrimEnd('\\');
        if (rootPath.Length == 2 && rootPath[1] == ':') rootPath += "\\";
        files = dirs = bytes = denied = 0;
        done = false;
        cancel = false;
        root = null;
        started = DateTime.UtcNow;
        worker = new System.Threading.Thread(Run);
        worker.IsBackground = true;
        worker.Priority = System.Threading.ThreadPriority.BelowNormal;
        worker.Start();
        return Progress();
    }

    public static string Cancel() {
        cancel = true;
        if (worker != null && worker.IsAlive) worker.Join(3000);
        worker = null;
        return "true";
    }

    public static string Clear() { Cancel(); root = null; done = false; return "true"; }

    static void Run() {
        var r = new Node { Name = rootPath };
        try { Walk(r, rootPath); } catch { }
        root = r;
        done = !cancel;
    }

    static string LongPath(string p) {
        if (p.StartsWith(@"\\?\")) return p;
        return p.StartsWith(@"\\") ? @"\\?\UNC\" + p.Substring(2) : @"\\?\" + p;
    }

    static void Walk(Node node, string dir) {
        current = dir;
        WIN32_FIND_DATA d;
        IntPtr h = FindFirstFileEx(LongPath(dir.TrimEnd('\\')) + "\\*", 1, out d, 0, IntPtr.Zero, 2);
        if (h == new IntPtr(-1)) { denied++; return; }
        try {
            do {
                if (cancel) return;
                string n = d.cFileName;
                if (n == "." || n == "..") continue;
                bool isDir = (d.dwFileAttributes & 0x10) != 0;
                bool link = (d.dwFileAttributes & 0x400) != 0 && (d.dwReserved0 == 0xA0000003 || d.dwReserved0 == 0xA000000C);
                if (isDir) {
                    if (link) continue;
                    var child = new Node { Name = n };
                    node.Dirs.Add(child);
                    dirs++;
                    Walk(child, dir.TrimEnd('\\') + "\\" + n);
                    node.Size += child.Size;
                    node.Files += child.Files;
                } else {
                    long sz = ((long)d.nFileSizeHigh << 32) | d.nFileSizeLow;
                    node.Size += sz;
                    node.Own += sz;
                    node.Files++;
                    files++;
                    bytes += sz;
                    if (sz >= 1048576) {
                        if (node.Big == null) node.Big = new List<KeyValuePair<string, long>>();
                        node.Big.Add(new KeyValuePair<string, long>(n, sz));
                        if (node.Big.Count > 24) {
                            node.Big.Sort((a, b) => b.Value.CompareTo(a.Value));
                            node.Big.RemoveRange(12, node.Big.Count - 12);
                        }
                    }
                }
            } while (FindNextFile(h, out d));
        } finally { FindClose(h); }
    }

    public static string Progress() {
        return "{\"root\":" + EdexNative.Q(rootPath) + ",\"running\":" + (worker != null && worker.IsAlive ? "true" : "false") +
            ",\"done\":" + (done ? "true" : "false") + ",\"files\":" + files + ",\"dirs\":" + dirs + ",\"bytes\":" + bytes +
            ",\"denied\":" + denied + ",\"seconds\":" + ((int)(DateTime.UtcNow - started).TotalSeconds) +
            ",\"current\":" + EdexNative.Q(current) + "}";
    }

    static Node Find(string path) {
        if (root == null) return null;
        string rel = path.TrimEnd('\\');
        string rp = rootPath.TrimEnd('\\');
        if (!rel.StartsWith(rp, StringComparison.OrdinalIgnoreCase)) return null;
        rel = rel.Substring(rp.Length).Trim('\\');
        Node node = root;
        if (rel.Length == 0) return node;
        foreach (var part in rel.Split('\\')) {
            Node next = null;
            foreach (var c in node.Dirs) if (string.Equals(c.Name, part, StringComparison.OrdinalIgnoreCase)) { next = c; break; }
            if (next == null) return null;
            node = next;
        }
        return node;
    }

    static readonly int[] Caps = { 36, 14, 7 };

    static void Emit(StringBuilder sb, Node node, int level, int depth) {
        sb.Append("{\"name\":").Append(EdexNative.Q(node.Name)).Append(",\"size\":").Append(node.Size)
          .Append(",\"files\":").Append(node.Files).Append(",\"dir\":true");
        if (level < depth) {
            var items = new List<KeyValuePair<object, long>>();
            foreach (var c in node.Dirs) items.Add(new KeyValuePair<object, long>(c, c.Size));
            long bigTotal = 0;
            if (node.Big != null) {
                node.Big.Sort((a, b) => b.Value.CompareTo(a.Value));
                for (int i = 0; i < Math.Min(12, node.Big.Count); i++) { items.Add(new KeyValuePair<object, long>(node.Big[i], node.Big[i].Value)); bigTotal += node.Big[i].Value; }
            }
            items.Sort((a, b) => b.Value.CompareTo(a.Value));
            int cap = Caps[Math.Min(level, Caps.Length - 1)];
            long shown = 0;
            sb.Append(",\"children\":[");
            int count = 0;
            foreach (var it in items) {
                if (count >= cap || (level > 0 && it.Value < node.Size / 400)) break;
                if (count > 0) sb.Append(',');
                if (it.Key is Node) Emit(sb, (Node)it.Key, level + 1, depth);
                else {
                    var f = (KeyValuePair<string, long>)it.Key;
                    sb.Append("{\"name\":").Append(EdexNative.Q(f.Key)).Append(",\"size\":").Append(f.Value).Append(",\"dir\":false}");
                }
                shown += it.Value;
                count++;
            }
            long rest = node.Size - shown;
            if (rest > 0 && rest >= node.Size / 400) {
                if (count > 0) sb.Append(',');
                sb.Append("{\"name\":\"\",\"rest\":true,\"size\":").Append(rest).Append(",\"dir\":false}");
            }
            sb.Append(']');
        }
        sb.Append('}');
    }

    public static string Children(string path, int depth) {
        Node node = Find(path);
        if (node == null) return "null";
        var sb = new StringBuilder();
        Emit(sb, node, 0, Math.Max(1, Math.Min(4, depth)));
        return sb.ToString();
    }
}
'@

function Write-Line([string]$text) {
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()
}

function J([string]$s) { [EdexNative]::Q($s) }

# -- WinRT helpers (media sessions, Bluetooth) --------------------------------
# Windows PowerShell can call WinRT APIs directly; async operations are
# awaited through the .NET AsTask bridge with a timeout.
$script:asTaskOp = $null
function Initialize-WinRT {
    if ($script:asTaskOp) { return }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
}
function Await($op, [Type]$type, [int]$ms = 4000) {
    $task = $script:asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
    if (-not $task.Wait($ms)) { throw 'WinRT call timed out' }
    $task.Result
}

# -- Now playing (any app that reports to Windows' media controls) ------------
$script:mediaManager = $null
function Get-MediaManager {
    if (-not $script:mediaManager) {
        Initialize-WinRT
        $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
        $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
        $script:mediaManager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    $script:mediaManager
}

function Select-MediaSession($a) {
    $mgr = Get-MediaManager
    $skip = [string]$a.skip
    $sessions = @($mgr.GetSessions() | Where-Object { -not $skip -or $_.SourceAppUserModelId -notmatch $skip })
    if (-not $sessions.Count) { return $null }
    # A particular kind of player (e.g. Spotify), or nothing at all.
    if ($a.match) {
        $m = $sessions | Where-Object { $_.SourceAppUserModelId -match [string]$a.match } | Select-Object -First 1
        if ($m) { return $m }
        if ($a.only) { return $null }
    }
    if ($a.app) {
        $match = $sessions | Where-Object { $_.SourceAppUserModelId -eq [string]$a.app } | Select-Object -First 1
        if ($match) { return $match }
    }
    $cur = $mgr.GetCurrentSession()
    if ($cur -and (-not $skip -or $cur.SourceAppUserModelId -notmatch $skip)) { return $cur }
    $playing = $sessions | Where-Object { [string]$_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
    if ($playing) { return $playing }
    $sessions[0]
}

function Read-Thumbnail($ref) {
    $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    try { [EdexStreams]::DataUrl($stream, 3MB) }
    finally { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream) } catch { } }
}

function Get-NowPlaying($a) {
    $s = Select-MediaSession $a
    if (-not $s) { return 'null' }
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $info = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $status = [string]$info.PlaybackStatus
    $pos = $tl.Position.TotalSeconds
    $end = $tl.EndTime.TotalSeconds
    if ($status -eq 'Playing' -and $end -gt 0 -and $tl.LastUpdatedTime.Year -gt 2000) {
        $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
    }
    if ($end -gt 0 -and $pos -gt $end) { $pos = $end }
    $c = $info.Controls
    $art = 'null'
    if ($a.art -and $p.Thumbnail) { try { $art = Read-Thumbnail $p.Thumbnail } catch { $art = 'null' } }
    $b = { param($v) if ($v) { 'true' } else { 'false' } }
    '{"app":' + (J $s.SourceAppUserModelId) + ',"title":' + (J $p.Title) + ',"artist":' + (J $p.Artist) +
        ',"album":' + (J $p.AlbumTitle) + ',"status":' + (J $status) +
        ',"position":' + [Math]::Round([Math]::Max(0, $pos), 1).ToString([Globalization.CultureInfo]::InvariantCulture) +
        ',"duration":' + [Math]::Round([Math]::Max(0, $end), 1).ToString([Globalization.CultureInfo]::InvariantCulture) +
        ',"hasArt":' + (& $b ($null -ne $p.Thumbnail)) + ',"art":' + $art +
        ',"canPlay":' + (& $b $c.IsPlayEnabled) + ',"canPause":' + (& $b $c.IsPauseEnabled) +
        ',"canNext":' + (& $b $c.IsNextEnabled) + ',"canPrev":' + (& $b $c.IsPreviousEnabled) +
        ',"canSeek":' + (& $b $c.IsPlaybackPositionEnabled) + '}'
}

function Invoke-MediaControl($a) {
    $s = Select-MediaSession $a
    if (-not $s) { return 'false' }
    switch ([string]$a.action) {
        'toggle' { $op = $s.TryTogglePlayPauseAsync() }
        'play'   { $op = $s.TryPlayAsync() }
        'pause'  { $op = $s.TryPauseAsync() }
        'next'   { $op = $s.TrySkipNextAsync() }
        'prev'   { $op = $s.TrySkipPreviousAsync() }
        'seek'   { $op = $s.TryChangePlaybackPositionAsync([long]([double]$a.position * 10000000)) }
        default  { throw 'Unknown media action' }
    }
    if (Await $op ([bool])) { 'true' } else { 'false' }
}

# -- Bluetooth ------------------------------------------------------------------
function Get-BluetoothRadio {
    Initialize-WinRT
    $null = [Windows.Devices.Radios.Radio, Windows.Devices.Radios, ContentType = WindowsRuntime]
    $radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
    $radios | Where-Object { [string]$_.Kind -eq 'Bluetooth' } | Select-Object -First 1
}

function Get-Bluetooth {
    $radio = Get-BluetoothRadio
    if (-not $radio) { return '{"radio":null,"devices":[]}' }
    $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
    $null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
    $items = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    $on = [string]$radio.State -eq 'On'
    if ($on) {
        foreach ($kind in 'classic', 'le') {
            try {
                $sel = if ($kind -eq 'classic') { [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true) } else { [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true) }
                $infos = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
                foreach ($i in $infos) {
                    $connected = $false; $major = ''; $address = ''
                    try {
                        if ($kind -eq 'classic') {
                            $d = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice]) 2500
                            if ($d) { $connected = [string]$d.ConnectionStatus -eq 'Connected'; $major = [string]$d.ClassOfDevice.MajorClass; $address = $d.BluetoothAddress.ToString('X'); $d.Dispose() }
                        } else {
                            $d = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($i.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice]) 2500
                            if ($d) { $connected = [string]$d.ConnectionStatus -eq 'Connected'; $major = 'LowEnergy'; $address = $d.BluetoothAddress.ToString('X'); $d.Dispose() }
                        }
                    } catch { }
                    $name = [string]$i.Name
                    if (-not $name) { continue }
                    $key = if ($address) { $address } else { $name }
                    if ($seen.ContainsKey($key)) {
                        if ($connected) { $items[$seen[$key]] = '{"name":' + (J $name) + ',"connected":true,"kind":' + (J $major) + '}' }
                        continue
                    }
                    $seen[$key] = $items.Count
                    $items.Add('{"name":' + (J $name) + ',"connected":' + $(if ($connected) { 'true' } else { 'false' }) + ',"kind":' + (J $major) + '}')
                }
            } catch { }
        }
    }
    '{"radio":' + (J ([string]$radio.State)) + ',"devices":[' + ($items -join ',') + ']}'
}

function Set-BluetoothRadio([bool]$on) {
    $radio = Get-BluetoothRadio
    if (-not $radio) { throw 'No Bluetooth radio' }
    $access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    if ([string]$access -ne 'Allowed') { throw "Bluetooth access: $access" }
    $state = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
    $result = Await ($radio.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus]) 8000
    if ([string]$result -ne 'Allowed') { throw "Bluetooth: $result" }
    Get-Bluetooth
}

# -- Xbox / Microsoft Store games ------------------------------------------------
# Installed packages that carry a MicrosoftGame.config are games; the Start
# menu id (family!app) launches them.
function Get-XboxGames {
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($p in @(Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue)) {
        if ($p.IsFramework -or -not $p.InstallLocation) { continue }
        $cfg = Join-Path $p.InstallLocation 'MicrosoftGame.config'
        if (-not (Test-Path -LiteralPath $cfg)) { continue }
        $name = ''; $logo = ''; $appId = ''
        try {
            [xml]$x = Get-Content -LiteralPath $cfg -Raw -ErrorAction Stop
            $sv = $x.Game.ShellVisuals
            if ($sv) {
                $name = [string]$sv.DefaultDisplayName
                foreach ($k in 'Square480x480Logo', 'Square150x150Logo', 'StoreLogo') {
                    $v = [string]$sv.GetAttribute($k)
                    if ($v) { $logo = $v; break }
                }
            }
        } catch { }
        try {
            $m = Get-AppxPackageManifest -Package $p -ErrorAction Stop
            $apps = @($m.Package.Applications.Application)
            if ($apps.Count) { $appId = [string]$apps[0].Id }
            if (-not $name -or $name -like 'ms-resource:*') {
                $dn = [string]$m.Package.Properties.DisplayName
                if ($dn -and $dn -notlike 'ms-resource:*') { $name = $dn }
            }
        } catch { }
        if (-not $appId) { continue }
        $out.Add('{"aumid":' + (J ($p.PackageFamilyName + '!' + $appId)) + ',"name":' + (J $name) + ',"dir":' + (J ([string]$p.InstallLocation)) + ',"logo":' + (J $logo) + '}')
    }
    '[' + ($out -join ',') + ']'
}

# -- Windows Search index -----------------------------------------------------
# Names (prefix match per word) or, in content mode, text inside documents.
# Only letters, digits and a few joiners reach the query, so input can't
# change its structure.
function Search-Index($a) {
    $words = @([regex]::Matches([string]$a.query, '[\p{L}\p{N}_\-\.]+') | ForEach-Object { $_.Value.Trim('.') } | Where-Object { $_ } | Select-Object -First 6)
    if (-not $words.Count) { return '[]' }
    $max = [Math]::Min(60, [Math]::Max(1, [int]$a.max))
    $terms = ($words | ForEach-Object { '"' + $_ + '*"' }) -join ' AND '
    $where = if ([string]$a.mode -eq 'content') { "CONTAINS(*, '$terms')" } else { "CONTAINS(System.FileName, '$terms')" }
    $sql = "SELECT TOP $max System.ItemPathDisplay, System.ItemNameDisplay, System.Size, System.DateModified, System.ItemType FROM SystemIndex WHERE SCOPE='file:' AND $where ORDER BY System.Search.Rank DESC"
    $conn = New-Object System.Data.OleDb.OleDbConnection "Provider=Search.CollatorDSO;Extended Properties='Application=Windows';"
    try {
        $conn.Open()
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = $sql
        $cmd.CommandTimeout = 8
        $r = $cmd.ExecuteReader()
        $out = New-Object System.Collections.Generic.List[string]
        while ($r.Read()) {
            $path = [string]$r.GetValue(0)
            if (-not $path) { continue }
            $size = if ($r.IsDBNull(2)) { 'null' } else { ([double]$r.GetValue(2)).ToString([Globalization.CultureInfo]::InvariantCulture) }
            $mtime = 'null'
            if (-not $r.IsDBNull(3)) { $mtime = ([DateTimeOffset]::new([DateTime]::SpecifyKind([DateTime]$r.GetValue(3), [DateTimeKind]::Utc))).ToUnixTimeMilliseconds().ToString() }
            $isDir = (-not $r.IsDBNull(4)) -and ([string]$r.GetValue(4) -eq 'Directory')
            $out.Add('{"path":' + (J $path) + ',"name":' + (J ([string]$r.GetValue(1))) + ',"size":' + $size + ',"mtime":' + $mtime + ',"isDir":' + $(if ($isDir) { 'true' } else { 'false' }) + '}')
        }
        $r.Close()
        '[' + ($out -join ',') + ']'
    } finally { $conn.Close() }
}

# Compiling the interop types costs ~1-2 s, so the assembly is cached on disk
# keyed by a hash of its source and reused on later launches.
$refs = @('System.Drawing', 'System.Management')
try {
    $sha = [System.Security.Cryptography.SHA1]::Create()
    $hash = ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($source)) | ForEach-Object { $_.ToString('x2') }) -join ''
    $dll = Join-Path $CacheDir ("edex-native-" + $hash.Substring(0, 12) + ".dll")
    if (-not (Test-Path $dll)) {
        Add-Type -TypeDefinition $source -ReferencedAssemblies $refs -OutputAssembly $dll -OutputType Library
        # Drop assemblies compiled from older versions of this script.
        Get-ChildItem -Path $CacheDir -Filter 'edex-native-*.dll' | Where-Object { $_.FullName -ne $dll } | Remove-Item -ErrorAction SilentlyContinue
    }
    Add-Type -Path $dll
} catch {
    Add-Type -TypeDefinition $source -ReferencedAssemblies $refs
}

try { [EdexShell]::GuardConsole() } catch { }

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
            'foreground' { $data = [EdexNative]::Foreground() }
            'minimize'  { $data = if ([EdexNative]::Minimize([long]$a.hwnd)) { 'true' } else { 'false' } }
            'maximize'  { $data = if ([EdexNative]::ToggleMaximize([long]$a.hwnd)) { 'true' } else { 'false' } }
            'close'     { $data = if ([EdexNative]::Close([long]$a.hwnd)) { 'true' } else { 'false' } }
            'media'     { $data = if ([EdexNative]::MediaKey([string]$a.key)) { 'true' } else { 'false' } }
            'volume'    { $data = [EdexNative]::GetVolume() }
            'setVolume' { $data = [EdexNative]::SetVolume([double]$a.level) }
            'setMute'   { $data = [EdexNative]::SetMute([bool]$a.muted) }
            'perf'      { $data = [EdexNative]::Perf() }
            'live'      { $data = [EdexSys]::Live() }
            'processes' { $data = [EdexSys]::Processes([bool]$a.paths) }
            'drives'    { $data = [EdexSys]::Drives() }
            'battery'   { $data = [EdexSys]::Battery() }
            'static'    { $data = [EdexSys]::Static() }
            'temp'      { $data = [EdexSys]::Temp() }
            'icons'     { $data = [EdexSys]::Icons([string[]]@($a.paths | Where-Object { $_ -ne $null })) }
            'clipSeq'   { $data = [EdexSys]::ClipSeq() }
            'brightness' { $data = [EdexSys]::GetBrightness() }
            'setBrightness' { $data = [EdexSys]::SetBrightness([int]$a.level) }
            'taskbarHide'  { $data = [EdexShell]::Hide([int]$a.prev) }
            'taskbarShow'  { $data = [EdexShell]::Show([int]$a.prev) }
            'taskbarState' { $data = [EdexShell]::State() }
            'taskbarPeek'  { $data = [EdexShell]::Peek() }
            'fitWindow'    { $data = [EdexShell]::FitWindow([long]$a.hwnd, [bool]$a.cover) }
            'audioSessions'  { $data = [EdexAudio]::Sessions() }
            'audioSetSession' { $data = [EdexAudio]::SetSession([long]$a.pid, [double]$a.level, [int]$a.mute) }
            'audioDevices'   { $data = [EdexAudio]::Devices() }
            'audioSetDefault' { $data = [EdexAudio]::SetDefault([string]$a.id) }
            'monitors'     { $data = [EdexWin]::Monitors() }
            'windowRect'   { $data = [EdexWin]::GetRect([long]$a.hwnd) }
            'placeWindow'  { $data = [EdexWin]::Place([long]$a.hwnd, [int]$a.x, [int]$a.y, [int]$a.w, [int]$a.h, [string]$a.state) }
            'sendToBack'   { $data = [EdexWin]::SendToBack([long]$a.hwnd) }
            'tileWindow'   { $data = [EdexWin]::Tile([long]$a.hwnd, [double]$a.x, [double]$a.y, [double]$a.w, [double]$a.h) }
            'minimizeQuiet' { $data = [EdexWin]::MinimizeQuiet([long]$a.hwnd) }
            'saverBlocked' { $data = [EdexWin]::SaverBlocked([long[]]@($a.exclude | Where-Object { $_ -ne $null })) }
            'windowSnapshot' { $data = [EdexWin]::Snapshot([long]$a.hwnd, [int]$a.max) }
            'wallLocate'   { $data = [EdexWall]::Locate() }
            'wallAttach'   { $data = [EdexWall]::Attach([long]$a.hwnd, [int]$a.x, [int]$a.y, [int]$a.w, [int]$a.h) }
            'wallCheck'    { $data = [EdexWall]::Check([long]$a.hwnd) }
            'wallRefresh'  { $data = [EdexWall]::Refresh() }
            'wallCovered'  { $data = [EdexWall]::Covered() }
            'diskScan'     { $data = [EdexDisk]::Start([string]$a.path) }
            'diskProgress' { $data = [EdexDisk]::Progress() }
            'diskNode'     { $data = [EdexDisk]::Children([string]$a.path, [int]$a.depth) }
            'diskCancel'   { $data = [EdexDisk]::Cancel() }
            'diskClear'    { $data = [EdexDisk]::Clear() }
            'nowPlaying'   { $data = Get-NowPlaying $a }
            'mediaControl' { $data = Invoke-MediaControl $a }
            'bluetooth'    { $data = Get-Bluetooth }
            'bluetoothRadio' { $data = Set-BluetoothRadio ([bool]$a.on) }
            'searchIndex'  { $data = Search-Index $a }
            'xboxGames'    { $data = Get-XboxGames }
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

# eDEX closed the pipe (quit or crash): never leave the taskbar hidden.
try { [EdexShell]::RestoreIfHidden() } catch { }
