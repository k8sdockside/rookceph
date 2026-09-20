// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/rook.ts
  var CLUSTERS = "crd:cephclusters.ceph.rook.io";
  var PODS = "pods";
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

  // src/model/units.ts
  function count(n, noun, plural = `${noun}s`) {
    return `${n} ${n === 1 ? noun : plural}`;
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
  function button(label, onClick, attrs = {}) {
    const node = el("button", { type: "button", ...attrs }, label);
    node.addEventListener("click", onClick);
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
  function since(timestamp, now = Date.now()) {
    if (!timestamp) return "—";
    const then = Date.parse(timestamp);
    if (Number.isNaN(then)) return "—";
    const seconds = Math.max(0, Math.round((now - then) / 1e3));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
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
  function pill(text, tone = "", title = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title ? { title } : {} }, text);
  }
  function block(title, note, ...children) {
    return el("section", { class: "block" }, el("h2", {}, title), note ? el("p", { class: "note" }, note) : null, ...children.filter((c) => c !== null));
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

  // src/pages/daemons.ts
  var REFRESH = 1e4;
  var layout = "type";
  start("page", async (ctx) => {
    replace(byId("head"), heading("Daemons & OSDs", `Every Ceph daemon Rook runs in ${ctx.contextName}, and the machine it runs on.`));
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    let pods = [];
    let clusters = [];
    const byType = button("By daemon", () => pick("type"));
    const byNode = button("By machine", () => pick("node"));
    const pick = (next) => {
      layout = next;
      byType.classList.toggle("primary", layout === "type");
      byNode.classList.toggle("primary", layout === "node");
      void k8sdockside.storage?.set("daemon-layout", layout);
      render(body, failure, pods, clusters);
    };
    const remembered = await k8sdockside.storage?.get("daemon-layout");
    layout = remembered === "node" ? "node" : "type";
    byType.classList.toggle("primary", layout === "type");
    byNode.classList.toggle("primary", layout === "node");
    replace(byId("bar"), byType, byNode);
    const stop = every(
      REFRESH,
      async () => {
        [pods, clusters] = await Promise.all([maybeList({ kind: PODS }), maybeList({ kind: CLUSTERS })]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        render(body, failure, pods, clusters);
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function render(host, failure, pods, clusters) {
    const all = groups(pods);
    if (all.length === 0) {
      const external = clusters.filter((cluster) => cluster.spec?.external?.enable === true);
      replace(
        host,
        failure,
        block(
          "No Ceph daemons run here",
          external.length > 0 ? `${external.map((c) => c.metadata.name).join(", ")} ${external.length === 1 ? "is an external cluster" : "are external clusters"}: the mons, managers and OSDs are on machines outside this Kubernetes cluster, and nothing about them can be read from here.` : "No pod in this cluster carries a rook-ceph app label. Either Rook is not installed, or its operator has not made anything yet.",
          nothing("The storage classes and the pools they point at are still worth a look.")
        )
      );
      return;
    }
    replace(host, failure, ...layout === "type" ? byDaemonType(all) : byMachine(all));
  }
  function byDaemonType(all) {
    return all.map(
      (group) => block(
        "",
        "",
        el(
          "div",
          { class: "group-head" },
          el("h2", { style: "margin:0" }, group.label),
          el("span", { class: `group-count tone-${group.tone || "none"}` }, `${group.running} of ${group.total} running`),
          el("span", { class: "kind-gives" }, group.note)
        ),
        el("div", { class: "daemons" }, ...group.daemons.map((daemon) => tile(daemon))),
        quorumNote(group)
      )
    );
  }
  function byMachine(all) {
    const daemons = all.flatMap((group) => group.daemons);
    const nodes = /* @__PURE__ */ new Map();
    for (const daemon of daemons) {
      const node = daemon.node || "not scheduled";
      nodes.set(node, [...nodes.get(node) ?? [], daemon]);
    }
    return [...nodes.entries()].sort(([a], [b]) => a.localeCompare(b, void 0, { numeric: true })).map(([node, here]) => {
      const mons = here.filter((daemon) => daemon.type === "mon").length;
      const osds = here.filter((daemon) => daemon.type === "osd").length;
      const broken = here.filter((daemon) => daemon.tone === "error" || daemon.tone === "warn").length;
      return block(
        "",
        "",
        el(
          "div",
          { class: "group-head" },
          el("h2", { style: "margin:0" }, node),
          el("span", { class: `group-count tone-${broken ? "warn" : "ok"}` }, `${here.length - broken} of ${here.length} running`),
          mons > 0 ? pill(count(mons, "mon"), "info", "Taking this machine out costs a monitor") : null,
          osds > 0 ? pill(count(osds, "OSD"), "info", "Taking this machine out takes these OSDs down with it") : null
        ),
        el("div", { class: "daemons" }, ...here.map((daemon) => tile(daemon, true)))
      );
    });
  }
  function tile(daemon, withType = false) {
    const label = daemon.id ? `${daemonWord(daemon)}.${daemon.id}` : daemon.name.replace(/^rook-ceph-/, "");
    const node = el(
      "span",
      { class: `daemon tone-edge-${daemon.tone || "none"}`, title: daemon.problem || `${daemon.name} — ${daemon.phase}` },
      el("span", { class: `dot dot-${daemon.tone || "none"}` }),
      el("span", { class: "daemon-id" }, withType || !daemon.id ? label : `${daemonWord(daemon)}.${daemon.id}`),
      daemon.deviceClass ? pill(daemon.deviceClass, "", "The device class Ceph put this disk in") : null,
      daemon.role ? pill(daemon.role, daemon.role === "active" ? "ok" : "", "Which manager is serving the dashboard and the metrics") : null,
      el("span", { class: "daemon-where" }, withType ? since(daemon.startedAt) : daemon.node || "not scheduled"),
      daemon.restarts > 0 ? pill(`${daemon.restarts}×`, daemon.restarts > 3 ? "warn" : "", `Restarted ${daemon.restarts} times`) : null
    );
    clickable(node, () => void k8sdockside.open({ kind: PODS, namespace: daemon.namespace, name: daemon.name }));
    return node;
  }
  function daemonWord(daemon) {
    return DAEMONS.find((entry) => entry.type === daemon.type)?.type ?? daemon.type;
  }
  function quorumNote(group) {
    if (group.type !== "mon") return null;
    const need = Math.floor(group.total / 2) + 1;
    if (group.total === 0) return null;
    const short = group.running < need;
    const even = group.total % 2 === 0;
    if (!short && !even) return null;
    return el(
      "p",
      { class: short ? "card-problem" : "note", style: "margin-top:8px" },
      short ? `Only ${group.running} of ${group.total} monitors are running, and a quorum needs ${need}. Ceph stops serving reads and writes without one.` : `${group.total} monitors is an even number: a quorum still needs ${need}, so the extra one buys no more tolerance than ${group.total - 1} would.`
    );
  }
})();
