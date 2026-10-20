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
'@

function Write-Line([string]$text) {
    [Console]::Out.WriteLine($text)
    [Console]::Out.Flush()
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
