export interface RepopackRequest {
  githubUrl: string;
  excludePatterns?: string[];
  sizeThresholdMb?: number;
  regexFilter?: string;
  maxRepoSizeMb?: number;
}

export interface RepopackResponse {
  status: 'processing' | 'completed' | 'error';
  output?: string;
  error?: string;
}