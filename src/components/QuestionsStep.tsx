"use client";

import type { Answer, Question } from "@/lib/schema";

type Props = {
  questions: Question[];
  // One answer per question, same order.
  answers: Answer[];
  onChange: (answers: Answer[]) => void;
  // True when the user skipped the questions; only the extra information field is shown.
  skipped: boolean;
  extraInfo: string;
  onExtraInfoChange: (value: string) => void;
  canGenerate: boolean;
  onBack: () => void;
  onGenerate: () => void;
  loading: boolean;
};

export function QuestionsStep({
  questions,
  answers,
  onChange,
  skipped,
  extraInfo,
  onExtraInfoChange,
  canGenerate,
  onBack,
  onGenerate,
  loading,
}: Props) {
  const update = (index: number, patch: Partial<Answer>) =>
    onChange(answers.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  const done = answers.filter((a) => a.none || a.answer.trim()).length;

  return (
    <div className="questions">
      {answers.length > 0 && (
        <div className="card">
          <h2>Câteva întrebări înainte de generare</h2>
          <p className="muted">
            Am comparat CV-ul tău cu anunțul. Întrebările sunt despre cerințele
            care nu apar în CV sau apar prea vag. Ce răspunzi aici se poate
            folosi în CV. Dacă nu ai experiența respectivă, bifează „Nu am
            experiență cu asta”; nu se va adăuga nimic. Întrebările lăsate goale
            sunt ignorate.
          </p>
        </div>
      )}

      {answers.length === 0 && (
        <div className="card">
          <p>
            {skipped
              ? "Ai sărit peste întrebări. Dacă vrei, adaugă mai jos informații suplimentare, apoi generează CV-ul."
              : "CV-ul tău acoperă deja cerințele din anunț. Dacă vrei, adaugă mai jos informații suplimentare, apoi generează CV-ul."}
          </p>
        </div>
      )}

      {answers.map((a, i) => (
        <div
          key={i}
          className={`card question ${a.none || a.answer.trim() ? "done" : ""}`}
        >
          <div className="question-head">
            <span className={`kind ${questions[i]?.kind}`}>
              {questions[i]?.kind === "weak"
                ? "Neclar în CV"
                : "Lipsește din CV"}
            </span>
            {a.requirement && <strong>{a.requirement}</strong>}
          </div>
          {questions[i]?.why && (
            <p className="muted small">{questions[i].why}</p>
          )}
          <label htmlFor={`q-${i}`} className="question-text">
            {a.question}
          </label>
          <textarea
            id={`q-${i}`}
            rows={3}
            value={a.answer}
            disabled={a.none}
            placeholder="Răspunsul tău (opțional)…"
            onChange={(e) => update(i, { answer: e.target.value })}
          />
          <label className="inline muted">
            <input
              type="checkbox"
              checked={a.none}
              onChange={(e) => update(i, { none: e.target.checked })}
            />
            Nu am experiență cu asta
          </label>
        </div>
      ))}

      <div className="card">
        <h2>Informații suplimentare</h2>
        <p className="muted">
          Orice altceva despre experiența ta care nu apare în CV: proiecte,
          tehnologii, responsabilități, rezultate. Doar lucruri reale; aplicația
          nu inventează nimic, dar poate folosi tot ce scrii aici.
        </p>
        <textarea
          rows={6}
          value={extraInfo}
          onChange={(e) => onExtraInfoChange(e.target.value)}
          placeholder="Ex.: Am condus migrarea către AWS a 3 servicii în 2023; lucrez zilnic cu PostgreSQL…"
        />
      </div>

      <div className="card form-footer">
        <button type="button" className="button ghost" onClick={onBack}>
          Înapoi la date
        </button>
        <div className="inline">
          {answers.length > 0 && (
            <span className="muted small">
              {done} din {answers.length} răspunse
            </span>
          )}
          <button
            type="button"
            className="button primary"
            disabled={loading || !canGenerate}
            onClick={onGenerate}
          >
            {loading
              ? "Se generează… (poate dura 1-2 minute)"
              : "Generează CV personalizat"}
          </button>
        </div>
      </div>
    </div>
  );
}
