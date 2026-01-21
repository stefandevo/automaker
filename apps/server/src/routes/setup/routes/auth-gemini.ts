/**
 * POST /auth-gemini endpoint - Connect Gemini CLI to the app
 */

import type { Request, Response } from 'express';
import { getErrorMessage, logError } from '../common.js';
import * as fs from 'fs';
import * as path from 'path';

const DISCONNECTED_MARKER_FILE = '.gemini-disconnected';

/**
 * Creates handler for POST /api/setup/auth-gemini
 * Removes the disconnection marker to allow Gemini CLI to be used
 */
export function createAuthGeminiHandler() {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const projectRoot = process.cwd();
      const automakerDir = path.join(projectRoot, '.automaker');
      const markerPath = path.join(automakerDir, DISCONNECTED_MARKER_FILE);

      // Remove the disconnection marker if it exists
      if (fs.existsSync(markerPath)) {
        fs.unlinkSync(markerPath);
      }

      res.json({
        success: true,
        message: 'Gemini CLI connected to app',
      });
    } catch (error) {
      logError(error, 'Auth Gemini failed');
      res.status(500).json({
        success: false,
        error: getErrorMessage(error),
      });
    }
  };
}
