// src/repopack.ts
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fg from 'fast-glob';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pack } from "repopack";
import { ProcessRepoRequest } from '.';
import { AsyncGeneratorCallback } from './util';

const TOP_FILES_LENGTH = 10;
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

interface FileInfo {
  path: string;
  size: number;
}

export interface Message {
  humanFriendlyProgress: string;
  progress: number;
  output?: string;
  complete: boolean;
  error?: string;
  largeFiles?: {
    path: string;
    size: number;
    tokenCount: number;
  }[];
  waitingForFileSelection?: boolean;
}

export interface SelectedFilesMessage {
  selectedFiles?: string[];
}

export class RepopackService {
  async *processRepositoryStreaming(handshake: ProcessRepoRequest): AsyncGenerator<Message, void, SelectedFilesMessage | undefined> {
    const {
      githubUrl,
      excludePatterns = "",
      sizeThresholdMb = this.DEFAULT_SIZE_THRESHOLD_MB,
      outputStyle = 'markdown'
    } = handshake;
    const excludePatternsArray = excludePatterns.split('\n').filter(Boolean);

    const workDir = path.join(this.TEMP_DIR, randomUUID());
    try {
      // Validate GitHub URL
      if (!this.isValidGithubUrl(githubUrl)) {
        throw new Error('Invalid GitHub URL');
      }

      yield { humanFriendlyProgress: 'Initializing...', complete: false, progress: 0 };

      // Create unique working directory
      fs.mkdirSync(workDir, { recursive: true });

      yield { humanFriendlyProgress: 'Cloning repository...', complete: false, progress: 10 };
      try {
        for await (const progress of this.cloneRepository(githubUrl, workDir, this.DEFAULT_MAX_REPO_SIZE_MB)) {
          yield { humanFriendlyProgress: `Cloning repository: ${progress}%`, complete: false, progress: progress * 0.7 + 10 };
        }
      } catch (error) {
        yield { humanFriendlyProgress: 'Error cloning repository', error: String(error), complete: true, progress: 100 };
        return;
      }

      yield { humanFriendlyProgress: 'Analyzing repository...', complete: false, progress: 85 };

      const files = await this.getRepositoryFiles(workDir, excludePatternsArray);

      let largeFiles = (await Promise.all(
        files
          .map(async f => ({
            path: path.relative(workDir, f.path),
            size: f.size,
            tokenCount: await this.countTokens(f.path)
          }))
      )).sort((a, b) => b.size - a.size);

      if (largeFiles.filter(f => f.size > sizeThresholdMb * 1024 * 1024).length < TOP_FILES_LENGTH) {
        largeFiles = largeFiles.slice(0, TOP_FILES_LENGTH);
      } else {
        largeFiles = largeFiles.filter(f => f.size > sizeThresholdMb * 1024 * 1024);
      }


      // Send large files info and wait for user selection
      const selectedFiles =
        yield {
          humanFriendlyProgress: 'Large files found. Waiting for selection...',
          complete: false,
          progress: 87,
          largeFiles,
          waitingForFileSelection: true
        };

      // Wait for response with selected files

      // Add selected files to exclude patterns
      const ignorePatterns = [
        ...excludePatternsArray,
        ...(selectedFiles?.selectedFiles || largeFiles.filter(f => f.size > sizeThresholdMb * 1024 * 1024).map(f => f.path)),
      ];

      yield { humanFriendlyProgress: 'Running repopack...', complete: false, progress: 90 };

      const config = {
        ...defaultConfig,
        cwd: workDir,
        ignore: {
          ...defaultConfig.ignore,
          customPatterns: ignorePatterns,
        },
        output: {
          ...defaultConfig.output,
          style: outputStyle,
        },
      };

      const cb = new AsyncGeneratorCallback<Message>()

      let numMessages = 0;
      this.runRepopack(config, (progress) => {
        numMessages++;
        const progressNum = 1 / (1 + Math.exp(-numMessages * 0.05)) * 100;

        cb.call({ humanFriendlyProgress: `Running repopack: ${progress}`, complete: false, progress: progressNum * 0.5 + 95 });
      }).then((output) => {
        cb.call({ humanFriendlyProgress: 'Processing complete', complete: true, output, progress: 100 });
      }).catch((error) => {
        cb.call({ humanFriendlyProgress: 'Error occurred', error: String(error), complete: true, progress: 100 });
      });

      for await (const message of cb) {
        yield message;

        if (message.complete) {
          break;
        }
      }
    } catch (error) {
      yield { humanFriendlyProgress: 'Error occurred', error: String(error), complete: true, progress: 100 };
    } finally {
      // Clean up temporary directory
      await fs.promises.rm(workDir, { recursive: true, force: true });
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

  private isValidGithubUrl(url: string): boolean {
    const githubUrlRegex = /^https:\/\/github\.com\/[\w-]+\/[\w-]+(\/?|\.git)$/;
    return githubUrlRegex.test(url);
  }

  private async *cloneRepository(url: string, workDir: string, maxRepoSizeMb: number): AsyncGenerator<number> {
    const repoSize = await this.getRepositorySize(url);
    if (repoSize > maxRepoSizeMb * 1024 * 1024) {
      throw new Error(`Repository size ${repoSize}MB exceeds maximum allowed size of ${maxRepoSizeMb}MB`);
    }

    yield* await new Promise<AsyncGenerator<number>>((resolve, reject) => {
      let receivedObjects = 0;
      let totalObjects = 0;
      const progress = (async function* () {
        const gitClone = spawn('git', ['clone', '--progress', '--depth=1', url, workDir]);

        const cb = new AsyncGeneratorCallback<number>()
        gitClone.stderr.on('data', (data) => {
          const output = data.toString();
          const matchReceiving = output.match(/Receiving objects:\s+(\d+)%\s+\((\d+)\/(\d+)\)/);
          if (matchReceiving) {
            const [, percentage] = matchReceiving;
            cb.call(parseInt(percentage));
          }
        });

        const closePromise = new Promise((resolveClone, rejectClone) => {
          gitClone.on('close', (code) => {
            if (code === 0) {
              resolveClone(undefined);
            } else {
              rejectClone(new Error(`Git clone process exited with code ${code}`));
            }
            cb.call(100);
          });

          gitClone.on('error', (error) => {
            rejectClone(error);
          });
        });


        for await (const message of cb) {
          yield message;
          if (message === 100) {
            break;
          }
        }

        await closePromise;
      })();

      resolve(progress);
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

  private async getRepositoryFiles(dir: string, excludePatternsArray: string[]): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    return fg.default.glob("**/*", {
      ignore: excludePatternsArray.concat(['node_modules', '.git']),
      cwd: dir
    }).then(entries => {
      for (const entry of entries) {
        const stats = fs.statSync(path.join(dir, entry));
        files.push({
          path: path.join(dir, entry),
          size: stats.size
        });
      }
      return files;
    });
  }

  private async runRepopack(config: Parameters<typeof pack>[1], progressCallback?: Parameters<typeof pack>[2]): Promise<string> {
    await pack(config.cwd, config, progressCallback);

    return await fs.promises.readFile(path.join(config.cwd, "repopack-output.md"), "utf8");
  }

  private async countTokens(filePath: string): Promise<number> {
    // TODO: Implement token counting
    // Concern: Token counting is expensive, and this could result in DoS
    return 0;
  }
}
