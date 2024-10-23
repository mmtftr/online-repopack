import Client, { Environment, Local } from "@/app/lib/client";
import { RepopackRequest, RepopackResponse } from "./types";


const API_BASE_URL = process.env.NODE_ENV === "development" ? Local : Environment("staging");

const cl = new Client(API_BASE_URL);

export const processRepository = async (data: RepopackRequest): Promise<RepopackResponse> => {
  const response = await cl.repopack.processRepo(data);

  return {
    status: "completed",
    output: response.output,
  };
};

export const processRepoStreaming = async (data: RepopackRequest) => {
  return cl.repopack.processRepoStreaming(data);
};
