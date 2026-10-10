"use client";

import { pdf } from "@react-pdf/renderer";
import { useEffect, useState } from "react";
import type { Cv, SectionLabels } from "@/lib/schema";
import { CvDocument } from "./CvDocument";

function fileName(cv: Cv) {
  const base = cv.name.trim() ? `CV ${cv.name.trim()}` : "CV";
  return `${base.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_")}.pdf`;
}

export default function PdfPreview({ cv, labels }: { cv: Cv; labels: SectionLabels }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-render the PDF shortly after the user stops typing.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const blob = await pdf(<CvDocument cv={cv} labels={labels} />).toBlob();
        if (cancelled) return;
        setUrl(URL.createObjectURL(blob));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cv, labels]);

  // Revoke the previous object URL when a new one replaces it.
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <div className="preview">
      <div className="preview-toolbar">
        <span className="muted">Previzualizare PDF</span>
        {url && (
          <a className="button primary" href={url} download={fileName(cv)}>
            Descarcă PDF
          </a>
        )}
      </div>
      {error && <p className="error">Eroare la generarea PDF-ului: {error}</p>}
      {url ? (
        <iframe className="preview-frame" src={url} title="Previzualizare CV" />
      ) : (
        <div className="preview-frame placeholder">Se generează PDF-ul…</div>
      )}
    </div>
  );
}
