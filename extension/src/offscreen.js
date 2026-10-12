// Offscreen document: reads the text of PDF and DOCX files for the service worker, which has no DOM.
async function pdfText(bytes) {
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let out = "", lastY = null;
    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += "\n";
      else if (out && !out.endsWith(" ") && !out.endsWith("\n")) out += " ";
      out += item.str;
      if (item.hasEOL) out += "\n";
      lastY = y;
    }
    pages.push(out);
  }
  return pages.join("\n\n");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "read-file") return false;
  (async () => {
    const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
    let text = "";
    if (msg.kind === "pdf") text = await pdfText(bytes);
    else if (msg.kind === "docx") text = (await window.mammoth.extractRawText({ arrayBuffer: bytes.buffer })).value;
    sendResponse({ ok: true, text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() });
  })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
