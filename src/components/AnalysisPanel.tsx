import type { Analysis } from "@/lib/schema";

export function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  return (
    <details className="card analysis" open>
      <summary>
        <h2>Ce s-a accentuat și de ce</h2>
      </summary>
      {analysis.notes.trim() && <p>{analysis.notes}</p>}

      {analysis.matched.length > 0 && (
        <>
          <h3>Cerințe acoperite de experiența ta</h3>
          <ul className="matched">
            {analysis.matched.map((m, i) => (
              <li key={i}>
                <strong>{m.requirement}</strong>
                <span className="muted"> ← {m.evidence}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {analysis.gaps.length > 0 && (
        <>
          <h3>Cerințe fără acoperire în materialul tău</h3>
          <p className="muted">
            Nu au fost adăugate în CV. Dacă de fapt ai această experiență, adaug-o la „Informații
            suplimentare” și regenerează.
          </p>
          <ul className="gaps">
            {analysis.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
