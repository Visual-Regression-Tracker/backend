// One-off: PNGs are kept in png/ so seeding never depends on local fonts. Usage: [PLAYWRIGHT_MODULE=/abs/node_modules/playwright] node generate.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(join(process.env.PLAYWRIGHT_MODULE, "index.mjs")).href
  : "playwright";
const { chromium } = await import(playwrightModule);

const css = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f2a24; background: #f7f5f0; font-size: 15px; line-height: 1.5; }
a { color: inherit; text-decoration: none; }
.topbar { background: #23432f; color: #e8efe9; font-size: 13px; text-align: center; padding: 6px; }
header { display: flex; align-items: center; gap: 32px; padding: 16px 48px; background: #fff; border-bottom: 1px solid #e4e0d6; }
.logo { font-weight: 800; font-size: 22px; letter-spacing: -0.5px; color: #23432f; display: flex; align-items: center; gap: 8px; }
.logo i { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #3f7a52, #23432f); display: inline-block; }
nav { display: flex; gap: 24px; font-weight: 500; color: #44524a; }
nav a.active { color: #23432f; border-bottom: 2px solid #3f7a52; padding-bottom: 2px; }
.search { margin-left: auto; width: 260px; padding: 8px 14px; border: 1px solid #d8d3c7; border-radius: 20px; color: #8a918c; font-size: 14px; background: #faf9f6; }
.icons { display: flex; gap: 18px; font-size: 14px; color: #44524a; }
.badge { background: #c8643b; color: #fff; border-radius: 10px; padding: 0 7px; font-size: 12px; margin-left: 4px; }
main { padding: 32px 48px; }
h1 { font-size: 32px; letter-spacing: -0.5px; margin-bottom: 8px; }
h2 { font-size: 20px; margin-bottom: 12px; }
.muted { color: #6b746e; }
.btn { display: inline-block; padding: 12px 22px; border-radius: 8px; font-weight: 600; border: 0; font-size: 15px; }
.btn-primary { background: #2f6b45; color: #fff; }
.btn-secondary { background: #fff; color: #23432f; border: 1px solid #23432f; }
.card { background: #fff; border: 1px solid #e4e0d6; border-radius: 12px; }
.art { border-radius: 10px; position: relative; overflow: hidden; }
.art svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.crumbs { font-size: 13px; color: #6b746e; margin-bottom: 18px; }
.stars { color: #d79a2b; letter-spacing: 1px; font-size: 13px; }
input, select, .field { display: block; width: 100%; padding: 11px 12px; border: 1px solid #d8d3c7; border-radius: 8px; background: #fff; font-size: 14px; color: #8a918c; margin-top: 6px; }
label { font-size: 13px; font-weight: 600; color: #44524a; display: block; margin-bottom: 14px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b746e; padding: 12px 16px; border-bottom: 1px solid #e4e0d6; }
td { padding: 14px 16px; border-bottom: 1px solid #efece5; font-size: 14px; }
.pill { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 12px; }
.pill.ok { background: #e2f0e6; color: #2f6b45; } .pill.wait { background: #fbf0d9; color: #94660f; } .pill.off { background: #eceae4; color: #6b746e; }
.mobile header { padding: 12px 16px; gap: 12px; } .mobile nav, .mobile .search, .mobile .icons span.t { display: none; }
.mobile main { padding: 20px 16px; } .mobile .icons { margin-left: auto; } .mobile .btn-secondary { margin: 8px 0 0 0 !important; }
`;

const palette = [
  ["#7fa98a", "#3f7a52", "#23432f"],
  ["#d9a36b", "#c8643b", "#7a3a22"],
  ["#9ab7cf", "#4f7ea6", "#2a4a66"],
  ["#c9c39b", "#8f8a55", "#55522f"],
];
const art = (seed, h) => {
  const [a, b, c] = palette[seed % palette.length];
  return `<div class="art" style="height:${h}px;background:linear-gradient(180deg,${a}55,${a})"><svg viewBox="0 0 400 240" preserveAspectRatio="none">
<circle cx="${300 - seed * 37 % 200}" cy="60" r="26" fill="#fff8e6" opacity=".8"/>
<polygon points="0,240 ${90 + seed * 13 % 60},${90 + seed * 7 % 40} 200,240" fill="${b}"/>
<polygon points="120,240 ${260 - seed * 11 % 50},${70 + seed * 5 % 30} 400,240" fill="${c}"/>
<polygon points="260,240 ${340 + seed * 3 % 30},150 400,200 400,240" fill="${b}" opacity=".85"/></svg></div>`;
};

const header = (active, cartCount = 2) => `
<div class="topbar">Free carbon-neutral shipping on orders over $75 · 60-day returns</div>
<header>
  <a class="logo"><i></i>Fernway</a>
  <nav>${["Shop", "New arrivals", "Journal", "Help"].map((n) => `<a class="${n === active ? "active" : ""}">${n}</a>`).join("")}</nav>
  <div class="search">Search tents, packs, layers…</div>
  <div class="icons"><span class="t">Account</span><span>Cart<span class="badge">${cartCount}</span></span></div>
</header>`;

const products = [
  ["Ridgeline 38L Pack", 129, "★★★★★", 214],
  ["Tarnline Rain Shell", 189, "★★★★☆", 96],
  ["Cirque 2P Tent", 349, "★★★★★", 58],
  ["Lowland Fleece", 89, "★★★★☆", 141],
  ["Driftwood Camp Mug", 24, "★★★★★", 322],
  ["Summit Trekking Poles", 119, "★★★★☆", 77],
  ["Hollow 20° Sleeping Bag", 229, "★★★★★", 64],
  ["Basecamp Headlamp", 39, "★★★★☆", 188],
];

const pages = {
  home: (v2, mobile) => `${header("Shop")}
<main>
  <section style="display:grid;grid-template-columns:${mobile ? "1fr" : "1.05fr 1fr"};gap:40px;align-items:center;margin-bottom:36px">
    <div>
      <div class="muted" style="font-weight:600;letter-spacing:1px;font-size:12px;text-transform:uppercase;margin-bottom:12px">Autumn collection</div>
      <h1 style="font-size:${mobile ? 34 : 48}px;line-height:1.1;margin-bottom:16px">${v2 ? "Built for the long way round" : "Gear for the long way round"}</h1>
      <p class="muted" style="font-size:17px;margin-bottom:24px;max-width:460px">Packs, shells and shelters tested on long trails and repaired for life. Made in small batches from recycled fabrics.</p>
      <a class="btn btn-primary">Shop the collection</a> <a class="btn btn-secondary" style="margin-left:8px">Read the journal</a>
    </div>
    ${art(0, mobile ? 200 : 360)}
  </section>
  <h2>Shop by category</h2>
  <section style="display:grid;grid-template-columns:repeat(${mobile ? 2 : 4},1fr);gap:16px">
    ${["Packs", "Shelter", "Layers", "Camp kitchen"].map((c, i) => `<div class="card" style="padding:12px">${art(i + 1, 110)}<div style="font-weight:600;margin-top:10px">${c}</div></div>`).join("")}
  </section>
</main>`,
  catalog: () => `${header("Shop")}
<main style="display:grid;grid-template-columns:220px 1fr;gap:32px">
  <aside>
    <div class="crumbs">Home / Shop / All gear</div>
    ${[["Category", ["Packs", "Shelter", "Layers", "Camp kitchen", "Lighting"]], ["Price", ["Under $50", "$50 – $150", "$150 – $300", "Over $300"]], ["Rating", ["4 stars & up", "5 stars"]]]
      .map(([t, opts]) => `<h2 style="font-size:15px;margin:18px 0 8px">${t}</h2>${opts.map((o, i) => `<div style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:14px"><span style="width:16px;height:16px;border:1px solid #b9b3a5;border-radius:4px;background:${i === 1 && t === "Category" ? "#2f6b45" : "#fff"}"></span>${o}</div>`).join("")}`).join("")}
  </aside>
  <section>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px"><h1 style="font-size:26px">All gear <span class="muted" style="font-size:15px;font-weight:400">· 64 items</span></h1><div class="field" style="width:200px;margin:0">Sort: Most popular</div></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
      ${products.map(([n, p, s, r], i) => `<div class="card" style="padding:10px">${art(i, 120)}<div style="font-weight:600;margin-top:8px;font-size:14px">${n}</div><div class="stars">${s} <span class="muted">(${r})</span></div><div style="font-weight:700;margin-top:2px">$${p}.00</div></div>`).join("")}
    </div>
  </section>
</main>`,
  product: (v2) => `${header("Shop")}
<main>
  <div class="crumbs">Home / Shop / Packs / Ridgeline 38L Pack</div>
  <section style="display:grid;grid-template-columns:1.1fr 1fr;gap:48px">
    <div>${art(0, 420)}<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px">${[0, 1, 2, 3].map((i) => art(i, 70)).join("")}</div></div>
    <div>
      <h1>Ridgeline 38L Pack</h1>
      <div class="stars" style="margin-bottom:12px">★★★★★ <span class="muted">4.8 · 214 reviews</span></div>
      <div style="font-size:26px;font-weight:700;margin-bottom:18px">${v2 ? "$119.00" : "$129.00"}</div>
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">Colour: Moss</div>
      <div style="display:flex;gap:10px;margin-bottom:18px">${["#3f7a52", "#c8643b", "#2a4a66", "#55522f"].map((c, i) => `<span style="width:30px;height:30px;border-radius:50%;background:${c};outline:${i === 0 ? "2px solid #1f2a24" : "none"};outline-offset:2px"></span>`).join("")}</div>
      <label>Torso length<div class="field">Medium (17–19 in)</div></label>
      <a class="btn" style="display:block;text-align:center;background:${v2 ? "#c8643b" : "#2f6b45"};color:#fff;padding:14px">Add to cart</a>
      <p class="muted" style="margin-top:18px">A frameless 38-litre pack with a roll-top closure, stretch side pockets and a removable hip belt. Weighs 790 g; carries up to 12 kg comfortably on multi-day trips.</p>
      <table style="margin-top:14px">${[["Volume", "38 L"], ["Weight", "790 g"], ["Fabric", "Recycled 210D ripstop"], ["Warranty", "Repairs for life"]].map(([k, v]) => `<tr><td class="muted" style="padding:8px 0">${k}</td><td style="padding:8px 0">${v}</td></tr>`).join("")}</table>
    </div>
  </section>
</main>`,
  cart: (v2) => `${header("Shop")}
<main>
  ${v2 ? `<div style="background:#fbf0d9;border:1px solid #ecd39b;color:#7a5410;padding:14px 18px;border-radius:10px;margin-bottom:20px;font-weight:500">Use code TRAIL15 for 15% off your first order — ends Sunday.</div>` : ""}
  <h1 style="margin-bottom:20px">Your cart</h1>
  <section style="display:grid;grid-template-columns:1fr 360px;gap:32px;align-items:start">
    <div class="card">${[[0, "Ridgeline 38L Pack", "Moss · Medium", 129, 1], [4, "Driftwood Camp Mug", "Stone", 24, 2]].map(([i, n, o, p, q]) => `<div style="display:flex;gap:18px;padding:18px;border-bottom:1px solid #efece5;align-items:center"><div style="width:110px">${art(i, 90)}</div><div style="flex:1"><div style="font-weight:600">${n}</div><div class="muted" style="font-size:13px">${o}</div><div style="font-size:13px;margin-top:8px;color:#2f6b45">In stock · ships in 1–2 days</div></div><div class="field" style="width:70px;margin:0">${q}</div><div style="width:90px;text-align:right;font-weight:700">$${p * q}.00</div></div>`).join("")}</div>
    <div class="card" style="padding:22px">
      <h2>Order summary</h2>
      ${[["Subtotal", "$177.00"], ["Shipping", "Free"], ["Estimated tax", "$14.16"]].map(([k, v]) => `<div style="display:flex;justify-content:space-between;margin:8px 0" class="muted"><span>${k}</span><span>${v}</span></div>`).join("")}
      <div style="display:flex;justify-content:space-between;margin:14px 0 18px;font-weight:700;font-size:18px;border-top:1px solid #efece5;padding-top:14px"><span>Total</span><span>$191.16</span></div>
      <a class="btn btn-primary" style="display:block;text-align:center">Check out</a>
    </div>
  </section>
</main>`,
  checkout: () => `${header("Shop")}
<main>
  <h1 style="margin-bottom:20px">Checkout</h1>
  <section style="display:grid;grid-template-columns:1fr 360px;gap:32px;align-items:start">
    <div class="card" style="padding:24px">
      <h2>Contact</h2><label>Email<div class="field">you@example.com</div></label>
      <h2 style="margin-top:8px">Shipping address</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px"><label>First name<div class="field">Alex</div></label><label>Last name<div class="field">Rivera</div></label></div>
      <label>Street address<div class="field">12 Example Lane</div></label>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:0 16px"><label>City<div class="field">Springfield</div></label><label>State<div class="field">OR</div></label><label>ZIP<div class="field">97000</div></label></div>
      <h2 style="margin-top:8px">Delivery</h2>
      ${[["Standard · 3–5 days", "Free", true], ["Express · 1–2 days", "$12.00", false]].map(([n, p, on]) => `<div style="display:flex;justify-content:space-between;padding:12px 14px;border:1px solid ${on ? "#2f6b45" : "#d8d3c7"};border-radius:8px;margin-bottom:8px;font-size:14px"><span>${on ? "◉" : "○"} ${n}</span><span>${p}</span></div>`).join("")}
    </div>
    <div class="card" style="padding:22px">
      <h2>Summary</h2>
      <div style="display:flex;justify-content:space-between;margin:8px 0" class="muted"><span>2 items</span><span>$177.00</span></div>
      <div style="display:flex;justify-content:space-between;margin:8px 0" class="muted"><span>Tax</span><span>$14.16</span></div>
      <div style="display:flex;justify-content:space-between;margin:14px 0 18px;font-weight:700;font-size:18px;border-top:1px solid #efece5;padding-top:14px"><span>Total</span><span>$191.16</span></div>
      <a class="btn btn-primary" style="display:block;text-align:center">Continue to payment</a>
    </div>
  </section>
</main>`,
  "sign-in": () => `${header("")}
<main style="display:flex;justify-content:center;padding-top:56px">
  <div class="card" style="width:400px;padding:32px">
    <h1 style="font-size:26px">Welcome back</h1>
    <p class="muted" style="margin-bottom:22px">Sign in to track orders and manage repairs.</p>
    <label>Email<div class="field">you@example.com</div></label>
    <label>Password<div class="field">••••••••</div></label>
    <a class="btn btn-primary" style="display:block;text-align:center;margin-top:6px">Sign in</a>
    <p class="muted" style="text-align:center;margin-top:18px;font-size:14px">New to Fernway? <a style="color:#2f6b45;font-weight:600">Create an account</a></p>
  </div>
</main>`,
  orders: () => `${header("")}
<main style="display:grid;grid-template-columns:200px 1fr;gap:32px">
  <aside>${["Overview", "Orders", "Repairs", "Addresses", "Settings"].map((n) => `<div style="padding:9px 12px;border-radius:8px;margin-bottom:4px;${n === "Orders" ? "background:#e2f0e6;color:#23432f;font-weight:600" : "color:#44524a"}">${n}</div>`).join("")}</aside>
  <section>
    <h1 style="font-size:26px;margin-bottom:18px">Order history</h1>
    <div class="card"><table><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr>
    ${[["#FW-20931", "Oct 28, 2026", "Ridgeline 38L Pack, Driftwood Camp Mug ×2", "$191.16", "wait", "Processing"], ["#FW-20544", "Sep 14, 2026", "Tarnline Rain Shell", "$204.12", "ok", "Delivered"], ["#FW-19870", "Jul 2, 2026", "Basecamp Headlamp", "$42.12", "ok", "Delivered"], ["#FW-19311", "May 19, 2026", "Lowland Fleece", "$96.12", "off", "Returned"], ["#FW-18702", "Mar 3, 2026", "Cirque 2P Tent", "$376.92", "ok", "Delivered"]]
      .map(([o, d, it, t, k, s]) => `<tr><td style="font-weight:600">${o}</td><td class="muted">${d}</td><td>${it}</td><td>${t}</td><td><span class="pill ${k}">${s}</span></td></tr>`).join("")}
    </table></div>
  </section>
</main>`,
  help: () => `${header("Help")}
<main>
  <section style="text-align:center;padding:24px 0 30px"><h1>How can we help?</h1><div class="field" style="max-width:520px;margin:14px auto 0">Search help articles</div></section>
  <section style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px">
    ${[["Orders & shipping", "Track a parcel, change an address"], ["Returns & repairs", "60-day returns, lifetime repairs"], ["Sizing & fit", "Torso length, layering guides"]].map(([t, s]) => `<div class="card" style="padding:20px"><div style="font-weight:700;margin-bottom:4px">${t}</div><div class="muted" style="font-size:14px">${s}</div></div>`).join("")}
  </section>
  <h2>Frequently asked</h2>
  <div class="card">${["How long does standard shipping take?", "Can I return gear I have used on a trip?", "How do lifetime repairs work?", "Do you ship outside the United States?", "How do I choose the right torso length?"].map((q, i) => `<div style="display:flex;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #efece5"><span style="font-weight:500">${q}</span><span class="muted">${i === 0 ? "−" : "+"}</span></div>${i === 0 ? `<div class="muted" style="padding:0 20px 16px;border-bottom:1px solid #efece5;font-size:14px">Standard orders ship within two business days and arrive in 3–5 days.</div>` : ""}`).join("")}</div>
</main>`,
  "not-found": () => `${header("")}
<main style="text-align:center;padding-top:70px">
  <div style="width:360px;margin:0 auto 24px">${art(2, 180)}</div>
  <div class="muted" style="font-weight:700;letter-spacing:2px">ERROR 404</div>
  <h1>This trail doesn't go anywhere</h1>
  <p class="muted" style="margin-bottom:22px">The page you were looking for has moved or never existed.</p>
  <a class="btn btn-primary">Back to the shop</a>
</main>`,
  wishlist: () => `${header("")}
<main>
  <h1 style="font-size:26px">Wishlist <span class="muted" style="font-size:15px;font-weight:400">· 3 saved</span></h1>
  <p class="muted" style="margin-bottom:20px">We'll email you when saved items go on sale.</p>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">
    ${[2, 6, 1].map((i) => { const [n, p, s] = products[i]; return `<div class="card" style="padding:12px">${art(i, 180)}<div style="font-weight:600;margin-top:10px">${n}</div><div class="stars">${s}</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><b>$${p}.00</b><a class="btn btn-primary" style="padding:8px 14px;font-size:14px">Add to cart</a></div></div>`; }).join("")}
  </div>
</main>`,
};

const shots = [
  ["home", false, false], ["home", true, false], ["home-mobile", false, true], ["home-mobile", true, true],
  ["catalog", false], ["product", false], ["product", true], ["cart", false], ["cart", true],
  ["checkout", false], ["sign-in", false], ["orders", false], ["help", false], ["not-found", false], ["wishlist", false],
];

const outDir = join(here, "png");
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
for (const [name, v2, mobile = false] of shots) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const render = pages[name.replace("-mobile", "")];
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="${mobile ? "mobile" : ""}">${render(v2, mobile)}</body></html>`);
  const file = join(outDir, `${name}${v2 ? ".v2" : ""}.png`);
  await writeFile(file, await page.screenshot());
  await page.close();
  console.log(file);
}
await browser.close();
