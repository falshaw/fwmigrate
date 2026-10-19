"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function TranslatePage() {
  const params = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");

  async function handleTranslate() {
    setLoading(true);
    setProgress("Translating rules...");

    const res = await fetch(`/api/v1/projects/${params.id}/translate`, {
      method: "POST",
    });
    if (res.ok) {
      setProgress("Translation complete!");
      setTimeout(
        () => router.push(`/dashboard/projects/${params.id}/review`),
        1000,
      );
    } else {
      setProgress("Translation failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Translate Rules</h1>

      <div className="card-luxury p-8 text-center">
        <p className="text-gray-400 mb-6">
          This will translate all parsed rules from the source vendor format to
          the target vendor format using AI-assisted translation.
        </p>

        {progress && <p className="text-orange-400 mb-4">{progress}</p>}

        <button
          onClick={handleTranslate}
          disabled={loading}
          className="btn-brand disabled:opacity-50"
        >
          {loading ? "Translating..." : "Translate All Rules"}
        </button>
      </div>
    </div>
  );
}
