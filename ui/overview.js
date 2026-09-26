// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
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
  function quantity(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const match = /^\s*([0-9.]+)\s*([EPTGMk]i?|m)?\s*$/.exec(value);
    if (!match) {
      const plain = Number(value);
      return Number.isFinite(plain) ? plain : 0;
    }
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return 0;
    const suffix = match[2] ?? "";
    const binary = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
    const decimal = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, m: 1e-3 };
    return n * (binary[suffix] ?? decimal[suffix] ?? 1);
  }

  // src/model/classes.ts
  var SUFFIXES = [
    { suffix: "rbd.csi.ceph.com", kind: "block" },
    { suffix: "cephfs.csi.ceph.com", kind: "file" },
    { suffix: "nfs.csi.ceph.com", kind: "nfs" },
    { suffix: "ceph.rook.io/bucket", kind: "bucket" }
  ];
  var KIND_WORDS = {
    block: { label: "Block (RBD)", short: "block", gives: "an RBD image, mounted by one node at a time" },
    file: { label: "Shared file (CephFS)", short: "file", gives: "a CephFS subvolume, mountable by many pods at once" },
    nfs: { label: "NFS", short: "nfs", gives: "an NFS export of a CephFS subvolume" },
    bucket: { label: "Object (S3 bucket)", short: "bucket", gives: "an S3 bucket, asked for with an ObjectBucketClaim" },
    other: { label: "Other", short: "other", gives: "something this plugin does not recognise" }
  };
  var KIND_ORDER = ["block", "file", "nfs", "bucket", "other"];
  function kindOf(provisioner) {
    for (const { suffix, kind } of SUFFIXES) {
      if (provisioner === suffix || provisioner.endsWith(`.${suffix}`)) return kind;
    }
    return null;
  }
  function driverNamespace(provisioner) {
    for (const { suffix } of SUFFIXES) {
      if (provisioner.endsWith(`.${suffix}`)) return provisioner.slice(0, provisioner.length - suffix.length - 1);
    }
    return "";
  }
  var DEFAULT_ANNOTATIONS = ["storageclass.kubernetes.io/is-default-class", "storageclass.beta.kubernetes.io/is-default-class"];
  function isDefault(storageClass) {
    const annotations = storageClass.metadata.annotations ?? {};
    return DEFAULT_ANNOTATIONS.some((key) => annotations[key] === "true");
  }
  function backingOf(parameters) {
    const p = parameters ?? {};
    return {
      clusterID: p["clusterID"] ?? "",
      pool: p["pool"] ?? "",
      dataPool: p["dataPool"] ?? "",
      fsName: p["fsName"] ?? "",
      nfsCluster: p["nfsCluster"] ?? "",
      server: p["server"] ?? "",
      objectStore: p["objectStoreName"] ?? "",
      objectStoreNamespace: p["objectStoreNamespace"] ?? "",
      endpoint: p["endpoint"] ?? "",
      encrypted: p["encrypted"] === "true",
      fsType: p["csi.storage.k8s.io/fstype"] ?? "",
      imageFeatures: p["imageFeatures"] ?? ""
    };
  }
  var NO_BACKENDS = { clusters: [], pools: [], filesystems: [], objectStores: [], nfses: [], claims: [] };
  function classViews(storageClasses, backends = NO_BACKENDS) {
    return storageClasses.map((storageClass) => classView(storageClass, backends)).filter((view) => view !== null).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  }
  function classView(storageClass, backends = NO_BACKENDS) {
    const provisioner = storageClass.provisioner ?? "";
    const kind = kindOf(provisioner);
    if (kind === null) return null;
    const backing = backingOf(storageClass.parameters);
    const name = storageClass.metadata.name;
    const namespace = backing.clusterID || driverNamespace(provisioner);
    const cluster = backends.clusters.find((c) => (c.metadata.namespace ?? "") === namespace) ?? null;
    const pool = backing.pool ? backends.pools.find((p) => poolName(p) === backing.pool) ?? null : null;
    const filesystem = backing.fsName ? backends.filesystems.find((f) => f.metadata.name === backing.fsName) ?? null : null;
    const objectStore = backing.objectStore ? backends.objectStores.find(
      (o) => o.metadata.name === backing.objectStore && (!backing.objectStoreNamespace || (o.metadata.namespace ?? "") === backing.objectStoreNamespace)
    ) ?? null : null;
    const nfs = backing.nfsCluster ? backends.nfses.find((n) => n.metadata.name === backing.nfsCluster) ?? null : null;
    const mine = backends.claims.filter((claim) => claim.spec?.storageClassName === name);
    const pending = mine.filter((claim) => (claim.status?.phase ?? "") === "Pending").length;
    const requested = mine.reduce((total, claim) => total + quantity(claim.status?.capacity?.["storage"] ?? claim.spec?.resources?.requests?.["storage"]), 0);
    const problem = problemOf(kind, backing, { cluster, pool, filesystem, objectStore, nfs }, backends);
    return {
      storageClass,
      name,
      kind,
      provisioner,
      driverNamespace: driverNamespace(provisioner),
      isDefault: isDefault(storageClass),
      reclaim: storageClass.reclaimPolicy ?? "Delete",
      binding: storageClass.volumeBindingMode ?? "Immediate",
      expansion: storageClass.allowVolumeExpansion === true,
      backing,
      cluster,
      pool,
      filesystem,
      objectStore,
      nfs,
      claims: mine.length,
      pending,
      requested,
      problem,
      tone: problem ? "warn" : pending > 0 ? "warn" : "ok"
    };
  }
  function poolName(pool) {
    return pool.spec?.name || pool.metadata.name;
  }
  function problemOf(kind, backing, found, backends) {
    const rookIsHere = backends.clusters.length > 0;
    if (!rookIsHere) return "";
    if (found.cluster === null) {
      return backing.clusterID ? `No CephCluster in namespace ${backing.clusterID}: this class provisions from a Ceph outside this cluster, or from one that has been removed.` : "";
    }
    if (found.cluster.spec?.external?.enable === true && kind !== "bucket") return "";
    if (kind === "block" && backing.pool && found.pool === null) {
      return `No CephBlockPool named ${backing.pool}. Volumes will stay Pending unless the pool was made outside Rook.`;
    }
    if (kind === "file" && backing.fsName && found.filesystem === null) {
      return `No CephFilesystem named ${backing.fsName}. Volumes will stay Pending unless the filesystem was made outside Rook.`;
    }
    if (kind === "bucket" && backing.objectStore && found.objectStore === null && !backing.endpoint) {
      return `No CephObjectStore named ${backing.objectStore}. Bucket claims will stay Pending unless the class names an endpoint instead.`;
    }
    if (kind === "nfs" && backing.nfsCluster && found.nfs === null) {
      return `No CephNFS named ${backing.nfsCluster}. Volumes will stay Pending.`;
    }
    return "";
  }
  function consumesCeph(storageClasses) {
    return storageClasses.some((storageClass) => kindOf(storageClass.provisioner ?? "") !== null);
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
      versions: Object.entries(map ?? {}).map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count || a.version.localeCompare(b.version))
    }));
  }
  function mixedVersions(view) {
    const all = /* @__PURE__ */ new Set();
    for (const daemon of view.daemonVersions) for (const v of daemon.versions) all.add(v.version);
    return all.size > 1;
  }

  // src/model/rook.ts
  var CLUSTERS = "crd:cephclusters.ceph.rook.io";
  var BLOCK_POOLS = "crd:cephblockpools.ceph.rook.io";
  var FILESYSTEMS = "crd:cephfilesystems.ceph.rook.io";
  var OBJECT_STORES = "crd:cephobjectstores.ceph.rook.io";
  var NFSES = "crd:cephnfses.ceph.rook.io";
  var PODS = "pods";
  var STORAGE_CLASSES = "storageclasses";
  var PVCS = "persistentvolumeclaims";
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
  function durability(pool) {
    const replicas = pool?.replicated?.size ?? 0;
    if (replicas > 0) return `${replicas} ${replicas === 1 ? "copy" : "copies"}`;
    const data = pool?.erasureCoded?.dataChunks ?? 0;
    const coding = pool?.erasureCoded?.codingChunks ?? 0;
    if (data > 0 || coding > 0) return `EC ${data}+${coding}`;
    return "";
  }
  function fragile(pool) {
    const replicas = pool?.replicated?.size ?? 0;
    if (replicas === 1) return true;
    const coding = pool?.erasureCoded?.codingChunks ?? 0;
    const data = pool?.erasureCoded?.dataChunks ?? 0;
    return data > 0 && coding === 0;
  }

  // src/model/attention.ts
  var SETTLED = /* @__PURE__ */ new Set(["Ready", "Connected", "Connecting", "Progressing", ""]);
  var HEALTHY = /* @__PURE__ */ new Set(["Ready", "Connected"]);
  function issues(sources) {
    const found = [
      ...clusterIssues(sources.clusters),
      ...daemonIssues(sources.daemons),
      ...poolIssues(sources.pools),
      ...filesystemIssues(sources.filesystems),
      ...objectStoreIssues(sources.objectStores),
      ...classIssues(sources.classes)
    ];
    return found.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  }
  function clusterIssues(clusters) {
    const found = [];
    for (const view of clusters) {
      const ref = { kind: CLUSTERS, namespace: view.namespace, name: view.name };
      for (const check of view.checks) {
        found.push({
          title: `${view.name}: ${check.id}`,
          detail: check.message || check.severity,
          tone: check.tone,
          rank: check.tone === "error" ? 0 : 2,
          ref
        });
      }
      if (view.cleanup) {
        found.push({
          title: `${view.name} is being destroyed`,
          detail: `spec.cleanupPolicy.confirmation is set to "${view.cleanup}". Rook will wipe the data on the hosts when the cluster is deleted.`,
          tone: "error",
          rank: 0,
          ref
        });
      }
      if (view.phase && !SETTLED.has(view.phase)) {
        found.push({
          title: `${view.name} is in phase ${view.phase}`,
          detail: view.message || "Rook could not finish reconciling the cluster.",
          tone: "error",
          rank: 1,
          ref
        });
      }
      if (view.capacity.known) {
        const tone = fullnessTone(view.capacity);
        if (tone === "error" || tone === "warn") {
          found.push({
            title: `${view.name} is ${percent(view.capacity.used, view.capacity.total).toFixed(0)}% full`,
            detail: `${size(view.capacity.used)} of ${size(view.capacity.total)} raw. Ceph stops accepting writes at its full ratio, which defaults to 95%.`,
            tone,
            rank: tone === "error" ? 1 : 3,
            ref
          });
        }
      }
      if (!view.health && !view.external) {
        found.push({
          title: `${view.name} has not reported its status`,
          detail: "Rook has not been able to read `ceph status` from the mons yet.",
          tone: "warn",
          rank: 3,
          ref
        });
      }
    }
    return found;
  }
  function daemonIssues(daemons) {
    return daemons.filter((daemon) => daemon.tone === "error" || daemon.tone === "warn").map((daemon) => ({
      title: `${daemon.name} is ${daemon.phase.toLowerCase() || "not running"}`,
      detail: daemon.problem || `The pod is ${daemon.phase || "in an unknown state"}.`,
      tone: daemon.tone,
      rank: daemon.type === "mon" || daemon.type === "osd" ? 1 : 2,
      ref: { kind: PODS, namespace: daemon.namespace, name: daemon.name }
    }));
  }
  function poolIssues(pools) {
    const found = [];
    for (const pool of pools) {
      const ref = { kind: BLOCK_POOLS, namespace: pool.metadata.namespace ?? "", name: pool.metadata.name };
      const phase = pool.status?.phase ?? "";
      if (phase && !HEALTHY.has(phase)) {
        found.push({ title: `Pool ${poolName(pool)} is in phase ${phase}`, detail: "Rook has not been able to make or update the pool.", tone: "error", rank: 1, ref });
      }
      if (fragile(pool.spec)) {
        found.push({
          title: `Pool ${poolName(pool)} has no redundancy`,
          detail: `${durability(pool.spec) || "Its layout"} means one failed OSD loses the data in this pool.`,
          tone: "warn",
          rank: 3,
          ref
        });
      }
      const mirror = pool.status?.mirroringStatus?.summary?.health ?? "";
      if (mirror && mirror !== "OK") {
        found.push({
          title: `Mirroring on ${poolName(pool)} is ${mirror}`,
          detail: pool.status?.mirroringStatus?.details || "The mirror daemon is not keeping up with the peer cluster.",
          tone: mirror === "ERROR" ? "error" : "warn",
          rank: 2,
          ref
        });
      }
    }
    return found;
  }
  function filesystemIssues(filesystems) {
    return filesystems.filter((fs) => (fs.status?.phase ?? "") !== "" && !HEALTHY.has(fs.status?.phase ?? "")).map((fs) => ({
      title: `Filesystem ${fs.metadata.name} is in phase ${fs.status?.phase}`,
      detail: "Rook has not been able to make or update the filesystem and its metadata servers.",
      tone: "error",
      rank: 1,
      ref: { kind: FILESYSTEMS, namespace: fs.metadata.namespace ?? "", name: fs.metadata.name }
    }));
  }
  function objectStoreIssues(stores) {
    return stores.filter((store) => (store.status?.phase ?? "") !== "" && !HEALTHY.has(store.status?.phase ?? "")).map((store) => ({
      title: `Object store ${store.metadata.name} is in phase ${store.status?.phase}`,
      detail: store.status?.message || "The RGW gateways are not serving.",
      tone: "error",
      rank: 1,
      ref: { kind: OBJECT_STORES, namespace: store.metadata.namespace ?? "", name: store.metadata.name }
    }));
  }
  function classIssues(classes) {
    const found = [];
    for (const view of classes) {
      const ref = { kind: STORAGE_CLASSES, name: view.name };
      if (view.problem) {
        found.push({ title: `Storage class ${view.name} points at nothing`, detail: view.problem, tone: "warn", rank: 2, ref });
      }
      if (view.pending > 0) {
        found.push({
          title: `${view.pending} claim${view.pending === 1 ? "" : "s"} on ${view.name} ${view.pending === 1 ? "is" : "are"} pending`,
          detail: "The CSI provisioner has not made the volumes yet. Open the claims to see what it says.",
          tone: "warn",
          rank: 3,
          ref
        });
      }
    }
    return found;
  }

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
    const problem = problemOf2(pod, phase, ready, statuses);
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
  function problemOf2(pod, phase, ready, statuses) {
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
  function svgEl(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    for (const child of children) node.append(child);
    return node;
  }
  function ring(title, slices, options = {}) {
    const total = slices.reduce((n, s) => n + s.count, 0);
    const R = 54;
    const C = 2 * Math.PI * R;
    const drawing = svgEl("svg", { viewBox: "0 0 140 140", class: "ring-svg", "aria-hidden": "true" });
    drawing.append(svgEl("circle", { cx: 70, cy: 70, r: R, class: "ring-track", fill: "none", "stroke-width": 16 }));
    let offset = 0;
    for (const slice of slices) {
      if (slice.count <= 0) continue;
      const fraction = total > 0 ? slice.count / total : 0;
      drawing.append(
        svgEl("circle", {
          cx: 70,
          cy: 70,
          r: R,
          fill: "none",
          "stroke-width": 16,
          "stroke-linecap": "butt",
          class: `ring-arc arc-${slice.tone || "none"}`,
          "stroke-dasharray": `${(fraction * C).toFixed(2)} ${C.toFixed(2)}`,
          "stroke-dashoffset": `${(-offset * C).toFixed(2)}`,
          transform: "rotate(-90 70 70)"
        })
      );
      offset += fraction;
    }
    const legend = el("ul", { class: "legend" });
    for (const slice of slices) {
      const row = el(
        "li",
        { class: slice.count === 0 ? "legend-row zero" : "legend-row" },
        el("span", { class: `dot dot-${slice.tone || "none"}` }),
        el("span", { class: "legend-label" }, slice.label),
        el("span", { class: "legend-count" }, String(slice.count))
      );
      if (options.onPick && slice.count > 0) clickable(row, () => options.onPick?.(slice.label));
      legend.append(row);
    }
    return el(
      "section",
      { class: "ring-card" },
      el("h2", {}, title),
      el(
        "div",
        { class: "ring-body" },
        el(
          "div",
          { class: "ring-holder" },
          drawing,
          el("div", { class: "ring-centre" }, el("span", { class: "ring-total" }, String(total)), el("span", { class: "ring-unit" }, options.unit ?? ""))
        ),
        legend
      )
    );
  }
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
  function stat(label, value, note = "", tone = "") {
    return el(
      "div",
      { class: "stat" },
      el("div", { class: `stat-value tone-${tone || "none"}` }, value),
      el("div", { class: "stat-label" }, label),
      note ? el("div", { class: "stat-note" }, note) : null
    );
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

  // src/pages/overview.ts
  var REFRESH = 1e4;
  start("page", async (ctx) => {
    replace(byId("head"), heading("Rook Ceph", `Ceph storage in ${ctx.contextName}.`));
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const [clusters, pods, storageClasses, claims, pools, filesystems, objectStores, nfses] = await Promise.all([
          maybeList({ kind: CLUSTERS }),
          maybeList({ kind: PODS }),
          maybeList({ kind: STORAGE_CLASSES }),
          maybeList({ kind: PVCS }),
          maybeList({ kind: BLOCK_POOLS }),
          maybeList({ kind: FILESYSTEMS }),
          maybeList({ kind: OBJECT_STORES }),
          maybeList({ kind: NFSES })
        ]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        const views = clusters.map(clusterView);
        const classes = classViews(storageClasses, { clusters, pools, filesystems, objectStores, nfses, claims });
        if (views.length === 0) {
          draw(body, failure, clientOnly(ctx, classes, storageClasses));
          return;
        }
        draw(body, failure, ...full(views, pods, classes, pools, filesystems, objectStores));
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function draw(host, failure, ...children) {
    replace(host, failure, ...children.filter((child) => child !== null));
  }
  function full(views, pods, classes, pools, filesystems, objectStores) {
    const daemons = views.flatMap((view) => groups(ofCluster(pods, view.namespace)).flatMap((group) => group.daemons));
    const problems = issues({ clusters: views, daemons, pools, filesystems, objectStores, classes });
    const osds = daemons.filter((daemon) => daemon.type === "osd");
    const mons = daemons.filter((daemon) => daemon.type === "mon");
    const capacity = views.reduce((total, view) => total + (view.capacity.known ? view.capacity.total : 0), 0);
    const used = views.reduce((total, view) => total + (view.capacity.known ? view.capacity.used : 0), 0);
    return [
      el(
        "div",
        { class: "stats" },
        stat("Ceph clusters", String(views.length), views.some((v) => v.external) ? `${views.filter((v) => v.external).length} external` : "all in this cluster"),
        stat(
          "Raw capacity used",
          capacity > 0 ? size(used) : "—",
          capacity > 0 ? `${percent(used, capacity).toFixed(0)}% of ${size(capacity)}` : "Ceph has not reported it",
          capacity > 0 && percent(used, capacity) >= 85 ? "warn" : ""
        ),
        stat("OSDs", String(osds.length), osds.length ? `${osds.filter((o) => o.tone === "ok").length} running` : "none in this cluster", osds.some((o) => o.tone === "error") ? "error" : ""),
        stat("Monitors", String(mons.length), mons.length ? `${mons.filter((m) => m.tone === "ok").length} running` : "none in this cluster", mons.some((m) => m.tone === "error") ? "error" : ""),
        stat("Storage classes", String(classes.length), `${classes.reduce((n, c) => n + c.claims, 0)} claims`)
      ),
      ...views.map(healthBanner),
      daemonBlock(daemons),
      classBlock(classes),
      attentionBlock(problems),
      versionNote(views)
    ];
  }
  function healthBanner(view) {
    const banner = el("div", { class: "health" });
    banner.style.borderLeftColor = `var(--${toneVar(view.tone)})`;
    const name = el(
      "div",
      { class: "health-name" },
      el("span", { class: `health-word tone-${view.tone || "none"}` }, view.health || "not reported"),
      pill(view.external ? "external Ceph" : "in this cluster", view.external ? "info" : "", view.external ? "Ceph runs outside this Kubernetes cluster; Rook only talks to it" : "Rook runs the Ceph daemons here"),
      view.phase ? pill(view.phase, view.phase === "Ready" || view.phase === "Connected" ? "ok" : "warn") : null,
      view.version ? pill(`Ceph ${view.version}`, "") : null
    );
    const open = () => void k8sdockside.open({ kind: CLUSTERS, namespace: view.namespace, name: view.name });
    const title = el("div", {}, el("strong", {}, view.name), el("span", { class: "faint" }, view.namespace ? ` in ${view.namespace}` : ""));
    clickable(title, open);
    banner.append(
      el("div", { style: "flex:1 1 220px;min-width:0" }, title, name),
      el("p", { class: "health-sentence" }, healthSentence(view) + (view.message ? ` ${view.message}` : "")),
      capacityPiece(view)
    );
    const checks2 = view.checks.length > 0 ? checkList(view) : null;
    return el("div", {}, banner, checks2);
  }
  function capacityPiece(view) {
    if (!view.capacity.known) {
      return el("div", { class: "health-capacity" }, el("p", { class: "faint", style: "margin:0" }, "Ceph has not reported any capacity yet."));
    }
    const tone = fullnessTone(view.capacity);
    const segments = [
      { label: "Used", bytes: view.capacity.used, tone },
      { label: "Free", bytes: Math.max(0, view.capacity.total - view.capacity.used), tone: "" }
    ];
    return el(
      "div",
      { class: "health-capacity" },
      stack(segments, view.capacity.total),
      el(
        "p",
        { class: "numbers", style: "margin:0" },
        el("span", {}, el("strong", {}, size(view.capacity.used)), " used"),
        el("span", {}, el("strong", {}, size(view.capacity.total)), " raw"),
        el("span", {}, el("strong", {}, `${percent(view.capacity.used, view.capacity.total).toFixed(0)}%`), " full")
      )
    );
  }
  function checkList(view) {
    const list = el("ul", { class: "checks" });
    for (const check of view.checks) {
      const row = el(
        "li",
        { class: "check" },
        el("span", { class: `dot dot-${check.tone || "none"}` }),
        el("span", { class: "check-id" }, check.id),
        el("span", { class: "check-message" }, check.message)
      );
      row.title = "Open the Ceph health checks documentation";
      clickable(row, () => void k8sdockside.openUrl(`https://docs.ceph.com/en/latest/rados/operations/health-checks/#${check.id.toLowerCase()}`));
      list.append(row);
    }
    return block(`What Ceph is complaining about in ${view.name}`, "Straight out of `ceph status`. Each row opens what the check means.", list);
  }
  function daemonBlock(daemons) {
    if (daemons.length === 0) {
      return block(
        "Daemons",
        "",
        nothing("No Ceph daemon pods run in this cluster. For an external Ceph that is exactly right — the mons and OSDs are on somebody else‘s machines.")
      );
    }
    const tally = (tone) => daemons.filter((daemon) => daemon.tone === tone).length;
    const slices = [
      { label: "not running", count: tally("error"), tone: "error" },
      { label: "starting or unready", count: tally("warn"), tone: "warn" },
      { label: "unknown", count: tally(""), tone: "" },
      { label: "running", count: tally("ok"), tone: "ok" }
    ];
    return el(
      "div",
      { class: "rings" },
      ring("Ceph daemons", slices, { onPick: () => void k8sdockside.openView("daemons"), unit: "pods" }),
      ring("OSDs", osdSlices(daemons), { onPick: () => void k8sdockside.openView("daemons"), unit: "OSDs" })
    );
  }
  function osdSlices(daemons) {
    const osds = daemons.filter((daemon) => daemon.type === "osd");
    const classes = /* @__PURE__ */ new Map();
    for (const osd of osds) classes.set(osd.deviceClass || "unknown class", (classes.get(osd.deviceClass || "unknown class") ?? 0) + 1);
    const tones = ["info", "ok", "warn", ""];
    return [...classes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count], index) => ({ label, count, tone: tones[index % tones.length] ?? "" }));
  }
  function classBlock(classes) {
    if (classes.length === 0) {
      return block("Storage classes", "", nothing("No storage class in this cluster provisions from Ceph. Nothing here can ask Ceph for a volume yet."));
    }
    const list = el("ul", { class: "checks" });
    for (const kind of KIND_ORDER) {
      const mine = classes.filter((view) => view.kind === kind);
      if (mine.length === 0) continue;
      const claims = mine.reduce((n, view) => n + view.claims, 0);
      const row = el(
        "li",
        { class: "check" },
        el("span", { class: `dot dot-${mine.some((v) => v.problem) ? "warn" : "ok"}` }),
        el("span", { class: "check-id" }, KIND_WORDS[kind].label),
        el("span", { class: "check-message" }, `${mine.map((v) => v.name).join(", ")} — ${claims} claim${claims === 1 ? "" : "s"}, ${KIND_WORDS[kind].gives}`)
      );
      clickable(row, () => void k8sdockside.openView("classes"));
      list.append(row);
    }
    return block("What this cluster can ask Ceph for", "Every Ceph storage class, by what it hands a workload. Each row opens the full map.", list);
  }
  function attentionBlock(problems) {
    if (problems.length === 0) {
      return block("Needs attention", "", nothing("Ceph is healthy, every daemon is running, and no pool is without redundancy."));
    }
    const list = el("ul", { class: "issues" });
    for (const issue of problems.slice(0, 20)) {
      const row = el(
        "li",
        { class: "issue" },
        el("span", { class: `dot dot-${issue.tone || "none"}` }),
        el("span", { class: "issue-title" }, issue.title),
        el("span", { class: "issue-detail" }, issue.detail)
      );
      clickable(row, () => void k8sdockside.open(issue.ref));
      list.append(row);
    }
    return block("Needs attention", problems.length > 20 ? `The worst 20 of ${problems.length}. Each row opens the object.` : "Each row opens the object.", list);
  }
  function versionNote(views) {
    const mixed = views.filter(mixedVersions);
    if (mixed.length === 0) return null;
    return block(
      "More than one Ceph version is running",
      `${mixed.map((v) => v.name).join(", ")} has daemons on different Ceph versions. During an upgrade that is expected; left this way it is the thing that bites.`,
      el("div", { class: "links" }, button("What an upgrade looks like", () => void k8sdockside.openUrl("https://rook.io/docs/rook/latest/Upgrade/ceph-upgrade/")))
    );
  }
  function clientOnly(ctx, classes, storageClasses) {
    if (!consumesCeph(storageClasses)) {
      return block(
        "No Ceph in this cluster",
        `${ctx.contextName} has no CephCluster and no storage class that provisions from Ceph. The plugin stays out of the way until it has one.`,
        el("p", { class: "links" }, button("How to install Rook Ceph", () => void k8sdockside.openUrl("https://rook.io/docs/rook/latest/Getting-Started/quickstart/")))
      );
    }
    const drivers = [...new Set(classes.map((view) => view.provisioner))].sort();
    const namespaces = [...new Set(classes.map((view) => view.backing.clusterID || view.driverNamespace).filter((n) => n !== ""))].sort();
    const claims = classes.reduce((n, view) => n + view.claims, 0);
    return el(
      "div",
      {},
      el(
        "div",
        { class: "banner" },
        el("h2", {}, "This cluster is a Ceph client"),
        el(
          "p",
          { class: "note", style: "margin-bottom:0" },
          `${ctx.contextName} has no CephCluster, so Ceph itself is not managed from here. What it does have is ${drivers.length === 1 ? "a CSI driver" : `${drivers.length} CSI drivers`} and ${classes.length} storage class${classes.length === 1 ? "" : "es"} pointing at a Ceph elsewhere` + (namespaces.length ? `, under cluster id ${namespaces.join(", ")}.` : ".") + " Everything about the volumes is here; nothing about the OSDs is."
        )
      ),
      el(
        "div",
        { class: "stats" },
        stat("Storage classes", String(classes.length), "provisioning from Ceph"),
        stat("Claims", String(claims), `${classes.reduce((n, view) => n + view.pending, 0)} pending`, classes.some((view) => view.pending > 0) ? "warn" : ""),
        stat("CSI drivers", String(drivers.length), drivers.join(", "))
      ),
      classBlock(classes),
      block(
        "What is missing, and why",
        "Health, capacity, pools and OSDs all come from a CephCluster resource. Without one, Rook is not running here and there is nothing in this cluster to read them from — they live wherever Ceph itself does.",
        el(
          "div",
          { class: "links" },
          button("Open the storage class map", () => void k8sdockside.openView("classes")),
          button("Connecting Rook to an external Ceph", () => void k8sdockside.openUrl("https://rook.io/docs/rook/latest/CRDs/Cluster/external-cluster/external-cluster/"))
        )
      )
    );
  }
  function toneVar(tone) {
    return tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "error" ? "error" : tone === "info" ? "accent" : "border";
  }
})();
