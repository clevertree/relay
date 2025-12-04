/**
 * GitHub Update Service
 * Fetches the latest built APK from GitHub Actions workflow artifacts
 */

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_OWNER = 'clevertree';
const GITHUB_REPO = 'relay';
const WORKFLOW_NAME = 'android-build.yml';

export interface ArtifactInfo {
  id: number;
  name: string;
  url: string;
  createdAt: string;
  expiresAt: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string;
  createdAt: string;
}

/**
 * Fetch the latest successful workflow run from GitHub Actions
 */
export async function getLatestWorkflowRun(): Promise<WorkflowRun | null> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_NAME}/runs?status=completed&conclusion=success&per_page=1`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch workflow runs:', response.statusText);
      return null;
    }

    const data = await response.json();
    const runs = data.workflow_runs || [];

    if (runs.length === 0) {
      console.warn('No successful workflow runs found');
      return null;
    }

    const latestRun = runs[0];
    return {
      id: latestRun.id,
      status: latestRun.status,
      conclusion: latestRun.conclusion,
      createdAt: latestRun.created_at,
    };
  } catch (error) {
    console.error('Error fetching workflow runs:', error);
    return null;
  }
}

/**
 * Fetch artifacts from a specific workflow run
 */
export async function getArtifactsForRun(runId: number): Promise<ArtifactInfo[]> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/artifacts`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch artifacts:', response.statusText);
      return [];
    }

    const data = await response.json();
    const artifacts = data.artifacts || [];

    // Filter for the APK artifact
    const apkArtifacts = artifacts.filter((artifact: any) =>
      artifact.name.includes('relay-android-release-apk')
    );

    return apkArtifacts.map((artifact: any) => ({
      id: artifact.id,
      name: artifact.name,
      url: artifact.url,
      createdAt: artifact.created_at,
      expiresAt: artifact.expires_at,
    }));
  } catch (error) {
    console.error('Error fetching artifacts:', error);
    return [];
  }
}

/**
 * Get the download URL for an artifact
 * Note: GitHub requires authentication to download artifacts
 * You'll need to provide a GitHub token for this to work
 */
export async function getArtifactDownloadUrl(
  artifactId: number,
  githubToken?: string
): Promise<string | null> {
  try {
    const headers: HeadersInit = {
      Accept: 'application/vnd.github.v3+json',
    };

    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/artifacts/${artifactId}/zip`,
      {
        headers,
        redirect: 'follow',
      }
    );

    if (!response.ok) {
      console.error('Failed to get artifact download URL:', response.statusText);
      return null;
    }

    // The response URL is the download URL
    return response.url;
  } catch (error) {
    console.error('Error getting artifact download URL:', error);
    return null;
  }
}

/**
 * Get the latest APK artifact with download URL
 * This is the main function to use
 */
export async function getLatestAPK(githubToken?: string): Promise<{
  artifact: ArtifactInfo;
  downloadUrl: string;
} | null> {
  try {
    // Get latest successful workflow run
    const latestRun = await getLatestWorkflowRun();
    if (!latestRun) {
      console.warn('No successful workflow run found');
      return null;
    }

    // Get artifacts from that run
    const artifacts = await getArtifactsForRun(latestRun.id);
    if (artifacts.length === 0) {
      console.warn('No APK artifacts found in latest run');
      return null;
    }

    const latestArtifact = artifacts[0];

    // Get download URL
    const downloadUrl = await getArtifactDownloadUrl(latestArtifact.id, githubToken);
    if (!downloadUrl) {
      console.error('Failed to get download URL for artifact');
      return null;
    }

    return {
      artifact: latestArtifact,
      downloadUrl,
    };
  } catch (error) {
    console.error('Error getting latest APK:', error);
    return null;
  }
}
