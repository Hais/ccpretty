/**
 * GitHub Actions utility functions
 */

/**
 * Check if the current environment is running in GitHub Actions
 */
export function isGitHubActions(): boolean {
  return !!(
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_SERVER_URL &&
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_RUN_ID
  );
}

/**
 * Get the GitHub Actions run URL if running in GitHub Actions
 */
export function getGitHubActionsRunUrl(): string | null {
  if (!isGitHubActions()) {
    return null;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

/**
 * Format session display text - either GitHub Actions run link or session ID
 */
export function formatSessionDisplay(sessionId: string): { text: string; isLink: boolean } {
  const runUrl = getGitHubActionsRunUrl();
  
  if (runUrl) {
    return {
      text: runUrl,
      isLink: true
    };
  }
  
  return {
    text: sessionId,
    isLink: false
  };
}