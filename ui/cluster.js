// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/health.ts
  var NO_CAPACITY = { total: 0, used: 0, available: 0, known: false, lastUpdated: "" };
  function clusterView(cluster) {
    const ceph = cluster.status?.ceph ?? null;
    const health = ceph?.health ?? "";
    const external = cluster.spec?.external?.enable === true;
    return {
      cluster,
      name: cluster.metadata.name,
      namespace: cluster.metadata.namespace ?? "",
      mode: external ? "external" : "converged",
      external,
      health,
      word: healthWord(health),
      tone: healthTone(health),
      phase: cluster.status?.phase ?? cluster.status?.state ?? "",
      message: cluster.status?.message ?? "",
      fsid: ceph?.fsid ?? "",
      version: cluster.status?.version?.version ?? "",
      image: cluster.status?.version?.image ?? cluster.spec?.cephVersion?.image ?? "",
      checks: checks(ceph?.details),
      capacity: capacityOf(cluster),
      deviceClasses: (cluster.status?.storage?.deviceClasses ?? []).map((c) => c.name ?? "").filter((n) => n !== ""),
      stores: cluster.status?.storage?.osd?.storeType ?? {},
      monsWanted: external ? 0 : cluster.spec?.mon?.count ?? 0,
      daemonVersions: daemonVersions(cluster),
      dashboard: cluster.spec?.dashboard?.enabled === true,
      cleanup: cluster.spec?.cleanupPolicy?.confirmation ?? ""
    };
  }
  function healthWord(health) {
    switch (health) {
      case "HEALTH_OK":
        return "ok";
      case "HEALTH_WARN":
        return "warn";
      case "HEALTH_ERR":
        return "err";
      default:
        return health ? health.toLowerCase() : "unknown";
    }
  }
  function healthTone(health) {
    switch (health) {
      case "HEALTH_OK":
        return "ok";
      case "HEALTH_WARN":
        return "warn";
      case "HEALTH_ERR":
        return "error";
      default:
        return "";
    }
  }
  function healthSentence(view) {
    switch (view.health) {
      case "HEALTH_OK":
        return "Ceph reports every check passing.";
      case "HEALTH_WARN":
        return `Ceph is warning about ${view.checks.length === 1 ? "one check" : `${view.checks.length} checks`}.`;
      case "HEALTH_ERR":
        return `Ceph is in error on ${view.checks.length === 1 ? "one check" : `${view.checks.length} checks`}.`;
      default:
        return "Rook has not read the cluster status yet. That is not the same as a problem — give it a moment.";
    }
  }
  function checks(details) {
    const rank = (severity) => severity === "HEALTH_ERR" ? 0 : severity === "HEALTH_WARN" ? 1 : 2;
    return Object.entries(details ?? {}).map(([id, detail]) => ({
      id,
      severity: detail?.severity ?? "",
      message: detail?.message ?? "",
      tone: healthTone(detail?.severity ?? "")
    })).sort((a, b) => rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id));
  }
  function capacityOf(cluster) {
    const capacity = cluster.status?.ceph?.capacity;
    const total = capacity?.bytesTotal ?? 0;
    const used = capacity?.bytesUsed ?? 0;
    const available = capacity?.bytesAvailable ?? 0;
    if (!(total > 0)) return { ...NO_CAPACITY, lastUpdated: capacity?.lastUpdated ?? "" };
    return {
      total,
      used: Math.max(0, Math.min(used, total)),
      available: Math.max(0, Math.min(available, total)),
      known: true,
      lastUpdated: capacity?.lastUpdated ?? ""
    };
  }
  function fullnessTone(capacity) {
    if (!capacity.known) return "";
    const share = capacity.used / capacity.total;
    if (share >= 0.95) return "error";
    if (share >= 0.85) return "warn";
    return "ok";
  }
  function daemonVersions(cluster) {
    const versions = cluster.status?.ceph?.versions;
    if (!versions) return [];
    const types = [
      ["mon", versions.mon],
      ["mgr", versions.mgr],
      ["osd", versions.osd],
      ["mds", versions.mds],
      ["rgw", versions.rgw]
    ];
    return types.filter(([, map]) => map && Object.keys(map).length > 0).map(([type, map]) => ({
      type,
      versions: Object.entries(map ?? {}).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count || a.version.localeCompare(b.version))
    }));
  }

  // src/model/units.ts
  function size(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
      n /= 1024;
      unit++;
    }
    const digits = n >= 100 || unit === 0 ? 0 : n >= 10 ? 1 : 2;
    return `${n.toFixed(digits)} ${units[unit]}`;
  }
  function percent(part, whole) {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(100, part / whole * 100));
  }

  // src/ui/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(child);
    }
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }

  // src/ui/page.ts
  function fail(host, err) {
    const message = err instanceof Error ? err.message : String(err);
    replace(
      host,
      el("div", { class: "failure" }, el("strong", {}, "That did not work. "), el("span", {}, message))
    );
  }
  function start(hostId, body) {
    const run = async () => {
      const host = document.getElementById(hostId);
      try {
        const ctx = await k8sdockside.ready();
        await body(ctx);
      } catch (err) {
        if (host) fail(host, err);
      }
    };
    void run();
  }

  // src/ui/parts.ts
  function stack(segments, whole) {
    const bar = el("div", { class: "stack" });
    for (const segment of segments) {
      if (segment.bytes <= 0) continue;
      const piece = el("span", { class: `stack-part fill-${segment.tone || "none"}`, title: `${segment.label}: ${size(segment.bytes)}` });
      piece.style.width = `${percent(segment.bytes, whole)}%`;
      bar.append(piece);
    }
    return bar;
  }
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function facts(pairs) {
    const list = el("dl", { class: "facts" });
    for (const [term, value] of pairs) {
      list.append(el("dt", {}, term), el("dd", {}, typeof value === "string" ? value || "—" : value));
    }
    return list;
  }
  function nothing(message) {
    return el("p", { class: "empty" }, message);
  }
  function clickable(node, onPick) {
    node.classList.add("pick");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.addEventListener("click", onPick);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPick();
      }
    });
    return node;
  }

  // src/pages/cluster.ts
  start("panel", async () => {
    const host = byId("panel");
    const view = clusterView(await k8sdockside.object());
    const capacity = capacityOf(view.cluster);
    const head = el(
      "div",
      { class: "panel-head" },
      pill(view.health || "not reported", view.tone),
      view.phase ? pill(view.phase, view.phase === "Ready" || view.phase === "Connected" ? "ok" : "warn") : null,
      pill(view.external ? "external Ceph" : "converged", view.external ? "info" : ""),
      view.version ? pill(`Ceph ${view.version}`, "") : null,
      view.dashboard ? pill("dashboard on", "") : null
    );
    const pairs = [["Status", healthSentence(view)]];
    if (view.fsid) pairs.push(["fsid", el("span", { class: "mono" }, view.fsid)]);
    if (view.deviceClasses.length > 0) pairs.push(["Device classes", view.deviceClasses.join(", ")]);
    const stores = Object.entries(view.stores);
    if (stores.length > 0) pairs.push(["OSD store", stores.map(([name, n]) => `${n} × ${name}`).join(", ")]);
    if (view.message) pairs.push(["Rook says", view.message]);
    replace(host, head, capacityPiece(capacity), facts(pairs), checks2(view.checks));
  });
  function capacityPiece(capacity) {
    if (!capacity.known) return el("p", { class: "faint" }, "Ceph has not reported any capacity yet.");
    const tone = fullnessTone(capacity);
    const segments = [
      { label: "Used", bytes: capacity.used, tone },
      { label: "Free", bytes: Math.max(0, capacity.total - capacity.used), tone: "" }
    ];
    return el(
      "div",
      { style: "margin-bottom:8px" },
      stack(segments, capacity.total),
      el(
        "p",
        { class: "numbers", style: "margin-top:4px" },
        el("span", {}, el("strong", {}, size(capacity.used)), " used"),
        el("span", {}, el("strong", {}, size(capacity.total)), " raw"),
        el("span", {}, el("strong", {}, `${percent(capacity.used, capacity.total).toFixed(0)}%`), " full")
      )
    );
  }
  function checks2(list) {
    if (list.length === 0) return nothing("Ceph is not complaining about anything.");
    const node = el("ul", { class: "checks" });
    for (const check of list) {
      const row = el(
        "li",
        { class: "check" },
        el("span", { class: `dot dot-${check.tone || "none"}` }),
        el("span", { class: "check-id" }, check.id),
        el("span", { class: "check-message" }, check.message)
      );
      clickable(row, () => void k8sdockside.openUrl(`https://docs.ceph.com/en/latest/rados/operations/health-checks/#${check.id.toLowerCase()}`));
      node.append(row);
    }
    return node;
  }
})();
