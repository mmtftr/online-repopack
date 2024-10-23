"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function UnauthenticatedContent() {
  const searchParams = useSearchParams();
  const fromPage = searchParams.get("from");

  return (
    <section>
      <h1 className="text-3xl">Unauthenticated</h1>
      <br />
      <p>
        You need to be logged in to view <code>{fromPage}</code>
      </p>
    </section>
  );
}

export default function Unauthenticated() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UnauthenticatedContent />
    </Suspense>
  );
}
