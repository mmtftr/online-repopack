import Client, { Environment, Local, repopack } from "@/app/lib/client";

const API_BASE_URL = process.env.NODE_ENV === "development" ? Local : Environment("staging");

const cl = new Client(API_BASE_URL);

export const processRepository = async (data: repopack.ProcessRepoRequest): Promise<{ output: string }> => {
  return await cl.repopack.processRepo(data);
};

export const processRepoStreaming = async (data: repopack.ProcessRepoRequest) => {
  return cl.repopack.processRepoStreaming(data);
};
