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
import { processRepoStreaming } from "@/lib/api";
import { RepopackRequest } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function HomePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setProgress(0);
    setProgressMessage("");

    const formData = new FormData(event.currentTarget);
    const request: RepopackRequest = {
      githubUrl: formData.get("githubUrl") as string,
      sizeThresholdMb: Number(formData.get("sizeThreshold")) || undefined,
      regexFilter: (formData.get("regexFilter") as string) || undefined,
      excludePatterns: (formData.get("excludePatterns") as string)
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
    };

    try {
      const stream = await processRepoStreaming(request);
      for await (const message of stream) {
        setProgressMessage(message.humanFriendlyProgress);
        setProgress((prev) => Math.min(prev + 10, 90)); // Increment progress

        if (message.complete) {
          if (message.error) {
            setError(message.error);
          } else if (message.output) {
            localStorage.setItem("repopackOutput", message.output);
            router.push("/results");
          }
          break;
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setIsSubmitting(false);
      setProgress(100);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>RepoRepo</CardTitle>
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

            {isSubmitting && (
              <div className="space-y-2">
                <Progress value={progress} className="w-full" />
                <p className="text-sm text-gray-500">{progressMessage}</p>
              </div>
            )}

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
              <Label htmlFor="sizeThreshold">
                Size Threshold (MB) - Files larger than this will be excluded
              </Label>
              <Input
                id="sizeThreshold"
                name="sizeThreshold"
                type="number"
                placeholder="1"
                min="0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="regexFilter">Regex Filter (Optional)</Label>
              <Input
                id="regexFilter"
                name="regexFilter"
                placeholder="\.test\.|\.spec\."
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
                placeholder="*.log&#10;dist/*&#10;*.min.js"
              />
            </div>
          </CardContent>

          <CardFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Processing..." : "Process Repository"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
