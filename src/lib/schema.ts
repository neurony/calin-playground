import { z } from "zod";

// All fields are required so structured outputs always return a complete
// shape; "missing" information is expressed as an empty string or array.

export const ExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  description: z.string(),
  bullets: z.array(z.string()),
});

export const EducationSchema = z.object({
  degree: z.string(),
  institution: z.string(),
  location: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  details: z.string(),
});

export const ProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  bullets: z.array(z.string()),
});

export const CvSchema = z.object({
  name: z.string(),
  headline: z.string(),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.string()),
  }),
  summary: z.string(),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  skills: z.array(
    z.object({
      category: z.string(),
      items: z.array(z.string()),
    }),
  ),
  certifications: z.array(z.string()),
  languages: z.array(
    z.object({
      language: z.string(),
      level: z.string(),
    }),
  ),
});

export const AnalysisSchema = z.object({
  // JD requirements that the candidate's real experience covers, and where.
  matched: z.array(
    z.object({
      requirement: z.string(),
      evidence: z.string(),
    }),
  ),
  // JD requirements with no support in the source material. Never added to the CV.
  gaps: z.array(z.string()),
  // Short note on what was emphasised, reordered or left out, and why.
  notes: z.string(),
});

export const GenerationSchema = z.object({
  cv: CvSchema,
  analysis: AnalysisSchema,
  // Labels for the PDF section headings, in the CV's language.
  labels: z.object({
    summary: z.string(),
    experience: z.string(),
    projects: z.string(),
    education: z.string(),
    skills: z.string(),
    certifications: z.string(),
    languages: z.string(),
  }),
});

export type Cv = z.infer<typeof CvSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type SectionLabels = Generation["labels"];

export type OutputLanguage = "auto" | "ro" | "en";
