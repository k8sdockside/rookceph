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
  var STORAGE_CLASSES = "storageclasses";
  var PVS = "persistentvolumes";
  function durability(pool) {
    const replicas = pool?.replicated?.size ?? 0;
    if (replicas > 0) return `${replicas} ${replicas === 1 ? "copy" : "copies"}`;
    const data = pool?.erasureCoded?.dataChunks ?? 0;
    const coding = pool?.erasureCoded?.codingChunks ?? 0;
    if (data > 0 || coding > 0) return `EC ${data}+${coding}`;
    return "";
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

  // src/pages/pvc.ts
  start("panel", async () => {
    const host = byId("panel");
    const claim = await k8sdockside.object();
    const className = claim.spec?.storageClassName ?? "";
    if (!className) {
      replace(host, nothing("This claim names no storage class, so nothing here can say whether Ceph is behind it."));
      return;
    }
    const [storageClasses, volumes, clusters, pools, filesystems, objectStores, nfses] = await Promise.all([
      maybeList({ kind: STORAGE_CLASSES }),
      maybeList({ kind: PVS }),
      maybeList({ kind: CLUSTERS }),
      maybeList({ kind: BLOCK_POOLS }),
      maybeList({ kind: FILESYSTEMS }),
      maybeList({ kind: OBJECT_STORES }),
      maybeList({ kind: NFSES })
    ]);
    const storageClass = storageClasses.find((candidate) => candidate.metadata.name === className);
    const view = storageClass ? classView(storageClass, { clusters, pools, filesystems, objectStores, nfses, claims: [claim] }) : null;
    if (!view) {
      replace(
        host,
        nothing(
          storageClass ? `${className} is not a Ceph storage class — its provisioner is ${storageClass.provisioner ?? "not set"}.` : `No storage class named ${className} is in this cluster any more.`
        )
      );
      return;
    }
    const volume = volumes.find((candidate) => candidate.metadata.name === (claim.spec?.volumeName ?? ""));
    const csi = volume?.spec?.csi;
    const attributes = csi?.volumeAttributes ?? {};
    const pairs = [
      ["What it is", `${KIND_WORDS[view.kind].label} — ${KIND_WORDS[view.kind].gives}`],
      ["Storage class", openName(view.name, { kind: STORAGE_CLASSES, name: view.name }, "card-name")]
    ];
    if (view.cluster) {
      pairs.push(["Ceph cluster", openName(view.cluster.metadata.name, { kind: CLUSTERS, namespace: view.cluster.metadata.namespace ?? "", name: view.cluster.metadata.name }, "card-name")]);
    } else if (view.backing.clusterID) {
      pairs.push(["Ceph cluster", el("span", { class: "faint" }, `cluster id ${view.backing.clusterID}, outside this Kubernetes cluster`)]);
    }
    if (view.kind === "block") {
      pairs.push(["Pool", view.pool ? openName(poolName(view.pool), { kind: BLOCK_POOLS, namespace: view.pool.metadata.namespace ?? "", name: view.pool.metadata.name }, "card-name") : mono(view.backing.pool)]);
      if (attributes["imageName"]) pairs.push(["RBD image", mono(attributes["imageName"])]);
      if (view.pool) pairs.push(["Redundancy", durability(view.pool.spec) || "—"]);
    }
    if (view.kind === "file" || view.kind === "nfs") {
      pairs.push(["Filesystem", view.filesystem ? openName(view.filesystem.metadata.name, { kind: FILESYSTEMS, namespace: view.filesystem.metadata.namespace ?? "", name: view.filesystem.metadata.name }, "card-name") : mono(view.backing.fsName)]);
      if (attributes["subvolumeName"]) pairs.push(["Subvolume", mono(attributes["subvolumeName"])]);
      if (attributes["subvolumePath"]) pairs.push(["Path", mono(attributes["subvolumePath"])]);
      pairs.push(["Data pool", mono(view.backing.pool)]);
    }
    if (view.kind === "nfs") {
      pairs.push(["NFS server", view.nfs ? openName(view.nfs.metadata.name, { kind: NFSES, namespace: view.nfs.metadata.namespace ?? "", name: view.nfs.metadata.name }, "card-name") : mono(view.backing.nfsCluster)]);
    }
    if (view.kind === "bucket") {
      pairs.push(["Object store", view.objectStore ? openName(view.objectStore.metadata.name, { kind: OBJECT_STORES, namespace: view.objectStore.metadata.namespace ?? "", name: view.objectStore.metadata.name }, "card-name") : mono(view.backing.objectStore)]);
    }
    if (csi?.volumeHandle) pairs.push(["CSI volume handle", mono(csi.volumeHandle)]);
    pairs.push([
      "Size",
      el(
        "span",
        {},
        size(quantity(claim.status?.capacity?.["storage"] ?? claim.spec?.resources?.requests?.["storage"])),
        view.expansion ? el("span", { class: "faint" }, " — this class allows growing it") : el("span", { class: "faint" }, " — this class does not allow growing it")
      )
    ]);
    const phase = claim.status?.phase ?? "";
    replace(
      host,
      el(
        "div",
        { class: "panel-head" },
        pill(phase || "no phase", phase === "Bound" ? "ok" : phase === "Pending" ? "warn" : ""),
        view.backing.encrypted ? pill("encrypted", "ok", "The CSI driver encrypts this volume") : null,
        (claim.spec?.accessModes ?? []).map((mode) => pill(mode, "")).length > 0 ? el("span", {}, ...(claim.spec?.accessModes ?? []).map((mode) => pill(mode, ""))) : null,
        el("span", { class: "spacer" }),
        el("span", { class: "faint mono" }, view.provisioner)
      ),
      facts(pairs),
      phase === "Pending" ? el("p", { class: "card-problem" }, "The CSI provisioner has not made this volume yet. Its events say why — and if the pool or filesystem the class names is missing, that is usually it.") : null,
      view.problem ? el("p", { class: "card-problem" }, view.problem) : null
    );
  });
  function mono(value) {
    return value ? el("span", { class: "mono" }, value) : el("span", { class: "faint" }, "not set");
  }
})();
