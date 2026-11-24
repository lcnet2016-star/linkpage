(() => {
  "use strict";

  const routes = new Map();

  const num = (value) => {
    if (value === undefined || value === null || value === "") return NaN;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const asArray = (value) => Array.isArray(value) ? value : [];
  const candidates = (data) => [...asArray(data?.campaigns), ...asArray(data?.upcoming)];
  const campaignId = (c) => c?.id === null || c?.id === undefined ? "" : String(c.id);
  const isExcluded = (c) => !c || c.enabled === false ||
    ["draft", "private", "archived", "disabled"].includes(String(c.status || "").toLowerCase());
  const published = (c, now) => {
    const start = num(c.publish_at_ms);
    return !isExcluded(c) && (!Number.isFinite(start) || now >= start);
  };

  function campaignView(data, now = Date.now()) {
    const v = data || {};
    const campaigns = asArray(v.campaigns).filter((c) => {
      if (!published(c, now)) return false;
      const start = num(c.start_at_ms), end = num(c.end_at_ms);
      if (Number.isFinite(start) && now < start) return false;
      if (Number.isFinite(end) && now >= end) return false;
      return true;
    });
    const activeIds = new Set(campaigns.map(campaignId).filter(Boolean));
    const upcoming = asArray(v.upcoming).filter((c) => {
      if (!published(c, now) || activeIds.has(campaignId(c))) return false;
      const start = num(c.start_at_ms), end = num(c.end_at_ms);
      return (!Number.isFinite(start) || now < start) && (!Number.isFinite(end) || now < end);
    });
    return {...v, campaigns, upcoming};
  }

  function nextBoundary(data, now) {
    let next = Infinity;
    for (const c of candidates(data)) {
      if (isExcluded(c)) continue;
      for (const n of [num(c.publish_at_ms), num(c.start_at_ms), num(c.end_at_ms)]) {
        if (Number.isFinite(n) && n > now && n < next) next = n;
      }
    }
    return next;
  }

  function showTeaserTime(ms) {
    const timestamp = num(ms);
    if (!Number.isFinite(timestamp)) return "";
    const pieces = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const f = Object.fromEntries(pieces.map(({type, value}) => [type, value]));
    return `${f.month}/${f.day} ${f.hour}:${f.minute} JST`;
  }

  function watchCampaignFeed(key, read, render, {initial = null, missing = () => {}, retainOnError = true} = {}) {
    if (routes.has(key)) {
      const existing = routes.get(key);
      existing.render = render;
      existing.show();
      return existing.refresh();
    }
    let current = initial;
    let timer = null;
    let pending = null;
    function schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const now = Date.now(), next = nextBoundary(current, now);
      if (!Number.isFinite(next)) return;
      timer = setTimeout(() => {
        show();
        refresh();
      }, Math.min(next - now, 2147483647));
    }
    function show() {
      if (current) entry.render(campaignView(current));
      else missing();
      schedule();
    }
    function refresh() {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(read)
        .then((data) => { if (data && typeof data === "object") current = data; })
        .catch(() => { if (!retainOnError) current = null; })
        .finally(() => { pending = null; show(); });
      return pending;
    }
    const entry = {render, show, refresh};
    routes.set(key, entry);
    if (initial) show();
    setInterval(refresh, 30_000);
    return refresh();
  }

  async function getPublicJson(path, match) {
    if (!/^\/data\/(?:cms|content)\/[a-zA-Z0-9._-]+\.json$/.test(path)) {
      throw new Error("Unsupported public JSON path");
    }
    const res = await fetch(path, {cache: "no-store", redirect: "error"});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || (match && !match(data))) throw new Error("Invalid public JSON shape");
    return data;
  }

  function safeHref(value) {
    if (typeof value !== "string" || !value || /[\x00-\x20\\]/.test(value)) return null;
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    if (!value.startsWith("https://")) return null;
    try {
      const url = new URL(value);
      return url.username || url.password ? null : url.href;
    } catch { return null; }
  }

  function isManagedCampaignFeed(data) {
    if (!data || data.success !== true || !Array.isArray(data.campaigns) || !Array.isArray(data.upcoming)) return false;
    const declared = new Set();
    function check(c, teaser) {
      if (!c || isExcluded(c) || !campaignId(c) || typeof c.title !== "string" || !c.title.trim()) return false;
      if (declared.has(campaignId(c))) return false;
      declared.add(campaignId(c));
      const start = num(c.start_at_ms), end = num(c.end_at_ms);
      if (!Number.isSafeInteger(start) || (c.end_at_ms !== undefined && (!Number.isSafeInteger(end) || end <= start))) return false;
      if (c.publish_at_ms !== undefined && !Number.isSafeInteger(num(c.publish_at_ms))) return false;
      if (teaser) {
        const keys = new Set(["id", "title", "publish_at_ms", "start_at_ms", "end_at_ms", "enabled", "status"]);
        return Object.keys(c).every(k => keys.has(k));
      }
      return Number.isSafeInteger(end) && Array.isArray(c.links) && c.links.length <= 4
        && c.links.every(l => l && safeHref(l.url) && typeof l.text === "string")
        && (c.image_url == null || c.image_url === "" || !!safeHref(c.image_url));
    }
    return data.campaigns.every(c => check(c, false)) && data.upcoming.every(c => check(c, true));
  }

  function withSaleUtm(value, target) {
    const url = safeHref(value);
    if (!url) return "#";
    const u = new URL(url, location.origin);
    for (const [k, v] of Object.entries({utm_source: "site", utm_medium: "lp", utm_campaign: "cf_sale", utm_content: target})) {
      u.searchParams.set(k, v);
    }
    return u.origin === location.origin ? u.pathname + u.search + u.hash : u.href;
  }

  window.PolarisStatic = Object.freeze({
    asArray, campaignView, showTeaserTime, watchCampaignFeed, getPublicJson, safeHref, withSaleUtm, isManagedCampaignFeed,
  });
})();
