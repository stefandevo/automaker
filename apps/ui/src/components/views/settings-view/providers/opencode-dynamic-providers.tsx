/**
 * OpenCode Dynamic Providers Component
 *
 * Shows authenticated providers from OpenCode CLI and allows
 * refreshing the model list from the CLI.
 */

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle2, XCircle, Cloud, Terminal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getElectronAPI } from '@/lib/electron';
import { useAppStore } from '@/store/app-store';
import { createLogger } from '@automaker/utils/logger';

const logger = createLogger('OpenCodeDynamicProviders');

interface OpenCodeProviderInfo {
  id: string;
  name: string;
  authenticated: boolean;
  authMethod?: 'oauth' | 'api_key';
}

interface OpenCodeDynamicProvidersProps {
  isCliInstalled: boolean;
}

/**
 * Provider display configuration
 */
const PROVIDER_CONFIG: Record<string, { icon: string; displayName: string }> = {
  copilot: { icon: '', displayName: 'GitHub Copilot' },
  anthropic: { icon: '', displayName: 'Anthropic' },
  openai: { icon: '', displayName: 'OpenAI' },
  google: { icon: '', displayName: 'Google' },
  'amazon-bedrock': { icon: '', displayName: 'AWS Bedrock' },
  azure: { icon: '', displayName: 'Azure OpenAI' },
  ollama: { icon: '', displayName: 'Ollama' },
  lmstudio: { icon: '', displayName: 'LM Studio' },
  opencode: { icon: '', displayName: 'OpenCode' },
};

function getProviderDisplay(provider: OpenCodeProviderInfo) {
  const config = PROVIDER_CONFIG[provider.id] || {
    displayName: provider.name || provider.id,
  };
  return config.displayName;
}

export function OpenCodeDynamicProviders({ isCliInstalled }: OpenCodeDynamicProvidersProps) {
  const [providers, setProviders] = useState<OpenCodeProviderInfo[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const { dynamicOpencodeModels, setDynamicOpencodeModels } = useAppStore();

  // Model count derived from store
  const modelCount = dynamicOpencodeModels.length;

  // Fetch models from API and store them (only if not already loaded)
  const fetchModels = useCallback(
    async (force = false) => {
      // Skip if already have models and not forcing refresh
      if (!force && dynamicOpencodeModels.length > 0) {
        logger.debug('Dynamic models already loaded, skipping fetch');
        return;
      }

      try {
        const api = getElectronAPI();
        if (api?.setup?.getOpencodeModels) {
          const data = await api.setup.getOpencodeModels();
          if (data.success && data.models) {
            setDynamicOpencodeModels(data.models);
            logger.info(`Loaded ${data.models.length} dynamic OpenCode models`);
          }
        }
      } catch (error) {
        logger.error('Failed to fetch OpenCode models:', error);
      }
    },
    [dynamicOpencodeModels.length, setDynamicOpencodeModels]
  );

  // Fetch providers on mount, but only fetch models if not already loaded
  useEffect(() => {
    if (isCliInstalled) {
      fetchProviders();
      // Only fetch models if store is empty
      if (dynamicOpencodeModels.length === 0) {
        fetchModels(false);
      }
    }
  }, [isCliInstalled]); // Intentionally not including fetchModels to avoid re-fetching

  const fetchProviders = useCallback(async () => {
    setIsLoadingProviders(true);
    try {
      const api = getElectronAPI();
      if (api?.setup?.getOpencodeProviders) {
        const data = await api.setup.getOpencodeProviders();
        if (data.success && data.providers) {
          setProviders(data.providers);
        }
      } else {
        logger.warn('OpenCode providers API not available');
      }
    } catch (error) {
      logger.error('Failed to fetch OpenCode providers:', error);
    } finally {
      setIsLoadingProviders(false);
    }
  }, []);

  const handleRefreshModels = useCallback(async () => {
    setIsRefreshingModels(true);
    try {
      const api = getElectronAPI();
      if (api?.setup?.refreshOpencodeModels) {
        const data = await api.setup.refreshOpencodeModels();
        if (data.success) {
          // Store the refreshed models in the app store
          if (data.models) {
            setDynamicOpencodeModels(data.models);
            toast.success(`Refreshed ${data.models.length} models from OpenCode CLI`);
          }
          // Also refresh providers
          await fetchProviders();
        } else {
          toast.error(data.error || 'Failed to refresh models');
        }
      } else {
        logger.warn('OpenCode refresh models API not available');
        toast.error('OpenCode API not available');
      }
    } catch (error) {
      logger.error('Failed to refresh OpenCode models:', error);
      toast.error('Failed to refresh models from OpenCode CLI');
    } finally {
      setIsRefreshingModels(false);
    }
  }, [fetchProviders, setDynamicOpencodeModels]);

  if (!isCliInstalled) {
    return null;
  }

  const authenticatedProviders = providers.filter((p) => p.authenticated);
  const unauthenticatedProviders = providers.filter((p) => !p.authenticated);

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-border/50',
        'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
        'shadow-sm shadow-black/5'
      )}
    >
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
              <Cloud className="w-5 h-5 text-brand-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                Dynamic Providers
              </h2>
              {modelCount !== null && (
                <p className="text-xs text-muted-foreground">{modelCount} models available</p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshModels}
            disabled={isRefreshingModels}
            className="gap-2"
          >
            {isRefreshingModels ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh Models
          </Button>
        </div>
        <p className="text-sm text-muted-foreground/80 ml-12">
          OpenCode discovers models from your authenticated providers (GitHub Copilot, Google, etc.)
        </p>
      </div>

      <div className="p-6 space-y-4">
        {isLoadingProviders ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-6">
            <Terminal className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-2">No providers detected yet</p>
            <p className="text-xs text-muted-foreground/70">
              Run <code className="font-mono bg-accent/50 px-1 rounded">opencode</code> and use{' '}
              <code className="font-mono bg-accent/50 px-1 rounded">/connect</code> to authenticate
              with providers
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Authenticated Providers */}
            {authenticatedProviders.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Authenticated
                </h3>
                <div className="grid gap-2">
                  {authenticatedProviders.map((provider) => (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                          <Cloud className="w-4 h-4 text-emerald-500" />
                        </div>
                        <span className="text-sm font-medium text-emerald-400">
                          {getProviderDisplay(provider)}
                        </span>
                      </div>
                      {provider.authMethod && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                        >
                          {provider.authMethod === 'oauth' ? 'OAuth' : 'API Key'}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Available but Not Authenticated */}
            {unauthenticatedProviders.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                  Available
                </h3>
                <div className="grid gap-2">
                  {unauthenticatedProviders.slice(0, 5).map((provider) => (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                          <Cloud className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <span className="text-sm font-medium text-muted-foreground">
                          {getProviderDisplay(provider)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground/70">Not authenticated</span>
                    </div>
                  ))}
                  {unauthenticatedProviders.length > 5 && (
                    <p className="text-xs text-muted-foreground/70 text-center py-1">
                      +{unauthenticatedProviders.length - 5} more providers available
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Help text */}
            <div className="pt-2 border-t border-border/30">
              <p className="text-xs text-muted-foreground/70">
                Use <code className="font-mono bg-accent/50 px-1 rounded">opencode /connect</code>{' '}
                to add new providers like GitHub Copilot, Google AI, or local models.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
