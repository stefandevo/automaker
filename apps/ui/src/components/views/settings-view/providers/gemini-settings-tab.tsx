import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GeminiCliStatus, GeminiCliStatusSkeleton } from '../cli-status/gemini-cli-status';
import { ProviderToggle } from './provider-toggle';
import { useGeminiCliStatus } from '@/hooks/queries';
import { queryKeys } from '@/lib/query-keys';
import type { CliStatus as SharedCliStatus } from '../shared/types';
import type { GeminiAuthStatus } from '../cli-status/gemini-cli-status';

export function GeminiSettingsTab() {
  const queryClient = useQueryClient();

  // React Query hooks for data fetching
  const {
    data: cliStatusData,
    isLoading: isCheckingGeminiCli,
    refetch: refetchCliStatus,
  } = useGeminiCliStatus();

  // Transform CLI status to the expected format
  const cliStatus = useMemo((): SharedCliStatus | null => {
    if (!cliStatusData) return null;
    return {
      success: cliStatusData.success ?? false,
      status: cliStatusData.installed ? 'installed' : 'not_installed',
      method: cliStatusData.auth?.method,
      version: cliStatusData.version,
      path: cliStatusData.path,
      recommendation: cliStatusData.recommendation,
      installCommands: cliStatusData.installCommands,
    };
  }, [cliStatusData]);

  // Transform auth status to the expected format
  const authStatus = useMemo((): GeminiAuthStatus | null => {
    if (!cliStatusData?.auth) return null;
    return {
      authenticated: cliStatusData.auth.authenticated,
      method: (cliStatusData.auth.method as GeminiAuthStatus['method']) || 'none',
      hasApiKey: cliStatusData.auth.hasApiKey,
      hasEnvApiKey: cliStatusData.auth.hasEnvApiKey,
      error: cliStatusData.auth.error,
    };
  }, [cliStatusData]);

  // Refresh all gemini-related queries
  const handleRefreshGeminiCli = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.cli.gemini() });
    await refetchCliStatus();
    toast.success('Gemini CLI refreshed');
  }, [queryClient, refetchCliStatus]);

  // Show skeleton only while checking CLI status initially
  if (!cliStatus && isCheckingGeminiCli) {
    return (
      <div className="space-y-6">
        <GeminiCliStatusSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Provider Visibility Toggle */}
      <ProviderToggle provider="gemini" providerLabel="Gemini" />

      <GeminiCliStatus
        status={cliStatus}
        authStatus={authStatus}
        isChecking={isCheckingGeminiCli}
        onRefresh={handleRefreshGeminiCli}
      />
    </div>
  );
}

export default GeminiSettingsTab;
