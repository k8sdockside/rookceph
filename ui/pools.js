// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/rook.ts
  var BLOCK_POOLS = "crd:cephblockpools.ceph.rook.io";
  var FILESYSTEMS = "crd:cephfilesystems.ceph.rook.io";
  var OBJECT_STORES = "crd:cephobjectstores.ceph.rook.io";
  var NFSES = "crd:cephnfses.ceph.rook.io";
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

  // src/model/units.ts
  function count(n, noun, plural = `${noun}s`) {
    return `${n} ${n === 1 ? noun : plural}`;
  }

  // src/model/classes.ts
  function poolName(pool) {
    return pool.spec?.name || pool.metadata.name;
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

  // src/pages/pools.ts
  var REFRESH = 15e3;
  start("page", async (ctx) => {
    replace(byId("head"), heading("Pools & filesystems", `What Ceph serves in ${ctx.contextName}, and how many copies of it there are.`));
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const stop = every(
      REFRESH,
      async () => {
        const [pools, filesystems, stores, nfses] = await Promise.all([
          maybeList({ kind: BLOCK_POOLS }),
          maybeList({ kind: FILESYSTEMS }),
          maybeList({ kind: OBJECT_STORES }),
          maybeList({ kind: NFSES })
        ]);
        failure.textContent = "";
        document.getElementById("first")?.remove();
        if (pools.length + filesystems.length + stores.length + nfses.length === 0) {
          replace(
            body,
            failure,
            block(
              "Nothing here yet",
              "This cluster has no CephBlockPool, CephFilesystem, CephObjectStore or CephNFS. Either Rook is not managing Ceph from here, or nothing has been asked of it yet.",
              nothing("A cluster that only consumes an external Ceph has none of these — the pools are defined wherever Ceph itself is.")
            )
          );
          return;
        }
        replace(body, failure, poolsBlock(pools), filesystemsBlock(filesystems), storesBlock(stores), nfsBlock(nfses));
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
  function phasePill(phase) {
    if (!phase) return null;
    const good = phase === "Ready" || phase === "Connected";
    return pill(phase, good ? "ok" : phase === "Progressing" ? "warn" : "error");
  }
  function durabilityPill(spec) {
    const words = durability(spec);
    if (!words) return pill("layout not set", "warn", "Neither replicated.size nor erasureCoded is set on this pool");
    return pill(words, fragile(spec) ? "error" : "ok", fragile(spec) ? "One failed OSD loses the data in this pool" : "The data survives a failure");
  }
  function poolsBlock(pools) {
    if (pools.length === 0) return block("Block pools", "", nothing("No CephBlockPool. RBD storage classes have nothing here to provision from."));
    const cards = pools.slice().sort((a, b) => poolName(a).localeCompare(poolName(b))).map((pool) => {
      const mirror = pool.status?.mirroringStatus?.summary?.health ?? "";
      const fragileHere = fragile(pool.spec);
      return el(
        "article",
        { class: `card tone-edge-${fragileHere ? "error" : (pool.status?.phase ?? "") === "Ready" ? "ok" : "warn"}` },
        el(
          "div",
          { class: "card-head" },
          openName(poolName(pool), { kind: BLOCK_POOLS, namespace: pool.metadata.namespace ?? "", name: pool.metadata.name }, "card-name"),
          el("span", { class: "spacer" }),
          durabilityPill(pool.spec),
          phasePill(pool.status?.phase)
        ),
        facts([
          ["Failure domain", pool.spec?.failureDomain || "host (Ceph‘s default)"],
          ["Device class", pool.spec?.deviceClass || "any"],
          ["Compression", pool.spec?.compressionMode || "off"],
          ["Pool id", pool.status?.poolID !== void 0 ? String(pool.status.poolID) : "—"],
          ...pool.spec?.mirroring?.enabled ? [["Mirroring", el("span", {}, pool.spec.mirroring.mode || "on", mirror ? pill(mirror, mirror === "OK" ? "ok" : "error") : null)]] : [],
          ...pool.spec?.quotas?.maxSize ? [["Quota", pool.spec.quotas.maxSize]] : []
        ]),
        fragileHere ? el(
          "p",
          { class: "card-problem" },
          `${durability(pool.spec)} means one failed OSD loses everything in this pool. Ceph will not warn about it — requireSafeReplicaSize only stops you creating one.`
        ) : null
      );
    });
    return block(
      "Block pools",
      "What RBD volumes are cut out of. The redundancy pill is how many copies of each object the pool keeps — that is what survives a dead disk, not the health status.",
      el("div", { class: "wide" }, ...cards)
    );
  }
  function filesystemsBlock(filesystems) {
    if (filesystems.length === 0) return null;
    const cards = filesystems.map((fs) => {
      const mds = fs.spec?.metadataServer;
      const active = mds?.activeCount ?? 0;
      const dataPools = fs.spec?.dataPools ?? [];
      return el(
        "article",
        { class: `card tone-edge-${(fs.status?.phase ?? "") === "Ready" ? "ok" : "warn"}` },
        el(
          "div",
          { class: "card-head" },
          openName(fs.metadata.name, { kind: FILESYSTEMS, namespace: fs.metadata.namespace ?? "", name: fs.metadata.name }, "card-name"),
          el("span", { class: "spacer" }),
          pill(`${count(active, "active MDS", "active MDS")}`, active > 0 ? "ok" : "error", "Metadata servers serving this filesystem"),
          mds?.activeStandby ? pill("with standbys", "ok", "Each active MDS has a standby ready to take over") : pill("no standbys", "warn", "An MDS failure means a pause until one is restarted"),
          phasePill(fs.status?.phase)
        ),
        facts([
          ["Metadata pool", el("span", {}, fs.spec?.metadataPool?.name || `${fs.metadata.name}-metadata`, " — ", durabilityPill(fs.spec?.metadataPool))],
          [
            "Data pools",
            dataPools.length === 0 ? "—" : el(
              "span",
              {},
              ...dataPools.flatMap((pool, index) => [
                index > 0 ? el("span", {}, ", ") : null,
                el("span", { class: "mono" }, pool.name || `${fs.metadata.name}-data${index}`),
                el("span", {}, " "),
                durabilityPill(pool)
              ]).filter((node) => node !== null)
            )
          ],
          ["Mirroring", fs.spec?.mirroring?.enabled ? "on" : "off"]
        ]),
        dataPools.some(fragile) || fragile(fs.spec?.metadataPool) ? el("p", { class: "card-problem" }, "One of this filesystem‘s pools keeps a single copy. Losing one OSD loses what is in it — the metadata pool most of all.") : null
      );
    });
    return block(
      "Filesystems (CephFS)",
      "What shared-file storage classes provision from. A filesystem needs its metadata servers up to be mountable at all, and each one holds a metadata pool and one or more data pools.",
      el("div", { class: "wide" }, ...cards)
    );
  }
  function storesBlock(stores) {
    if (stores.length === 0) return null;
    const cards = stores.map((store) => {
      const endpoints = [...store.status?.endpoints?.secure ?? [], ...store.status?.endpoints?.insecure ?? []];
      return el(
        "article",
        { class: `card tone-edge-${(store.status?.phase ?? "") === "Ready" || (store.status?.phase ?? "") === "Connected" ? "ok" : "warn"}` },
        el(
          "div",
          { class: "card-head" },
          openName(store.metadata.name, { kind: OBJECT_STORES, namespace: store.metadata.namespace ?? "", name: store.metadata.name }, "card-name"),
          el("span", { class: "spacer" }),
          pill(count(store.status?.replicas ?? store.spec?.gateway?.instances ?? 0, "gateway"), (store.status?.replicas ?? 0) > 0 ? "ok" : "warn"),
          phasePill(store.status?.phase)
        ),
        facts([
          ["S3 endpoints", endpoints.length ? el("span", { class: "mono" }, endpoints.join(", ")) : "none reported"],
          ["Metadata pool", durabilityPill(store.spec?.metadataPool)],
          ["Data pool", durabilityPill(store.spec?.dataPool)],
          ["Shared pools", store.spec?.sharedPools?.dataPoolName || store.spec?.sharedPools?.metadataPoolName ? "yes" : "no"],
          ["Zone", store.spec?.zone?.name || "—"]
        ]),
        store.status?.message ? el("p", { class: "card-problem" }, store.status.message) : null
      );
    });
    return block("Object stores (RGW)", "The S3 endpoints. Bucket storage classes make their buckets in one of these, through an ObjectBucketClaim.", el("div", { class: "wide" }, ...cards));
  }
  function nfsBlock(nfses) {
    if (nfses.length === 0) return null;
    const cards = nfses.map(
      (nfs) => el(
        "article",
        { class: `card tone-edge-${(nfs.status?.phase ?? "") === "Ready" ? "ok" : "warn"}` },
        el(
          "div",
          { class: "card-head" },
          openName(nfs.metadata.name, { kind: NFSES, namespace: nfs.metadata.namespace ?? "", name: nfs.metadata.name }, "card-name"),
          el("span", { class: "spacer" }),
          pill(count(nfs.spec?.server?.active ?? 0, "active server"), (nfs.spec?.server?.active ?? 0) > 0 ? "ok" : "warn"),
          phasePill(nfs.status?.phase)
        ),
        facts([
          ["RADOS pool", nfs.spec?.rados?.pool || "—"],
          ["RADOS namespace", nfs.spec?.rados?.namespace || "—"],
          ["Service name", el("span", { class: "mono" }, `rook-ceph-nfs-${nfs.metadata.name}-a`)]
        ])
      )
    );
    return block(
      "NFS servers",
      "Ganesha servers exporting CephFS over NFS. An NFS storage class names one of these in its nfsCluster parameter and the matching Service in its server parameter.",
      el("div", { class: "wide" }, ...cards)
    );
  }
})();
