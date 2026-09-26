// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/rook.ts
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
  function byDaemon(a, b) {
    if (a.id && b.id) return a.id.localeCompare(b.id, void 0, { numeric: true });
    return a.name.localeCompare(b.name, void 0, { numeric: true });
  }
  function onNode(pods, node) {
    return pods.map(daemonView).filter((daemon) => daemon.node === node && daemon.type !== "other").sort((a, b) => DAEMONS.findIndex((d) => d.type === a.type) - DAEMONS.findIndex((d) => d.type === b.type) || byDaemon(a, b));
  }

  // src/model/units.ts
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

  // src/pages/node.ts
  start("panel", async () => {
    const host = byId("panel");
    const node = await k8sdockside.object();
    const pods = await maybeList({ kind: PODS });
    const daemons = onNode(pods, node.metadata.name);
    if (daemons.length === 0) {
      replace(host, nothing("No Ceph daemon runs on this machine. Rook schedules mons and OSDs onto the nodes it was given disks on; everything else follows its own placement rules."));
      return;
    }
    const mons = daemons.filter((daemon) => daemon.type === "mon").length;
    const osds = daemons.filter((daemon) => daemon.type === "osd").length;
    const broken = daemons.filter((daemon) => daemon.tone === "error" || daemon.tone === "warn");
    replace(
      host,
      el(
        "div",
        { class: "panel-head" },
        pill(`${daemons.length - broken.length} of ${daemons.length} running`, broken.length === 0 ? "ok" : "warn"),
        mons > 0 ? pill(count(mons, "monitor"), "info") : null,
        osds > 0 ? pill(count(osds, "OSD"), "info") : null
      ),
      el("div", { class: "daemons" }, ...daemons.map(tile)),
      cost(mons, osds)
    );
  });
  function tile(daemon) {
    const label = daemon.id ? `${daemon.type}.${daemon.id}` : daemon.name.replace(/^rook-ceph-/, "");
    const node = el(
      "span",
      { class: `daemon tone-edge-${daemon.tone || "none"}`, title: daemon.problem || `${daemon.name} — ${daemon.phase}` },
      el("span", { class: `dot dot-${daemon.tone || "none"}` }),
      el("span", { class: "daemon-id" }, label),
      daemon.deviceClass ? pill(daemon.deviceClass, "", "The device class Ceph put this disk in") : null,
      daemon.role ? pill(daemon.role, daemon.role === "active" ? "ok" : "") : null,
      daemon.restarts > 0 ? pill(`${daemon.restarts}×`, daemon.restarts > 3 ? "warn" : "") : null
    );
    clickable(node, () => void k8sdockside.open({ kind: PODS, namespace: daemon.namespace, name: daemon.name }));
    return node;
  }
  function cost(mons, osds) {
    const parts = [];
    if (mons > 0) parts.push(`${count(mons, "monitor")} — a quorum is more than half of them, so check how many are left before you drain this node`);
    if (osds > 0) parts.push(`${count(osds, "OSD")} — Ceph rebuilds what they held onto the remaining disks, which copies data across the network`);
    if (parts.length === 0) return null;
    return el("p", { class: "note", style: "margin:8px 0 0" }, `Draining this machine takes down ${parts.join("; and ")}.`);
  }
})();
