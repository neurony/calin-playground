// Stand-ins for job ads on other sites: a careers page with a schema.org JobPosting, a plain job board
// page, an article, a careers page listing several jobs, a short ad, a Google Doc, a file in Google
// Drive and PDFs (with text, and scanned), served through Playwright request interception.

// A one-page PDF with real text (Helvetica, one line per entry).
export function textPdf(lines) {
  const esc = (l) => l.replace(/[\\()]/g, (m) => "\\" + m);
  const stream = "BT /F1 10 Tf 14 TL 50 800 Td " + lines.map((l) => `(${esc(l)}) Tj T*`).join(" ") + " ET";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]);
}
// A one-page PDF with shapes only (like a scan: no text layer).
export function scannedPdf() {
  const stream = "0.2 0.2 0.2 rg 60 760 260 18 re f 60 720 420 8 re f 60 700 400 8 re f";
  return pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]);
}
function pdf(objects) {
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const NAV = `<nav><a href="/">Home</a> · <a href="/jobs">All jobs</a> · <a href="/about">About us</a> · <a href="/login">Sign in</a></nav>`;
const FOOTER = `<footer><p>© 2026 Example. Cookie settings · Privacy · Terms · Contact</p><p>Follow us on social media.</p></footer>`;

const AD_LINES = (title, company, marker) => [
  `Job title: ${title}`,
  `Company: ${company}`,
  "AD-START",
  `About the role: we are hiring a ${title} to join our team in Bucharest (hybrid, full-time).`,
  "Responsibilities:",
  "- Build and run backend services in Java and Spring Boot",
  "- Work with AWS and CI/CD pipelines every day",
  "- Review code and help less experienced colleagues",
  "Requirements:",
  "- 4+ years of experience with Java",
  "- Good knowledge of PostgreSQL",
  "- Professional English",
  "We offer: private health insurance, a learning budget and flexible hours.",
  `How to apply: send your CV through this page. (marker: ${marker})`,
  "AD-END",
];

export const WEB = {
  // schema.org JobPosting: read without asking Claude what the page is.
  "https://careers.example-company.com/jobs/platform-backend-engineer": () => ({
    contentType: "text/html", body: page("Platform Backend Engineer – Example Company", `${NAV}
      <main><h1>Platform Backend Engineer</h1><p>Example Company · Cluj-Napoca</p><div id="ad">Build our platform. See the full description below.</div></main>${FOOTER}
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org", "@type": "JobPosting", title: "Platform Backend Engineer",
        hiringOrganization: { "@type": "Organization", name: "Example Company" },
        jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Cluj-Napoca", addressCountry: "RO" } },
        description: "<p>We are looking for a backend engineer for our platform team.</p><h3>Responsibilities</h3><ul><li>Design and build the Java services behind our order and billing platform</li><li>Run them on AWS (ECS, RDS) with Terraform</li><li>Take part in code review and on-call</li></ul><h3>Requirements</h3><ul><li>5+ years of Java</li><li>PostgreSQL</li></ul><p>(marker: JSONLD-JOB)</p>",
      })}</script>`),
  }),
  // A job board page without structured data: Claude finds the ad among the menus and the footer.
  "https://www.example-jobs.ro/oferta/12345": () => ({
    contentType: "text/html", body: page("Cloud Support Engineer | Example Jobs", `${NAV}<aside><h3>Similar jobs</h3><ul><li>Java Developer</li><li>Data Analyst</li></ul></aside>
      <main>${AD_LINES("Cloud Support Engineer", "Example Telecom", "GENERIC-JOB").map((l) => `<p>${l}</p>`).join("")}</main>${FOOTER}`),
  }),
  // An article: the local check stops it, nothing is sent.
  "https://blog.example.org/how-we-work": () => ({
    contentType: "text/html", body: page("How we work – Example Blog", `${NAV}<article><h1>How we work</h1>${"<p>We write about our engineering culture, the tools we like and the books we read. Last month we moved our build to a new system and it was faster than before.</p>".repeat(6)}<p>(marker: NOT-A-JOB-BLOG)</p></article>${FOOTER}`),
  }),
  // A careers page that lists several jobs: it passes the local check, Claude says it is not one ad.
  "https://careers.example-company.com/": () => ({
    contentType: "text/html", body: page("Careers – Example Company", `${NAV}<main><h1>Careers at Example Company</h1>
      <p>Join us! We offer benefits, remote and hybrid work, and a learning budget. Apply to any of our open positions; experience levels from junior to senior.</p>
      <p>Our requirements differ per role; responsibilities are described in each job description.</p>
      ${["Platform Backend Engineer", "Data Analyst", "Product Designer", "QA Engineer"].map((t) => `<p><a href="/jobs/x">${t}</a> – full-time, Cluj-Napoca. Requirements and responsibilities on the job page.</p>`).join("")}
      <p>(marker: NOT-A-SINGLE-AD)</p></main>${FOOTER}`),
  }),
  // A short ad that the local check does not recognise: it is found only through the toolbar button.
  "https://smallco.example.net/hiring": () => ({
    contentType: "text/html", body: page("We are hiring", `<main><h1>Node.js developer wanted</h1>
      <p>Job title: Node.js Developer</p><p>Company: SmallCo</p><p>AD-START</p>
      <p>SmallCo builds booking software for dentists. We need a Node.js developer who knows TypeScript and PostgreSQL to work on our API, together with our two other developers.</p>
      <p>Send your CV to jobs@smallco.example.net. (marker: SHORT-AD)</p><p>AD-END</p></main>`),
  }),
  // Google Docs: the page shows a canvas; the text comes from the document's text export.
  "https://docs.google.com/document/d/DOC123/edit": () => ({
    contentType: "text/html", body: page("Data Platform Lead - Google Docs", `<div class="kix-appview-editor"><canvas width="800" height="1000"></canvas></div>`),
  }),
  "https://docs.google.com/document/d/DOC123/export?format=txt": () => ({
    contentType: "text/plain; charset=utf-8", body: AD_LINES("Data Platform Lead", "Example Data", "GDOC-JOB").join("\n"),
  }),
  // A PDF previewed in Google Drive: downloaded by the service worker.
  "https://drive.google.com/file/d/FILE456/view": () => ({
    contentType: "text/html", body: page("qa-automation.pdf - Google Drive", `<div role="main"><img alt="page 1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>`),
  }),
  "https://drive.google.com/uc?export=download&id=FILE456": () => ({
    contentType: "application/pdf", body: textPdf(AD_LINES("QA Automation Engineer", "Example QA", "DRIVE-PDF-JOB")),
  }),
  // A PDF shown inside a page.
  "https://www.example-jobs.ro/pdf-ad": () => ({
    contentType: "text/html", body: page("Mobile Developer (PDF)", `<main><h1>Mobile Developer</h1><embed src="/files/mobile-developer.pdf" type="application/pdf" width="600" height="800"></main>`),
  }),
  "https://www.example-jobs.ro/files/mobile-developer.pdf": () => ({
    contentType: "application/pdf", body: textPdf(AD_LINES("Mobile Developer", "Example Apps", "EMBED-PDF-JOB")),
  }),
  // A scanned PDF shown inside a page.
  "https://www.example-jobs.ro/scan-ad": () => ({
    contentType: "text/html", body: page("Scanned ad", `<main><embed src="/files/scanned-ad.pdf" type="application/pdf" width="600" height="800"></main>`),
  }),
  "https://www.example-jobs.ro/files/scanned-ad.pdf": () => ({ contentType: "application/pdf", body: scannedPdf() }),
  // A PDF file on its own.
  "https://files.example.com/jd/devops.pdf": () => ({
    contentType: "application/pdf", body: textPdf(AD_LINES("DevOps Engineer", "Example Ops", "PDF-FILE-JOB")),
  }),
};

export const WEB_HOSTS = ["careers.example-company.com", "www.example-jobs.ro", "blog.example.org", "smallco.example.net", "docs.google.com", "drive.google.com", "files.example.com"];
