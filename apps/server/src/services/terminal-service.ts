/**
 * Terminal Service
 *
 * Manages PTY (pseudo-terminal) sessions using node-pty.
 * Supports cross-platform shell detection including WSL.
 */

import * as pty from "node-pty";
import { EventEmitter } from "events";
import * as os from "os";
import * as fs from "fs";

// Maximum scrollback buffer size (characters)
const MAX_SCROLLBACK_SIZE = 100000; // ~100KB per terminal

export interface TerminalSession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  createdAt: Date;
  shell: string;
  scrollbackBuffer: string; // Store recent output for replay on reconnect
}

export interface TerminalOptions {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

type DataCallback = (sessionId: string, data: string) => void;
type ExitCallback = (sessionId: string, exitCode: number) => void;

export class TerminalService extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private dataCallbacks: Set<DataCallback> = new Set();
  private exitCallbacks: Set<ExitCallback> = new Set();

  /**
   * Detect the best shell for the current platform
   */
  detectShell(): { shell: string; args: string[] } {
    const platform = os.platform();

    // Check if running in WSL
    if (platform === "linux" && this.isWSL()) {
      // In WSL, prefer the user's configured shell or bash
      const userShell = process.env.SHELL || "/bin/bash";
      if (fs.existsSync(userShell)) {
        return { shell: userShell, args: ["--login"] };
      }
      return { shell: "/bin/bash", args: ["--login"] };
    }

    switch (platform) {
      case "win32": {
        // Windows: prefer PowerShell, fall back to cmd
        const pwsh = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
        const pwshCore = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

        if (fs.existsSync(pwshCore)) {
          return { shell: pwshCore, args: [] };
        }
        if (fs.existsSync(pwsh)) {
          return { shell: pwsh, args: [] };
        }
        return { shell: "cmd.exe", args: [] };
      }

      case "darwin": {
        // macOS: prefer user's shell, then zsh, then bash
        const userShell = process.env.SHELL;
        if (userShell && fs.existsSync(userShell)) {
          return { shell: userShell, args: ["--login"] };
        }
        if (fs.existsSync("/bin/zsh")) {
          return { shell: "/bin/zsh", args: ["--login"] };
        }
        return { shell: "/bin/bash", args: ["--login"] };
      }

      case "linux":
      default: {
        // Linux: prefer user's shell, then bash, then sh
        const userShell = process.env.SHELL;
        if (userShell && fs.existsSync(userShell)) {
          return { shell: userShell, args: ["--login"] };
        }
        if (fs.existsSync("/bin/bash")) {
          return { shell: "/bin/bash", args: ["--login"] };
        }
        return { shell: "/bin/sh", args: [] };
      }
    }
  }

  /**
   * Detect if running inside WSL (Windows Subsystem for Linux)
   */
  isWSL(): boolean {
    try {
      // Check /proc/version for Microsoft/WSL indicators
      if (fs.existsSync("/proc/version")) {
        const version = fs.readFileSync("/proc/version", "utf-8").toLowerCase();
        return version.includes("microsoft") || version.includes("wsl");
      }
      // Check for WSL environment variable
      if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
        return true;
      }
    } catch {
      // Ignore errors
    }
    return false;
  }

  /**
   * Get platform info for the client
   */
  getPlatformInfo(): {
    platform: string;
    isWSL: boolean;
    defaultShell: string;
    arch: string;
  } {
    const { shell } = this.detectShell();
    return {
      platform: os.platform(),
      isWSL: this.isWSL(),
      defaultShell: shell,
      arch: os.arch(),
    };
  }

  /**
   * Validate and resolve a working directory path
   */
  private resolveWorkingDirectory(requestedCwd?: string): string {
    const homeDir = os.homedir();

    // If no cwd requested, use home
    if (!requestedCwd) {
      return homeDir;
    }

    // Clean up the path
    let cwd = requestedCwd.trim();

    // Fix double slashes at start (but not for Windows UNC paths)
    if (cwd.startsWith("//") && !cwd.startsWith("//wsl")) {
      cwd = cwd.slice(1);
    }

    // Check if path exists and is a directory
    try {
      const stat = fs.statSync(cwd);
      if (stat.isDirectory()) {
        return cwd;
      }
      console.warn(`[Terminal] Path exists but is not a directory: ${cwd}, falling back to home`);
      return homeDir;
    } catch {
      console.warn(`[Terminal] Working directory does not exist: ${cwd}, falling back to home`);
      return homeDir;
    }
  }

  /**
   * Create a new terminal session
   */
  createSession(options: TerminalOptions = {}): TerminalSession {
    const id = `term-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const { shell: detectedShell, args: shellArgs } = this.detectShell();
    const shell = options.shell || detectedShell;

    // Validate and resolve working directory
    const cwd = this.resolveWorkingDirectory(options.cwd);

    // Build environment with some useful defaults
    const env: Record<string, string> = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "automaker-terminal",
      ...options.env,
    };

    console.log(`[Terminal] Creating session ${id} with shell: ${shell} in ${cwd}`);

    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd,
      env,
    });

    const session: TerminalSession = {
      id,
      pty: ptyProcess,
      cwd,
      createdAt: new Date(),
      shell,
      scrollbackBuffer: "",
    };

    this.sessions.set(id, session);

    // Forward data events and store in scrollback buffer
    ptyProcess.onData((data) => {
      // Append to scrollback buffer
      session.scrollbackBuffer += data;
      // Trim if too large (keep the most recent data)
      if (session.scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
        session.scrollbackBuffer = session.scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
      }

      this.dataCallbacks.forEach((cb) => cb(id, data));
      this.emit("data", id, data);
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[Terminal] Session ${id} exited with code ${exitCode}`);
      this.sessions.delete(id);
      this.exitCallbacks.forEach((cb) => cb(id, exitCode));
      this.emit("exit", id, exitCode);
    });

    console.log(`[Terminal] Session ${id} created successfully`);
    return session;
  }

  /**
   * Write data to a terminal session
   */
  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[Terminal] Session ${sessionId} not found`);
      return false;
    }
    session.pty.write(data);
    return true;
  }

  /**
   * Resize a terminal session
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.warn(`[Terminal] Session ${sessionId} not found for resize`);
      return false;
    }
    try {
      session.pty.resize(cols, rows);
      return true;
    } catch (error) {
      console.error(`[Terminal] Error resizing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Kill a terminal session
   */
  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    try {
      session.pty.kill();
      this.sessions.delete(sessionId);
      console.log(`[Terminal] Session ${sessionId} killed`);
      return true;
    } catch (error) {
      console.error(`[Terminal] Error killing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get scrollback buffer for a session (for replay on reconnect)
   */
  getScrollback(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    return session?.scrollbackBuffer || null;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): Array<{
    id: string;
    cwd: string;
    createdAt: Date;
    shell: string;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      createdAt: s.createdAt,
      shell: s.shell,
    }));
  }

  /**
   * Subscribe to data events
   */
  onData(callback: DataCallback): () => void {
    this.dataCallbacks.add(callback);
    return () => this.dataCallbacks.delete(callback);
  }

  /**
   * Subscribe to exit events
   */
  onExit(callback: ExitCallback): () => void {
    this.exitCallbacks.add(callback);
    return () => this.exitCallbacks.delete(callback);
  }

  /**
   * Clean up all sessions
   */
  cleanup(): void {
    console.log(`[Terminal] Cleaning up ${this.sessions.size} sessions`);
    this.sessions.forEach((session, id) => {
      try {
        session.pty.kill();
      } catch {
        // Ignore errors during cleanup
      }
      this.sessions.delete(id);
    });
  }
}

// Singleton instance
let terminalService: TerminalService | null = null;

export function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService();
  }
  return terminalService;
}
