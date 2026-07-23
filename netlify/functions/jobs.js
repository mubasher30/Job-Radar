// netlify/functions/jobs.js
//
// Live job aggregator for Job Radar.
// Sources, all legitimately self-serve (no partner approval, no scraping):
//   - Remotive               https://remotive.com/api/remote-jobs   (public, no key)
//   - RemoteOK                https://remoteok.com/api               (public, no key)
//   - We Work Remotely (RSS)  https://weworkremotely.com/categories/*.rss (public, no key)
//   - Arbeitnow                https://www.arbeitnow.com/api/job-board-api (public, no key)
//   - Adzuna                   https://api.adzuna.com/v1/api/jobs/*   (free key, set
//                              ADZUNA_APP_ID / ADZUNA_APP_KEY as Netlify env vars)
//
// Deliberately NOT included, and why:
//   - Indeed:  public Publisher API was deprecated in 2023/24; the only remaining
//              access is a sales-led enterprise partner program.
//   - Dice:    never had a public jobs API — enterprise/employer-side only.
//   - LinkedIn: blocks automated access; scraping it violates their ToS and gets
//              IPs banned. Not something to build into a public site.
// For those three, ask Claude in a chat session for a periodic supplementary pass —
// they're reachable there through authenticated connectors, just not from a
// public serverless function.

const RESUME_WEIGHTS = [
  { kw: "design system", w: 12 },
  { kw: "design token", w: 12 },
  { kw: "figma", w: 6 },
  { kw: "healthcare", w: 9 },
  { kw: "fintech", w: 8 },
  { kw: "salesforce", w: 6 },
  { kw: "accessibility", w: 5 },
  { kw: "wcag", w: 6 },
  { kw: "section 508", w: 5 },
  { kw: "artificial intelligence", w: 6 },
  { kw: " ai ", w: 6 },
  { kw: "saas", w: 5 },
  { kw: "lead", w: 5 },
  { kw: "manager", w: 4 },
  { kw: "research", w: 4 },
  { kw: "enterprise", w: 4 },
  { kw: "product design", w: 8 },
  { kw: "ux", w: 5 },
  { kw: "ui", w: 3 },
  { kw: "prototyp", w: 3 },
  { kw: "usability", w: 4 },
  { kw: "component librar", w: 6 },
  { kw: "design ops", w: 4 },
  { kw: "remote", w: 2 }
];

function scoreText(text) {
  const t = " " + text.toLowerCase() + " ";
  let sum = 0;
  const matched = [];
  for (const { kw, w } of RESUME_WEIGHTS) {
    if (t.includes(kw)) {
      sum += w;
      matched.push(kw.trim());
    }
  }
  const score = Math.max(35, Math.min(97, Math.round(38 + sum * 1.15)));
  return { score, matched };
}

function isDesignRole(title) {
  const t = title.toLowerCase();
  return (
    t.includes("product designer") ||
    t.includes("ux designer") ||
    t.includes("ui designer") ||
    t.includes("ux/ui") ||
    t.includes("ui/ux") ||
    t.includes("user experience") ||
    t.includes("design lead") ||
    t.includes("design manager") ||
    t.includes("product design") ||
    (t.includes("designer") && (t.includes("ux") || t.includes("ui") || t.includes("product")))
  );
}

async function fetchRemotive() {
  try {
    const res = await fetch("https://remotive.com/api/remote-jobs?category=design");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs || [])
      .filter(j => isDesignRole(j.title))
      .map(j => {
        const { score, matched } = scoreText(j.title + " " + (j.description || "").replace(/<[^>]+>/g, " "));
        return {
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || "Remote",
          posted: (j.publication_date || "").slice(0, 10),
          salary: j.salary || "Not listed",
          url: j.url,
          source: "Remotive",
          score,
          matched
        };
      });
  } catch (e) {
    return [];
  }
}

async function fetchRemoteOK() {
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "job-radar-dashboard (contact: user)" }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data
      .filter(j => j && j.position && isDesignRole(j.position))
      .slice(0, 60)
      .map(j => {
        const { score, matched } = scoreText(
          (j.position || "") + " " + (j.description || "").replace(/<[^>]+>/g, " ") + " " + (j.tags || []).join(" ")
        );
        return {
          title: j.position,
          company: j.company,
          location: (j.location && j.location.trim()) || "Remote",
          posted: j.date ? j.date.slice(0, 10) : "",
          salary: j.salary_min ? `$${j.salary_min} – $${j.salary_max}/yr` : "Not listed",
          url: j.url || `https://remoteok.com${j.slug ? "/remote-jobs/" + j.slug : ""}`,
          source: "RemoteOK",
          score,
          matched
        };
      });
  } catch (e) {
    return [];
  }
}

function parseRSS(xml, sourceLabel) {
  const items = [];
  const itemBlocks = xml.split("<item>").slice(1);
  for (const block of itemBlocks) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      if (!m) return "";
      return m[1]
        .replace(/<!\[CDATA\[/g, "")
        .replace(/\]\]>/g, "")
        .trim();
    };
    const title = get("title");
    const link = get("link");
    const description = get("description");
    const pubDate = get("pubDate");
    if (title && isDesignRole(title)) {
      const { score, matched } = scoreText(title + " " + description.replace(/<[^>]+>/g, " "));
      // WWR titles are usually "Job Title at Company" or include company separately; keep title as-is.
      items.push({
        title,
        company: sourceLabel === "We Work Remotely" ? "See listing" : "",
        location: "Remote",
        posted: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : "",
        salary: "Not listed",
        url: link,
        source: sourceLabel,
        score,
        matched
      });
    }
  }
  return items;
}

async function fetchWWR() {
  const feeds = [
    "https://weworkremotely.com/categories/remote-design-jobs.rss",
    "https://weworkremotely.com/categories/remote-product-jobs.rss"
  ];
  let all = [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed);
      if (!res.ok) continue;
      const xml = await res.text();
      all = all.concat(parseRSS(xml, "We Work Remotely"));
    } catch (e) {
      /* skip */
    }
  }
  return all;
}

// Adzuna — free self-serve API, covers 16+ countries. Requires ADZUNA_APP_ID /
// ADZUNA_APP_KEY env vars set in Netlify (never commit these to the repo).
async function fetchAdzuna() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return []; // silently skip if not configured yet

  const countries = ["us", "gb", "ca", "au", "de"];
  const queries = ["product designer", "ux designer"];
  const results = [];

  for (const country of countries) {
    for (const q of queries) {
      try {
        const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=15&what=${encodeURIComponent(q)}&content-type=application/json`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        for (const j of data.results || []) {
          if (!isDesignRole(j.title || "")) continue;
          const { score, matched } = scoreText((j.title || "") + " " + (j.description || ""));
          results.push({
            title: j.title,
            company: j.company && j.company.display_name,
            location: (j.location && j.location.display_name) || country.toUpperCase(),
            posted: j.created ? j.created.slice(0, 10) : "",
            salary: j.salary_min ? `$${Math.round(j.salary_min)} – $${Math.round(j.salary_max)}/yr` : "Not listed",
            url: j.redirect_url,
            source: "Adzuna",
            score,
            matched
          });
        }
      } catch (e) {
        /* skip this country/query combo */
      }
    }
  }
  return results;
}

// Arbeitnow — public, no API key required, remote-friendly tech/design jobs.
async function fetchArbeitnow() {
  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter(j => j && j.title && isDesignRole(j.title) && j.remote)
      .map(j => {
        const { score, matched } = scoreText((j.title || "") + " " + (j.description || "").replace(/<[^>]+>/g, " ") + " " + (j.tags || []).join(" "));
        return {
          title: j.title,
          company: j.company_name,
          location: j.location || "Remote",
          posted: j.created_at ? new Date(j.created_at * 1000).toISOString().slice(0, 10) : "",
          salary: "Not listed",
          url: j.url,
          source: "Arbeitnow",
          score,
          matched
        };
      });
  } catch (e) {
    return [];
  }
}

exports.handler = async function () {
  try {
    const [remotive, remoteok, wwr, adzuna, arbeitnow] = await Promise.all([
      fetchRemotive(),
      fetchRemoteOK(),
      fetchWWR(),
      fetchAdzuna(),
      fetchArbeitnow()
    ]);

    let all = [...remotive, ...remoteok, ...wwr, ...adzuna, ...arbeitnow];

    // De-dupe by title+company (rough)
    const seen = new Set();
    all = all.filter(j => {
      const key = (j.title + "|" + j.company).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    all.sort((a, b) => b.score - a.score);
    all = all.slice(0, 60);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        count: all.length,
        jobs: all
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) })
    };
  }
};
