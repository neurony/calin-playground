"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { OutputLanguage } from "@/lib/schema";

export type InputState = {
  jobDescription: string;
  cvText: string;
  extraInfo: string;
  language: OutputLanguage;
};

type Props = {
  value: InputState;
  onChange: (value: InputState) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  jdFile: File | null;
  onJdFileChange: (file: File | null) => void;
  // Analyse the inputs and ask clarifying questions (the default path).
  onSubmit: () => void;
  // Go to step 2 without questions (only the extra information field).
  onSkip: () => void;
  // Clear everything (inputs, files, questions, answers, generated CV) for a new role.
  onReset: () => void;
  loading: boolean;
};

const ACCEPT =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

function FilePicker({
  inputRef,
  file,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <div className="file-row">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file && (
        <button
          type="button"
          className="button ghost"
          onClick={() => {
            onChange(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
        >
          Elimină fișierul
        </button>
      )}
    </div>
  );
}

export function InputForm({
  value,
  onChange,
  file,
  onFileChange,
  jdFile,
  onJdFileChange,
  onSubmit,
  onSkip,
  onReset,
  loading,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const jdFileInput = useRef<HTMLInputElement>(null);
  // Reset takes two clicks: the first asks for confirmation for a few seconds.
  const [confirmingReset, setConfirmingReset] = useState(false);
  useEffect(() => {
    if (!confirmingReset) return;
    const timer = setTimeout(() => setConfirmingReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingReset]);

  function handleReset() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setConfirmingReset(false);
    if (fileInput.current) fileInput.current.value = "";
    if (jdFileInput.current) jdFileInput.current.value = "";
    onReset();
  }
  const set = <K extends keyof InputState>(key: K, v: InputState[K]) =>
    onChange({ ...value, [key]: v });

  const hasCv = Boolean(file || value.cvText.trim());
  const hasJobDescription = Boolean(jdFile || value.jobDescription.trim());
  const canSubmit = hasJobDescription && hasCv && !loading;

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="reset-bar">
        <button
          type="button"
          className="button ghost danger"
          disabled={loading}
          onClick={handleReset}
          title="Șterge anunțul, CV-ul, întrebările, răspunsurile și CV-ul generat"
        >
          {confirmingReset ? "Sigur? Apasă din nou pentru a șterge tot" : "Resetează tot"}
        </button>
      </div>

      <section>
        <h2>1. Job description</h2>
        <p className="muted">
          Încarcă anunțul (PDF, DOCX, TXT) și/sau lipește-l ca text: responsabilități, cerințe,
          despre companie.
        </p>
        <FilePicker inputRef={jdFileInput} file={jdFile} onChange={onJdFileChange} />
        <textarea
          rows={12}
          value={value.jobDescription}
          onChange={(e) => set("jobDescription", e.target.value)}
          placeholder="(Opțional dacă ai încărcat fișierul) Lipește aici job description-ul…"
        />
      </section>

      <section>
        <h2>2. CV-ul tău</h2>
        <p className="muted">Încarcă CV-ul (PDF, DOCX, TXT) și/sau lipește-l ca text.</p>
        <FilePicker inputRef={fileInput} file={file} onChange={onFileChange} />
        <textarea
          rows={8}
          value={value.cvText}
          onChange={(e) => set("cvText", e.target.value)}
          placeholder="(Opțional) Lipește CV-ul ca text…"
        />
      </section>

      <section className="form-footer">
        <label className="inline">
          Limba CV-ului:
          <select
            value={value.language}
            onChange={(e) => set("language", e.target.value as OutputLanguage)}
          >
            <option value="auto">Ca a job description-ului</option>
            <option value="ro">Română</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="inline">
          <button
            type="button"
            className="button ghost"
            disabled={!hasJobDescription || loading}
            onClick={onSkip}
          >
            Sari peste întrebări
          </button>
          <button type="submit" className="button primary" disabled={!canSubmit}>
            {loading ? "Se lucrează… (poate dura 1-2 minute)" : "Continuă: întrebări despre experiența ta"}
          </button>
        </div>
      </section>
      {!hasCv && hasJobDescription && (
        <p className="muted">
          Adaugă CV-ul ca să primești întrebări. Fără CV, poți sări peste întrebări și descrie
          experiența la pasul 2, în „Informații suplimentare”.
        </p>
      )}
    </form>
  );
}
