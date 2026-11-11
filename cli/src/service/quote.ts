// Quoting helpers for the service definition formats. All pure.

function rejectControlChars(value: string, what: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`${what} must not contain newlines or NUL characters: ${JSON.stringify(value)}`);
  }
}

export function escapeXml(value: string): string {
  rejectControlChars(value, "XML value");
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** One ExecStart= argument: always double-quoted, C-style escapes, `%` and `$` doubled. */
export function quoteSystemdArg(value: string): string {
  rejectControlChars(value, "systemd argument");
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/%/g, "%%")
    .replace(/\$/g, "$$$$");
  return `"${escaped}"`;
}

/** One Environment= assignment. `$` is literal there, `%` is still a specifier. */
export function quoteSystemdEnv(name: string, value: string): string {
  rejectControlChars(value, `environment variable ${name}`);
  const escaped = `${name}=${value}`
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/%/g, "%%");
  return `"${escaped}"`;
}

/**
 * Desktop Entry Exec= argument. Quoting rules first (escape " ` $ \ inside
 * double quotes), then the string-level escaping of the key value (\ -> \\)
 * and field-code escaping (% -> %%).
 */
export function quoteDesktopExecArg(value: string): string {
  rejectControlChars(value, "Exec argument");
  const quoted = /^[A-Za-z0-9_@+=:,./-]+$/.test(value)
    ? value
    : `"${value.replace(/(["`$\\])/g, "\\$1")}"`;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}

/** Quote one argument for a Windows command line (CommandLineToArgvW rules). Always quotes. */
export function quoteWindowsArg(value: string): string {
  rejectControlChars(value, "Windows argument");
  let out = "\"";
  let backslashes = 0;
  for (const ch of value) {
    if (ch === "\\") {
      backslashes += 1;
      continue;
    }
    if (ch === "\"") {
      out += "\\".repeat(backslashes * 2 + 1) + "\"";
    } else {
      out += "\\".repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  out += "\\".repeat(backslashes * 2) + "\"";
  return out;
}

/** VBScript string literal. */
export function vbsString(value: string): string {
  rejectControlChars(value, "VBScript string");
  return `"${value.replace(/"/g, "\"\"")}"`;
}
