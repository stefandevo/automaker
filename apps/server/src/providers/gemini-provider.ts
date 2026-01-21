/**
 * Gemini Provider - Executes queries using the Gemini CLI
 *
 * Extends CliProvider with Gemini-specific:
 * - Event normalization for Gemini's JSONL streaming format
 * - Google account and API key authentication support
 * - Thinking level configuration
 *
 * Based on https://github.com/google-gemini/gemini-cli
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CliProvider,
  type CliSpawnConfig,
  type CliErrorInfo,
} from './cli-provider.js';
import type {
  ProviderConfig,
  ExecuteOptions,
  ProviderMessage,
  InstallationStatus,
  ModelDefinition,
  ContentBlock,
} from './types.js';
import { validateBareModelId } from '@automaker/types';
import { GEMINI_MODEL_MAP, type GeminiAuthStatus } from '@automaker/types';
import { createLogger, isAbortError } from '@automaker/utils';
import { spawnJSONLProcess } from '@automaker/platform';

// Create logger for this module
const logger = createLogger('GeminiProvider');

// =============================================================================
// Gemini Stream Event Types
// =============================================================================

/**
 * Base event structure from Gemini CLI --output-format stream-json
 */
interface GeminiStreamEvent {
  type: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'result' | 'error';
  subtype?: string;
  session_id?: string;
}

interface GeminiSystemEvent extends GeminiStreamEvent {
  type: 'system';
  subtype: 'init' | 'config';
  session_id: string;
}

interface GeminiAssistantEvent extends GeminiStreamEvent {
  type: 'assistant';
  message: {
    content: Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }>;
  };
  session_id: string;
}

interface GeminiToolCallEvent extends GeminiStreamEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  call_id: string;
  session_id: string;
  tool_call: {
    function?: {
      name: string;
      arguments: string;
    };
    result?: unknown;
  };
}

interface GeminiResultEvent extends GeminiStreamEvent {
  type: 'result';
  is_error?: boolean;
  result?: string;
  error?: string;
  session_id: string;
}

// =============================================================================
// Error Codes
// =============================================================================

export enum GeminiErrorCode {
  NOT_INSTALLED = 'GEMINI_NOT_INSTALLED',
  NOT_AUTHENTICATED = 'GEMINI_NOT_AUTHENTICATED',
  RATE_LIMITED = 'GEMINI_RATE_LIMITED',
  MODEL_UNAVAILABLE = 'GEMINI_MODEL_UNAVAILABLE',
  NETWORK_ERROR = 'GEMINI_NETWORK_ERROR',
  PROCESS_CRASHED = 'GEMINI_PROCESS_CRASHED',
  TIMEOUT = 'GEMINI_TIMEOUT',
  UNKNOWN = 'GEMINI_UNKNOWN_ERROR',
}

export interface GeminiError extends Error {
  code: GeminiErrorCode;
  recoverable: boolean;
  suggestion?: string;
}

/**
 * GeminiProvider - Integrates Gemini CLI as an AI provider
 *
 * Features:
 * - Google account OAuth login support
 * - API key authentication (GEMINI_API_KEY)
 * - Vertex AI support
 * - Thinking level configuration
 * - Streaming JSON output
 */
export class GeminiProvider extends CliProvider {
  constructor(config: ProviderConfig = {}) {
    super(config);
    // Trigger CLI detection on construction
    this.ensureCliDetected();
  }

  // ==========================================================================
  // CliProvider Abstract Method Implementations
  // ==========================================================================

  getName(): string {
    return 'gemini';
  }

  getCliName(): string {
    return 'gemini';
  }

  getSpawnConfig(): CliSpawnConfig {
    return {
      windowsStrategy: 'npx', // Gemini CLI can be run via npx
      npxPackage: '@anthropic-ai/gemini-cli', // Placeholder - actual package name TBD
      commonPaths: {
        linux: [
          path.join(os.homedir(), '.local/bin/gemini'),
          '/usr/local/bin/gemini',
          path.join(os.homedir(), '.npm-global/bin/gemini'),
        ],
        darwin: [
          path.join(os.homedir(), '.local/bin/gemini'),
          '/usr/local/bin/gemini',
          '/opt/homebrew/bin/gemini',
          path.join(os.homedir(), '.npm-global/bin/gemini'),
        ],
        win32: [
          path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'gemini.cmd'),
          path.join(os.homedir(), '.npm-global', 'gemini.cmd'),
        ],
      },
    };
  }

  /**
   * Extract prompt text from ExecuteOptions
   */
  private extractPromptText(options: ExecuteOptions): string {
    if (typeof options.prompt === 'string') {
      return options.prompt;
    } else if (Array.isArray(options.prompt)) {
      return options.prompt
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('\n');
    } else {
      throw new Error('Invalid prompt format');
    }
  }

  buildCliArgs(options: ExecuteOptions): string[] {
    const model = options.model || 'gemini-2.5-flash';
    const cliArgs: string[] = [];

    // Non-interactive mode with prompt flag
    cliArgs.push('-p');

    // Streaming JSON output format
    cliArgs.push('--output-format', 'stream-json');

    // Model selection (if not default)
    if (model && model !== 'auto') {
      cliArgs.push('--model', model);
    }

    // Thinking level configuration (maps to Gemini's thinking budget)
    if (options.thinkingLevel && options.thinkingLevel !== 'none') {
      // Map our thinking levels to Gemini's
      const geminiThinking = this.mapThinkingLevel(options.thinkingLevel);
      if (geminiThinking !== 'off') {
        cliArgs.push('--thinking-level', geminiThinking.toUpperCase());
      }
    }

    // Use '-' to read prompt from stdin
    cliArgs.push('-');

    return cliArgs;
  }

  /**
   * Map AutoMaker thinking levels to Gemini thinking levels
   */
  private mapThinkingLevel(level: string): 'off' | 'low' | 'medium' | 'high' {
    switch (level) {
      case 'none':
        return 'off';
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
      case 'ultrathink':
        return 'high';
      default:
        return 'off';
    }
  }

  /**
   * Convert Gemini event to AutoMaker ProviderMessage format
   */
  normalizeEvent(event: unknown): ProviderMessage | null {
    const geminiEvent = event as GeminiStreamEvent;

    switch (geminiEvent.type) {
      case 'system':
        // System init - capture session but don't yield
        return null;

      case 'user':
        // User message - already handled by caller
        return null;

      case 'assistant': {
        const assistantEvent = geminiEvent as GeminiAssistantEvent;
        const contentBlocks: ContentBlock[] = [];

        for (const c of assistantEvent.message.content) {
          if (c.type === 'text' && 'text' in c) {
            contentBlocks.push({ type: 'text', text: c.text });
          } else if (c.type === 'thinking' && 'thinking' in c) {
            contentBlocks.push({ type: 'thinking', thinking: c.thinking });
          }
        }

        return {
          type: 'assistant',
          session_id: assistantEvent.session_id,
          message: {
            role: 'assistant',
            content: contentBlocks,
          },
        };
      }

      case 'tool_call': {
        const toolEvent = geminiEvent as GeminiToolCallEvent;
        const toolCall = toolEvent.tool_call;

        if (!toolCall.function) {
          return null;
        }

        let toolInput: unknown;
        try {
          toolInput = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          toolInput = { raw: toolCall.function.arguments };
        }

        if (toolEvent.subtype === 'started') {
          return {
            type: 'assistant',
            session_id: toolEvent.session_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: toolCall.function.name,
                  tool_use_id: toolEvent.call_id,
                  input: toolInput,
                },
              ],
            },
          };
        }

        if (toolEvent.subtype === 'completed') {
          return {
            type: 'assistant',
            session_id: toolEvent.session_id,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  name: toolCall.function.name,
                  tool_use_id: toolEvent.call_id,
                  input: toolInput,
                },
                {
                  type: 'tool_result',
                  tool_use_id: toolEvent.call_id,
                  content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
                },
              ],
            },
          };
        }

        return null;
      }

      case 'result': {
        const resultEvent = geminiEvent as GeminiResultEvent;

        if (resultEvent.is_error) {
          return {
            type: 'error',
            session_id: resultEvent.session_id,
            error: resultEvent.error || resultEvent.result || 'Unknown error',
          };
        }

        return {
          type: 'result',
          subtype: 'success',
          session_id: resultEvent.session_id,
          result: resultEvent.result,
        };
      }

      case 'error': {
        const errorEvent = geminiEvent as GeminiResultEvent;
        return {
          type: 'error',
          session_id: errorEvent.session_id,
          error: errorEvent.error || 'Unknown error',
        };
      }

      default:
        return null;
    }
  }

  // ==========================================================================
  // CliProvider Overrides
  // ==========================================================================

  /**
   * Override error mapping for Gemini-specific error codes
   */
  protected mapError(stderr: string, exitCode: number | null): CliErrorInfo {
    const lower = stderr.toLowerCase();

    if (
      lower.includes('not authenticated') ||
      lower.includes('please log in') ||
      lower.includes('unauthorized') ||
      lower.includes('login required')
    ) {
      return {
        code: GeminiErrorCode.NOT_AUTHENTICATED,
        message: 'Gemini CLI is not authenticated',
        recoverable: true,
        suggestion: 'Run "gemini" and choose a login method, or set GEMINI_API_KEY',
      };
    }

    if (
      lower.includes('rate limit') ||
      lower.includes('too many requests') ||
      lower.includes('429') ||
      lower.includes('quota exceeded')
    ) {
      return {
        code: GeminiErrorCode.RATE_LIMITED,
        message: 'Gemini API rate limit exceeded',
        recoverable: true,
        suggestion: 'Wait a few minutes and try again. Free tier: 60 req/min, 1000 req/day',
      };
    }

    if (
      lower.includes('model not available') ||
      lower.includes('invalid model') ||
      lower.includes('unknown model')
    ) {
      return {
        code: GeminiErrorCode.MODEL_UNAVAILABLE,
        message: 'Requested model is not available',
        recoverable: true,
        suggestion: 'Try using "gemini-2.5-flash" or select a different model',
      };
    }

    if (
      lower.includes('network') ||
      lower.includes('connection') ||
      lower.includes('econnrefused') ||
      lower.includes('timeout')
    ) {
      return {
        code: GeminiErrorCode.NETWORK_ERROR,
        message: 'Network connection error',
        recoverable: true,
        suggestion: 'Check your internet connection and try again',
      };
    }

    if (exitCode === 137 || lower.includes('killed') || lower.includes('sigterm')) {
      return {
        code: GeminiErrorCode.PROCESS_CRASHED,
        message: 'Gemini CLI process was terminated',
        recoverable: true,
        suggestion: 'The process may have run out of memory. Try a simpler task.',
      };
    }

    return {
      code: GeminiErrorCode.UNKNOWN,
      message: stderr || `Gemini CLI exited with code ${exitCode}`,
      recoverable: false,
    };
  }

  /**
   * Override install instructions for Gemini-specific guidance
   */
  protected getInstallInstructions(): string {
    return 'Install with: npm install -g @anthropic-ai/gemini-cli (or visit https://github.com/google-gemini/gemini-cli)';
  }

  /**
   * Execute a prompt using Gemini CLI with streaming
   */
  async *executeQuery(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    this.ensureCliDetected();

    // Validate that model doesn't have a provider prefix
    validateBareModelId(options.model, 'GeminiProvider');

    if (!this.cliPath) {
      throw this.createError(
        GeminiErrorCode.NOT_INSTALLED,
        'Gemini CLI is not installed',
        true,
        this.getInstallInstructions()
      );
    }

    // Extract prompt text to pass via stdin
    const promptText = this.extractPromptText(options);

    const cliArgs = this.buildCliArgs(options);
    const subprocessOptions = this.buildSubprocessOptions(options, cliArgs);

    // Pass prompt via stdin
    subprocessOptions.stdinData = promptText;

    let sessionId: string | undefined;

    logger.debug(`GeminiProvider.executeQuery called with model: "${options.model}"`);

    try {
      for await (const rawEvent of spawnJSONLProcess(subprocessOptions)) {
        const event = rawEvent as GeminiStreamEvent;

        // Capture session ID from system init
        if (event.type === 'system' && (event as GeminiSystemEvent).subtype === 'init') {
          sessionId = event.session_id;
          logger.debug(`Session started: ${sessionId}`);
        }

        // Normalize and yield the event
        const normalized = this.normalizeEvent(event);
        if (normalized) {
          if (!normalized.session_id && sessionId) {
            normalized.session_id = sessionId;
          }
          yield normalized;
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        logger.debug('Query aborted');
        return;
      }

      // Map CLI errors to GeminiError
      if (error instanceof Error && 'stderr' in error) {
        const errorInfo = this.mapError(
          (error as { stderr?: string }).stderr || error.message,
          (error as { exitCode?: number | null }).exitCode ?? null
        );
        throw this.createError(
          errorInfo.code as GeminiErrorCode,
          errorInfo.message,
          errorInfo.recoverable,
          errorInfo.suggestion
        );
      }
      throw error;
    }
  }

  // ==========================================================================
  // Gemini-Specific Methods
  // ==========================================================================

  /**
   * Create a GeminiError with details
   */
  private createError(
    code: GeminiErrorCode,
    message: string,
    recoverable: boolean = false,
    suggestion?: string
  ): GeminiError {
    const error = new Error(message) as GeminiError;
    error.code = code;
    error.recoverable = recoverable;
    error.suggestion = suggestion;
    error.name = 'GeminiError';
    return error;
  }

  /**
   * Get Gemini CLI version
   */
  async getVersion(): Promise<string | null> {
    this.ensureCliDetected();
    if (!this.cliPath) return null;

    try {
      const result = execSync(`"${this.cliPath}" --version`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
      }).trim();
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Check authentication status
   */
  async checkAuth(): Promise<GeminiAuthStatus> {
    this.ensureCliDetected();
    if (!this.cliPath) {
      return { authenticated: false, method: 'none' };
    }

    // Check for API key in environment
    if (process.env.GEMINI_API_KEY) {
      return { authenticated: true, method: 'api_key', hasApiKey: true };
    }

    // Check for Google Cloud credentials (Vertex AI)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT) {
      return { authenticated: true, method: 'vertex_ai' };
    }

    // Check for Gemini credentials file (~/.gemini/settings.json)
    const geminiConfigDir = path.join(os.homedir(), '.gemini');
    const settingsPath = path.join(geminiConfigDir, 'settings.json');

    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, 'utf8');
        const settings = JSON.parse(content);
        // Check if there's auth configuration
        if (settings.auth || settings.credentials || settings.apiKey) {
          return {
            authenticated: true,
            method: 'google_login',
            hasCredentialsFile: true,
          };
        }
      } catch {
        // Invalid settings file
      }
    }

    // Try running the CLI to check if authenticated
    try {
      // A simple query to check auth - this will fail if not authenticated
      execSync(`"${this.cliPath}" --version`, {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env },
      });
      // If version works, assume some form of auth is configured
      return { authenticated: true, method: 'google_login' };
    } catch (error: unknown) {
      const execError = error as { stderr?: string };
      if (
        execError.stderr?.includes('not authenticated') ||
        execError.stderr?.includes('login')
      ) {
        return { authenticated: false, method: 'none' };
      }
    }

    return { authenticated: false, method: 'none' };
  }

  /**
   * Detect installation status (required by BaseProvider)
   */
  async detectInstallation(): Promise<InstallationStatus> {
    const installed = await this.isInstalled();
    const version = installed ? await this.getVersion() : undefined;
    const auth = await this.checkAuth();

    return {
      installed,
      version: version || undefined,
      path: this.cliPath || undefined,
      method: 'cli',
      hasApiKey: !!process.env.GEMINI_API_KEY,
      authenticated: auth.authenticated,
    };
  }

  /**
   * Get the detected CLI path (public accessor for status endpoints)
   */
  getCliPath(): string | null {
    this.ensureCliDetected();
    return this.cliPath;
  }

  /**
   * Get available Gemini models
   */
  getAvailableModels(): ModelDefinition[] {
    return Object.entries(GEMINI_MODEL_MAP).map(([id, config]) => ({
      id: `gemini-${id}`,
      name: config.label,
      modelString: id,
      provider: 'gemini',
      description: config.description,
      supportsTools: true,
      supportsVision: config.supportsVision,
      contextWindow: config.contextWindow,
    }));
  }

  /**
   * Check if a feature is supported
   */
  supportsFeature(feature: string): boolean {
    const supported = ['tools', 'text', 'streaming', 'vision', 'thinking'];
    return supported.includes(feature);
  }
}
