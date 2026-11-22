// Planner test harness: builds 55 weeks (11 profiles x 5 seeds) in headless Chromium and checks the menu rules.
// Run from the repo root:  node tests/harness.mjs   (--verbose prints every week, --seeds=N changes the count)
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Playwright from the project, or a global install (NODE_PATH)
const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));
const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.join(here, "..", "index.html")).href;
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const SEEDS = +(args.find((a) => a.startsWith("--seeds="))?.split("=")[1] || 5);

const base = { units: "metric", sex: "male", age: 35, heightCm: 178, weightKg: 82, activity: 1.55, goal: "lose", diets: [], avoid: "", likes: "",
  meals: "3", snacks: "1", treat: "none", flav: "sweet", out: { days: [], style: "h" }, store: "costco", packs: true, premade: true, sauce: false,
  freezer: "std", start: 0, styles: ["bowl", "sand", "plate", "classic"], mix: false, cap: 300 };
const PROFILES = [
  { name: "Default man, lose", s: {} },
  { name: "Household of 3, vegetarian", s: { hh: { n: 3, people: [{}, { name: "Sam", sex: "male", age: 31, heightCm: 183, weightKg: 85, activity: 1.725, goal: "maintain", diets: ["Vegetarian"], home: { l: [false, false, false, false, false, true, true] } }, { name: "Kid", sex: "female", age: 15, heightCm: 160, weightKg: 50, activity: 1.55, goal: "maintain", diets: ["Vegetarian"], avoid: "nut" }] }, sex: "female", age: 29, heightCm: 165, weightKg: 62, goal: "maintain", diets: ["Vegetarian"], snacks: "2" } },
  { name: "Family of 4, young kids", s: { hh: { n: 4, people: [{}, { name: "Alex", sex: "female", age: 36, heightCm: 168, weightKg: 66, activity: 1.375, goal: "maintain", diets: [] }, { name: "Ben", sex: "male", age: 9, heightCm: 133, weightKg: 28, activity: 1.55, goal: "maintain", diets: [], avoid: "nut", home: { l: [false, false, false, false, false, true, true] } }, { name: "Cleo", sex: "female", age: 6, heightCm: 115, weightKg: 20, activity: 1.55, goal: "maintain", diets: [], home: { l: [false, false, false, false, false, true, true] } }] } } },
  { name: "Vegan, 2 meals", s: { diets: ["Vegan"], meals: "2", snacks: "1", sex: "female", heightCm: 170, weightKg: 68, age: 41 } },
  { name: "Keto man", s: { diets: ["Keto"], weightKg: 95, age: 45 } },
  { name: "Gluten-free, nut allergy", s: { diets: ["Gluten-free"], avoid: "nut", prots: { beef: 0, pork: 0 }, sex: "female", heightCm: 160, weightKg: 70, age: 52 } },
  { name: "Pescatarian, treats", s: { diets: ["Pescatarian"], treat: "h", sex: "female", heightCm: 168, weightKg: 58, goal: "maintain" } },
  { name: "Big man, gain, 2 snacks", s: { heightCm: 190, weightKg: 92, age: 24, goal: "gain", activity: 1.725, snacks: "2", treat: "i" } },
  { name: "Any store, eats out Fri/Sat", s: { store: "any", out: { days: [4, 5], style: "i" } } },
  { name: "Mostly Costco, no freezer", s: { store: "mostly", freezer: "none", sex: "female", age: 33, heightCm: 172, weightKg: 75 } },
  { name: "Mix and match, quick dinners", s: { mix: true, course: { d: { effort: 25, variety: 3 }, l: { effort: 10, variety: 2 } } } },
];

// Each rule returns a list of problems for one built week. Hard rules fail the run; soft ones are reported.
const RULES = [
  { id: "builds", hard: true, desc: "a week is built with 7 days", check: (w) => (w.error ? [w.error] : w.days.length === 7 ? [] : [`${w.days.length} days`]) },
  { id: "slots", hard: true, desc: "every day fills every slot", check: (w) => w.days.flatMap((d, i) => (d.meals.length === d.slots.length ? [] : [`day ${i + 1}: ${d.meals.length} meals for ${d.slots.length} slots`])) },
  { id: "diet", hard: true, desc: "every meal fits the diet and avoid list", check: (w) => w.days.flatMap((d, i) => d.meals.filter((m) => !m.ok).map((m) => `day ${i + 1}: ${m.name}`)) },
  { id: "kcal", hard: true, desc: "each day within 15% of its calorie target", check: (w) => w.days.flatMap((d, i) => (Math.abs(d.kcal - d.tk) / d.tk > 0.15 ? [`day ${i + 1}: ${Math.round(d.kcal)} vs ${d.tk}`] : [])) },
  { id: "kcal-tight", hard: false, desc: "each day within 8% of its calorie target", check: (w) => w.days.flatMap((d, i) => (Math.abs(d.kcal - d.tk) / d.tk > 0.08 ? [`day ${i + 1}: ${Math.round(d.kcal)} vs ${d.tk}`] : [])) },
  { id: "protein", hard: true, desc: "weekly protein at least 85% of target", check: (w) => (w.protein < 0.85 * w.T.p * 7 ? [`${Math.round(w.protein / 7)} g a day vs ${w.T.p} g`] : []) },
  { id: "repeat-day", hard: true, desc: "no dish twice in one day", check: (w) => w.days.flatMap((d, i) => {
    const seen = new Map(), out = [];
    d.meals.forEach((m) => { if (m.out) return; if (seen.has(m.dish)) out.push(`day ${i + 1}: ${m.name} / ${seen.get(m.dish)}`); else seen.set(m.dish, m.name); });
    return out;
  }) },
  { id: "lunch-dinner", hard: true, desc: "no dish served as both lunch and dinner in a week", check: (w) => {
    const as = {}, out = new Set();
    w.days.forEach((d) => d.meals.forEach((m) => { if (m.out || (m.slot !== "Lunch" && m.slot !== "Dinner")) return; if (as[m.dish] && as[m.dish] !== m.slot) out.add(m.name); as[m.dish] ||= m.slot; }));
    return [...out];
  } },
  { id: "dinner-type", hard: true, desc: "dinners are dinner-type meals (dinner effort above quickest)", check: (w) => w.quickDinner ? [] : w.days.flatMap((d, i) => d.meals.filter((m) => m.slot === "Dinner" && !m.out && m.dinner === false).map((m) => `day ${i + 1}: ${m.name}`)) },
  { id: "daily-repeat", hard: false, desc: "a course set to Daily repeats a finished meal (dish + sauce) at most once", check: (w) => {
    const n = {};
    w.days.forEach((d) => d.meals.forEach((m) => { if (!m.out && w.daily[m.type]) { const k = m.type + m.dish + m.sauce; n[k] = (n[k] || 0) + 1; } }));
    return Object.entries(n).filter(([, c]) => c > 2).map(([k, c]) => `${k} x${c}`);
  } },
  { id: "prots-never", hard: true, desc: "no protein the person never eats", check: (w) => w.days.flatMap((d, i) => d.meals.filter((m) => !m.out && w.never.includes(m.main)).map((m) => `day ${i + 1}: ${m.name} [${m.main}]`)) },
  { id: "portion-size", hard: true, desc: "meal portions between 3/4 and 1 1/2", check: (w) => w.days.flatMap((d, i) => d.meals.filter((m) => "bld".includes(m.type) && !m.out && (m.mult < 0.75 || m.mult > 1.5)).map((m) => `day ${i + 1}: ${m.name} x${m.mult}`)) },
  { id: "household", hard: true, desc: "everyone in a household gets within 15% of their calories, from meals they can eat", check: (w) => (w.others || []).flatMap((o) => o.days.flatMap((d, i) => [
    ...(Math.abs(d.k - d.tk) / d.tk > 0.15 ? [`${o.name} day ${i + 1}: ${Math.round(d.k)} vs ${d.tk}`] : []),
    ...d.bad.map((n) => `${o.name} day ${i + 1}: ${n}`)])) },
  { id: "portion-label", hard: true, desc: "portion labels in plain words", check: (w) => (w.labels.filter((t) => /\d×/.test(t)).slice(0, 3)) },
  { id: "budget", hard: false, desc: "first shop under $300 a person", check: (w) => (w.shop && w.shop.shop > 300 * w.hh ? [`$${Math.round(w.shop.shop)}`] : []) },
  { id: "freezer", hard: true, desc: "frozen food fits the freezer on its busiest day", check: (w) => (w.fz && w.fz.peak > w.fz.cap + 1 ? [`${(w.fz.peak / 1000).toFixed(1)} kg of ${(w.fz.cap / 1000).toFixed(0)} kg`] : []) },
  { id: "waste", hard: true, desc: "no fresh food wasted ($0)", check: (w) => (w.shop && w.shop.waste > 0.005 ? [`$${Math.round(w.shop.waste)}`] : []) },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
await page.goto(pageUrl);
await page.waitForFunction(() => window.__bbd);

const results = [];
for (const prof of PROFILES) for (let k = 0; k < SEEDS; k++) {
  const seed = 1000 + k * 7919;
  const w = await page.evaluate(({ s, seed }) => {
    const B = window.__bbd;
    const { ctx, week } = B.run(s, seed);
    if (week.error) return { error: week.error, days: [] };
    // Main protein: the menu data's tag when there is one, else the ingredient giving the most protein
    const FAM = { poultry: "chicken", meat: "beef", pork: "pork", fish: "fish", shellfish: "shellfish", egg: "egg", dairy: "dairy", soy: "tofu" };
    const mainOf = (m) => m.main ?? (() => {
      let best = null, bp = 0;
      m.items.forEach(([k, g]) => { const p = (B.ING[k][2] * g) / 100; if (p > bp) { bp = p; best = k; } });
      if (!best || bp < 8) return "none";
      if (/turkey/.test(best)) return "turkey";
      const tag = B.ING[best][7].split(" ").find((t) => FAM[t]);
      return tag ? FAM[tag] : "legume";
    })();
    let protein = 0;
    const days = week.days.map((d, di) => {
      const dd = B.dayData(d, di), slots = d.slots || ctx.slots;
      protein += dd.tot[1];
      return {
        slots, kcal: dd.tot[0], tk: d.tk ?? ctx.T.k,
        meals: dd.meals.map((x, i) => ({ id: x.m.id, name: x.m.name, slot: slots[i], type: x.m.type, out: !!x.m.out, ok: !!x.m.out || B.allowed(x.m, ctx.diets, ctx.avoid),
          dish: x.m.id.replace(/^k[ld]\./, "k.").replace(/^c/, "m"), dinner: x.m.dinner ?? (x.m.style === "sand" ? false : undefined), main: x.m.out ? "none" : mainOf(x.m),
          kcal: x.n[0], mult: x.mult, appeal: x.m.appeal, sauce: x.items.find((it) => it.sauce)?.k || "" })),
      };
    });
    const labels = [...document.querySelectorAll("#days .mt")].map((e) => e.textContent);
    const daily = Object.fromEntries(Object.entries(ctx.course).map(([t, c]) => [t, c.variety >= 7 && "bld".includes(t)]));
    const never = Object.entries(s.prots || {}).filter(([, v]) => v === 0).map(([k]) => k);
    // Everyone else in a household builder: shared lunches and dinners at their scale, plus their own breakfasts and snacks
    const others = (ctx.house?.others || []).map((o) => ({ name: o.name, T: o.T, avoid: o.avoid, days: week.days.map((d, di) => {
      const dd = B.dayData(d, di), wd = (ctx.start + di) % 7;
      let k = 0, p = 0;
      dd.meals.forEach((x) => { if ((x.m.type === "l" || x.m.type === "d") && o.home?.[x.m.type]?.[wd] !== false) { k += x.n[0] * o.ratio; p += x.n[1] * o.ratio; } });
      const own = (dd.own || []).find((y) => y.who === o.who);
      own?.meals.forEach((x) => x.items.forEach(({ k: ing, g }) => { k += (B.ING[ing][1] * g) / 100; p += (B.ING[ing][2] * g) / 100; }));
      return { k, p, tk: own?.tk ?? o.T.k, own: own?.meals.map((x) => x.m.name) || [], bad: (own?.meals || []).filter((x) => !B.allowed(x.m, o.diets, o.avoid)).map((x) => x.m.name) };
    }) }));
    return { hh: (ctx.house?.n || 1) + (ctx.house?.others.length || 0), others, never, T: ctx.T, days, protein, shop: B.shopStats(), fz: { peak: B.freezerPeak(), cap: ctx.fcap }, labels, daily, quickDinner: ctx.course.d.effort <= 10 };
  }, { s: { ...base, ...prof.s }, seed });
  const fails = RULES.map((rule) => ({ rule, probs: rule.check(w) })).filter((x) => x.probs.length);
  results.push({ prof: prof.name, seed, w, fails });
  if (verbose) {
    console.log(`\n== ${prof.name} (seed ${seed})${w.shop ? ` shop $${Math.round(w.shop.shop)}, waste $${Math.round(w.shop.waste)}` : ""}`);
    w.days.forEach((d, i) => console.log(`  ${i + 1}. ${Math.round(d.kcal)}/${d.tk}  ` + d.meals.map((m) => `${m.slot[0]}:${m.name} [${m.main}]`).join(" | ")));
    fails.forEach((f) => console.log(`  ${f.rule.hard ? "FAIL" : "warn"} ${f.rule.id}: ${f.probs.join("; ")}`));
  }
}
await browser.close();

const weeks = results.length;
console.log(`\nBuilt ${weeks} weeks (${PROFILES.length} profiles x ${SEEDS} seeds)\n`);
let hardFail = errors.length;
for (const rule of RULES) {
  const bad = results.filter((r) => r.fails.some((f) => f.rule === rule));
  if (rule.hard) hardFail += bad.length;
  const ex = bad[0] ? `  e.g. ${bad[0].prof}: ${bad[0].fails.find((f) => f.rule === rule).probs.slice(0, 2).join("; ")}` : "";
  console.log(`${bad.length ? (rule.hard ? "FAIL" : "warn") : " ok "}  ${rule.id.padEnd(12)} ${String(weeks - bad.length).padStart(3)}/${weeks}  ${rule.desc}${ex}`);
}
const ap = results.flatMap((r) => r.w.days.flatMap((d) => d.meals.filter((m) => (m.slot === "Lunch" || m.slot === "Dinner") && m.appeal).map((m) => m.appeal)));
console.log(`\nAverage appeal of lunches and dinners: ${(ap.reduce((a, b) => a + b, 0) / ap.length).toFixed(2)} (1 to 5)`);
const shops = results.filter((r) => r.w.shop).map((r) => r.w.shop);
if (shops.length) {
  const st = (k) => { const v = shops.map((x) => x[k]).sort((a, b) => a - b); return `$${Math.round(v[0])} to $${Math.round(v[v.length - 1])}, median $${Math.round(v[v.length >> 1])}`; };
  console.log(`\nCostco weeks: shop ${st("shop")} · eaten ${st("eaten")} · fresh waste ${st("waste")}`);
}
if (errors.length) console.log(`\nPage errors:\n  ${[...new Set(errors)].join("\n  ")}`);
process.exit(hardFail ? 1 : 0);
