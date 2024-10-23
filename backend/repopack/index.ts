import { api } from "encore.dev/api";
import { Message, RepopackService } from "./service";

export interface ProcessRepoRequest {
  githubUrl: string;
  excludePatterns?: string[];
  sizeThresholdMb?: number;
  regexFilter?: string;
  maxRepoSizeMb?: number;
}

export async function processRepoImpl(req: ProcessRepoRequest): Promise<{ output: string }> {
  const service = new RepopackService();
  return {
    output: await service.processRepository(req),
  };
}


export const processRepo = api<ProcessRepoRequest, Promise<{ output: string }>>({
  method: "POST",
  path: "/process-repo",
  expose: true,
  auth: false,
}, processRepoImpl);


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
