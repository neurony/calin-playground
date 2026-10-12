// Reading a job ad from any page. collectPage() runs inside the page (content script, or injected with
// chrome.scripting when the toolbar button is clicked), so it must be self-contained.

export async function collectPage() {
  const out = { url: location.href, title: document.title || "", text: "", jsonld: null, source: "page", gdocId: null, gdocText: false, driveFileId: null, pdfUrls: [] };
  // A PDF opened in the browser: the file itself is read by the service worker.
  if (document.contentType === "application/pdf") { out.pdfUrls.push(location.href); out.source = "pdf"; return out; }

  // Job ads published for search engines (schema.org JobPosting, JSON-LD).
  const htmlToText = (html) => {
    const marked = String(html || "")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol|\/tr)[^>]*>/gi, "\n");
    const doc = new DOMParser().parseFromString(marked, "text/html"); // inert: no scripts, no handlers
    return (doc.body?.textContent || "").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  };
  const findPosting = (node) => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) { for (const n of node) { const f = findPosting(n); if (f) return f; } return null; }
    const type = [].concat(node["@type"] || []).map(String);
    if (type.some((t) => /JobPosting$/i.test(t))) return node;
    return findPosting(node["@graph"]) || null;
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    let posting = null;
    try { posting = findPosting(JSON.parse(s.textContent)); } catch { continue; }
    if (!posting) continue;
    const org = posting.hiringOrganization;
    const place = [].concat(posting.jobLocation || [])[0]?.address;
    const description = htmlToText(posting.description);
    if (description.length < 100) continue;
    out.jsonld = {
      title: String(posting.title || "").trim(),
      company: String((typeof org === "string" ? org : org?.name) || "").trim(),
      location: typeof place === "string" ? place : [place?.addressLocality, place?.addressRegion, place?.addressCountry?.name || place?.addressCountry].filter((x) => typeof x === "string" && x).join(", "),
      text: description,
    };
    break;
  }

  // Google Docs draws the document on a canvas: its text comes from the document's text export.
  const gdoc = location.hostname === "docs.google.com" && location.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (gdoc) {
    out.gdocId = gdoc[1];
    out.source = "gdoc";
    try {
      const r = await fetch(`/document/d/${gdoc[1]}/export?format=txt`, { credentials: "include" });
      if (r.ok) { out.text = (await r.text()).trim(); out.gdocText = !!out.text; }
    } catch { /* the service worker tries again */ }
  }
  // A file previewed in Google Drive is downloaded by the service worker.
  const drive = location.hostname === "drive.google.com" && location.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (drive) { out.driveFileId = drive[1]; out.source = "drive"; }

  if (!out.text) out.text = (document.body?.innerText || "").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim().slice(0, 100000);

  // PDFs shown inside the page.
  for (const el of document.querySelectorAll("embed, object, iframe")) {
    const src = el.getAttribute("src") || el.getAttribute("data") || "";
    const type = el.getAttribute("type") || "";
    if (!src || !(/\.pdf(\?|#|$)/i.test(src) || /pdf/i.test(type))) continue;
    try { const u = new URL(src, location.href); if (/^https?:$/.test(u.protocol)) out.pdfUrls.push(u.href); } catch { /* not a URL */ }
  }
  return out;
}

// A local first check, so that only pages that look like a job ad are ever sent to Claude.
const SIGNALS = [
  /responsibilit|responsabilit|what you('|’)ll do|your role|ce vei face|atribu[țţt]ii|sarcini|aufgaben|vos missions|tus funciones/,
  /requirements|qualifications|cerin[țţt]e|calific[aă]ri|what we('|’)re looking for|ce c[aă]ut[aă]m|anforderungen|profil recherch|requisitos/,
  /\bapply\b|aplic[aă]|candideaz|bewerb|postuler|aplicar/,
  /experience|experien[țţt]|erfahrung|exp[ée]rience|experiencia/,
  /benefits|we offer|what we offer|oferim|beneficii|perks|salary|salariu|compensation|wir bieten|nous offrons/,
  /full[- ]time|part[- ]time|remote|hybrid|on[- ]site|norm[aă] [îi]ntreag[aă]|permanent|contract type|tip contract/,
  /job description|descrierea (postului|jobului)|about the (role|job|position)|despre (rol|job|post)|job type|seniority|employment type/,
];
const URL_SIGNAL = /job|career|vacanc|position|opening|posting|cariere|locuri-de-munca|angajar|oferte|stellen|emploi|empleo|recruit|hiring/i;

export function looksLikeJobAd({ url, text }) {
  const t = (text || "").toLowerCase();
  if (t.length < 400 || t.length > 150000) return false;
  const hits = SIGNALS.filter((r) => r.test(t)).length;
  return hits >= 4 || (URL_SIGNAL.test(url || "") && hits >= 3);
}

// One id per page: the address without the fragment and the usual tracking parameters.
export function normalizeUrl(href) {
  try {
    const u = new URL(href);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|refid|trk)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch { return href || ""; }
}
