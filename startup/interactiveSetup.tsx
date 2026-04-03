import { feature } from 'bun:bundle';
import React from 'react';
import type { ChannelEntry } from '../bootstrap/state.js';
import { getAllowedChannels, setAllowedChannels, setHasDevChannels, setSessionTrustAccepted } from '../bootstrap/state.js';
import type { Command } from '../commands.js';
import { initializeTelemetryAfterTrust } from '../entrypoints/init.js';
import { showSetupDialog, completeOnboarding } from '../interactiveHelpers.js';
import { checkGate_CACHED_OR_BLOCKING, initializeGrowthBook, resetGrowthBook } from '../services/analytics/growthbook.js';
import { logEvent } from '../services/analytics/index.js';
import { isQualifiedForGrove } from '../services/api/grove.js';
import { handleMcpjsonServerApprovals } from '../services/mcpServerApproval.js';
import { normalizeApiKeyForConfig } from '../utils/authPortable.js';
import { getExternalClaudeMdIncludes, getMemoryFiles, shouldShowClaudeMdExternalIncludesWarning } from '../utils/claudemd.js';
import { checkHasTrustDialogAccepted, getCustomApiKeyStatus, getGlobalConfig } from '../utils/config.js';
import { updateDeepLinkTerminalPreference } from '../utils/deepLink/terminalPreference.js';
import { isEnvTruthy, isRunningOnHomespace } from '../utils/envUtils.js';
import { updateGithubRepoPathMapping } from '../utils/githubRepoPathMapping.js';
import { applyConfigEnvironmentVariables } from '../utils/managedEnv.js';
import type { PermissionMode } from '../utils/permissions/PermissionMode.js';
import { getSettingsWithAllErrors } from '../utils/settings/allErrors.js';
import { hasAutoModeOptIn, hasSkipDangerousModePermissionPrompt } from '../utils/settings/settings.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { getSystemContext } from '../context.js';

export async function showSetupScreens(root: import('../ink.js').Root, permissionMode: PermissionMode, allowDangerouslySkipPermissions: boolean, commands?: Command[], claudeInChrome?: boolean, devChannels?: ChannelEntry[]): Promise<boolean> {
  if ("production" === 'test' || isEnvTruthy(false) || process.env.IS_DEMO) {
    return false;
  }
  const config = getGlobalConfig();
  let onboardingShown = false;
  if (!config.theme || !config.hasCompletedOnboarding) {
    onboardingShown = true;
    const {
      Onboarding
    } = await import('../components/Onboarding.js');
    await showSetupDialog(root, done => <Onboarding onDone={() => {
      completeOnboarding();
      void done();
    }} />, {
      onChangeAppState: (await import('../state/onChangeAppState.js')).onChangeAppState
    });
  }
  if (!isEnvTruthy(process.env.CLAUBBIT)) {
    if (!checkHasTrustDialogAccepted()) {
      const {
        TrustDialog
      } = await import('../components/TrustDialog/TrustDialog.js');
      await showSetupDialog(root, done => <TrustDialog commands={commands} onDone={done} />);
    }
    setSessionTrustAccepted(true);
    resetGrowthBook();
    void initializeGrowthBook();
    void getSystemContext();
    const {
      errors: allErrors
    } = getSettingsWithAllErrors();
    if (allErrors.length === 0) {
      await handleMcpjsonServerApprovals(root);
    }
    if (await shouldShowClaudeMdExternalIncludesWarning()) {
      const externalIncludes = getExternalClaudeMdIncludes(await getMemoryFiles(true));
      const {
        ClaudeMdExternalIncludesDialog
      } = await import('../components/ClaudeMdExternalIncludesDialog.js');
      await showSetupDialog(root, done => <ClaudeMdExternalIncludesDialog onDone={done} isStandaloneDialog externalIncludes={externalIncludes} />);
    }
  }
  void updateGithubRepoPathMapping();
  if (feature('LODESTONE')) {
    updateDeepLinkTerminalPreference();
  }
  applyConfigEnvironmentVariables();
  setImmediate(() => initializeTelemetryAfterTrust());
  if (await isQualifiedForGrove()) {
    const {
      GroveDialog
    } = await import('../components/grove/Grove.js');
    const decision = await showSetupDialog<string>(root, done => <GroveDialog showIfAlreadyViewed={false} location={onboardingShown ? 'onboarding' : 'policy_update_modal'} onDone={done} />);
    if (decision === 'escape') {
      logEvent('tengu_grove_policy_exited', {});
      gracefulShutdownSync(0);
      return false;
    }
  }
  if (process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()) {
    const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
    const keyStatus = getCustomApiKeyStatus(customApiKeyTruncated);
    if (keyStatus === 'new') {
      const {
        ApproveApiKey
      } = await import('../components/ApproveApiKey.js');
      await showSetupDialog<boolean>(root, done => <ApproveApiKey customApiKeyTruncated={customApiKeyTruncated} onDone={done} />, {
        onChangeAppState: (await import('../state/onChangeAppState.js')).onChangeAppState
      });
    }
  }
  if ((permissionMode === 'bypassPermissions' || allowDangerouslySkipPermissions) && !hasSkipDangerousModePermissionPrompt()) {
    const {
      BypassPermissionsModeDialog
    } = await import('../components/BypassPermissionsModeDialog.js');
    await showSetupDialog(root, done => <BypassPermissionsModeDialog onAccept={done} />);
  }
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (permissionMode === 'auto' && !hasAutoModeOptIn()) {
      const {
        AutoModeOptInDialog
      } = await import('../components/AutoModeOptInDialog.js');
      await showSetupDialog(root, done => <AutoModeOptInDialog onAccept={done} onDecline={() => gracefulShutdownSync(1)} declineExits />);
    }
  }
  if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
    if (getAllowedChannels().length > 0 || (devChannels?.length ?? 0) > 0) {
      await checkGate_CACHED_OR_BLOCKING('tengu_harbor');
    }
    if (devChannels && devChannels.length > 0) {
      const [{
        isChannelsEnabled
      }, {
        getClaudeAIOAuthTokens
      }] = await Promise.all([import('../services/mcp/channelAllowlist.js'), import('../utils/auth.js')]);
      if (!isChannelsEnabled() || !getClaudeAIOAuthTokens()?.accessToken) {
        setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({
          ...c,
          dev: true
        }))]);
        setHasDevChannels(true);
      } else {
        const {
          DevChannelsDialog
        } = await import('../components/DevChannelsDialog.js');
        await showSetupDialog(root, done => <DevChannelsDialog channels={devChannels} onAccept={() => {
          setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({
            ...c,
            dev: true
          }))]);
          setHasDevChannels(true);
          void done();
        }} />);
      }
    }
  }
  if (claudeInChrome && !getGlobalConfig().hasCompletedClaudeInChromeOnboarding) {
    const {
      ClaudeInChromeOnboarding
    } = await import('../components/ClaudeInChromeOnboarding.js');
    await showSetupDialog(root, done => <ClaudeInChromeOnboarding onDone={done} />);
  }
  return onboardingShown;
}
