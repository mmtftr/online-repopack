"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { processRepoStreaming } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { repopack } from "./lib/client";

const FILE_SELECTION_TIMEOUT_MS = 100000;
interface LargeFile {
  path: string;
  size: number;
  tokenCount: number;
}

interface ProcessedRepo {
  url: string;
  timestamp: number;
  outputUrl?: string;
  output?: string;
  size: number;
}

const MAX_HISTORY_ITEMS = 10;

function LargeFilesSelector({
  files,
  thresholdMb,
  onSelect,
}: {
  files: LargeFile[];
  thresholdMb: number | undefined;
  onSelect: (selectedFiles: string[]) => void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    new Set(
      typeof thresholdMb === "number"
        ? files
            .filter((f) => f.size > (thresholdMb ?? 0) * 1024 * 1024)
            .map((f) => f.path)
        : []
    )
  );

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Large Files Found</h3>
      <p className="text-sm text-gray-500">
        Select files to exclude from the analysis:
      </p>
      <div className="space-y-2">
        {files.map((file) => (
          <div key={file.path} className="flex items-center space-x-2">
            <input
              type="checkbox"
              id={file.path}
              checked={selectedFiles.has(file.path)}
              onChange={(e) => {
                const newSelected = new Set(selectedFiles);
                if (e.target.checked) {
                  newSelected.add(file.path);
                } else {
                  newSelected.delete(file.path);
                }
                setSelectedFiles(newSelected);
              }}
            />
            <label htmlFor={file.path} className="text-sm">
              {file.path} ({(file.size / 1024 / 1024).toFixed(2)}MB,{" "}
              {file.tokenCount.toLocaleString()} tokens)
            </label>
          </div>
        ))}
      </div>
      <Button
        onClick={() => onSelect(Array.from(selectedFiles))}
        className="w-full"
      >
        Continue Processing
      </Button>
    </div>
  );
}

function saveToHistory(repo: ProcessedRepo) {
  const history = getHistory();
  history.unshift(repo);
  while (history.length > MAX_HISTORY_ITEMS) {
    history.pop();
  }
  localStorage.setItem("repopackHistory", JSON.stringify(history));
}

function getHistory(): ProcessedRepo[] {
  try {
    return JSON.parse(localStorage.getItem("repopackHistory") || "[]");
  } catch {
    return [];
  }
}

function ProcessHistory({ history }: { history: ProcessedRepo[] }) {
  if (history.length === 0) return null;

  const router = useRouter();
  return (
    <Card className="max-w-2xl mx-auto mt-8">
      <CardHeader>
        <CardTitle>Recent Repositories</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {history.map((repo, i) => (
            <div
              key={i}
              className="flex justify-between items-center p-2 border rounded"
            >
              <div>
                <div className="font-medium">{repo.url}</div>
                <div className="text-sm text-gray-500">
                  {new Date(repo.timestamp).toLocaleString()} -
                  {(repo.size / 1024).toFixed(2)}KB
                </div>
              </div>
              {(repo.output || repo.outputUrl) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (repo.output) {
                      localStorage.setItem("repopackOutput", repo.output);
                      router.push("/results");
                    } else if (repo.outputUrl) {
                      window.location.href = repo.outputUrl;
                    }
                  }}
                >
                  View
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [fileSelectionUI, setFileSelectionUI] = useState<React.ReactNode>(null);
  const [history, setHistory] = useState<ProcessedRepo[]>([]);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const request: repopack.ProcessRepoRequest = {
      githubUrl: formData.get("githubUrl") as string,
      sizeThresholdMb: Number(formData.get("sizeThreshold")) || undefined,
      regexFilter: (formData.get("regexFilter") as string) || undefined,
      excludePatterns: (formData.get("excludePatterns") as string) || undefined,
      outputStyle:
        (formData.get(
          "outputStyle"
        ) as repopack.ProcessRepoRequest["outputStyle"]) || "markdown",
    };

    try {
      const stream = await processRepoStreaming(request);
      for await (const message of stream) {
        setProgressMessage(message.humanFriendlyProgress);
        setProgress(message.progress ?? 0);

        if (message.waitingForFileSelection && message.largeFiles) {
          // Show file selection UI and wait for user input
          await new Promise((resolve) => {
            setTimeout(() => {
              resolve(null);
            }, FILE_SELECTION_TIMEOUT_MS);

            setFileSelectionUI(
              <LargeFilesSelector
                thresholdMb={request.sizeThresholdMb}
                files={message.largeFiles!}
                onSelect={async (selectedFiles) => {
                  setFileSelectionUI(null);
                  await stream.send({ selectedFiles });
                  resolve(null);
                }}
              />
            );
          });
        }
        if (message.complete) {
          if (message.error) {
            setError(message.error);
          } else {
            const repo: ProcessedRepo = {
              url: request.githubUrl,
              timestamp: Date.now(),
              outputUrl: message.outputUrl,
              output: message.output,
              size: message.outputSize || 0,
            };
            saveToHistory(repo);
            setHistory(getHistory());

            if (message.output) {
              localStorage.setItem("repopackOutput", message.output);
              router.push("/results");
            } else if (message.outputUrl) {
              window.location.href = message.outputUrl;
            }
          }
          break;
        }
      }

      await stream.close();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setIsSubmitting(false);
      setProgress(0);
    }
  };
  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Repopack Online</CardTitle>
          <CardDescription>
            Process your GitHub repository with Repopack
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {isSubmitting && !fileSelectionUI && (
              <div className="space-y-2">
                <Progress value={progress} className="w-full" />
                <p className="text-sm text-gray-500">{progressMessage}</p>
              </div>
            )}
            {fileSelectionUI ? (
              fileSelectionUI
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="githubUrl">GitHub Repository URL</Label>
                  <Input
                    id="githubUrl"
                    name="githubUrl"
                    placeholder="https://github.com/username/repo"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outputStyle">Output Style</Label>
                  <Select name="outputStyle" defaultValue="markdown">
                    <SelectTrigger>
                      <SelectValue placeholder="Select output style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="markdown">Markdown</SelectItem>
                      <SelectItem value="xml">XML</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sizeThreshold">
                    Size Threshold (MB) - Files larger than this will be flagged
                  </Label>
                  <Input
                    id="sizeThreshold"
                    name="sizeThreshold"
                    type="number"
                    step={0.01}
                    placeholder="number of MB - 1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="excludePatterns">
                    Exclude Patterns (One per line)
                  </Label>
                  <textarea
                    id="excludePatterns"
                    name="excludePatterns"
                    className="w-full min-h-[100px] px-3 py-2 border rounded-md"
                    placeholder=".log&#10;dist/&#10;.min.js"
                  />
                </div>
              </>
            )}
          </CardContent>
          {!fileSelectionUI && (
            <CardFooter>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Processing..." : "Process Repository"}
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>
      <ProcessHistory history={history} />
    </div>
  );
}
