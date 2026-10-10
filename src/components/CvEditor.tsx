"use client";

import type { Cv, Education, Experience, Project, SectionLabels } from "@/lib/schema";

type Props = {
  cv: Cv;
  labels: SectionLabels;
  onChange: (cv: Cv) => void;
};

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <em className="muted"> {hint}</em>}
      </span>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// Edits a string[] as a textarea with one item per line. Empty lines are kept
// while typing and filtered out when the PDF is rendered.
function Lines({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  rows?: number;
}) {
  return (
    <Area
      label={label}
      hint="(câte unul pe rând)"
      rows={rows ?? Math.max(3, value.length + 1)}
      value={value.join("\n")}
      onChange={(v) => onChange(v.split("\n"))}
    />
  );
}

function update<T>(list: T[], index: number, item: T): T[] {
  return list.map((x, i) => (i === index ? item : x));
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

function EntryControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="entry-controls">
      <button type="button" className="button ghost" disabled={index === 0} onClick={() => onMove(-1)} title="Mută în sus">
        ↑
      </button>
      <button type="button" className="button ghost" disabled={index === count - 1} onClick={() => onMove(1)} title="Mută în jos">
        ↓
      </button>
      <button type="button" className="button ghost danger" onClick={onRemove} title="Șterge">
        ✕
      </button>
    </div>
  );
}

const emptyExperience: Experience = {
  title: "",
  company: "",
  location: "",
  startDate: "",
  endDate: "",
  description: "",
  bullets: [],
};
const emptyProject: Project = { name: "", description: "", bullets: [] };
const emptyEducation: Education = {
  degree: "",
  institution: "",
  location: "",
  startDate: "",
  endDate: "",
  details: "",
};

export function CvEditor({ cv, labels, onChange }: Props) {
  const set = <K extends keyof Cv>(key: K, value: Cv[K]) => onChange({ ...cv, [key]: value });

  return (
    <div className="editor">
      <fieldset className="card">
        <legend>Antet</legend>
        <div className="grid2">
          <Field label="Nume" value={cv.name} onChange={(v) => set("name", v)} />
          <Field label="Titlu" value={cv.headline} onChange={(v) => set("headline", v)} />
          <Field label="Email" value={cv.contact.email} onChange={(v) => set("contact", { ...cv.contact, email: v })} />
          <Field label="Telefon" value={cv.contact.phone} onChange={(v) => set("contact", { ...cv.contact, phone: v })} />
          <Field label="Locație" value={cv.contact.location} onChange={(v) => set("contact", { ...cv.contact, location: v })} />
        </div>
        <Lines label="Linkuri" value={cv.contact.links} onChange={(v) => set("contact", { ...cv.contact, links: v })} rows={2} />
      </fieldset>

      <fieldset className="card">
        <legend>{labels.summary}</legend>
        <Area label="" value={cv.summary} onChange={(v) => set("summary", v)} rows={5} />
      </fieldset>

      <fieldset className="card">
        <legend>{labels.experience}</legend>
        {cv.experience.map((job, i) => (
          <div key={i} className="entry">
            <EntryControls
              index={i}
              count={cv.experience.length}
              onMove={(d) => set("experience", move(cv.experience, i, d))}
              onRemove={() => set("experience", cv.experience.filter((_, j) => j !== i))}
            />
            <div className="grid2">
              <Field label="Rol" value={job.title} onChange={(v) => set("experience", update(cv.experience, i, { ...job, title: v }))} />
              <Field label="Companie" value={job.company} onChange={(v) => set("experience", update(cv.experience, i, { ...job, company: v }))} />
              <Field label="Început" value={job.startDate} onChange={(v) => set("experience", update(cv.experience, i, { ...job, startDate: v }))} />
              <Field label="Sfârșit" value={job.endDate} onChange={(v) => set("experience", update(cv.experience, i, { ...job, endDate: v }))} />
              <Field label="Locație" value={job.location} onChange={(v) => set("experience", update(cv.experience, i, { ...job, location: v }))} />
            </div>
            <Area label="Descriere scurtă" value={job.description} onChange={(v) => set("experience", update(cv.experience, i, { ...job, description: v }))} rows={2} />
            <Lines label="Realizări / responsabilități" value={job.bullets} onChange={(v) => set("experience", update(cv.experience, i, { ...job, bullets: v }))} />
          </div>
        ))}
        <button type="button" className="button ghost" onClick={() => set("experience", [...cv.experience, emptyExperience])}>
          + Adaugă experiență
        </button>
      </fieldset>

      <fieldset className="card">
        <legend>{labels.projects}</legend>
        {cv.projects.map((p, i) => (
          <div key={i} className="entry">
            <EntryControls
              index={i}
              count={cv.projects.length}
              onMove={(d) => set("projects", move(cv.projects, i, d))}
              onRemove={() => set("projects", cv.projects.filter((_, j) => j !== i))}
            />
            <Field label="Nume proiect" value={p.name} onChange={(v) => set("projects", update(cv.projects, i, { ...p, name: v }))} />
            <Area label="Descriere" value={p.description} onChange={(v) => set("projects", update(cv.projects, i, { ...p, description: v }))} rows={2} />
            <Lines label="Detalii" value={p.bullets} onChange={(v) => set("projects", update(cv.projects, i, { ...p, bullets: v }))} />
          </div>
        ))}
        <button type="button" className="button ghost" onClick={() => set("projects", [...cv.projects, emptyProject])}>
          + Adaugă proiect
        </button>
      </fieldset>

      <fieldset className="card">
        <legend>{labels.skills}</legend>
        {cv.skills.map((s, i) => (
          <div key={i} className="entry">
            <EntryControls
              index={i}
              count={cv.skills.length}
              onMove={(d) => set("skills", move(cv.skills, i, d))}
              onRemove={() => set("skills", cv.skills.filter((_, j) => j !== i))}
            />
            <Field label="Categorie" value={s.category} onChange={(v) => set("skills", update(cv.skills, i, { ...s, category: v }))} />
            <Field
              label="Competențe (separate prin virgulă)"
              value={s.items.join(", ")}
              onChange={(v) => set("skills", update(cv.skills, i, { ...s, items: v.split(",").map((x) => x.trimStart()) }))}
            />
          </div>
        ))}
        <button type="button" className="button ghost" onClick={() => set("skills", [...cv.skills, { category: "", items: [] }])}>
          + Adaugă categorie
        </button>
      </fieldset>

      <fieldset className="card">
        <legend>{labels.education}</legend>
        {cv.education.map((e, i) => (
          <div key={i} className="entry">
            <EntryControls
              index={i}
              count={cv.education.length}
              onMove={(d) => set("education", move(cv.education, i, d))}
              onRemove={() => set("education", cv.education.filter((_, j) => j !== i))}
            />
            <div className="grid2">
              <Field label="Diplomă / specializare" value={e.degree} onChange={(v) => set("education", update(cv.education, i, { ...e, degree: v }))} />
              <Field label="Instituție" value={e.institution} onChange={(v) => set("education", update(cv.education, i, { ...e, institution: v }))} />
              <Field label="Început" value={e.startDate} onChange={(v) => set("education", update(cv.education, i, { ...e, startDate: v }))} />
              <Field label="Sfârșit" value={e.endDate} onChange={(v) => set("education", update(cv.education, i, { ...e, endDate: v }))} />
              <Field label="Locație" value={e.location} onChange={(v) => set("education", update(cv.education, i, { ...e, location: v }))} />
            </div>
            <Area label="Detalii" value={e.details} onChange={(v) => set("education", update(cv.education, i, { ...e, details: v }))} rows={2} />
          </div>
        ))}
        <button type="button" className="button ghost" onClick={() => set("education", [...cv.education, emptyEducation])}>
          + Adaugă studii
        </button>
      </fieldset>

      <fieldset className="card">
        <legend>
          {labels.certifications} &amp; {labels.languages}
        </legend>
        <Lines label={labels.certifications} value={cv.certifications} onChange={(v) => set("certifications", v)} />
        <p className="field-title">{labels.languages}</p>
        {cv.languages.map((l, i) => (
          <div key={i} className="grid2 row-with-remove">
            <Field label="Limbă" value={l.language} onChange={(v) => set("languages", update(cv.languages, i, { ...l, language: v }))} />
            <Field label="Nivel" value={l.level} onChange={(v) => set("languages", update(cv.languages, i, { ...l, level: v }))} />
            <button type="button" className="button ghost danger" onClick={() => set("languages", cv.languages.filter((_, j) => j !== i))} title="Șterge">
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="button ghost" onClick={() => set("languages", [...cv.languages, { language: "", level: "" }])}>
          + Adaugă limbă
        </button>
      </fieldset>
    </div>
  );
}
