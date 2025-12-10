const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Codex CLI Detector - Checks if OpenAI Codex CLI is installed
 *
 * Codex CLI is OpenAI's agent CLI tool that allows users to use
 * GPT-5.1 Codex models (gpt-5.1-codex-max, gpt-5.1-codex, etc.)
 * for code generation and agentic tasks.
 */
class CodexCliDetector {
  /**
   * Check if Codex CLI is installed and accessible
   * @returns {Object} { installed: boolean, path: string|null, version: string|null, method: 'cli'|'npm'|'brew'|'none' }
   */
  static detectCodexInstallation() {
    try {
      // Method 1: Check if 'codex' command is in PATH
      try {
        const codexPath = execSync('which codex 2>/dev/null', { encoding: 'utf-8' }).trim();
        if (codexPath) {
          const version = this.getCodexVersion(codexPath);
          return {
            installed: true,
            path: codexPath,
            version: version,
            method: 'cli'
          };
        }
      } catch (error) {
        // CLI not in PATH, continue checking other methods
      }

      // Method 2: Check for npm global installation
      try {
        const npmListOutput = execSync('npm list -g @openai/codex --depth=0 2>/dev/null', { encoding: 'utf-8' });
        if (npmListOutput && npmListOutput.includes('@openai/codex')) {
          // Get the path from npm bin
          const npmBinPath = execSync('npm bin -g', { encoding: 'utf-8' }).trim();
          const codexPath = path.join(npmBinPath, 'codex');
          const version = this.getCodexVersion(codexPath);
          return {
            installed: true,
            path: codexPath,
            version: version,
            method: 'npm'
          };
        }
      } catch (error) {
        // npm global not found
      }

      // Method 3: Check for Homebrew installation on macOS
      if (process.platform === 'darwin') {
        try {
          const brewList = execSync('brew list --formula 2>/dev/null', { encoding: 'utf-8' });
          if (brewList.includes('codex')) {
            const brewPrefixOutput = execSync('brew --prefix codex 2>/dev/null', { encoding: 'utf-8' }).trim();
            const codexPath = path.join(brewPrefixOutput, 'bin', 'codex');
            const version = this.getCodexVersion(codexPath);
            return {
              installed: true,
              path: codexPath,
              version: version,
              method: 'brew'
            };
          }
        } catch (error) {
          // Homebrew not found or codex not installed via brew
        }
      }

      // Method 4: Check Windows path
      if (process.platform === 'win32') {
        try {
          const codexPath = execSync('where codex 2>nul', { encoding: 'utf-8' }).trim().split('\n')[0];
          if (codexPath) {
            const version = this.getCodexVersion(codexPath);
            return {
              installed: true,
              path: codexPath,
              version: version,
              method: 'cli'
            };
          }
        } catch (error) {
          // Not found on Windows
        }
      }

      // Method 5: Check common installation paths
      const commonPaths = [
        path.join(os.homedir(), '.local', 'bin', 'codex'),
        path.join(os.homedir(), '.npm-global', 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
      ];

      for (const checkPath of commonPaths) {
        if (fs.existsSync(checkPath)) {
          const version = this.getCodexVersion(checkPath);
          return {
            installed: true,
            path: checkPath,
            version: version,
            method: 'cli'
          };
        }
      }

      // Method 6: Check if OPENAI_API_KEY is set (can use Codex API directly)
      if (process.env.OPENAI_API_KEY) {
        return {
          installed: false,
          path: null,
          version: null,
          method: 'api-key-only',
          hasApiKey: true
        };
      }

      return {
        installed: false,
        path: null,
        version: null,
        method: 'none'
      };
    } catch (error) {
      console.error('[CodexCliDetector] Error detecting Codex installation:', error);
      return {
        installed: false,
        path: null,
        version: null,
        method: 'none',
        error: error.message
      };
    }
  }

  /**
   * Get Codex CLI version from executable path
   * @param {string} codexPath Path to codex executable
   * @returns {string|null} Version string or null
   */
  static getCodexVersion(codexPath) {
    try {
      const version = execSync(`"${codexPath}" --version 2>/dev/null`, { encoding: 'utf-8' }).trim();
      return version || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get installation info and recommendations
   * @returns {Object} Installation status and recommendations
   */
  static getInstallationInfo() {
    const detection = this.detectCodexInstallation();

    if (detection.installed) {
      return {
        status: 'installed',
        method: detection.method,
        version: detection.version,
        path: detection.path,
        recommendation: detection.method === 'cli'
          ? 'Using Codex CLI - ready for GPT-5.1 Codex models'
          : `Using Codex CLI via ${detection.method} - ready for GPT-5.1 Codex models`
      };
    }

    // Not installed but has API key
    if (detection.method === 'api-key-only') {
      return {
        status: 'api_key_only',
        method: 'api-key-only',
        recommendation: 'OPENAI_API_KEY detected but Codex CLI not installed. Install Codex CLI for full agentic capabilities.',
        installCommands: this.getInstallCommands()
      };
    }

    return {
      status: 'not_installed',
      recommendation: 'Install OpenAI Codex CLI to use GPT-5.1 Codex models for agentic tasks',
      installCommands: this.getInstallCommands()
    };
  }

  /**
   * Get installation commands for different platforms
   * @returns {Object} Installation commands by platform
   */
  static getInstallCommands() {
    return {
      npm: 'npm install -g @openai/codex@latest',
      macos: 'brew install codex',
      linux: 'npm install -g @openai/codex@latest',
      windows: 'npm install -g @openai/codex@latest'
    };
  }

  /**
   * Check if Codex CLI supports a specific model
   * @param {string} model Model name to check
   * @returns {boolean} Whether the model is supported
   */
  static isModelSupported(model) {
    const supportedModels = [
      'gpt-5.1-codex-max',
      'gpt-5.1-codex',
      'gpt-5.1-codex-mini',
      'gpt-5.1',
      'o3',
      'o3-mini',
      'o4-mini'
    ];
    return supportedModels.includes(model);
  }

  /**
   * Get default model for Codex CLI
   * @returns {string} Default model name
   */
  static getDefaultModel() {
    return 'gpt-5.1-codex-max';
  }
}

module.exports = CodexCliDetector;
