"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { CvEditor } from "@/components/CvEditor";
import { InputForm, type InputState } from "@/components/InputForm";
import type { Generation } from "@/lib/schema";

// react-pdf only runs in the browser.
const PdfPreview = dynamic(() => import("@/components/PdfPreview"), {
  ssr: false,
  loading: () => <div className="preview-frame placeholder">Se încarcă previzualizarea…</div>,
});

const STORAGE_KEY = "cv-tailor-state-v1";

type Saved = { input: InputState; result: Generation | null };

const emptyInput: InputState = { jobDescription: "", cvText: "", extraInfo: "", language: "auto" };

export default function Home() {
  const [input, setInput] = useState<InputState>(emptyInput);
  const [file, setFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [result, setResult] = useState<Generation | null>(null);
  const [view, setView] = useState<"input" | "result">("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Restore the last session (text inputs and generated CV; files are not kept).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Saved;
        setInput({ ...emptyInput, ...saved.input });
        if (saved.result) {
          setResult(saved.result);
          setView("result");
        }
      }
    } catch {
      // Ignore unreadable or blocked storage.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, result } satisfies Saved));
    } catch {
      // Ignore unavailable storage.
    }
  }, [input, result, restored]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("jobDescription", input.jobDescription);
      body.set("cvText", input.cvText);
      body.set("extraInfo", input.extraInfo);
      body.set("language", input.language);
      if (file) body.set("cvFile", file);
      if (jdFile) body.set("jdFile", jdFile);

      const res = await fetch("/api/generate", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error ?? `Eroare ${res.status}`);
      }
      setResult(data as Generation);
      setView("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <header className="app-header">
        <div>
          <h1>CV Tailor</h1>
          <p className="muted">
            CV-ul tău, adaptat la job: accentuează ce ai făcut deja, fără să inventeze nimic.
          </p>
        </div>
        {result && (
          <nav className="tabs">
            <button
              className={`button ${view === "input" ? "primary" : "ghost"}`}
              onClick={() => setView("input")}
            >
              Input
            </button>
            <button
              className={`button ${view === "result" ? "primary" : "ghost"}`}
              onClick={() => setView("result")}
            >
              CV generat
            </button>
          </nav>
        )}
      </header>

      {error && <p className="error card">{error}</p>}

      {view === "input" || !result ? (
        <InputForm
          value={input}
          onChange={setInput}
          file={file}
          onFileChange={setFile}
          jdFile={jdFile}
          onJdFileChange={setJdFile}
          onSubmit={generate}
          loading={loading}
        />
      ) : (
        <>
          <AnalysisPanel analysis={result.analysis} />
          <div className="result-layout">
            <CvEditor
              cv={result.cv}
              labels={result.labels}
              onChange={(cv) => setResult({ ...result, cv })}
            />
            <div className="preview-column">
              <PdfPreview cv={result.cv} labels={result.labels} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
