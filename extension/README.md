# CV Tailor – extensie de browser (Chrome / Edge, Manifest V3)

Aplicația CV Tailor (portul lui `artifact/cv-tailor.template.html`) ca extensie de browser, plus nota CV-ului tău pe iconiță când ai deschis un anunț de job: pe LinkedIn, pe orice alt site, într-un Google Doc, în Google Drive sau într-un PDF.

## Ce face

- **Nota pe iconiță pe LinkedIn.** Pe un anunț (`/jobs/view/<id>` sau panoul de job din căutare, `?currentJobId=<id>`), iconița arată cât de bine se potrivește CV-ul tău: verde ≥ 75, albastru 45–74, portocaliu < 45. `CV?` = nu există încă un CV salvat în extensie; `KEY` = lipsește cheia API; `…` = se calculează; `!` = eroare (detaliile în tooltip). Pe alte pagini, nimic.
  - Model: `claude-haiku-5-5`, effort `low`, prompt scurt (doar scor + verdict, din CV + anunț), răspuns JSON prin structured outputs.
  - Cache per id de job; se recalculează doar când se schimbă CV-ul (hash SHA-256 al textului CV-ului) sau textul anunțului.
  - Debounce la navigare (1 s după schimbarea URL-ului, apoi așteaptă ca descrierea din panou să fie a noului job și să fie stabilă); un singur apel de notă odată; dintr-o serie de click-uri rapide se notează doar ultimul job.
  - După analiza completă din aplicație (pasul 2, Opus) pentru același anunț și același CV, iconița preia scorul acela, ca să vezi același număr în ambele locuri.
- **Anunțuri de pe orice altă sursă (automat).** Pe orice pagină, extensia verifică întâi local, în browser, dacă pagina pare un anunț (cuvinte tipice unui anunț, plus adresa paginii). Ce nu trece de această verificare nu se trimite nicăieri.
  - Dacă pagina publică anunțul în formatul standard pentru motoarele de căutare (schema.org `JobPosting`), anunțul se ia direct de acolo, fără să-l întrebe pe Claude ce e pagina.
  - Altfel, textul paginii (până la 60.000 de caractere) merge la `claude-haiku-5-5` (effort `low`), care decide dacă e anunțul unui singur post și extrage doar anunțul, fără meniuri, subsol sau alte joburi. Răspunsul se ține minte per pagină (inclusiv „nu e anunț”), ca să nu se plătească de două ori.
  - Apoi anunțul primește notă ca pe LinkedIn (aceeași cache, același debounce, un singur apel odată).
  - Surse citite: orice pagină web (inclusiv site-uri SPA), **Google Docs** (prin exportul text al documentului, cu sesiunea ta Google), fișiere **PDF/DOCX din Google Drive** (descărcate cu sesiunea ta), **PDF-uri incluse într-o pagină**, **PDF-uri deschise direct în browser** (le citește service worker-ul, pentru că vizualizatorul de PDF din Chrome nu rulează scripturi de extensie). PDF-urile și DOCX-urile se citesc într-un document offscreen al extensiei, cu pdf.js și mammoth.
  - Funcționează doar cu auto-score pornit, cu cheie și cu CV.
- **Anunțuri de pe orice sursă (click + confirmare).** Pe o pagină care nu e un anunț cunoscut, click pe iconiță deschide panoul, care citește pagina (aceleași surse ca mai sus) și cere lui Claude Haiku să găsească anunțul în ea. Dacă îl găsește, îți arată titlul și compania și butonul **Use this page as the job description**; abia la click îl pune la pasul 1. Un PDF scanat se transcrie întâi cu Opus, ca la încărcarea de fișiere. Pe un anunț deja detectat automat, click-ul îl încarcă direct.
- **Click pe iconiță** deschide aplicația în **panoul lateral** al browserului (Side Panel, în dreapta), cu anunțul curent completat la pasul 1 și nota deja calculată afișată. Panoul rămâne deschis când schimbi taburile și îl poți lărgi trăgând de marginea din stânga. Dacă panoul e deja deschis, un nou click încarcă anunțul din tabul curent. Dacă ai răspunsuri nesalvate la întrebările altui rol, te întreabă înainte să le înlocuiască. Când panoul e îngust, la pasul 3 editorul și previzualizarea se comută cu **Edit / Preview**.
- **Aplicația** are tot ce are artefactul: pașii Details → Questions → Tailored CV, Saved CVs, scorul 0–100 cu verdict, întrebări cu memoria răspunsurilor („Still accurate / Update it”), New role / Reset everything, verificarea completitudinii („Put them back”), Rewrite pe secțiuni, sursa fiecărui punct, tips la hover, 3 template-uri PDF (pdfmake) cu previzualizare reală (pdf.js), PDF-uri scanate citite de Claude. Prompturile (RULES, QUESTION_RULES, verificarea, repair, rewrite, transcrierea) sunt cele din artefact, cu o singură diferență: secțiunea „Voice” din RULES cere acum ca CV-ul să urmeze registrul profesional al anunțului, în limbaj fluent, de nivel nativ (în artefact era „plain language”), iar o secțiune nouă, „Consistent quality across the whole CV”, cere ca toate părțile CV-ului, inclusiv cele mai puțin relevante, să fie rescrise la același nivel, fără întrebări suplimentare.
  - Model: `claude-opus-5-5`, streaming, adaptive thinking, cu `fallbacks: "default"` (dacă Claude refuză o cerere, API-ul o reia pe modelul de rezervă recomandat). Effort: `high` pentru scrierea CV-ului și „Put them back”, `medium` pentru întrebări, verificare și rewrite, `low` pentru transcrierea scanărilor (constanta `EFFORT` și funcția `transcribeScannedPdf` din `src/app/app.js`).
- **Settings:** cheia API (Save / Test key / Show / Remove), comutatorul „Auto-score job ads” și lista exactă a datelor trimise și unde.

## Instalare

1. Ai nevoie de Node.js 20+.
2. Construiește extensia:
   ```bash
   cd extension
   npm install
   npm run build        # scrie extension/dist/
   npm run zip          # opțional: extension/cv-tailor-extension.zip
   ```
   (Sau folosește direct `.zip`-ul primit: dezarhivează-l; folderul `cv-tailor-extension/` e extensia.)
3. Deschide `chrome://extensions` (în Edge: `edge://extensions`), pornește **Developer mode**, apasă **Load unpacked** și alege `extension/dist/` (sau folderul dezarhivat `cv-tailor-extension/`).
4. Fixează iconița CV Tailor în bara de unelte (pictograma puzzle → pin), ca să vezi nota.

## Cheia API

1. Creează o cheie în [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys). Costurile se facturează contului tău Anthropic.
2. Click pe iconiță → tab-ul **Settings** (la prima pornire se deschide singur) → lipește cheia → **Test key** (verifică cheia listând modelele, fără să consume tokeni) → se salvează.
3. Adaugă CV-ul tău la pasul 2 (fișier sau text). Din acel moment, anunțurile primesc notă.

Cheia stă doar în `chrome.storage.local` al profilului de browser (necriptată, ca orice date ale unei extensii). Apelurile merg direct din extensie la `api.anthropic.com`; nu există niciun server intermediar.

## Ce se trimite și unde

Numai la `api.anthropic.com`, cu cheia ta:

| Când | Ce | Model |
|---|---|---|
| Deschizi un anunț pe linkedin.com (doar cu auto-score pornit, o dată per anunț și CV) | titlul, compania, locația și descrierea anunțului + textul CV-ului (fișier și text lipit) | Haiku 5.5 |
| Deschizi pe alt site o pagină care, la verificarea locală, pare un anunț (doar cu auto-score pornit, cu cheie și CV; o dată per pagină) | adresa, titlul și textul paginii (sau al documentului/PDF-ului), max. 60.000 de caractere; nu se trimite pentru anunțurile în format standard | Haiku 5.5 |
| Apoi, pentru anunțul găsit (o dată per anunț și CV) | anunțul + textul CV-ului | Haiku 5.5 |
| Click pe iconiță pe o pagină care nu e un anunț cunoscut | adresa, titlul și textul paginii (sau al documentului/PDF-ului) | Haiku 5.5; un PDF scanat: imaginile paginilor, Opus 5.5 |
| Continue: check fit and questions | anunțul, CV-ul, informațiile suplimentare, răspunsurile anterioare | Opus 5.5 |
| Write / Regenerate, verificarea automată de după, Put them back, Rewrite | anunțul, CV-ul, informațiile suplimentare, răspunsurile, CV-ul adaptat | Opus 5.5 |
| Încarci un PDF scanat (fără text) | imaginile a până la 8 pagini | Opus 5.5 |

Nimic nu se trimite pentru paginile care nu trec de verificarea locală, cu auto-score oprit, sau fără CV ori fără cheie (în afară de click-ul pe iconiță, care trimite pagina la cererea ta). Citirea paginilor și a fișierelor se face local, în browser.

## Permisiuni

- `sidePanel`: aplicația se deschide în panoul lateral.
- `storage`, `unlimitedStorage`: starea aplicației, CV-urile salvate, cheia, cache-ul notelor.
- `<all_urls>` (acces la toate site-urile) și content script pe toate paginile: recunoașterea anunțurilor pe orice site, descărcarea PDF-urilor, a fișierelor din Drive și a exportului Google Docs, apelurile către `api.anthropic.com`. Chrome afișează la instalare avertismentul „citește și modifică datele de pe toate site-urile”.
- `scripting`: citirea tabului curent la click pe iconiță (și în taburile deschise înainte de instalare).
- `offscreen`: un document ascuns al extensiei care citește textul PDF-urilor și DOCX-urilor (service worker-ul nu are DOM).

## Structură

| Fișier | Rol |
|---|---|
| `src/manifest.json` | Manifest V3 |
| `src/background.js` | Service worker: badge, cache, coada de notare, deschiderea panoului lateral |
| `src/content.js` | Pe LinkedIn: detectează id-ul jobului, așteaptă descrierea, o trimite service worker-ului. Pe alte site-uri: verificarea locală și trimiterea paginilor care par anunțuri |
| `src/shared/collect.js` | Citirea unei pagini (text, `JobPosting`, Google Docs, Drive, PDF-uri incluse) și verificarea locală |
| `src/offscreen.html`, `src/offscreen.js` | Citirea textului din PDF și DOCX pentru service worker |
| `src/shared/claude.js` | Apelurile Anthropic (SDK oficial `@anthropic-ai/sdk`, `dangerouslyAllowBrowser`), maparea erorilor, nota rapidă, extragerea anunțului dintr-o pagină |
| `src/shared/store.js` | Cheile din `chrome.storage.local`, textul CV-ului, hash, compunerea anunțului |
| `src/app/app.html`, `app.css`, `app.js` | Aplicația (portul artefactului) + Settings + integrarea cu LinkedIn |
| `build.mjs`, `zip.mjs` | Build cu esbuild; copiază pdf.js 3.11.174, pdfmake 0.2.7, mammoth 1.6.0 și fonturile (Source Sans 3 din `public/fonts` pentru PDF, Source Sans 3 / Source Serif 4 pentru interfață) în `dist/` |
| `test/` | Teste Playwright, fixtura LinkedIn și mock-ul API-ului Anthropic |

Înlocuiri față de artefact: `window.claude.use("sample")` → apeluri API cu cheia ta; `use("downloads")` → descărcare obișnuită (link `download`); `localStorage` → `chrome.storage.local` (partajat cu service worker-ul); nimic de pe CDN (CSP-ul MV3 nu permite).

## Teste

```bash
cd extension
npm install
npm test             # build + Playwright (Chromium cu extensia încărcată)
HEADED=1 npm test    # cu fereastră vizibilă
```

Testele pornesc Chromium cu `dist/` încărcat, servesc o fixtură care imită paginile de job LinkedIn (aceleași clase CSS, schimbări de URL cu `history.pushState`, descrierea înlocuită cu întârziere) și simulează API-ul Anthropic prin interceptarea cererilor (inclusiv cele din service worker). Acoperă: badge-ul (`CV?`, scor, culori, cache, panoul din căutare, debounce, pagini care nu sunt anunțuri, auto-score oprit/pornit, invalidare la schimbarea CV-ului), deschiderea panoului lateral cu anunțul precompletat (Playwright nu poate afișa panoul lateral, așa că testul deschide pagina panoului într-un tab îngust), fluxul complet (întrebări, scriere, verificare + Put them back, Rewrite, surse, template-uri, previzualizare, descărcare PDF, Saved CVs), Stop, încărcare PDF/DOCX/PDF scanat, New role / Reset, lipsa erorilor în pagină (inclusiv CSP); anunțuri de pe alte surse: pagină cu `JobPosting`, pagină obișnuită (Claude extrage anunțul), articol (nu se trimite nimic), pagină de carieră cu mai multe joburi (o singură întrebare, apoi ținută minte), Google Docs, PDF din Drive, PDF inclus în pagină, fișier PDF, click + confirmare pe un anunț scurt, pe o pagină fără anunț și pe un PDF scanat.

Dacă instalezi Playwright local, browserul vine cu `npx playwright install chromium`.

Notă: selectoarele pentru LinkedIn (`src/content.js` → `SELECTORS`) sunt cele cunoscute ale paginilor de job LinkedIn; LinkedIn își schimbă des clasele, iar dacă nota nu mai apare, acolo e de actualizat.
