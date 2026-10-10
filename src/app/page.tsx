"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { CvEditor } from "@/components/CvEditor";
import { InputForm, type InputState } from "@/components/InputForm";
import { QuestionsStep } from "@/components/QuestionsStep";
import type { Answer, Generation, Question } from "@/lib/schema";

// react-pdf only runs in the browser.
const PdfPreview = dynamic(() => import("@/components/PdfPreview"), {
  ssr: false,
  loading: () => <div className="preview-frame placeholder">Se încarcă previzualizarea…</div>,
});

const STORAGE_KEY = "cv-tailor-state-v1";

type View = "input" | "questions" | "result";

type Saved = {
  input: InputState;
  questions?: Question[] | null;
  questionsSkipped?: boolean;
  answers?: Answer[];
  result: Generation | null;
};

const STEPS: { view: View; label: string }[] = [
  { view: "input", label: "1. Date" },
  { view: "questions", label: "2. Întrebări" },
  { view: "result", label: "3. CV generat" },
];

const emptyInput: InputState = { jobDescription: "", cvText: "", extraInfo: "", language: "auto" };

export default function Home() {
  const [input, setInput] = useState<InputState>(emptyInput);
  const [file, setFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [questionsSkipped, setQuestionsSkipped] = useState(false);
  const [result, setResult] = useState<Generation | null>(null);
  const [view, setView] = useState<View>("input");
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
        if (saved.questions) {
          setQuestions(saved.questions);
          setAnswers(saved.answers ?? []);
          setQuestionsSkipped(saved.questionsSkipped ?? false);
          setView("questions");
        }
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
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ input, questions, questionsSkipped, answers, result } satisfies Saved),
      );
    } catch {
      // Ignore unavailable storage.
    }
  }, [input, questions, questionsSkipped, answers, result, restored]);

  // Posts the inputs (plus any extra fields) to an API route and returns its JSON.
  async function post<T>(path: string, extra: Record<string, string> = {}): Promise<T | null> {
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
      for (const [key, value] of Object.entries(extra)) body.set(key, value);

      const res = await fetch(path, { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error ?? `Eroare ${res.status}`);
      }
      return data as T;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function askQuestions() {
    const data = await post<{ questions: Question[] }>("/api/questions");
    if (!data) return;
    setQuestions(data.questions);
    setQuestionsSkipped(false);
    setAnswers(
      data.questions.map((q) => ({
        requirement: q.requirement,
        question: q.question,
        answer: "",
        none: false,
      })),
    );
    setView("questions");
  }

  async function generate(withAnswers: Answer[]) {
    const data = await post<Generation>("/api/generate", { answers: JSON.stringify(withAnswers) });
    if (!data) return;
    setResult(data);
    setView("result");
  }

  function skipQuestions() {
    setError(null);
    setQuestions([]);
    setAnswers([]);
    setQuestionsSkipped(true);
    setView("questions");
  }

  function resetAll() {
    setInput({ ...emptyInput, language: input.language });
    setFile(null);
    setJdFile(null);
    setQuestions(null);
    setAnswers([]);
    setQuestionsSkipped(false);
    setResult(null);
    setError(null);
    setView("input");
    window.scrollTo({ top: 0 });
  }

  const canGenerate = Boolean(
    (jdFile || input.jobDescription.trim()) &&
      (file || input.cvText.trim() || input.extraInfo.trim()),
  );

  const available: Record<View, boolean> = {
    input: true,
    questions: questions !== null,
    result: result !== null,
  };

  return (
    <main className="container">
      <header className="app-header">
        <div>
          <h1>CV Tailor</h1>
          <p className="muted">
            CV-ul tău, adaptat la job: păstrează tot ce ai în CV, pune în față experiența relevantă și nu inventează nimic.
          </p>
        </div>
        <nav className="tabs">
          {STEPS.map((step) => (
            <button
              key={step.view}
              className={`button ${view === step.view ? "primary" : "ghost"}`}
              disabled={!available[step.view]}
              onClick={() => setView(step.view)}
            >
              {step.label}
            </button>
          ))}
        </nav>
      </header>

      {error && <p className="error card">{error}</p>}

      {view === "input" && (
        <InputForm
          value={input}
          onChange={setInput}
          file={file}
          onFileChange={setFile}
          jdFile={jdFile}
          onJdFileChange={setJdFile}
          onSubmit={askQuestions}
          onSkip={skipQuestions}
          onReset={resetAll}
          loading={loading}
        />
      )}

      {view === "questions" && questions && (
        <QuestionsStep
          questions={questions}
          answers={answers}
          onChange={setAnswers}
          skipped={questionsSkipped}
          extraInfo={input.extraInfo}
          onExtraInfoChange={(extraInfo) => setInput({ ...input, extraInfo })}
          canGenerate={canGenerate}
          onBack={() => setView("input")}
          onGenerate={() => generate(answers)}
          loading={loading}
        />
      )}

      {view === "result" && result && (
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
