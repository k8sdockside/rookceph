// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
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
  function quantity(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const match = /^\s*([0-9.]+)\s*([EPTGMk]i?|m)?\s*$/.exec(value);
    if (!match) {
      const plain2 = Number(value);
      return Number.isFinite(plain2) ? plain2 : 0;
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
  function backingOf(parameters2) {
    const p = parameters2 ?? {};
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

  // src/model/rook.ts
  var CLUSTERS = "crd:cephclusters.ceph.rook.io";
  var BLOCK_POOLS = "crd:cephblockpools.ceph.rook.io";
  var FILESYSTEMS = "crd:cephfilesystems.ceph.rook.io";
  var OBJECT_STORES = "crd:cephobjectstores.ceph.rook.io";
  var NFSES = "crd:cephnfses.ceph.rook.io";
  var BUCKET_CLAIMS = "crd:objectbucketclaims.objectbucket.io";
  var STORAGE_CLASSES = "storageclasses";
  var PVCS = "persistentvolumeclaims";
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
  async function maybeList(query2) {
    try {
      return await k8sdockside.list(query2);
    } catch {
      return [];
    }
  }

  // src/ui/parts.ts
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
  function heading(title, note) {
    return el(
      "header",
      { class: "page-head" },
      el("img", { class: "mark", src: "logo.svg", alt: "", width: 26, height: 26 }),
      el("div", {}, el("h1", {}, title), note ? el("p", { class: "note" }, note) : null)
    );
  }
  function openName(label, ref, className = "card-name") {
    const node = el("button", { type: "button", class: className, title: `Open ${label}` }, label);
    node.addEventListener("click", () => void k8sdockside.open(ref));
    return node;
  }
  function param(name, value) {
    return el("li", { class: "param" }, el("span", { class: "param-name mono" }, name), el("span", { class: "param-value mono" }, value));
  }

  // src/pages/storage.ts
  var REFRESH = 15e3;
  var query = "";
  start("page", async (ctx) => {
    replace(byId("head"), heading("Storage classes", `Every way ${ctx.contextName} can ask Ceph for storage, by what it hands a workload.`));
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const count = el("span", { class: "count" });
    const search = el("input", { type: "search", placeholder: "Search class, pool, filesystem or driver…", "aria-label": "Search storage classes" });
    let latest = [];
    let claims = [];
    search.addEventListener("input", () => {
      query = search.value.trim().toLowerCase();
      render(body, latest, claims, count);
    });
    replace(byId("bar"), search, count);
    const stop = every(
      REFRESH,
      async () => {
        const [storageClasses, clusters, pools, filesystems, objectStores, nfses, pvcs, obcs] = await Promise.all([
          maybeList({ kind: STORAGE_CLASSES }),
          maybeList({ kind: CLUSTERS }),
          maybeList({ kind: BLOCK_POOLS }),
          maybeList({ kind: FILESYSTEMS }),
          maybeList({ kind: OBJECT_STORES }),
          maybeList({ kind: NFSES }),
          maybeList({ kind: PVCS }),
          maybeList({ kind: BUCKET_CLAIMS })
        ]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        latest = classViews(storageClasses, { clusters, pools, filesystems, objectStores, nfses, claims: pvcs });
        claims = obcs;
        render(body, latest, claims, count);
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
    byId("page").insertBefore(failure, body);
  });
  function matches(view) {
    if (!query) return true;
    const haystack = [
      view.name,
      view.provisioner,
      view.kind,
      KIND_WORDS[view.kind].label,
      view.backing.pool,
      view.backing.dataPool,
      view.backing.fsName,
      view.backing.objectStore,
      view.backing.nfsCluster,
      view.backing.clusterID,
      view.backing.fsType
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  }
  function render(host, views, buckets, count) {
    const shown = views.filter(matches);
    count.textContent = views.length === shown.length ? `${views.length} class${views.length === 1 ? "" : "es"}` : `${shown.length} of ${views.length}`;
    if (views.length === 0) {
      replace(
        host,
        nothing(
          "No storage class in this cluster provisions from Ceph. A Ceph class is one whose provisioner ends in rbd.csi.ceph.com, cephfs.csi.ceph.com, nfs.csi.ceph.com or ceph.rook.io/bucket."
        )
      );
      return;
    }
    if (shown.length === 0) {
      replace(host, nothing(`Nothing matches “${query}”.`));
      return;
    }
    const sections = [];
    for (const kind of KIND_ORDER) {
      const mine = shown.filter((view) => view.kind === kind);
      if (mine.length === 0) continue;
      sections.push(
        el(
          "div",
          { class: "kind-head" },
          el("h2", {}, KIND_WORDS[kind].label),
          el("span", { class: "kind-gives" }, `${mine.length} class${mine.length === 1 ? "" : "es"} — ${KIND_WORDS[kind].gives}`)
        ),
        el("div", { class: "wide" }, ...mine.map((view) => card(view, buckets)))
      );
    }
    replace(host, ...sections);
  }
  function card(view, buckets) {
    return el(
      "article",
      { class: `card tone-edge-${view.tone || "none"}` },
      el(
        "div",
        { class: "card-head" },
        openName(view.name, { kind: STORAGE_CLASSES, name: view.name }),
        view.isDefault ? pill("default", "info", "New claims that name no class get this one") : null,
        el("span", { class: "spacer" }),
        view.backing.encrypted ? pill("encrypted", "ok", "The CSI driver encrypts each volume") : null
      ),
      el("p", { class: "card-for" }, el("span", { class: "mono" }, view.provisioner)),
      backingRow(view),
      numbers(view, buckets),
      parameters(view),
      view.problem ? el("p", { class: "card-problem" }, view.problem) : null,
      el(
        "p",
        { class: "card-foot" },
        pill(view.reclaim === "Retain" ? "retain" : view.reclaim.toLowerCase(), view.reclaim === "Retain" ? "info" : "", `Reclaim policy: what happens to the Ceph image or subvolume when the claim is deleted`),
        pill(view.binding === "WaitForFirstConsumer" ? "binds on first pod" : "binds at once", "", `volumeBindingMode: ${view.binding}`),
        pill(view.expansion ? "expandable" : "fixed size", view.expansion ? "ok" : "", view.expansion ? "A claim on this class can be grown" : "allowVolumeExpansion is not set: claims cannot be grown"),
        view.backing.fsType ? pill(view.backing.fsType, "", "The filesystem the driver formats the volume with") : null
      )
    );
  }
  function backingRow(view) {
    const pairs = [];
    if (view.cluster) {
      pairs.push([
        "Ceph cluster",
        openName(view.cluster.metadata.name, { kind: CLUSTERS, namespace: view.cluster.metadata.namespace ?? "", name: view.cluster.metadata.name }, "card-name")
      ]);
    } else if (view.backing.clusterID) {
      pairs.push(["Ceph cluster", el("span", { class: "faint" }, `cluster id ${view.backing.clusterID} — not in this Kubernetes cluster`)]);
    }
    if (view.kind === "block") {
      pairs.push(["Pool", view.pool ? poolLink(view.pool) : plain(view.backing.pool)]);
      if (view.backing.dataPool) pairs.push(["Erasure-coded data pool", plain(view.backing.dataPool)]);
      if (view.backing.imageFeatures) pairs.push(["RBD image features", plain(view.backing.imageFeatures)]);
    }
    if (view.kind === "file") {
      pairs.push(["Filesystem", view.filesystem ? fsLink(view.filesystem) : plain(view.backing.fsName)]);
      pairs.push(["Data pool", plain(view.backing.pool)]);
      if (view.filesystem) {
        const active = view.filesystem.spec?.metadataServer?.activeCount ?? 0;
        pairs.push(["Metadata servers", `${active} active${view.filesystem.spec?.metadataServer?.activeStandby ? ", each with a standby" : ""}`]);
      }
    }
    if (view.kind === "nfs") {
      pairs.push(["NFS server", view.nfs ? nfsLink(view.nfs) : plain(view.backing.nfsCluster)]);
      pairs.push(["Address", plain(view.backing.server)]);
      pairs.push(["Filesystem", view.filesystem ? fsLink(view.filesystem) : plain(view.backing.fsName)]);
    }
    if (view.kind === "bucket") {
      pairs.push(["Object store", view.objectStore ? storeLink(view.objectStore) : plain(view.backing.objectStore)]);
      const endpoints = [...view.objectStore?.status?.endpoints?.secure ?? [], ...view.objectStore?.status?.endpoints?.insecure ?? []];
      if (endpoints.length) pairs.push(["S3 endpoint", el("span", { class: "mono" }, endpoints[0] ?? "")]);
    }
    const pool = view.kind === "file" ? null : view.pool;
    if (pool) {
      const words = durability(pool.spec);
      pairs.push([
        "Redundancy",
        el(
          "span",
          {},
          words || "—",
          pool.spec?.failureDomain ? el("span", { class: "faint" }, ` across ${pool.spec.failureDomain}s`) : null,
          fragile(pool.spec) ? el("span", { class: "tone-warn" }, " — one failure loses it") : null
        )
      ]);
    }
    return pairs.length > 0 ? facts(pairs) : el("p", { class: "faint" }, "This class names nothing this plugin recognises.");
  }
  function plain(value) {
    return value ? el("span", { class: "mono" }, value) : el("span", { class: "faint" }, "not set");
  }
  function poolLink(pool) {
    return openName(poolName(pool), { kind: BLOCK_POOLS, namespace: pool.metadata.namespace ?? "", name: pool.metadata.name }, "card-name");
  }
  function fsLink(fs) {
    return openName(fs.metadata.name, { kind: FILESYSTEMS, namespace: fs.metadata.namespace ?? "", name: fs.metadata.name }, "card-name");
  }
  function storeLink(store) {
    return openName(store.metadata.name, { kind: OBJECT_STORES, namespace: store.metadata.namespace ?? "", name: store.metadata.name }, "card-name");
  }
  function nfsLink(nfs) {
    return openName(nfs.metadata.name, { kind: NFSES, namespace: nfs.metadata.namespace ?? "", name: nfs.metadata.name }, "card-name");
  }
  function numbers(view, buckets) {
    if (view.kind === "bucket") {
      const mine = buckets.filter((claim) => claim.spec?.storageClassName === view.name);
      const bound = mine.filter((claim) => (claim.status?.phase ?? "") === "Bound").length;
      const row = el(
        "p",
        { class: "numbers" },
        el("span", {}, el("strong", {}, String(mine.length)), ` bucket claim${mine.length === 1 ? "" : "s"}`),
        el("span", {}, el("strong", {}, String(bound)), " bound")
      );
      return row;
    }
    return el(
      "p",
      { class: "numbers" },
      el("span", {}, el("strong", {}, String(view.claims)), ` claim${view.claims === 1 ? "" : "s"}`),
      view.pending > 0 ? el("span", { class: "tone-warn" }, el("strong", {}, String(view.pending)), " pending") : null,
      el("span", {}, el("strong", {}, size(view.requested)), " bound")
    );
  }
  function parameters(view) {
    const entries = Object.entries(view.storageClass.parameters ?? {}).filter(([name]) => !name.startsWith("csi.storage.k8s.io/")).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return null;
    const details = el("details", { class: "params-details" });
    details.append(
      el("summary", { class: "card-label" }, `${entries.length} parameter${entries.length === 1 ? "" : "s"}`),
      el("ul", { class: "params" }, ...entries.map(([name, value]) => param(name, value)))
    );
    return details;
  }
})();
