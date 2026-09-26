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
  function openName(label, ref, className = "card-name") {
    const node = el("button", { type: "button", class: className, title: `Open ${label}` }, label);
    node.addEventListener("click", () => void k8sdockside.open(ref));
    return node;
  }
  function param(name, value) {
    return el("li", { class: "param" }, el("span", { class: "param-name mono" }, name), el("span", { class: "param-value mono" }, value));
  }

  // src/pages/sc.ts
  start("panel", async () => {
    const host = byId("panel");
    const storageClass = await k8sdockside.object();
    const [clusters, pools, filesystems, objectStores, nfses, claims] = await Promise.all([
      maybeList({ kind: CLUSTERS }),
      maybeList({ kind: BLOCK_POOLS }),
      maybeList({ kind: FILESYSTEMS }),
      maybeList({ kind: OBJECT_STORES }),
      maybeList({ kind: NFSES }),
      maybeList({ kind: PVCS })
    ]);
    const view = classView(storageClass, { clusters, pools, filesystems, objectStores, nfses, claims });
    if (!view) {
      replace(host, nothing(`This is not a Ceph storage class: its provisioner is ${storageClass.provisioner ?? "not set"}.`));
      return;
    }
    const pairs = [
      ["A pod gets", KIND_WORDS[view.kind].gives],
      ["From", view.cluster ? openName(view.cluster.metadata.name, { kind: CLUSTERS, namespace: view.cluster.metadata.namespace ?? "", name: view.cluster.metadata.name }, "card-name") : el("span", { class: "faint" }, view.backing.clusterID ? `cluster id ${view.backing.clusterID}, outside this Kubernetes cluster` : "a Ceph this plugin cannot see")]
    ];
    if (view.pool) {
      pairs.push(["Pool", openName(poolName(view.pool), { kind: BLOCK_POOLS, namespace: view.pool.metadata.namespace ?? "", name: view.pool.metadata.name }, "card-name")]);
      pairs.push([
        "Redundancy",
        el("span", {}, durability(view.pool.spec) || "—", fragile(view.pool.spec) ? el("span", { class: "tone-warn" }, " — one failed OSD loses it") : null)
      ]);
    }
    if (view.filesystem) {
      pairs.push(["Filesystem", openName(view.filesystem.metadata.name, { kind: FILESYSTEMS, namespace: view.filesystem.metadata.namespace ?? "", name: view.filesystem.metadata.name }, "card-name")]);
    }
    if (view.objectStore) {
      pairs.push(["Object store", openName(view.objectStore.metadata.name, { kind: OBJECT_STORES, namespace: view.objectStore.metadata.namespace ?? "", name: view.objectStore.metadata.name }, "card-name")]);
    }
    if (view.nfs) {
      pairs.push(["NFS server", openName(view.nfs.metadata.name, { kind: NFSES, namespace: view.nfs.metadata.namespace ?? "", name: view.nfs.metadata.name }, "card-name")]);
    }
    pairs.push([
      "When the claim goes",
      view.reclaim === "Retain" ? "the Ceph image or subvolume is kept — you delete it yourself" : view.reclaim === "Delete" ? "the Ceph image or subvolume is deleted with it" : view.reclaim
    ]);
    pairs.push(["Bound", view.binding === "WaitForFirstConsumer" ? "when the first pod that uses it is scheduled" : "as soon as the claim is made"]);
    pairs.push(["In use", `${view.claims} claim${view.claims === 1 ? "" : "s"}, ${size(view.requested)}${view.pending ? `, ${view.pending} pending` : ""}`]);
    const parameters = Object.entries(storageClass.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b));
    replace(
      host,
      el(
        "div",
        { class: "panel-head" },
        pill(KIND_WORDS[view.kind].label, "info"),
        view.isDefault ? pill("default class", "ok") : null,
        view.expansion ? pill("expandable", "ok") : pill("fixed size", ""),
        view.backing.encrypted ? pill("encrypted", "ok") : null,
        el("span", { class: "spacer" }),
        el("span", { class: "faint mono" }, view.provisioner)
      ),
      facts(pairs),
      view.problem ? el("p", { class: "card-problem" }, view.problem) : null,
      parameters.length > 0 ? el("div", {}, el("p", { class: "card-label", style: "margin:10px 0 0" }, "Parameters"), el("ul", { class: "params" }, ...parameters.map(([name, value]) => param(name, value)))) : null
    );
  });
})();
