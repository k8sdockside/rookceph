# Rook Ceph for K8s Dockside

A [K8s Dockside](https://github.com/k8sdockside/k8sdockside) plugin for
[Rook](https://rook.io), the operator that runs [Ceph](https://ceph.io) in
Kubernetes and hands it out as block volumes, shared filesystems, NFS exports
and S3 buckets.

It answers the questions you open Ceph for — is it `HEALTH_OK`, how full is
it, is any daemon down, and what exactly does that storage class give me —
without a shell in a toolbox pod.

<!-- markdownlint-disable-next-line MD033 -->
<img src="src/assets/logo.svg" alt="" width="64" height="64" />

## It works on all three kinds of cluster

Ceph is not always where you are looking at it from, and the plugin says which
of these it is looking at rather than drawing an empty dashboard:

| | What it is | What you get |
| --- | --- | --- |
| **Converged** | Rook runs the mons and OSDs on these machines | everything below |
| **External** | a `CephCluster` with `spec.external.enable`, talking to a Ceph elsewhere | health, capacity, pools, storage classes and CSI — but no daemon map, because the daemons are not here |
| **Client only** | ceph-csi drivers and storage classes, no Rook operator at all | the storage class map, the claims on it, and a plain statement of what cannot be known from here |

The third case is what the Dashboard falls back to when there is no
`CephCluster`: rather than "Rook is not installed", it says what the cluster
*does* have — which drivers, which classes, which cluster id they point at.

## What it shows

**Dashboard** — one banner per Ceph cluster: the health word, the mode, the
raw capacity as a bar, and under it *every* health check Ceph is reporting,
written out in full from `status.ceph.details` with a link to what each check
id means. Then the daemons as two rings, what the cluster can ask Ceph for,
and everything that needs attention — worst first, each row opening the object
it is about.

**Storage classes** — every Ceph storage class in the cluster, grouped by what
it actually hands a workload rather than by driver name: block (RBD), shared
file (CephFS), NFS, and object buckets. Each class is tied to the pool,
filesystem, object store or NFS server behind it, with the redundancy of that
pool, the reclaim and binding behaviour in words, the claims using it and what
they add up to, and every CSI parameter as it is really written. A class
pointing at something that is not there says so; a class pointing at a Ceph
outside this cluster is not treated as broken, because that is not a fault.

Rook names its drivers after its operator's namespace, so the match is on the
suffix — `rook-ceph.rbd.csi.ceph.com`, `storage.cephfs.csi.ceph.com` and a
plain `rbd.csi.ceph.com` are all recognised.

**Pools & filesystems** — every `CephBlockPool`, `CephFilesystem`,
`CephObjectStore` and `CephNFS`, each with the one fact that matters most:
how many copies of the data it keeps, as `3 copies` or `EC 4+2`. A pool with
a single copy is called out in red — Ceph itself reports `HEALTH_OK` for one
right up until a disk dies.

**Daemons & OSDs** — every mon, manager, OSD, metadata server and gateway,
either by daemon type ("is anything down") or by machine ("what does draining
this node cost"). OSDs carry their device class and their id; the active
manager is marked; a monitor count that cannot hold a quorum says so.

**Panels** on PersistentVolumeClaims (which RBD image or CephFS subvolume it
really is, and in which pool), on StorageClasses (what the parameters add up
to), on Nodes (the Ceph daemons on that machine and what a drain costs) and on
CephClusters (health checks and capacity).

Every Rook custom resource also gets a table of its own in the sidebar — block
pools, filesystems, object stores, users, realms, zones, bucket claims,
clients, mirrors, subvolume groups and the rest — plus the mon, mgr, OSD, MDS,
RGW, operator and CSI pods.

## What it reads, and what it changes

It reads Rook's custom resources and `objectbucket.io`'s, and Pods, Nodes,
PersistentVolumeClaims, PersistentVolumes and StorageClasses. It never reads
Secrets: the app refuses that for every plugin, whatever a manifest says — so
the CSI credentials a storage class names are shown as names and nothing more.

It can ask to change one thing, and it is shown to you in a dialog the pages
cannot reach or answer before anything happens:

| Action | On | What it does |
| --- | --- | --- |
| Enable / disable the Ceph dashboard | CephCluster | `spec.dashboard.enabled` |

Nothing it can do touches data, a pool, a CRUSH rule or an OSD.

### Charts

Six overview charts, drawn from the cluster's Prometheus if it has one
scraping the Ceph manager's `prometheus` module: raw capacity used and total,
OSDs up, health status over time, and pool throughput and IOPS. Without a
Prometheus the charts say so and the rest of the plugin is unaffected.

## Installing

In K8s Dockside: **Settings → Plugins → From a repository**:

```text
https://github.com/k8sdockside/rookceph.git
```

Needs K8s Dockside 0.1.1 or newer. Without a `CephCluster` in the cluster the
plugin is not listed as present, but it still works if you install it — which
is how the client-only view is reached.

## Working on it

The pages are TypeScript in `src/`, bundled into `ui/` — which is what the app
serves, and what installing clones, so `ui/` is committed and must be in step
with `src/`.

```sh
npm install
npm run build     # src/ -> ui/
npm run watch     # rebuild on every change; reopen the tab to see it
npm run preview   # draw every page to preview/, with no cluster
npm run check     # typecheck, unit tests, and ui/ against a fresh build
```

`npm run preview` is the one to reach for first. It runs every page against
the fixtures in `src/fixtures.ts` — a cluster in `HEALTH_WARN` at 88% full,
an external cluster beside it, a monitor down, an OSD crash-looping, a pool
keeping one copy, and a storage class whose pool was deleted — and writes them
to `preview/` as standalone HTML in both the app's light and dark themes. Open
`preview/index.html`. It needs no Kubernetes, no Rook and no Ceph, which
matters because the pages worth looking at are the ones a healthy cluster
never shows you.

The buttons in a preview do nothing: there is no app behind them. For that,
and for real data, you need the app.

To see your changes in the app without installing anything: **Settings →
Plugins → Watch another folder**, point it at this checkout, and press
**Reload** after each build.

To check the manifest the way the app does:

```sh
go run github.com/k8sdockside/k8sdockside/cmd/plugincheck@main .
```

### How it is laid out

| | |
| --- | --- |
| `plugin.json` | the manifest: views, cards, charts, panels, actions |
| `src/model/` | what Rook's resources mean — health, storage classes, daemons — with the tests |
| `src/ui/` | the pieces the pages are drawn from: rings, bars, pills, cards |
| `src/pages/` | one `.ts` and one `.html` per page, plus `render.test.ts` |
| `src/styles/` | one stylesheet, written in the app's theme tokens |

Everything with real Ceph knowledge in it lives in `src/model/` and is tested
without a cluster: that a driver is matched on its suffix so a non-default
operator namespace still works, that `clusterID` is looked up as a *namespace*
and not as a name, that a cluster Rook has not read yet is drawn as unknown
rather than as unhealthy, that a claim's `10Gi` is not added up as `10`, and
that a pool with one copy is called out even while Ceph says `HEALTH_OK`.

The field names in `src/model/rook.ts` are the JSON tags from
[`rook/pkg/apis/ceph.rook.io/v1/types.go`](https://github.com/rook/rook/blob/master/pkg/apis/ceph.rook.io/v1/types.go),
and the pod labels in `src/model/daemons.ts` are the constants Rook's operator
stamps on: `app`, `rook_cluster`, `ceph-osd-id`, `device-class`,
`failure-domain`, `ceph_daemon_id` and `mgr_role`.

## Credit

[Rook](https://rook.io) is a [CNCF](https://www.cncf.io) project and
[Ceph](https://ceph.io) is a [Ceph Foundation](https://ceph.io/en/foundation/)
one. Their names and their marks are their own and are used here only to name
this plugin for what it is about. The mark this plugin ships is Ceph's own,
copied from the logo the project publishes on its website
([`ceph/ceph.io`](https://github.com/ceph/ceph.io/blob/main/src/assets/svgs/logo-ceph-grey.svg)),
with only the wordmark beside it dropped so it fits a 26px square. This plugin
is not affiliated with the Rook or Ceph projects.

Apache 2.0 — see [LICENSE](LICENSE).
