// src/repopack.ts
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pack } from "repopack";
import { ProcessRepoRequest } from '.';

const defaultConfig: Parameters<typeof pack>[1] = {
  cwd: os.tmpdir(),
  output: {
    filePath: "repopack-output.md",
    style: 'markdown',
    removeComments: false,
    removeEmptyLines: false,
    topFilesLength: 10,
    showLineNumbers: false,
  },
  include: [],
  ignore: {
    useGitignore: true,
    useDefaultPatterns: true,
    customPatterns: [],
  },
  security: {
    enableSecurityCheck: true,
  },
};

interface RepopackOptions {
  githubUrl: string;
  excludePatterns?: string[];
  sizeThresholdMb?: number;
  regexFilter?: string;
  maxRepoSizeMb?: number;
}

interface FileInfo {
  path: string;
  size: number;
}

export interface Message {
  humanFriendlyProgress: string;
  output?: string;
  complete: boolean;
  error?: string;
}

export class RepopackService {
  async *processRepositoryStreaming(handshake: ProcessRepoRequest): AsyncGenerator<Message> {
    const {
      githubUrl,
      excludePatterns = [],
      sizeThresholdMb = this.DEFAULT_SIZE_THRESHOLD_MB,
      regexFilter,
      maxRepoSizeMb = this.DEFAULT_MAX_REPO_SIZE_MB
    } = handshake;

    const workDir = path.join(this.TEMP_DIR, randomUUID());
    try {
      // Validate GitHub URL
      if (!this.isValidGithubUrl(githubUrl)) {
        throw new Error('Invalid GitHub URL');
      }

      yield { humanFriendlyProgress: 'Initializing...', complete: false };

      // Create unique working directory
      fs.mkdirSync(workDir, { recursive: true });

      yield { humanFriendlyProgress: 'Cloning repository...', complete: false };
      await this.cloneRepository(githubUrl, workDir, maxRepoSizeMb);

      yield { humanFriendlyProgress: 'Analyzing repository...', complete: false };
      const files = await this.getRepositoryFiles(workDir);
      const largeFiles = files.filter(f => f.size > sizeThresholdMb * 1024 * 1024);

      yield { humanFriendlyProgress: 'Preparing ignore patterns...', complete: false };
      const ignorePatterns = [
        ...excludePatterns,
        ...largeFiles.map(f => path.relative(workDir, f.path)),
        ...(regexFilter ? [regexFilter] : [])
      ];
      const ignoreFilePath = path.join(workDir, '.repopackignore');
      fs.writeFileSync(ignoreFilePath, ignorePatterns.join('\n'));

      yield { humanFriendlyProgress: 'Running repopack...', complete: false };

      const config = {
        ...defaultConfig,
        cwd: workDir,
        ignore: {
          ...defaultConfig.ignore,
          customPatterns: ignorePatterns,
        },
      };

      const output = await this.runRepopack(workDir, (progress) => {
        // yield { humanFriendlyProgress: progress, complete: false };
      });
      yield { humanFriendlyProgress: 'Processing complete', output, complete: true };
    } catch (error) {
      yield { humanFriendlyProgress: 'Error occurred', error: String(error), complete: true };
    } finally {
      // Clean up temporary directory
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  private readonly DEFAULT_MAX_REPO_SIZE_MB = 100;
  private readonly DEFAULT_SIZE_THRESHOLD_MB = 1;
  private readonly TEMP_DIR = path.join(os.tmpdir(), 'repopack-service');

  constructor() {
    // Ensure temp directory exists
    if (!fs.existsSync(this.TEMP_DIR)) {
      fs.mkdirSync(this.TEMP_DIR, { recursive: true });
    }
  }

  async processRepository(options: RepopackOptions): Promise<string> {
    const {
      githubUrl,
      excludePatterns = [],
      sizeThresholdMb = this.DEFAULT_SIZE_THRESHOLD_MB,
      regexFilter,
      maxRepoSizeMb = this.DEFAULT_MAX_REPO_SIZE_MB
    } = options;

    // Validate GitHub URL
    if (!this.isValidGithubUrl(githubUrl)) {
      throw new Error('Invalid GitHub URL');
    }

    // Create unique working directory
    const workDir = path.join(this.TEMP_DIR, randomUUID());
    fs.mkdirSync(workDir, { recursive: true });

    try {
      // Clone repository with depth=1
      await this.cloneRepository(githubUrl, workDir, maxRepoSizeMb);

      // Get list of files and their sizes
      const files = await this.getRepositoryFiles(workDir);

      // Apply size threshold filter
      const largeFiles = files.filter(f => f.size > sizeThresholdMb * 1024 * 1024);

      // Create .repopackignore file
      const ignorePatterns = [
        ...excludePatterns,
        ...largeFiles.map(f => path.relative(workDir, f.path)),
        ...(regexFilter ? [regexFilter] : [])
      ];

      const ignoreFilePath = path.join(workDir, '.repopackignore');
      fs.writeFileSync(ignoreFilePath, ignorePatterns.join('\n'));

      // Run repopack
      const output = await this.runRepopack(workDir);

      return output;
    } finally {
      // Cleanup
      await this.cleanup(workDir);
    }
  }

  private isValidGithubUrl(url: string): boolean {
    const githubUrlRegex = /^https:\/\/github\.com\/[\w-]+\/[\w-]+(\/?|\.git)$/;
    return githubUrlRegex.test(url);
  }

  private async cloneRepository(url: string, workDir: string, maxRepoSizeMb: number): Promise<void> {
    // First, do a size check using git ls-remote
    const repoSize = await this.getRepositorySize(url);
    if (repoSize > maxRepoSizeMb * 1024 * 1024) {
      throw new Error(`Repository size ${repoSize}MB exceeds maximum allowed size of ${maxRepoSizeMb}MB`);
    }

    execSync(`git clone --depth=1 ${url} ${workDir}`, {
      stdio: 'pipe',
      timeout: 60000 // 1 minute timeout
    });
  }

  private async getRepositorySize(url: string): Promise<number> {
    const repoInfo = url.match(/github\.com\/(.+?)\/(.+?)(\.git)?$/);
    if (!repoInfo) {
      throw new Error('Invalid GitHub URL');
    }

    const [, owner, repo] = repoInfo;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch repository info: ${response.statusText}`);
    }

    const data = await response.json();
    return data.size / 1024; // Convert KB to MB
  }

  private async getRepositoryFiles(dir: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    const walk = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== '.git') {
            walk(fullPath);
          }
        } else {
          const stats = fs.statSync(fullPath);
          files.push({
            path: fullPath,
            size: stats.size
          });
        }
      }
    };

    walk(dir);
    return files;
  }

  private async runRepopack(workDir: string, progressCallback?: Parameters<typeof pack>[2]): Promise<string> {
    await pack(workDir, { ...defaultConfig, cwd: workDir }, progressCallback);

    return await fs.promises.readFile(path.join(workDir, "repopack-output.md"), "utf8");
  }

  private async cleanup(workDir: string): Promise<void> {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
