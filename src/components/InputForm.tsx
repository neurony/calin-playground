"use client";

import { useRef } from "react";
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
  onSubmit: () => void;
  loading: boolean;
};

export function InputForm({ value, onChange, file, onFileChange, onSubmit, loading }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof InputState>(key: K, v: InputState[K]) =>
    onChange({ ...value, [key]: v });

  const hasCandidateInfo = Boolean(file || value.cvText.trim() || value.extraInfo.trim());
  const canSubmit = value.jobDescription.trim() && hasCandidateInfo && !loading;

  return (
    <form
      className="card form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <section>
        <h2>1. Job description</h2>
        <p className="muted">Lipește anunțul complet: responsabilități, cerințe, despre companie.</p>
        <textarea
          rows={12}
          value={value.jobDescription}
          onChange={(e) => set("jobDescription", e.target.value)}
          placeholder="Lipește aici job description-ul…"
        />
      </section>

      <section>
        <h2>2. CV-ul tău</h2>
        <p className="muted">Încarcă CV-ul (PDF, DOCX, TXT) și/sau lipește-l ca text.</p>
        <div className="file-row">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
          {file && (
            <button
              type="button"
              className="button ghost"
              onClick={() => {
                onFileChange(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              Elimină fișierul
            </button>
          )}
        </div>
        <textarea
          rows={8}
          value={value.cvText}
          onChange={(e) => set("cvText", e.target.value)}
          placeholder="(Opțional) Lipește CV-ul ca text…"
        />
      </section>

      <section>
        <h2>3. Informații suplimentare</h2>
        <p className="muted">
          Ce nu apare în CV: proiecte, tehnologii, responsabilități, rezultate. Doar lucruri reale;
          aplicația nu inventează nimic, dar poate folosi tot ce scrii aici.
        </p>
        <textarea
          rows={8}
          value={value.extraInfo}
          onChange={(e) => set("extraInfo", e.target.value)}
          placeholder="Ex.: Am condus migrarea către AWS a 3 servicii în 2023; lucrez zilnic cu PostgreSQL…"
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
        <button type="submit" className="button primary" disabled={!canSubmit}>
          {loading ? "Se generează… (poate dura 1-2 minute)" : "Generează CV personalizat"}
        </button>
      </section>
      {!hasCandidateInfo && value.jobDescription.trim() && (
        <p className="muted">Adaugă CV-ul sau informații despre experiența ta.</p>
      )}
    </form>
  );
}
