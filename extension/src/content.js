// Runs on linkedin.com. Notices when a job ad is open (a /jobs/view/<id> page, or the job panel of a
// search with ?currentJobId=<id>) and hands its text to the service worker. Nothing leaves the browser
// from here; the worker decides whether to score it.
(() => {
  const SELECTORS = {
    title: [
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      ".jobs-details-top-card__job-title",
      "h1.top-card-layout__title",
      ".topcard__title",
      ".jobs-search__job-details h1",
      ".jobs-details h1",
      "main h1",
    ],
    company: [
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".jobs-details-top-card__company-url",
      ".topcard__org-name-link",
      ".top-card-layout__second-subline a",
    ],
    location: [
      ".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
      ".job-details-jobs-unified-top-card__bullet",
      ".jobs-unified-top-card__bullet",
      ".topcard__flavor--bullet",
    ],
    description: [
      "#job-details",
      ".jobs-description__content",
      ".jobs-description-content__text",
      ".jobs-box__html-content",
      ".show-more-less-html__markup",
      ".description__text",
      "[class*='jobs-description']",
    ],
  };

  function jobIdFromUrl(href) {
    let u;
    try { u = new URL(href); } catch { return null; }
    const view = u.pathname.match(/^\/jobs\/view\/(?:[^/]*?-)?(\d{5,})\/?/);
    if (view) return view[1];
    if (u.pathname.startsWith("/jobs")) {
      const id = u.searchParams.get("currentJobId");
      if (id && /^\d{5,}$/.test(id)) return id;
    }
    return null;
  }

  // LinkedIn puts every line of an ad in its own paragraph; one line break per line reads better.
  const clean = (s) => (s || "").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  function firstText(list, min = 1) {
    for (const sel of list) {
      for (const el of document.querySelectorAll(sel)) {
        const t = clean(el.innerText || el.textContent);
        if (t.length >= min) return t;
      }
    }
    return "";
  }
  function readJob() {
    return {
      title: firstText(SELECTORS.title).split("\n")[0].slice(0, 200),
      company: firstText(SELECTORS.company).split("\n")[0].slice(0, 200),
      location: firstText(SELECTORS.location).split("\n")[0].slice(0, 200),
      text: firstText(SELECTORS.description, 50),
    };
  }

  function send(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* the extension was reloaded */ }
  }

  const SETTLE_MS = 1000;   // debounce after the URL changes (people click through jobs quickly)
  const POLL_MS = 400;
  const GIVE_UP_MS = 15000;
  let lastHref = null, currentId = null, lastSentText = "", run = 0;

  function onUrlChange() {
    const id = jobIdFromUrl(location.href);
    if (id === currentId && id) return;
    const wasJob = currentId !== null;
    currentId = id;
    const myRun = ++run;
    if (!id) { if (wasJob || myRun === 1) send({ type: "not-job" }); return; }
    // Wait until the panel shows this job: in the search view LinkedIn swaps the description in after
    // the URL changes, so text equal to the previous job's is not trusted until it has had time.
    const started = Date.now();
    let prev = null;
    const tick = () => {
      if (myRun !== run) return;
      const job = readJob();
      const waited = Date.now() - started;
      const fresh = job.text && (job.text !== lastSentText || waited > 6000);
      const stable = prev && prev.text === job.text && prev.title === job.title;
      if (job.text.length >= 200 && fresh && stable) return finish(job);
      if (waited > GIVE_UP_MS) return finish(job.text !== lastSentText ? job : { ...job, text: "" });
      prev = job;
      setTimeout(tick, POLL_MS);
    };
    const finish = (job) => {
      if (myRun !== run) return;
      lastSentText = job.text || lastSentText;
      send({ type: "job-page", job: { jobId: id, url: location.href, ...job } });
    };
    setTimeout(tick, SETTLE_MS);
  }

  // LinkedIn is a single-page app: watch the URL instead of waiting for page loads.
  const check = () => { if (location.href !== lastHref) { lastHref = location.href; onUrlChange(); } };
  setInterval(check, 500);
  window.addEventListener("popstate", check);
  check();
})();
