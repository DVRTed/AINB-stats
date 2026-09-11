import { readFile, writeFile } from "node:fs/promises";
import { Mwn } from "mwn";

const PAGE = "User:DVRTed_bot/AINB-stats.json";
const FILE = new URL("./data.json", import.meta.url);
const FIELDS = {
  total_completed: "c",
  total_todo: "t",
  total_unnecessary: "u",
  total_in_progress: "i",
};

const wiki = new Mwn({
  apiUrl: "https://en.wikipedia.org/w/api.php",
  userAgent: "ainb-stats-chart/1.0 ([[:en:User:DVRTed]])",
  maxRetries: 5,
  retryPause: 1000,
  silent: true,
});

let data = [];
try {
  data = JSON.parse(await readFile(FILE, "utf8"));
  data = data.map(({ d, r, date, revid, ...record }) => ({
    d: d ?? date,
    r: r ?? revid,
    ...Object.fromEntries(
      Object.entries(FIELDS).map(([field, key]) => [
        key,
        record[key] ?? record[field],
      ]),
    ),
  }));
} catch {}

const last_revid = Math.max(0, ...data.map((record) => record.r));

const new_revids = [];
for await (const res of wiki.continuedQueryGen({
  action: "query",
  prop: "revisions",
  titles: PAGE,
  rvlimit: "50",
  rvprop: "ids",
  rvdir: "newer",
  rvstartid: last_revid || undefined,
})) {
  for (const rev of res.query.pages[0].revisions || [])
    if (rev.revid > last_revid) new_revids.push(rev.revid);
}

// batch 50 at a time
for (let i = 0; i < new_revids.length; i += 50) {
  const batch = new_revids.slice(i, i + 50);
  const res = await wiki.query({
    action: "query",
    revids: batch.join("|"),
    prop: "revisions",
    rvprop: "ids|timestamp|content",
    rvslots: "main",
  });

  for (const page of res.query.pages) {
    for (const rev of page.revisions || []) {
      let json;
      try {
        json = JSON.parse(rev.slots.main.content);
      } catch {
        continue;
      }
      if (Object.keys(FIELDS).some((field) => typeof json[field] !== "number"))
        continue;

      data.push({
        d: rev.timestamp,
        r: rev.revid,
        ...Object.fromEntries(
          Object.entries(FIELDS).map(([field, key]) => [key, json[field]]),
        ),
      });
    }
  }
}

data.sort((a, b) => new Date(a.d) - new Date(b.d));

await writeFile(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(`${data.length} points (${new_revids.length} new revisions)`);
