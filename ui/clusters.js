// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/rook.ts
  var CLUSTERS = "crd:cephclusters.ceph.rook.io";
  var PODS = "pods";
  var CLUSTER_LABEL = "rook_cluster";
  var APP = {
    mon: "rook-ceph-mon",
    mgr: "rook-ceph-mgr",
    osd: "rook-ceph-osd",
    osdPrepare: "rook-ceph-osd-prepare",
    mds: "rook-ceph-mds",
    rgw: "rook-ceph-rgw",
    nfs: "rook-ceph-nfs",
    rbdMirror: "rook-ceph-rbd-mirror",
    operator: "rook-ceph-operator",
    crash: "rook-ceph-crashcollector",
    exporter: "rook-ceph-exporter"
  };
  var OSD_ID_LABEL = "ceph-osd-id";
  var DEVICE_CLASS_LABEL = "device-class";
  var FAILURE_DOMAIN_LABEL = "failure-domain";
  var DAEMON_ID_LABEL = "ceph_daemon_id";
  var MGR_ROLE_LABEL = "mgr_role";

  // src/model/daemons.ts
  var DAEMONS = [
    { type: "mon", app: APP.mon, label: "Monitors", note: "hold the maps every client and daemon reads; a quorum of them must be up" },
    { type: "mgr", app: APP.mgr, label: "Managers", note: "run the dashboard, the metrics and the balancer; one is active, the rest stand by" },
    { type: "osd", app: APP.osd, label: "OSDs", note: "one per disk: this is where the data is" },
    { type: "mds", app: APP.mds, label: "Metadata servers", note: "serve CephFS; each filesystem has active ones and standbys" },
    { type: "rgw", app: APP.rgw, label: "Object gateways", note: "the S3 endpoint in front of an object store" },
    { type: "nfs", app: APP.nfs, label: "NFS servers", note: "export CephFS over NFS" },
    { type: "rbd-mirror", app: APP.rbdMirror, label: "RBD mirrors", note: "copy block pools to another Ceph cluster" },
    { type: "exporter", app: APP.exporter, label: "Exporters", note: "per-node Ceph metrics" },
    { type: "crash", app: APP.crash, label: "Crash collectors", note: "keep crash reports from the daemons on each node" },
    { type: "operator", app: APP.operator, label: "Operator", note: "Rook itself: it makes every other pod here" }
  ];
  function typeOf(pod) {
    const app = pod.metadata.labels?.["app"] ?? "";
    if (app === APP.osdPrepare) return "other";
    const found = DAEMONS.find((daemon) => daemon.app === app);
    return found?.type ?? "other";
  }
  function daemonView(pod) {
    const labels = pod.metadata.labels ?? {};
    const type = typeOf(pod);
    const statuses = pod.status?.containerStatuses ?? [];
    const phase = pod.status?.phase ?? "";
    const ready = statuses.length > 0 && statuses.every((container) => container.ready === true);
    const restarts = statuses.reduce((n, container) => n + (container.restartCount ?? 0), 0);
    const problem = problemOf(pod, phase, ready, statuses);
    return {
      pod,
      type,
      name: pod.metadata.name,
      namespace: pod.metadata.namespace ?? "",
      node: pod.spec?.nodeName ?? "",
      id: labels[OSD_ID_LABEL] ?? labels[DAEMON_ID_LABEL] ?? "",
      deviceClass: labels[DEVICE_CLASS_LABEL] ?? "",
      failureDomain: labels[FAILURE_DOMAIN_LABEL] ?? "",
      role: labels[MGR_ROLE_LABEL] ?? "",
      phase,
      ready,
      restarts,
      problem,
      tone: phase === "Running" && ready ? "ok" : phase === "Failed" ? "error" : problem ? "warn" : "",
      startedAt: pod.status?.startTime ?? ""
    };
  }
  function problemOf(pod, phase, ready, statuses) {
    if (phase === "Running" && ready) return "";
    for (const container of statuses) {
      const waiting = container.state?.waiting;
      if (waiting?.reason) return waiting.message || waiting.reason;
      const terminated = container.state?.terminated;
      if (terminated?.reason && terminated.reason !== "Completed") return `${terminated.reason} (exit ${terminated.exitCode ?? "?"})`;
    }
    if (pod.status?.reason) return pod.status.reason;
    if (pod.status?.message) return pod.status.message;
    if (phase === "Pending") return "the pod has not been scheduled or its image is still being pulled";
    if (phase === "Running" && !ready) return "the pod is running but has not reported itself ready";
    return "";
  }
  function groups(pods) {
    const views = pods.map(daemonView);
    return DAEMONS.map(({ type, label, note }) => {
      const daemons = views.filter((daemon) => daemon.type === type).sort(byDaemon);
      const running = daemons.filter((daemon) => daemon.tone === "ok").length;
      return {
        type,
        label,
        note,
        daemons,
        running,
        total: daemons.length,
        tone: daemons.length === 0 ? "" : running === daemons.length ? "ok" : running === 0 ? "error" : "warn"
      };
    }).filter((group) => group.total > 0);
  }
  function byDaemon(a, b) {
    if (a.id && b.id) return a.id.localeCompare(b.id, void 0, { numeric: true });
    return a.name.localeCompare(b.name, void 0, { numeric: true });
  }
  function ofCluster(pods, namespace) {
    return pods.filter((pod) => (pod.metadata.labels?.[CLUSTER_LABEL] ?? pod.metadata.namespace ?? "") === namespace);
  }
  function osdSpread(daemons) {
    const perNode = /* @__PURE__ */ new Map();
    for (const daemon of daemons) {
      if (daemon.type !== "osd" || !daemon.node) continue;
      perNode.set(daemon.node, (perNode.get(daemon.node) ?? 0) + 1);
    }
    return { nodes: perNode.size, most: Math.max(0, ...perNode.values()) };
  }

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
      versions: Object.entries(map ?? {}).map(([version, count2]) => ({ version, count: count2 })).sort((a, b) => b.count - a.count || a.version.localeCompare(b.version))
    }));
  }
  function mixedVersions(view) {
    const all = /* @__PURE__ */ new Set();
    for (const daemon of view.daemonVersions) for (const v of daemon.versions) all.add(v.version);
    return all.size > 1;
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
  function count(n, noun, plural = `${noun}s`) {
    return `${n} ${n === 1 ? noun : plural}`;
  }

  // node_modules/@k8sdockside/plugin-sdk/dom.js
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    append(node, children);
    return node;
  }
  function button(label, onClick, attrs = {}) {
    const node = el("button", { type: "button", ...attrs }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    append(parent, children);
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }
  function append(parent, children) {
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
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
  function focused() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { namespace: params.get("namespace") ?? "", name: params.get("name") ?? "" };
  }
  function every(ms, body, onError) {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await body();
      } catch (err) {
        onError(err);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
  async function maybeList(query) {
    try {
      return await k8sdockside.list(query);
    } catch {
      return [];
    }
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
  function stackLegend(segments) {
    const list = el("ul", { class: "stack-legend" });
    for (const segment of segments) {
      list.append(
        el(
          "li",
          {},
          el("span", { class: `dot dot-${segment.tone || "none"}` }),
          el("span", { class: "stack-name" }, segment.label),
          el("span", { class: "stack-size" }, size(segment.bytes))
        )
      );
    }
    return list;
  }
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function block(title, note, ...children) {
    return el("section", { class: "block" }, el("h2", {}, title), note ? el("p", { class: "note" }, note) : null, ...children.filter((c) => c !== null));
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
  function heading(title, note) {
    return el(
      "header",
      { class: "page-head" },
      el("img", { class: "mark", src: "logo.svg", alt: "", width: 26, height: 26 }),
      el("div", {}, el("h1", {}, title), note ? el("p", { class: "note" }, note) : null)
    );
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
  function openName(label, ref, className = "card-name") {
    const node = el("button", { type: "button", class: className, title: `Open ${label}` }, label);
    node.addEventListener("click", () => void k8sdockside.open(ref));
    return node;
  }

  // src/pages/clusters.ts
  var REFRESH = 1e4;
  start("page", async (ctx) => {
    replace(byId("head"), heading("Ceph clusters", `The CephClusters Rook manages from ${ctx.contextName}.`));
    const only = focused().name;
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const [clusters, pods] = await Promise.all([maybeList({ kind: CLUSTERS }), maybeList({ kind: PODS })]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        const views = clusters.map(clusterView).filter((view) => !only || view.name === only);
        if (views.length === 0) {
          replace(
            body,
            failure,
            block(
              only ? `No CephCluster named ${only}` : "No CephCluster here",
              only ? "It may have been deleted since this view was opened." : "Rook keeps one CephCluster per namespace. Without one, Ceph is not managed from this Kubernetes cluster — though storage classes here may still provision from a Ceph elsewhere.",
              el("p", { class: "links" }, button("Open the storage class map", () => void k8sdockside.openView("classes")))
            )
          );
          return;
        }
        replace(body, failure, ...views.map((view) => card(view, pods)));
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function card(view, pods) {
    const daemonGroups = view.external ? [] : groups(ofCluster(pods, view.namespace));
    const osds = daemonGroups.find((group) => group.type === "osd")?.daemons ?? [];
    const spread = osdSpread(osds);
    return el(
      "section",
      { class: `block tone-edge-${view.tone || "none"}`, style: "border-left-width:3px" },
      el(
        "div",
        { class: "card-head" },
        openName(view.name, { kind: CLUSTERS, namespace: view.namespace, name: view.name }, "card-name"),
        el("span", { class: "faint" }, view.namespace),
        el("span", { class: "spacer" }),
        pill(view.health || "not reported", view.tone),
        view.phase ? pill(view.phase, view.phase === "Ready" || view.phase === "Connected" ? "ok" : "warn") : null,
        pill(view.external ? "external" : "converged", view.external ? "info" : "", view.external ? "Ceph runs outside this Kubernetes cluster" : "Rook runs the Ceph daemons on these machines")
      ),
      el("p", { class: "note" }, healthSentence(view) + (view.message ? ` ${view.message}` : "")),
      capacityBlock(view),
      el("div", { class: "grid" }, identity(view), makeup(view, daemonGroups, spread)),
      view.checks.length > 0 ? checksBlock(view) : null,
      view.daemonVersions.length > 0 ? versionsBlock(view) : null,
      view.external ? externalNote() : null
    );
  }
  function capacityBlock(view) {
    const capacity = capacityOf(view.cluster);
    if (!capacity.known) {
      return el("p", { class: "faint" }, "Ceph has not reported any capacity yet. Rook fills this in the first time it can read `ceph df` from the mons.");
    }
    const tone = fullnessTone(capacity);
    const segments = [
      { label: "Used", bytes: capacity.used, tone },
      { label: "Free", bytes: Math.max(0, capacity.total - capacity.used), tone: "" }
    ];
    return el(
      "div",
      { style: "margin-bottom:10px" },
      stack(segments, capacity.total),
      stackLegend(segments),
      el(
        "p",
        { class: "numbers" },
        el("span", {}, el("strong", {}, `${percent(capacity.used, capacity.total).toFixed(1)}%`), " of raw capacity used"),
        capacity.lastUpdated ? el("span", {}, "read ", el("strong", {}, capacity.lastUpdated)) : null
      ),
      el(
        "p",
        { class: "note", style: "margin-top:4px" },
        "This is raw capacity: what the OSDs hold before replication is divided out. A pool with three copies stores a third of it. Ceph stops accepting writes at its full ratio, 95% by default."
      )
    );
  }
  function identity(view) {
    const pairs = [
      ["Ceph version", view.version || "—"],
      ["Image", el("span", { class: "mono" }, view.image || "—")],
      ["fsid", el("span", { class: "mono" }, view.fsid || "—")],
      ["Mode", view.external ? "external — Ceph runs elsewhere" : "converged — Rook runs Ceph here"],
      ["Ceph dashboard", view.dashboard ? "on" : "off"]
    ];
    if (!view.external) {
      const storage = view.cluster.spec?.storage;
      pairs.push(["Mons wanted", view.monsWanted ? String(view.monsWanted) : "—"]);
      pairs.push([
        "Disks",
        storage?.useAllDevices ? "every device Rook finds" : storage?.deviceFilter ? `devices matching ${storage.deviceFilter}` : (storage?.storageClassDeviceSets?.length ?? 0) > 0 ? `${count(storage?.storageClassDeviceSets?.length ?? 0, "device set")} on PVCs` : "named per node"
      ]);
      if (view.cluster.spec?.dataDirHostPath) pairs.push(["Host path", el("span", { class: "mono" }, view.cluster.spec.dataDirHostPath)]);
    }
    return el("div", { class: "card" }, el("h2", {}, "What it is"), facts(pairs));
  }
  function makeup(view, daemonGroups, spread) {
    const pairs = [];
    if (view.deviceClasses.length > 0) {
      pairs.push(["Device classes", el("span", {}, ...view.deviceClasses.map((name) => pill(name, "info")))]);
    }
    const stores = Object.entries(view.stores);
    if (stores.length > 0) {
      pairs.push(["OSD store", stores.map(([name, n]) => `${n} × ${name}`).join(", ")]);
    }
    if (view.external) {
      pairs.push(["Daemons", "on the external cluster — none of them run here"]);
    } else {
      for (const group of daemonGroups) {
        if (group.type === "operator" || group.type === "crash" || group.type === "exporter") continue;
        pairs.push([
          group.label,
          el(
            "span",
            {},
            `${group.running} of ${group.total} running`,
            group.tone !== "ok" ? el("span", { class: `tone-${group.tone || "none"}` }, " — something is not") : null
          )
        ]);
      }
      if (spread.nodes > 0) {
        pairs.push([
          "OSD spread",
          `${count(spread.nodes, "machine")}, at most ${count(spread.most, "OSD")} on one` + (spread.nodes < 3 ? " — fewer than three machines cannot survive a host failure with the default CRUSH rule" : "")
        ]);
      }
    }
    if (pairs.length === 0) return el("div", { class: "card" }, el("h2", {}, "What it is made of"), nothing("Nothing reported yet."));
    const node = el("div", { class: "card" }, el("h2", {}, "What it is made of"), facts(pairs));
    if (!view.external && daemonGroups.length > 0) {
      const open = el("p", { class: "links" }, button("Open the daemon map", () => void k8sdockside.openView("daemons")));
      node.append(open);
    }
    return node;
  }
  function checksBlock(view) {
    const list = el("ul", { class: "checks" });
    for (const check of view.checks) {
      const row = el(
        "li",
        { class: "check" },
        el("span", { class: `dot dot-${check.tone || "none"}` }),
        el("span", { class: "check-id" }, check.id),
        el("span", { class: "check-message" }, check.message)
      );
      clickable(row, () => void k8sdockside.openUrl(`https://docs.ceph.com/en/latest/rados/operations/health-checks/#${check.id.toLowerCase()}`));
      list.append(row);
    }
    return block("Health checks", "What `ceph status` would print. Each row opens what the check means.", list);
  }
  function versionsBlock(view) {
    const table = el("table");
    table.append(el("thead", {}, el("tr", {}, el("th", {}, "Daemon"), el("th", {}, "Ceph version"), el("th", {}, "How many"))));
    const rows = el("tbody");
    for (const daemon of view.daemonVersions) {
      for (const version of daemon.versions) {
        rows.append(el("tr", {}, el("td", {}, daemon.type), el("td", { class: "mono" }, version.version), el("td", {}, String(version.count))));
      }
    }
    table.append(rows);
    return block(
      "Versions the mons report",
      mixedVersions(view) ? "More than one Ceph version is running. During an upgrade that is expected; left this way it is the thing that bites." : "Every daemon is on the same Ceph version.",
      table
    );
  }
  function externalNote() {
    return block(
      "This is an external cluster",
      "Rook holds the connection details and runs the CSI drivers; the mons, OSDs and managers are on machines this app cannot see. Health and capacity are whatever the external cluster reports, and nothing here can change it.",
      el("p", { class: "links" }, button("How external clusters work", () => void k8sdockside.openUrl("https://rook.io/docs/rook/latest/CRDs/Cluster/external-cluster/external-cluster/")))
    );
  }
})();
