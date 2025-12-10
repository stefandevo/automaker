---
name: Codex CLI OpenAI Model Support
overview: Extend the model support system to integrate OpenAI Codex CLI, enabling users to use OpenAI models (GPT-4o, o3, etc.) alongside existing Claude models. This includes CLI detection, model provider abstraction, execution wrapper, and UI updates.
todos:
  - id: model-provider-abstraction
    content: Create model provider abstraction layer with base interface and Claude/Codex implementations
    status: pending
  - id: codex-cli-detector
    content: Implement Codex CLI detector service to check installation status and version
    status: pending
  - id: codex-executor
    content: Create Codex CLI execution wrapper that spawns subprocess and parses JSON output
    status: pending
  - id: codex-config-manager
    content: Implement Codex TOML configuration manager for model provider setup
    status: pending
  - id: model-registry
    content: Create centralized model registry with provider mappings and metadata
    status: pending
  - id: update-feature-executor
    content: Refactor feature-executor.js to use model provider abstraction instead of direct SDK calls
    status: pending
  - id: update-agent-service
    content: Update agent-service.js to support configurable model selection via provider abstraction
    status: pending
  - id: message-converter
    content: Create message format converter to translate Codex JSONL output to Claude SDK format
    status: pending
  - id: update-ui-types
    content: Extend TypeScript types in app-store.ts to include OpenAI models and provider metadata
    status: pending
  - id: update-board-view
    content: Expand model selection dropdown in board-view.tsx to include OpenAI models with provider grouping
    status: pending
  - id: update-settings-view
    content: Add OpenAI API key input, Codex CLI status check, and test connection button to settings-view.tsx
    status: pending
  - id: openai-test-api
    content: Create OpenAI API test endpoint at app/src/app/api/openai/test/route.ts
    status: pending
  - id: ipc-handlers
    content: Add IPC handlers in main.js for model management (checkCodexCli, getAvailableModels, testOpenAI)
    status: pending
  - id: preload-api
    content: Update preload.js and electron.d.ts to expose new IPC methods to renderer process
    status: pending
  - id: env-manager
    content: Create environment variable manager for centralized API key and config handling
    status: pending
  - id: error-handling
    content: Implement provider fallback logic and user-friendly error messages for missing CLI/API keys
    status: pending
---

# Codex CLI OpenAI Model Support Implementation Plan

## Overview

Extend Automaker's model support to integrate OpenAI Codex CLI, allowing users to use the latest GPT-5.1 Codex models (`gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1`) alongside existing Claude models. Codex CLI defaults to `gpt-5.1-codex-max` and uses ChatGPT Enterprise authentication (no API key required). The implementation will follow the existing Claude CLI pattern but add abstraction for multiple model providers.

## Current Architecture Analysis

### Model Usage Points

1. **Feature Executor** (`app/electron/services/feature-executor.js`):

   - Uses `MODEL_MAP` with hardcoded Claude models (haiku, sonnet, opus)
   - Calls `@anthropic-ai/claude-agent-sdk` `query()` function
   - Model selection via `getModelString(feature)` method

2. **Agent Service** (`app/electron/agent-service.js`):

   - Hardcoded model: `"claude-opus-4-5-20251101"`
   - Uses Claude Agent SDK directly

3. **API Route** (`app/src/app/api/chat/route.ts`):

   - Hardcoded model: `"claude-opus-4-5-20251101"`
   - Uses Claude Agent SDK

4. **Project Analyzer** (`app/electron/services/project-analyzer.js`):

   - Hardcoded model: `"claude-sonnet-4-20250514"`

5. **UI Components**:

   - `board-view.tsx`: Model dropdown (haiku/sonnet/opus)
   - `app-store.ts`: `AgentModel` type limited to Claude models

### Authentication

- Claude: Uses `CLAUDE_CODE_OAUTH_TOKEN` environment variable
- Codex: Uses `OPENAI_API_KEY` environment variable (per Codex docs)

## Implementation Strategy

### Phase 1: Model Provider Abstraction Layer

#### 1.1 Create Model Provider Interface

**File**: `app/electron/services/model-provider.js`

- Abstract base class/interface for model providers
- Methods: `executeQuery()`, `detectInstallation()`, `getAvailableModels()`, `validateConfig()`
- Implementations:
  - `ClaudeProvider` (wraps existing SDK usage)
  - `CodexProvider` (new, wraps Codex CLI execution)

#### 1.2 Create Codex CLI Detector

**File**: `app/electron/services/codex-cli-detector.js`

- Similar to `claude-cli-detector.js`
- Check for `codex` command in PATH
- Check for npm global installation: `npm list -g @openai/codex`
- Check for Homebrew installation on macOS
- Return: `{ installed: boolean, path: string, version: string, method: 'cli'|'npm'|'brew'|'none' }`

#### 1.3 Create Codex Provider Implementation

**File**: `app/electron/services/codex-provider.js`

- Extends model provider interface
- Executes Codex CLI via `child_process.spawn()` or `execSync()`
- Handles JSON output parsing (`codex exec --json`)
- Manages TOML configuration file creation/updates
- Supports latest GPT-5.1 Codex models:
  - `gpt-5.1-codex-max` (default, latest flagship for deep and fast reasoning)
  - `gpt-5.1-codex` (optimized for codex)
  - `gpt-5.1-codex-mini` (cheaper, faster, less capable)
  - `gpt-5.1` (broad world knowledge with strong general reasoning)
- Uses ChatGPT Enterprise authentication (no API key required for these models)
- Note: Legacy models (GPT-4o, o3, o1, etc.) are not supported - Codex CLI focuses on GPT-5.1 Codex family only

### Phase 2: Model Configuration System

#### 2.1 Extended Model Registry

**File**: `app/electron/services/model-registry.js`

- Centralized model configuration
- Model definitions with provider mapping:
  ```javascript
  {
    id: "claude-opus",
    name: "Claude Opus 4.5",
    provider: "claude",
    modelString: "claude-opus-4-5-20251101",
    ...
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "codex",
    modelString: "gpt-4o",
    requiresApiKey: "OPENAI_API_KEY",
    ...
  }
  ```

- Model categories: `claude`, `openai`, `azure`, `custom`

#### 2.2 Codex Configuration Manager

**File**: `app/electron/services/codex-config-manager.js`

- Manages Codex TOML config file (typically `~/.config/codex/config.toml` or project-specific)
- Creates/updates model provider configurations:
  ```toml
  [model_providers.openai-chat-completions]
  name = "OpenAI using Chat Completions"
  base_url = "https://api.openai.com/v1"
  env_key = "OPENAI_API_KEY"
  wire_api = "chat"
  
  [profiles.gpt4o]
  model = "gpt-4o"
  model_provider = "openai-chat-completions"
  ```

- Profile management for different use cases
- Validates configuration before execution

### Phase 3: Execution Integration

#### 3.1 Update Feature Executor

**File**: `app/electron/services/feature-executor.js`

- Replace direct SDK calls with model provider abstraction
- Update `getModelString()` to return model ID instead of string
- Add `getModelProvider(modelId)` method
- Modify `implementFeature()` to:
  - Get provider for selected model
  - Use provider's `executeQuery()` method
  - Handle different response formats (SDK vs CLI JSON)

#### 3.2 Update Agent Service

**File**: `app/electron/agent-service.js`

- Replace hardcoded model with configurable model selection
- Use model provider abstraction
- Support model selection per session

#### 3.3 Update Project Analyzer

**File**: `app/electron/services/project-analyzer.js`

- Use model provider abstraction
- Make model configurable (currently hardcoded to sonnet)

#### 3.4 Update API Route

**File**: `app/src/app/api/chat/route.ts`

- Support model selection from request
- Use model provider abstraction (if running in Electron context)
- Fallback to Claude SDK for web-only usage

### Phase 4: Codex CLI Execution Wrapper

#### 4.1 Codex Executor

**File**: `app/electron/services/codex-executor.js`

- Wraps `codex exec` command execution
- Handles subprocess spawning with proper environment variables
- Parses JSON output (JSONL format from `--json` flag)
- Converts Codex output format to match Claude SDK message format
- Handles streaming responses
- Error handling and timeout management

#### 4.2 Message Format Conversion

**File**: `app/electron/services/message-converter.js`

- Converts Codex JSONL output to Claude SDK message format
- Maps Codex events:
  - `thread.started` → session initialization
  - `item.completed` (reasoning) → thinking output
  - `item.completed` (command_execution) → tool use
  - `item.completed` (agent_message) → assistant message
- Maintains compatibility with existing UI components

### Phase 5: UI Updates

#### 5.1 Update Type Definitions

**File**: `app/src/store/app-store.ts`

- Extend `AgentModel` type to include OpenAI models:
  ```typescript
  export type AgentModel = 
    | "opus" | "sonnet" | "haiku"  // Claude
    | "gpt-4o" | "gpt-4o-mini" | "gpt-3.5-turbo" | "o3" | "o1";  // OpenAI
  ```

- Add `modelProvider` field to `Feature` interface
- Add provider metadata to model selection

#### 5.2 Update Board View

**File**: `app/src/components/views/board-view.tsx`

- Expand model dropdown to include OpenAI models
- Group models by provider (Claude / OpenAI)
- Show provider badges/icons
- Display model availability based on CLI detection
- Add tooltips showing model capabilities

#### 5.3 Update Settings View

**File**: `app/src/components/views/settings-view.tsx`

- Add OpenAI API key input field (similar to Anthropic key)
- Add Codex CLI status check (similar to Claude CLI check)
- Show installation instructions if Codex CLI not detected
- Add test connection button for OpenAI API
- Display detected Codex CLI version/path

#### 5.4 Create API Test Route

**File**: `app/src/app/api/openai/test/route.ts`

- Similar to `app/src/app/api/claude/test/route.ts`
- Test OpenAI API connection
- Validate API key format
- Return connection status

### Phase 6: Configuration & Environment

#### 6.1 Environment Variable Management

**File**: `app/electron/services/env-manager.js`

- Centralized environment variable handling
- Loads from `.env` file and system environment
- Validates required variables per provider
- Provides fallback mechanisms

#### 6.2 IPC Handlers for Model Management

**File**: `app/electron/main.js`

- Add IPC handlers:
  - `model:checkCodexCli` - Check Codex CLI installation
  - `model:getAvailableModels` - List available models per provider
  - `model:testOpenAI` - Test OpenAI API connection
  - `model:updateCodexConfig` - Update Codex TOML config

#### 6.3 Preload API Updates

**File**: `app/electron/preload.js`

- Expose new IPC methods to renderer
- Add TypeScript definitions in `app/src/types/electron.d.ts`

### Phase 7: Error Handling & Fallbacks

#### 7.1 Provider Fallback Logic

- If Codex CLI not available, fallback to Claude
- If OpenAI API key missing, show clear error messages
- Graceful degradation when provider unavailable

#### 7.2 Error Messages

- User-friendly error messages for missing CLI
- Installation instructions per platform
- API key validation errors
- Model availability warnings

## File Structure Summary

### New Files

```
app/electron/services/
  ├── model-provider.js          # Abstract provider interface
  ├── claude-provider.js         # Claude SDK wrapper
  ├── codex-provider.js          # Codex CLI wrapper
  ├── codex-cli-detector.js      # Codex CLI detection
  ├── codex-executor.js          # Codex CLI execution wrapper
  ├── codex-config-manager.js   # TOML config management
  ├── model-registry.js          # Centralized model definitions
  ├── message-converter.js       # Format conversion utilities
  └── env-manager.js             # Environment variable management

app/src/app/api/openai/
  └── test/route.ts              # OpenAI API test endpoint
```

### Modified Files

```
app/electron/services/
  ├── feature-executor.js        # Use model provider abstraction
  ├── agent-service.js           # Support multiple providers
  └── project-analyzer.js        # Configurable model selection

app/electron/
  ├── main.js                    # Add IPC handlers
  └── preload.js                 # Expose new APIs

app/src/
  ├── store/app-store.ts         # Extended model types
  ├── components/views/
  │   ├── board-view.tsx         # Expanded model selection UI
  │   └── settings-view.tsx      # OpenAI API key & Codex CLI status
  └── types/electron.d.ts        # Updated IPC type definitions
```

## Implementation Details

### Codex CLI Execution Pattern

```javascript
// Example execution flow
const codexExecutor = require('./codex-executor');
const result = await codexExecutor.execute({
  prompt: "Implement feature X",
  model: "gpt-4o",
  cwd: projectPath,
  systemPrompt: "...",
  maxTurns: 20,
  allowedTools: ["Read", "Write", "Edit", "Bash"],
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
});
```

### Model Provider Interface

```javascript
class ModelProvider {
  async executeQuery(options) {
    // Returns async generator of messages
  }
  
  async detectInstallation() {
    // Returns installation status
  }
  
  getAvailableModels() {
    // Returns list of supported models
  }
  
  validateConfig() {
    // Validates provider configuration
  }
}
```

### Configuration File Location

- User config: `~/.config/codex/config.toml` (or platform equivalent)
- Project config: `.codex/config.toml` (optional, project-specific)
- Fallback: In-memory config passed via CLI args

## Testing Considerations

1. **CLI Detection**: Test on macOS, Linux, Windows
2. **Model Execution**: Test with different OpenAI models
3. **Error Handling**: Test missing CLI, invalid API keys, network errors
4. **Format Conversion**: Verify message format compatibility
5. **Concurrent Execution**: Test multiple features with different providers
6. **Fallback Logic**: Test provider fallback scenarios

## Documentation Updates

1. Update README with Codex CLI installation instructions:

   - `npm install -g @openai/codex@latest` or `brew install codex`
   - ChatGPT Enterprise authentication (no API key needed)
   - API-based authentication for older models

2. Add model selection guide:

   - GPT-5.1 Codex Max (default, best for coding)
   - o3/o4-mini with reasoning efforts
   - GPT-5.1/GPT-5 with verbosity control

3. Document reasoning effort and verbosity settings
4. Add troubleshooting section for common issues
5. Document model list discovery via MCP interface

## Migration Path

1. Implement provider abstraction alongside existing code
2. Add Codex support without breaking existing Claude functionality
3. Gradually migrate services to use abstraction layer
4. Maintain backward compatibility during transition
5. Remove hardcoded models after full migration