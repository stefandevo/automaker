/**
 * Query Invalidation Hooks
 *
 * These hooks connect WebSocket events to React Query cache invalidation,
 * ensuring the UI stays in sync with server-side changes without manual refetching.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getElectronAPI } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';
import type { AutoModeEvent, SpecRegenerationEvent } from '@/types/electron';
import type { IssueValidationEvent } from '@automaker/types';

/**
 * Debounce delay for agent output invalidations (ms).
 * This prevents excessive refetches when auto_mode_progress events fire rapidly.
 */
const AGENT_OUTPUT_INVALIDATE_DEBOUNCE_MS = 1000;

/**
 * Invalidate queries based on auto mode events
 *
 * This hook subscribes to auto mode events (feature start, complete, error, etc.)
 * and invalidates relevant queries to keep the UI in sync.
 *
 * @param projectPath - Current project path
 *
 * @example
 * ```tsx
 * function BoardView() {
 *   const projectPath = useAppStore(s => s.currentProject?.path);
 *   useAutoModeQueryInvalidation(projectPath);
 *   // ...
 * }
 * ```
 */
export function useAutoModeQueryInvalidation(projectPath: string | undefined) {
  const queryClient = useQueryClient();

  // Track pending debounced invalidations per feature ID
  // Key: featureId, Value: timeout ID
  const pendingInvalidationsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Debounced agent output invalidation
  const debouncedInvalidateAgentOutput = useCallback(
    (featureId: string) => {
      if (!projectPath) return;

      const pendingInvalidations = pendingInvalidationsRef.current;

      // Clear any existing pending invalidation for this feature
      const existingTimeout = pendingInvalidations.get(featureId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Schedule a new debounced invalidation
      const timeoutId = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.features.agentOutput(projectPath, featureId),
        });
        pendingInvalidations.delete(featureId);
      }, AGENT_OUTPUT_INVALIDATE_DEBOUNCE_MS);

      pendingInvalidations.set(featureId, timeoutId);
    },
    [projectPath, queryClient]
  );

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      const pendingInvalidations = pendingInvalidationsRef.current;
      pendingInvalidations.forEach((timeoutId) => clearTimeout(timeoutId));
      pendingInvalidations.clear();
    };
  }, []);

  useEffect(() => {
    if (!projectPath) return;

    const api = getElectronAPI();
    const unsubscribe = api.autoMode.onEvent((event: AutoModeEvent) => {
      // Invalidate features when agent completes, errors, or receives plan approval
      if (
        event.type === 'auto_mode_feature_complete' ||
        event.type === 'auto_mode_error' ||
        event.type === 'plan_approval_required' ||
        event.type === 'plan_approved' ||
        event.type === 'plan_rejected' ||
        event.type === 'pipeline_step_complete'
      ) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.features.all(projectPath),
        });
      }

      // Invalidate running agents on any status change
      if (
        event.type === 'auto_mode_feature_start' ||
        event.type === 'auto_mode_feature_complete' ||
        event.type === 'auto_mode_error' ||
        event.type === 'auto_mode_resuming_features'
      ) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.runningAgents.all(),
        });
      }

      // Invalidate specific feature when it starts or has phase changes
      if (
        (event.type === 'auto_mode_feature_start' ||
          event.type === 'auto_mode_phase' ||
          event.type === 'auto_mode_phase_complete' ||
          event.type === 'pipeline_step_started') &&
        'featureId' in event
      ) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.features.single(projectPath, event.featureId),
        });
      }

      // Debounced invalidation for agent output during progress updates
      // This prevents excessive refetches when progress events fire rapidly
      if (event.type === 'auto_mode_progress' && 'featureId' in event) {
        debouncedInvalidateAgentOutput(event.featureId);
      }

      // Invalidate worktree queries when feature completes (may have created worktree)
      if (event.type === 'auto_mode_feature_complete' && 'featureId' in event) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.worktrees.all(projectPath),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.worktrees.single(projectPath, event.featureId),
        });
      }
    });

    return unsubscribe;
  }, [projectPath, queryClient, debouncedInvalidateAgentOutput]);
}

/**
 * Invalidate queries based on spec regeneration events
 *
 * @param projectPath - Current project path
 */
export function useSpecRegenerationQueryInvalidation(projectPath: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectPath) return;

    const api = getElectronAPI();
    const unsubscribe = api.specRegeneration.onEvent((event: SpecRegenerationEvent) => {
      // Only handle events for the current project
      if (event.projectPath !== projectPath) return;

      if (event.type === 'spec_regeneration_complete') {
        // Invalidate features as new ones may have been generated
        queryClient.invalidateQueries({
          queryKey: queryKeys.features.all(projectPath),
        });

        // Invalidate spec regeneration status
        queryClient.invalidateQueries({
          queryKey: queryKeys.specRegeneration.status(projectPath),
        });
      }
    });

    return unsubscribe;
  }, [projectPath, queryClient]);
}

/**
 * Invalidate queries based on GitHub validation events
 *
 * @param projectPath - Current project path
 */
export function useGitHubValidationQueryInvalidation(projectPath: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectPath) return;

    const api = getElectronAPI();

    // Check if GitHub API is available before subscribing
    if (!api.github?.onValidationEvent) {
      return;
    }

    const unsubscribe = api.github.onValidationEvent((event: IssueValidationEvent) => {
      if (event.type === 'validation_complete' || event.type === 'validation_error') {
        // Invalidate all validations for this project
        queryClient.invalidateQueries({
          queryKey: queryKeys.github.validations(projectPath),
        });

        // Also invalidate specific issue validation if we have the issue number
        if ('issueNumber' in event && event.issueNumber) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.github.validation(projectPath, event.issueNumber),
          });
        }
      }
    });

    return unsubscribe;
  }, [projectPath, queryClient]);
}

/**
 * Invalidate session queries based on agent stream events
 *
 * @param sessionId - Current session ID
 */
export function useSessionQueryInvalidation(sessionId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId) return;

    const api = getElectronAPI();
    const unsubscribe = api.agent.onStream((event) => {
      // Only handle events for the current session
      if ('sessionId' in event && event.sessionId !== sessionId) return;

      // Invalidate session history when a message is complete
      if (event.type === 'complete' || event.type === 'message') {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sessions.history(sessionId),
        });
      }

      // Invalidate sessions list when any session changes
      if (event.type === 'complete') {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sessions.all(),
        });
      }
    });

    return unsubscribe;
  }, [sessionId, queryClient]);
}

/**
 * Combined hook that sets up all query invalidation subscriptions
 *
 * Use this hook at the app root or in a layout component to ensure
 * all WebSocket events properly invalidate React Query caches.
 *
 * @param projectPath - Current project path
 * @param sessionId - Current session ID (optional)
 *
 * @example
 * ```tsx
 * function AppLayout() {
 *   const projectPath = useAppStore(s => s.currentProject?.path);
 *   const sessionId = useAppStore(s => s.currentSessionId);
 *   useQueryInvalidation(projectPath, sessionId);
 *   // ...
 * }
 * ```
 */
export function useQueryInvalidation(
  projectPath: string | undefined,
  sessionId?: string | undefined
) {
  useAutoModeQueryInvalidation(projectPath);
  useSpecRegenerationQueryInvalidation(projectPath);
  useGitHubValidationQueryInvalidation(projectPath);
  useSessionQueryInvalidation(sessionId);
}
