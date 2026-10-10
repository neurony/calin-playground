import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Cv, SectionLabels } from "@/lib/schema";

// Source Sans 3 covers Romanian diacritics (ș, ț, ă, î, â), which the built-in
// PDF fonts do not.
Font.register({
  family: "Source Sans 3",
  fonts: [
    { src: "/fonts/SourceSans3-Regular.ttf" },
    { src: "/fonts/SourceSans3-Bold.ttf", fontWeight: "bold" },
    { src: "/fonts/SourceSans3-Italic.ttf", fontStyle: "italic" },
  ],
});
// Keep words whole instead of hyphenating them.
Font.registerHyphenationCallback((word) => [word]);

const ACCENT = "#1f3a5f";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Source Sans 3",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "#1a1a1a",
    paddingVertical: 36,
    paddingHorizontal: 44,
  },
  name: { fontSize: 22, lineHeight: 1.2, fontWeight: "bold", color: ACCENT },
  headline: { fontSize: 12, marginTop: 4, color: "#333" },
  contact: { fontSize: 9.5, marginTop: 6, color: "#444" },
  section: { marginTop: 14 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: ACCENT,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    borderBottomWidth: 0.75,
    borderBottomColor: ACCENT,
    paddingBottom: 2,
    marginBottom: 6,
  },
  entry: { marginBottom: 8 },
  entryHeader: { flexDirection: "row", justifyContent: "space-between" },
  entryTitle: { fontWeight: "bold", flex: 1, paddingRight: 8 },
  entryMeta: { fontSize: 9.5, color: "#555" },
  entrySub: { fontStyle: "italic", color: "#444" },
  paragraph: { marginTop: 2 },
  bulletRow: { flexDirection: "row", marginTop: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
  skillRow: { marginBottom: 2 },
  bold: { fontWeight: "bold" },
});

function joinNonEmpty(values: string[], separator: string) {
  return values.map((v) => v.trim()).filter(Boolean).join(separator);
}

function dateRange(start: string, end: string) {
  return joinNonEmpty([start, end], " – ");
}

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items
        .filter((b) => b.trim())
        .map((b, i) => (
          <View key={i} style={styles.bulletRow} wrap={false}>
            <Text style={styles.bulletDot}>•</Text>
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} minPresenceAhead={40}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function CvDocument({ cv, labels }: { cv: Cv; labels: SectionLabels }) {
  const contactLine = joinNonEmpty(
    [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links],
    "  |  ",
  );
  const skills = cv.skills.filter((s) => s.items.some((i) => i.trim()));
  const languages = cv.languages.filter((l) => l.language.trim());
  const certifications = cv.certifications.filter((c) => c.trim());

  return (
    <Document title={cv.name ? `CV - ${cv.name}` : "CV"} author={cv.name}>
      <Page size="A4" style={styles.page}>
        <View>
          <Text style={styles.name}>{cv.name}</Text>
          {cv.headline.trim() && <Text style={styles.headline}>{cv.headline}</Text>}
          {contactLine && <Text style={styles.contact}>{contactLine}</Text>}
        </View>

        {cv.summary.trim() && (
          <Section title={labels.summary}>
            <Text>{cv.summary}</Text>
          </Section>
        )}

        {cv.experience.length > 0 && (
          <Section title={labels.experience}>
            {cv.experience.map((job, i) => (
              <View key={i} style={styles.entry}>
                <View style={styles.entryHeader} wrap={false}>
                  <Text style={styles.entryTitle}>
                    {joinNonEmpty([job.title, job.company], " · ")}
                  </Text>
                  <Text style={styles.entryMeta}>{dateRange(job.startDate, job.endDate)}</Text>
                </View>
                {job.location.trim() && <Text style={styles.entrySub}>{job.location}</Text>}
                {job.description.trim() && <Text style={styles.paragraph}>{job.description}</Text>}
                <Bullets items={job.bullets} />
              </View>
            ))}
          </Section>
        )}

        {cv.projects.length > 0 && (
          <Section title={labels.projects}>
            {cv.projects.map((p, i) => (
              <View key={i} style={styles.entry}>
                <Text style={styles.bold}>{p.name}</Text>
                {p.description.trim() && <Text style={styles.paragraph}>{p.description}</Text>}
                <Bullets items={p.bullets} />
              </View>
            ))}
          </Section>
        )}

        {skills.length > 0 && (
          <Section title={labels.skills}>
            {skills.map((s, i) => (
              <Text key={i} style={styles.skillRow}>
                {s.category.trim() && <Text style={styles.bold}>{s.category}: </Text>}
                {joinNonEmpty(s.items, ", ")}
              </Text>
            ))}
          </Section>
        )}

        {cv.education.length > 0 && (
          <Section title={labels.education}>
            {cv.education.map((e, i) => (
              <View key={i} style={styles.entry} wrap={false}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entryTitle}>
                    {joinNonEmpty([e.degree, e.institution], " · ")}
                  </Text>
                  <Text style={styles.entryMeta}>{dateRange(e.startDate, e.endDate)}</Text>
                </View>
                {e.location.trim() && <Text style={styles.entrySub}>{e.location}</Text>}
                {e.details.trim() && <Text style={styles.paragraph}>{e.details}</Text>}
              </View>
            ))}
          </Section>
        )}

        {certifications.length > 0 && (
          <Section title={labels.certifications}>
            <Bullets items={certifications} />
          </Section>
        )}

        {languages.length > 0 && (
          <Section title={labels.languages}>
            <Text>
              {languages
                .map((l) => (l.level.trim() ? `${l.language} (${l.level})` : l.language))
                .join(", ")}
            </Text>
          </Section>
        )}
      </Page>
    </Document>
  );
}
