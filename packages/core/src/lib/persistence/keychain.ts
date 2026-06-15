import { spawnSync } from "child_process";
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const SERVICE = "kulala-core";
const ACCOUNT = "sqlite-db-key";
const WINDOWS_TARGET = "kulala-core/sqlite-db-key";

// PowerShell script using P/Invoke to Windows Credential Manager (CredRead/CredWrite/CredDelete).
const WIN_CRED_PS1 = `
$ErrorActionPreference = 'Stop';
$target = '${WINDOWS_TARGET}';
$op = $args[0];

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinCred {
  [DllImport("Advapi32.dll", SetLastError=true, EntryPoint="CredReadW", CharSet=CharSet.Unicode)]
  private static extern bool CredRead(string target, uint type, int flag, out IntPtr credential);
  [DllImport("Advapi32.dll", SetLastError=true, EntryPoint="CredWriteW", CharSet=CharSet.Unicode)]
  private static extern bool CredWrite(ref CREDENTIAL cred, uint flags);
  [DllImport("Advapi32.dll", SetLastError=true, EntryPoint="CredDeleteW", CharSet=CharSet.Unicode)]
  private static extern bool CredDelete(string target, uint type, int flag);
  [DllImport("Advapi32.dll", SetLastError=true)]
  private static extern void CredFree(IntPtr cred);

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }

  public static string Get(string t) {
    IntPtr p;
    if (!CredRead(t, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlob == IntPtr.Zero || c.CredentialBlobSize == 0) return null;
      return Marshal.PtrToStringUni(c.CredentialBlob, (int)(c.CredentialBlobSize / 2));
    } finally { CredFree(p); }
  }

  public static bool Set(string t, string secret) {
    byte[] blob = secret == null ? null : Encoding.Unicode.GetBytes(secret);
    if (blob != null && blob.Length > 2560) return false;
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1;
    c.TargetName = Marshal.StringToCoTaskMemUni(t);
    c.UserName = Marshal.StringToCoTaskMemUni("user");
    c.CredentialBlobSize = (uint)(blob == null ? 0 : blob.Length);
    c.CredentialBlob = blob == null ? IntPtr.Zero : Marshal.AllocCoTaskMem(blob.Length);
    if (blob != null) Marshal.Copy(blob, 0, c.CredentialBlob, blob.Length);
    c.Persist = 2;
    try {
      bool ok = CredWrite(ref c, 0);
      return ok;
    } finally {
      Marshal.FreeCoTaskMem(c.TargetName);
      Marshal.FreeCoTaskMem(c.UserName);
      if (c.CredentialBlob != IntPtr.Zero) Marshal.FreeCoTaskMem(c.CredentialBlob);
    }
  }

  public static bool Delete(string t) {
    return CredDelete(t, 1, 0);
  }
}
"@

if ($op -eq 'get') {
  $p = [WinCred]::Get($target);
  if ($p -ne $null) { Write-Output $p }
} elseif ($op -eq 'set') {
  $p = [Console]::In.ReadLine();
  [WinCred]::Set($target, $p) | Out-Null
} elseif ($op -eq 'delete') {
  [WinCred]::Delete($target) | Out-Null
}
`;

function runWinCred(
  op: "get" | "set" | "delete",
  input?: string,
): { stdout: string; stderr: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "kulala-"));
  const scriptPath = join(dir, "win-cred.ps1");
  try {
    writeFileSync(scriptPath, WIN_CRED_PS1, "utf8");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, op],
      {
        encoding: "utf8",
        input: input ?? undefined,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status ?? -1,
    };
  } finally {
    try {
      unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
    try {
      rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Get a secret from the OS keychain.
 * - macOS: Keychain Access (security CLI)
 * - Linux: Secret Service (secret-tool, requires libsecret)
 * - Windows: Credential Manager via PowerShell P/Invoke (no extra deps).
 * May trigger an OS unlock prompt (e.g. keychain password) on first access.
 */
export async function getKeychainSecret(): Promise<string | null> {
  const platform = process.platform;
  if (platform === "darwin") {
    const result = spawnSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    if (result.status !== 0 || result.stderr?.trim()) return null;
    return result.stdout?.trim() ?? null;
  }
  if (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    const result = spawnSync(
      "secret-tool",
      ["lookup", "service", SERVICE, "account", ACCOUNT],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    if (result.status !== 0) return null;
    return result.stdout?.trim() ?? null;
  }
  if (platform === "win32") {
    const result = runWinCred("get");
    if (result.status !== 0) return null;
    return result.stdout?.trim() || null;
  }
  return null;
}

/**
 * Store a secret in the OS keychain. Overwrites if it already exists.
 */
export async function setKeychainSecret(secret: string): Promise<boolean> {
  const platform = process.platform;
  if (platform === "darwin") {
    spawnSync(
      "security",
      ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT],
      {
        encoding: "utf8",
      },
    );
    const result = spawnSync(
      "security",
      [
        "add-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
        secret,
        "-U",
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return result.status === 0;
  }
  if (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    const result = spawnSync(
      "secret-tool",
      [
        "store",
        "--label=Kulala DB key",
        "service",
        SERVICE,
        "account",
        ACCOUNT,
      ],
      { encoding: "utf8", input: secret, stdio: ["pipe", "pipe", "pipe"] },
    );
    return result.status === 0;
  }
  if (platform === "win32") {
    const result = runWinCred("set", secret);
    return result.status === 0;
  }
  return false;
}

/**
 * Remove the secret from the OS keychain.
 */
export async function deleteKeychainSecret(): Promise<boolean> {
  const platform = process.platform;
  if (platform === "darwin") {
    const result = spawnSync(
      "security",
      ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT],
      { encoding: "utf8" },
    );
    return result.status === 0;
  }
  if (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    const result = spawnSync(
      "secret-tool",
      ["clear", "service", SERVICE, "account", ACCOUNT],
      {
        encoding: "utf8",
      },
    );
    return result.status === 0;
  }
  if (platform === "win32") {
    const result = runWinCred("delete");
    return result.status === 0;
  }
  return false;
}

/**
 * Whether the current platform has keychain support.
 * - macOS: always
 * - Linux/BSD: when secret-tool is available (libsecret)
 * - Windows: when PowerShell is available (typical on Windows 7+)
 */
export function isKeychainAvailable(): boolean {
  const platform = process.platform;
  if (platform === "darwin") return true;
  if (platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "exit 0"],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return result.status === 0;
  }
  if (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    const result = spawnSync("which", ["secret-tool"], { encoding: "utf8" });
    return result.status === 0;
  }
  return false;
}
