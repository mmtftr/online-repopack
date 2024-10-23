"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClipboardCopy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";

export default function ResultsPage() {
  const router = useRouter();
  const [output, setOutput] = useState<string>("");

  useEffect(() => {
    const storedOutput = localStorage.getItem("repopackOutput");
    if (!storedOutput) {
      router.replace("/");
      return;
    }
    setOutput(storedOutput);
  }, [router]);

  const [isCopying, setIsCopying] = useState(false);

  const handleCopy = () => {
    setIsCopying(true);
    navigator.clipboard.writeText(output).then(() => {
      toast.success("Copied to clipboard!");
      setTimeout(() => setIsCopying(false), 1000);
    });
  };

  const handleNew = () => {
    localStorage.removeItem("repopackOutput");
    router.push("/");
  };

  if (!output) {
    return null;
  }

  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Repository Analysis Results</CardTitle>
        </CardHeader>

        <CardContent>
          <pre className="bg-gray-100 p-4 rounded-lg overflow-auto max-h-[600px] text-sm">
            {output}
          </pre>
        </CardContent>

        <CardFooter className="space-x-4">
          <Button
            onClick={handleCopy}
            disabled={isCopying}
            className={isCopying ? "opacity-50 cursor-not-allowed" : ""}
          >
            <ClipboardCopy className="w-4 h-4 mr-2" />
            {isCopying ? "Copied!" : "Copy to Clipboard"}
          </Button>
          <Button variant="outline" onClick={handleNew}>
            Process Another Repository
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
