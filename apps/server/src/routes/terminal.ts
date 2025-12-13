/**
 * Terminal routes with password protection
 *
 * Provides REST API for terminal session management and authentication.
 * WebSocket connections for real-time I/O are handled separately in index.ts.
 */

import { Router, Request, Response, NextFunction } from "express";
import { getTerminalService } from "../services/terminal-service.js";

// Read env variables lazily to ensure dotenv has loaded them
function getTerminalPassword(): string | undefined {
  return process.env.TERMINAL_PASSWORD;
}

function getTerminalEnabledConfig(): boolean {
  return process.env.TERMINAL_ENABLED !== "false"; // Enabled by default
}

// In-memory session tokens (would use Redis in production)
const validTokens: Map<string, { createdAt: Date; expiresAt: Date }> = new Map();
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return `term-${Date.now()}-${Math.random().toString(36).substr(2, 15)}${Math.random().toString(36).substr(2, 15)}`;
}

/**
 * Clean up expired tokens
 */
function cleanupExpiredTokens(): void {
  const now = new Date();
  validTokens.forEach((data, token) => {
    if (data.expiresAt < now) {
      validTokens.delete(token);
    }
  });
}

// Clean up expired tokens every 5 minutes
setInterval(cleanupExpiredTokens, 5 * 60 * 1000);

/**
 * Validate a terminal session token
 */
export function validateTerminalToken(token: string | undefined): boolean {
  if (!token) return false;

  const tokenData = validTokens.get(token);
  if (!tokenData) return false;

  if (tokenData.expiresAt < new Date()) {
    validTokens.delete(token);
    return false;
  }

  return true;
}

/**
 * Check if terminal requires password
 */
export function isTerminalPasswordRequired(): boolean {
  return !!getTerminalPassword();
}

/**
 * Check if terminal is enabled
 */
export function isTerminalEnabled(): boolean {
  return getTerminalEnabledConfig();
}

/**
 * Terminal authentication middleware
 * Checks for valid session token if password is configured
 */
export function terminalAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Check if terminal is enabled
  if (!getTerminalEnabledConfig()) {
    res.status(403).json({
      success: false,
      error: "Terminal access is disabled",
    });
    return;
  }

  // If no password configured, allow all requests
  if (!getTerminalPassword()) {
    next();
    return;
  }

  // Check for session token
  const token =
    (req.headers["x-terminal-token"] as string) ||
    (req.query.token as string);

  if (!validateTerminalToken(token)) {
    res.status(401).json({
      success: false,
      error: "Terminal authentication required",
      passwordRequired: true,
    });
    return;
  }

  next();
}

export function createTerminalRoutes(): Router {
  const router = Router();
  const terminalService = getTerminalService();

  /**
   * GET /api/terminal/status
   * Get terminal status (enabled, password required, platform info)
   */
  router.get("/status", (_req, res) => {
    res.json({
      success: true,
      data: {
        enabled: getTerminalEnabledConfig(),
        passwordRequired: !!getTerminalPassword(),
        platform: terminalService.getPlatformInfo(),
      },
    });
  });

  /**
   * POST /api/terminal/auth
   * Authenticate with password to get a session token
   */
  router.post("/auth", (req, res) => {
    if (!getTerminalEnabledConfig()) {
      res.status(403).json({
        success: false,
        error: "Terminal access is disabled",
      });
      return;
    }

    const terminalPassword = getTerminalPassword();

    // If no password required, return immediate success
    if (!terminalPassword) {
      res.json({
        success: true,
        data: {
          authenticated: true,
          passwordRequired: false,
        },
      });
      return;
    }

    const { password } = req.body;

    if (!password || password !== terminalPassword) {
      res.status(401).json({
        success: false,
        error: "Invalid password",
      });
      return;
    }

    // Generate session token
    const token = generateToken();
    const now = new Date();
    validTokens.set(token, {
      createdAt: now,
      expiresAt: new Date(now.getTime() + TOKEN_EXPIRY_MS),
    });

    res.json({
      success: true,
      data: {
        authenticated: true,
        token,
        expiresIn: TOKEN_EXPIRY_MS,
      },
    });
  });

  /**
   * POST /api/terminal/logout
   * Invalidate a session token
   */
  router.post("/logout", (req, res) => {
    const token =
      (req.headers["x-terminal-token"] as string) ||
      req.body.token;

    if (token) {
      validTokens.delete(token);
    }

    res.json({
      success: true,
    });
  });

  // Apply terminal auth middleware to all routes below
  router.use(terminalAuthMiddleware);

  /**
   * GET /api/terminal/sessions
   * List all active terminal sessions
   */
  router.get("/sessions", (_req, res) => {
    const sessions = terminalService.getAllSessions();
    res.json({
      success: true,
      data: sessions,
    });
  });

  /**
   * POST /api/terminal/sessions
   * Create a new terminal session
   */
  router.post("/sessions", (req, res) => {
    try {
      const { cwd, cols, rows, shell } = req.body;

      const session = terminalService.createSession({
        cwd,
        cols: cols || 80,
        rows: rows || 24,
        shell,
      });

      res.json({
        success: true,
        data: {
          id: session.id,
          cwd: session.cwd,
          shell: session.shell,
          createdAt: session.createdAt,
        },
      });
    } catch (error) {
      console.error("[Terminal] Error creating session:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create terminal session",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * DELETE /api/terminal/sessions/:id
   * Kill a terminal session
   */
  router.delete("/sessions/:id", (req, res) => {
    const { id } = req.params;
    const killed = terminalService.killSession(id);

    if (!killed) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      });
      return;
    }

    res.json({
      success: true,
    });
  });

  /**
   * POST /api/terminal/sessions/:id/resize
   * Resize a terminal session
   */
  router.post("/sessions/:id/resize", (req, res) => {
    const { id } = req.params;
    const { cols, rows } = req.body;

    if (!cols || !rows) {
      res.status(400).json({
        success: false,
        error: "cols and rows are required",
      });
      return;
    }

    const resized = terminalService.resize(id, cols, rows);

    if (!resized) {
      res.status(404).json({
        success: false,
        error: "Session not found",
      });
      return;
    }

    res.json({
      success: true,
    });
  });

  return router;
}
