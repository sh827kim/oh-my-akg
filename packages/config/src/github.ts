import { Octokit } from 'octokit';
import { execSync } from 'child_process';

export const getOctokit = () => {
  let token = process.env.GITHUB_TOKEN;
  if (!token) {
    try {
      token = execSync('gh auth token', { encoding: 'utf8' }).trim();
    } catch {
      // token remains undefined
    }
  }

  if (!token) {
    throw new Error('GITHUB_TOKEN is not set and `gh auth token` failed.');
  }

  return new Octokit({ auth: token });
};

export interface RepoInfo {
  id: string;
  name: string;
  url: string;
  description: string | null;
  visibility: string;
  language: string | null;
  updated_at: string;
  default_branch: string;
}

export const fetchRepos = async (org: string): Promise<RepoInfo[]> => {
  const octokit = getOctokit();
  console.log(`Fetching repositories for org: ${org}...`);

  const iterator = octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  });

  const repos: RepoInfo[] = [];

  for await (const { data: page } of iterator) {
    for (const repo of page) {
      repos.push({
        id: repo.full_name,
        name: repo.name,
        url: repo.html_url,
        description: repo.description,
        visibility: repo.visibility || 'public',
        language: repo.language || null,
        updated_at: repo.updated_at || new Date().toISOString(),
        default_branch: repo.default_branch || 'main',
      });
    }
  }

  console.log(`Fetched ${repos.length} repositories.`);
  return repos;
};
