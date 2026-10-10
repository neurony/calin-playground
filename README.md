# CV Tailor

Aplicație locală (Next.js) care primește un job description și CV-ul tău și generează o variantă a CV-ului adaptată la acel job.

**Regula de bază: nu inventează nimic.** Aplicația doar reordonează, selectează și reformulează experiența ta reală ca să scoată în față ce cere job-ul. Cerințele din anunț pe care materialul tău nu le acoperă apar separat, la „Cerințe fără acoperire”, și nu sunt adăugate în CV.

Există și o **extensie de browser** (Chrome/Edge) cu aplicația și nota CV-ului pe anunțurile LinkedIn: vezi [`extension/README.md`](extension/README.md).

## Ce face

- **Input:** job description (upload PDF / DOCX / TXT și/sau text lipit) + CV (upload PDF / DOCX / TXT și/sau text lipit) + informații suplimentare scrise liber (proiecte, tehnologii, rezultate care nu apar în CV).
- **Întrebări înainte de generare:** Claude compară CV-ul cu anunțul și te întreabă despre cerințele care lipsesc sau apar vag în CV. Răspunsurile tale devin material pentru CV; ce marchezi ca „Nu am experiență cu asta” rămâne neadăugat. Pasul se poate sări.
- **Generare cu Claude:** CV structurat, scris pe un ton natural, fără clișee de tipul „orientat spre rezultate”.
- **Analiză:** ce cerințe sunt acoperite (și de ce experiență), ce lipsește, ce s-a accentuat.
- **Editare:** modifici orice câmp înainte de export; previzualizarea PDF se actualizează pe loc.
- **Export PDF:** o coloană, ATS-friendly (text real, selectabil), cu diacritice românești.
- **Limbă:** RO, EN sau automat, după limba anunțului.
- Ultima sesiune (textele și CV-ul generat) se păstrează în browser (`localStorage`). Fișierele încărcate nu se păstrează.

## Pornire

Ai nevoie de Node.js 20+ și o cheie [Anthropic API](https://console.anthropic.com/settings/keys).

```bash
npm install
cp .env.example .env.local   # apoi completează ANTHROPIC_API_KEY
npm run dev
```

Deschide http://localhost:3000.

## Cum e construită

| Fișier | Rol |
|---|---|
| `src/app/api/questions/route.ts` | Pasul 2: compară CV-ul cu anunțul și generează întrebări despre lacune |
| `src/app/api/generate/route.ts` | Pasul 3: generează CV-ul din date și din răspunsurile la întrebări |
| `src/lib/inputs.ts` | Citește JD-ul și CV-ul din formular (PDF trimis direct la Claude, DOCX prin `mammoth`) |
| `src/lib/claude.ts` | Apelul către Claude cu structured outputs și tratarea erorilor |
| `src/lib/prompt.ts` | Prompt-urile: întrebările despre lacune; generarea (reguli de veridicitate, păstrarea întregului conținut, accentul, tonul) |
| `src/lib/schema.ts` | Schema Zod a CV-ului și a analizei (folosită pentru structured outputs și în UI) |
| `src/components/QuestionsStep.tsx` | Pasul cu întrebări |
| `src/components/CvEditor.tsx` | Editorul CV-ului |
| `src/components/CvDocument.tsx` | Template-ul PDF (`@react-pdf/renderer`) |
| `src/components/PdfPreview.tsx` | Previzualizare live și descărcare |

Modelul implicit este `claude-opus-5-5` (se poate schimba prin `CLAUDE_MODEL`). Fontul din PDF este Source Sans 3 (licență SIL OFL, în `public/fonts`).
