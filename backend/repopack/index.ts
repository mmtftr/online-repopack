import { api } from "encore.dev/api";
import { Message, RepopackService } from "./service";

export interface ProcessRepoRequest {
  githubUrl: string;
  excludePatterns?: string[];
  sizeThresholdMb?: number;
  regexFilter?: string;
  maxRepoSizeMb?: number;
  outputStyle?: 'markdown' | 'xml';  // Add this line
}

export const processRepoStreaming = api.streamOut<ProcessRepoRequest, Message>({
  path: "/process-repo-streaming",
  expose: true,
  auth: false,
}, async (handshake, stream) => {
  const service = new RepopackService();
  for await (const message of service.processRepositoryStreaming(handshake)) {
    await stream.send(message);
  }
  return await stream.close();
});
