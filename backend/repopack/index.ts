import { api } from "encore.dev/api";
import { Message, RepopackService, SelectedFilesMessage } from "./service";

const FILE_SELECTION_TIMEOUT_MS = 100000;
export interface ProcessRepoRequest {
  githubUrl: string;
  excludePatterns?: string;
  sizeThresholdMb?: number;
  outputStyle?: 'markdown' | 'xml';  // Add this line
}

export const processRepoStreaming = api.streamInOut<ProcessRepoRequest, SelectedFilesMessage, Message>({
  path: "/process-repo-streaming",
  expose: true,
  auth: false,
}, async (handshake, stream) => {
  const service = new RepopackService();

  const generator = service.processRepositoryStreaming(handshake);
  for await (const message of generator) {
    await stream.send(message);
    if (message.waitingForFileSelection) {
      const selectedFiles = await Promise.race([stream.recv(), new Promise<SelectedFilesMessage | undefined>(resolve => setTimeout(() => resolve(undefined), FILE_SELECTION_TIMEOUT_MS))]);
      if (selectedFiles) {
        await generator.next(selectedFiles);
      }
    }
  }
  return await stream.close();
});
