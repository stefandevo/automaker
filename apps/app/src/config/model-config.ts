/**
 * Model Configuration - Centralized model settings for the app
 *
 * Models can be overridden via environment variables:
 * - AUTOMAKER_MODEL_CHAT: Model for chat interactions
 * - AUTOMAKER_MODEL_DEFAULT: Fallback model for all operations
 */

/**
 * Claude model aliases for convenience
 */
export const CLAUDE_MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-5-20251101",
} as const;

/**
 * Default models per use case
 */
export const DEFAULT_MODELS = {
  chat: "claude-opus-4-5-20251101",
  default: "claude-opus-4-5-20251101",
} as const;

/**
 * Resolve a model alias to a full model string
 */
export function resolveModelString(
  modelKey?: string,
  defaultModel: string = DEFAULT_MODELS.default
): string {
  if (!modelKey) {
    return defaultModel;
  }

  // Full Claude model string - pass through
  if (modelKey.includes("claude-")) {
    return modelKey;
  }

  // Check alias map
  const resolved = CLAUDE_MODEL_MAP[modelKey];
  if (resolved) {
    return resolved;
  }

  // Unknown key - use default
  return defaultModel;
}

/**
 * Get the model for chat operations
 *
 * Priority:
 * 1. Explicit model parameter
 * 2. AUTOMAKER_MODEL_CHAT environment variable
 * 3. AUTOMAKER_MODEL_DEFAULT environment variable
 * 4. Default chat model
 */
export function getChatModel(explicitModel?: string): string {
  if (explicitModel) {
    return resolveModelString(explicitModel);
  }

  const envModel =
    process.env.AUTOMAKER_MODEL_CHAT || process.env.AUTOMAKER_MODEL_DEFAULT;

  if (envModel) {
    return resolveModelString(envModel);
  }

  return DEFAULT_MODELS.chat;
}

/**
 * Default allowed tools for chat interactions
 */
export const CHAT_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
] as const;

/**
 * Default max turns for chat
 */
export const CHAT_MAX_TURNS = 1000;

