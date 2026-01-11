/**
 * POST /worktree/generate-commit-message endpoint - Generate an AI commit message from git diff
 *
 * Uses Claude Haiku to generate a concise, conventional commit message from git changes.
 */

import type { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createLogger } from '@automaker/utils';
import { CLAUDE_MODEL_MAP } from '@automaker/model-resolver';
import { getErrorMessage, logError } from '../common.js';

const logger = createLogger('GenerateCommitMessage');
const execAsync = promisify(exec);

interface GenerateCommitMessageRequestBody {
  worktreePath: string;
}

interface GenerateCommitMessageSuccessResponse {
  success: true;
  message: string;
}

interface GenerateCommitMessageErrorResponse {
  success: false;
  error: string;
}

const SYSTEM_PROMPT = `You are a git commit message generator. Your task is to create a clear, concise commit message based on the git diff provided.

Rules:
- Output ONLY the commit message, nothing else
- First line should be a short summary (50 chars or less) in imperative mood
- Start with a conventional commit type if appropriate (feat:, fix:, refactor:, docs:, etc.)
- Keep it concise and descriptive
- Focus on WHAT changed and WHY (if clear from the diff), not HOW
- No quotes, backticks, or extra formatting
- If there are multiple changes, provide a brief summary on the first line

Examples:
- feat: Add dark mode toggle to settings
- fix: Resolve login validation edge case
- refactor: Extract user authentication logic
- docs: Update installation instructions`;

async function extractTextFromStream(
  stream: AsyncIterable<{
    type: string;
    subtype?: string;
    result?: string;
    message?: {
      content?: Array<{ type: string; text?: string }>;
    };
  }>
): Promise<string> {
  let responseText = '';

  for await (const msg of stream) {
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          responseText += block.text;
        }
      }
    } else if (msg.type === 'result' && msg.subtype === 'success') {
      responseText = msg.result || responseText;
    }
  }

  return responseText;
}

export function createGenerateCommitMessageHandler(): (
  req: Request,
  res: Response
) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { worktreePath } = req.body as GenerateCommitMessageRequestBody;

      if (!worktreePath || typeof worktreePath !== 'string') {
        const response: GenerateCommitMessageErrorResponse = {
          success: false,
          error: 'worktreePath is required and must be a string',
        };
        res.status(400).json(response);
        return;
      }

      logger.info(`Generating commit message for worktree: ${worktreePath}`);

      // Get git diff of staged and unstaged changes
      let diff = '';
      try {
        // First try to get staged changes
        const { stdout: stagedDiff } = await execAsync('git diff --cached', {
          cwd: worktreePath,
          maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        });

        // If no staged changes, get unstaged changes
        if (!stagedDiff.trim()) {
          const { stdout: unstagedDiff } = await execAsync('git diff', {
            cwd: worktreePath,
            maxBuffer: 1024 * 1024 * 5, // 5MB buffer
          });
          diff = unstagedDiff;
        } else {
          diff = stagedDiff;
        }
      } catch (error) {
        logger.error('Failed to get git diff:', error);
        const response: GenerateCommitMessageErrorResponse = {
          success: false,
          error: 'Failed to get git changes',
        };
        res.status(500).json(response);
        return;
      }

      if (!diff.trim()) {
        const response: GenerateCommitMessageErrorResponse = {
          success: false,
          error: 'No changes to commit',
        };
        res.status(400).json(response);
        return;
      }

      // Truncate diff if too long (keep first 10000 characters to avoid token limits)
      const truncatedDiff =
        diff.length > 10000 ? diff.substring(0, 10000) + '\n\n[... diff truncated ...]' : diff;

      const userPrompt = `Generate a commit message for these changes:\n\n\`\`\`diff\n${truncatedDiff}\n\`\`\``;

      const stream = query({
        prompt: userPrompt,
        options: {
          model: CLAUDE_MODEL_MAP.haiku,
          systemPrompt: SYSTEM_PROMPT,
          maxTurns: 1,
          allowedTools: [],
          permissionMode: 'default',
        },
      });

      const message = await extractTextFromStream(stream);

      if (!message || message.trim().length === 0) {
        logger.warn('Received empty response from Claude');
        const response: GenerateCommitMessageErrorResponse = {
          success: false,
          error: 'Failed to generate commit message - empty response',
        };
        res.status(500).json(response);
        return;
      }

      logger.info(`Generated commit message: ${message.trim().substring(0, 100)}...`);

      const response: GenerateCommitMessageSuccessResponse = {
        success: true,
        message: message.trim(),
      };
      res.json(response);
    } catch (error) {
      logError(error, 'Generate commit message failed');
      const response: GenerateCommitMessageErrorResponse = {
        success: false,
        error: getErrorMessage(error),
      };
      res.status(500).json(response);
    }
  };
}
