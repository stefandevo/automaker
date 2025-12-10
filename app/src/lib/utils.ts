import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { AgentModel } from "@/store/app-store"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Check if a model is a Codex/OpenAI model (doesn't support thinking)
 */
export function isCodexModel(model?: AgentModel | string): boolean {
  if (!model) return false;
  const codexModels: string[] = [
    "gpt-5.1-codex-max",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1",
    "o3",
    "o3-mini",
    "o4-mini",
    "gpt-4o",
    "gpt-4o-mini",
  ];
  return codexModels.includes(model);
}

/**
 * Determine if the current model supports extended thinking controls
 */
export function modelSupportsThinking(model?: AgentModel | string): boolean {
  if (!model) return true;
  return !isCodexModel(model);
}

/**
 * Get display name for a model
 */
export function getModelDisplayName(model: AgentModel | string): string {
  const displayNames: Record<string, string> = {
    haiku: "Claude Haiku",
    sonnet: "Claude Sonnet",
    opus: "Claude Opus",
    "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
    "gpt-5.1-codex": "GPT-5.1 Codex",
    "gpt-5.1-codex-mini": "GPT-5.1 Codex Mini",
    "gpt-5.1": "GPT-5.1",
    o3: "OpenAI O3",
    "o3-mini": "OpenAI O3 Mini",
    "o4-mini": "OpenAI O4 Mini",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
  };
  return displayNames[model] || model;
}
