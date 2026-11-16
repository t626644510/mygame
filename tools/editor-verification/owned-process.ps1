#requires -Version 7.0
param([Parameter(Mandatory = $true)][int]$OwnedProcessId)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# Query one PID supplied by the retained ChildProcess owner. No CIM, windows,
# accessibility, global application inventory, process mutation, or UI calls.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class P1OwnedProcessMetadata {
    [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public IntPtr reserved1, peb, reserved2a, reserved2b, pid, parentPid; }
    [StructLayout(LayoutKind.Sequential)] struct UnicodeString { public ushort length, maximumLength; public IntPtr buffer; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int kind, IntPtr output, int size, out int returned);
    public static string Owner(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid), token = IntPtr.Zero;
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { if (!OpenProcessToken(process, 8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error()); using (WindowsIdentity identity = new WindowsIdentity(token)) return identity.Name; }
        finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(process); }
    }
    public static long Parent(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid), output = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(BasicInfo)));
        if (process == IntPtr.Zero) { Marshal.FreeHGlobal(output); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        try { int returned; int status = NtQueryInformationProcess(process, 0, output, Marshal.SizeOf(typeof(BasicInfo)), out returned); if (status != 0) throw new InvalidOperationException("NtQueryInformationProcess basic status " + status); return Marshal.PtrToStructure<BasicInfo>(output).parentPid.ToInt64(); }
        finally { Marshal.FreeHGlobal(output); CloseHandle(process); }
    }
    public static string CommandLine(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid), output = IntPtr.Zero;
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { int needed; NtQueryInformationProcess(process, 60, IntPtr.Zero, 0, out needed); if (needed <= 0 || needed > 1024 * 1024) throw new InvalidOperationException("Invalid command line query size"); output = Marshal.AllocHGlobal(needed); int status = NtQueryInformationProcess(process, 60, output, needed, out needed); if (status != 0) throw new InvalidOperationException("NtQueryInformationProcess command status " + status); UnicodeString text = Marshal.PtrToStructure<UnicodeString>(output); return Marshal.PtrToStringUni(text.buffer, text.length / 2); }
        finally { if (output != IntPtr.Zero) Marshal.FreeHGlobal(output); CloseHandle(process); }
    }
}
'@
$owned = Get-Process -Id $OwnedProcessId -ErrorAction Stop
[pscustomobject][ordered]@{
    processId = $owned.Id
    parentProcessId = [P1OwnedProcessMetadata]::Parent($owned.Id)
    executablePath = $owned.Path
    commandLine = [P1OwnedProcessMetadata]::CommandLine($owned.Id)
    startedAtUtc = $owned.StartTime.ToUniversalTime().ToString('o')
    owner = [P1OwnedProcessMetadata]::Owner($owned.Id)
    sessionId = $owned.SessionId
    method = 'Get-Process and exact-PID native process/token queries; no CIM or UI'
} | ConvertTo-Json -Compress
