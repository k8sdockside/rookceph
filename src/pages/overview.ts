// The dashboard: the three questions you open Ceph for.
//
//   Is it HEALTH_OK?     the health banner, with Ceph's own checks under it
//   How full is it?      the raw capacity bar, per cluster
//   Is anything down?    the daemon ring and the attention list
//
// Before any of that, one question the other plugins do not have to ask: what
// *is* this cluster? Ceph can be here, or somewhere else with only Rook here
// to talk to it, or nowhere at all with only CSI drivers left behind. All
// three are real, and drawing the same dashboard for all three would be
// wrong twice.

import { issues } from '../model/attention.js';
import { classViews, consumesCeph, KIND_ORDER, KIND_WORDS, type ClassView } from '../model/classes.js';
import { groups, ofCluster, type DaemonView } from '../model/daemons.js';
import { clusterView, fullnessTone, healthSentence, mixedVersions, type ClusterView } from '../model/health.js';
import {
    BLOCK_POOLS,
    CLUSTERS,
    FILESYSTEMS,
    NFSES,
    OBJECT_STORES,
    PODS,
    PVCS,
    STORAGE_CLASSES,
    type CephBlockPool,
    type CephCluster,
    type CephFilesystem,
    type CephNFS,
    type CephObjectStore,
    type PersistentVolumeClaim,
    type Pod,
    type StorageClass,
} from '../model/rook.js';
import { percent, size, type Tone } from '../model/units.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, maybeList, start } from '../ui/page.js';
import { block, clickable, heading, nothing, pill, ring, stack, stat, type Slice } from '../ui/parts.js';

const REFRESH = 10_000;

start('page', async (ctx) => {
    replace(byId('head'), heading('Rook Ceph', `Ceph storage in ${ctx.contextName}.`));

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const [clusters, pods, storageClasses, claims, pools, filesystems, objectStores, nfses] = await Promise.all([
                maybeList<CephCluster>({ kind: CLUSTERS }),
                maybeList<Pod>({ kind: PODS }),
                maybeList<StorageClass>({ kind: STORAGE_CLASSES }),
                maybeList<PersistentVolumeClaim>({ kind: PVCS }),
                maybeList<CephBlockPool>({ kind: BLOCK_POOLS }),
                maybeList<CephFilesystem>({ kind: FILESYSTEMS }),
                maybeList<CephObjectStore>({ kind: OBJECT_STORES }),
                maybeList<CephNFS>({ kind: NFSES }),
            ]);
            failure.textContent = '';
            document.getElementById('first')?.remove();

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
        },
    );
    addEventListener('pagehide', stop);
});

function draw(host: HTMLElement, failure: HTMLElement, ...children: (Node | null)[]): void {
    replace(host, failure, ...children.filter((child): child is Node => child !== null));
}

/**
 * The dashboard when Rook is here: one banner per CephCluster, then the
 * daemons, then everything that needs attention.
 */
function full(
    views: ClusterView[],
    pods: Pod[],
    classes: ClassView[],
    pools: CephBlockPool[],
    filesystems: CephFilesystem[],
    objectStores: CephObjectStore[],
): (Node | null)[] {
    const daemons = views.flatMap((view) => groups(ofCluster(pods, view.namespace)).flatMap((group) => group.daemons));
    const problems = issues({ clusters: views, daemons, pools, filesystems, objectStores, classes });
    const osds = daemons.filter((daemon) => daemon.type === 'osd');
    const mons = daemons.filter((daemon) => daemon.type === 'mon');
    const capacity = views.reduce((total, view) => total + (view.capacity.known ? view.capacity.total : 0), 0);
    const used = views.reduce((total, view) => total + (view.capacity.known ? view.capacity.used : 0), 0);

    return [
        el(
            'div',
            { class: 'stats' },
            stat('Ceph clusters', String(views.length), views.some((v) => v.external) ? `${views.filter((v) => v.external).length} external` : 'all in this cluster'),
            stat(
                'Raw capacity used',
                capacity > 0 ? size(used) : '—',
                capacity > 0 ? `${percent(used, capacity).toFixed(0)}% of ${size(capacity)}` : 'Ceph has not reported it',
                capacity > 0 && percent(used, capacity) >= 85 ? 'warn' : '',
            ),
            stat('OSDs', String(osds.length), osds.length ? `${osds.filter((o) => o.tone === 'ok').length} running` : 'none in this cluster', osds.some((o) => o.tone === 'error') ? 'error' : ''),
            stat('Monitors', String(mons.length), mons.length ? `${mons.filter((m) => m.tone === 'ok').length} running` : 'none in this cluster', mons.some((m) => m.tone === 'error') ? 'error' : ''),
            stat('Storage classes', String(classes.length), `${classes.reduce((n, c) => n + c.claims, 0)} claims`),
        ),
        ...views.map(healthBanner),
        daemonBlock(daemons),
        classBlock(classes),
        attentionBlock(problems),
        versionNote(views),
    ];
}

/** One cluster's health, capacity and checks, as the page's headline. */
function healthBanner(view: ClusterView): HTMLElement {
    const banner = el('div', { class: 'health' });
    banner.style.borderLeftColor = `var(--${toneVar(view.tone)})`;

    const name = el(
        'div',
        { class: 'health-name' },
        el('span', { class: `health-word tone-${view.tone || 'none'}` }, view.health || 'not reported'),
        pill(view.external ? 'external Ceph' : 'in this cluster', view.external ? 'info' : '', view.external ? 'Ceph runs outside this Kubernetes cluster; Rook only talks to it' : 'Rook runs the Ceph daemons here'),
        view.phase ? pill(view.phase, view.phase === 'Ready' || view.phase === 'Connected' ? 'ok' : 'warn') : null,
        view.version ? pill(`Ceph ${view.version}`, '') : null,
    );

    const open = () => void k8sdockside.open({ kind: CLUSTERS, namespace: view.namespace, name: view.name });
    const title = el('div', {}, el('strong', {}, view.name), el('span', { class: 'faint' }, view.namespace ? ` in ${view.namespace}` : ''));
    clickable(title, open);

    banner.append(
        el('div', { style: 'flex:1 1 220px;min-width:0' }, title, name),
        el('p', { class: 'health-sentence' }, healthSentence(view) + (view.message ? ` ${view.message}` : '')),
        capacityPiece(view),
    );

    const checks = view.checks.length > 0 ? checkList(view) : null;
    return el('div', {}, banner, checks);
}

function capacityPiece(view: ClusterView): HTMLElement {
    if (!view.capacity.known) {
        return el('div', { class: 'health-capacity' }, el('p', { class: 'faint', style: 'margin:0' }, 'Ceph has not reported any capacity yet.'));
    }
    const tone = fullnessTone(view.capacity);
    const segments = [
        { label: 'Used', bytes: view.capacity.used, tone },
        { label: 'Free', bytes: Math.max(0, view.capacity.total - view.capacity.used), tone: '' as Tone },
    ];
    return el(
        'div',
        { class: 'health-capacity' },
        stack(segments, view.capacity.total),
        el(
            'p',
            { class: 'numbers', style: 'margin:0' },
            el('span', {}, el('strong', {}, size(view.capacity.used)), ' used'),
            el('span', {}, el('strong', {}, size(view.capacity.total)), ' raw'),
            el('span', {}, el('strong', {}, `${percent(view.capacity.used, view.capacity.total).toFixed(0)}%`), ' full'),
        ),
    );
}

/**
 * Ceph's health checks, written out.
 *
 * This is the single most useful thing the page can show, and the thing every
 * other view of Ceph in Kubernetes hides: `status.ceph.details` is exactly
 * what `ceph status` would print, and reading it should not require a shell
 * in a toolbox pod.
 */
function checkList(view: ClusterView): HTMLElement {
    const list = el('ul', { class: 'checks' });
    for (const check of view.checks) {
        const row = el(
            'li',
            { class: 'check' },
            el('span', { class: `dot dot-${check.tone || 'none'}` }),
            el('span', { class: 'check-id' }, check.id),
            el('span', { class: 'check-message' }, check.message),
        );
        row.title = 'Open the Ceph health checks documentation';
        clickable(row, () => void k8sdockside.openUrl(`https://docs.ceph.com/en/latest/rados/operations/health-checks/#${check.id.toLowerCase()}`));
        list.append(row);
    }
    return block(`What Ceph is complaining about in ${view.name}`, 'Straight out of `ceph status`. Each row opens what the check means.', list);
}

function daemonBlock(daemons: DaemonView[]): HTMLElement {
    if (daemons.length === 0) {
        return block(
            'Daemons',
            '',
            nothing('No Ceph daemon pods run in this cluster. For an external Ceph that is exactly right — the mons and OSDs are on somebody else‘s machines.'),
        );
    }
    const tally = (tone: Tone) => daemons.filter((daemon) => daemon.tone === tone).length;
    const slices: Slice[] = [
        { label: 'not running', count: tally('error'), tone: 'error' },
        { label: 'starting or unready', count: tally('warn'), tone: 'warn' },
        { label: 'unknown', count: tally(''), tone: '' },
        { label: 'running', count: tally('ok'), tone: 'ok' },
    ];
    return el(
        'div',
        { class: 'rings' },
        ring('Ceph daemons', slices, { onPick: () => void k8sdockside.openView('daemons'), unit: 'pods' }),
        ring('OSDs', osdSlices(daemons), { onPick: () => void k8sdockside.openView('daemons'), unit: 'OSDs' }),
    );
}

function osdSlices(daemons: DaemonView[]): Slice[] {
    const osds = daemons.filter((daemon) => daemon.type === 'osd');
    const classes = new Map<string, number>();
    for (const osd of osds) classes.set(osd.deviceClass || 'unknown class', (classes.get(osd.deviceClass || 'unknown class') ?? 0) + 1);
    const tones: Tone[] = ['info', 'ok', 'warn', ''];
    return [...classes.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([label, count], index) => ({ label, count, tone: tones[index % tones.length] ?? '' }));
}

/** What the cluster hands out, in one row per kind of storage. */
function classBlock(classes: ClassView[]): HTMLElement {
    if (classes.length === 0) {
        return block('Storage classes', '', nothing('No storage class in this cluster provisions from Ceph. Nothing here can ask Ceph for a volume yet.'));
    }
    const list = el('ul', { class: 'checks' });
    for (const kind of KIND_ORDER) {
        const mine = classes.filter((view) => view.kind === kind);
        if (mine.length === 0) continue;
        const claims = mine.reduce((n, view) => n + view.claims, 0);
        const row = el(
            'li',
            { class: 'check' },
            el('span', { class: `dot dot-${mine.some((v) => v.problem) ? 'warn' : 'ok'}` }),
            el('span', { class: 'check-id' }, KIND_WORDS[kind].label),
            el('span', { class: 'check-message' }, `${mine.map((v) => v.name).join(', ')} — ${claims} claim${claims === 1 ? '' : 's'}, ${KIND_WORDS[kind].gives}`),
        );
        clickable(row, () => void k8sdockside.openView('classes'));
        list.append(row);
    }
    return block('What this cluster can ask Ceph for', 'Every Ceph storage class, by what it hands a workload. Each row opens the full map.', list);
}

function attentionBlock(problems: ReturnType<typeof issues>): HTMLElement {
    if (problems.length === 0) {
        return block('Needs attention', '', nothing('Ceph is healthy, every daemon is running, and no pool is without redundancy.'));
    }
    const list = el('ul', { class: 'issues' });
    for (const issue of problems.slice(0, 20)) {
        const row = el(
            'li',
            { class: 'issue' },
            el('span', { class: `dot dot-${issue.tone || 'none'}` }),
            el('span', { class: 'issue-title' }, issue.title),
            el('span', { class: 'issue-detail' }, issue.detail),
        );
        clickable(row, () => void k8sdockside.open(issue.ref));
        list.append(row);
    }
    return block('Needs attention', problems.length > 20 ? `The worst 20 of ${problems.length}. Each row opens the object.` : 'Each row opens the object.', list);
}

/** Said only when it is true, because mid-upgrade it is normal and after it is not. */
function versionNote(views: ClusterView[]): HTMLElement | null {
    const mixed = views.filter(mixedVersions);
    if (mixed.length === 0) return null;
    return block(
        'More than one Ceph version is running',
        `${mixed.map((v) => v.name).join(', ')} has daemons on different Ceph versions. During an upgrade that is expected; left this way it is the thing that bites.`,
        el('div', { class: 'links' }, button('What an upgrade looks like', () => void k8sdockside.openUrl('https://rook.io/docs/rook/latest/Upgrade/ceph-upgrade/'))),
    );
}

/**
 * The dashboard when there is no CephCluster here at all.
 *
 * Two quite different clusters end up here: one that has nothing to do with
 * Ceph, and one that is a *client* -- ceph-csi drivers and storage classes
 * pointing at a Ceph somewhere else, with no Rook operator. The second has
 * plenty worth showing, and telling it "Rook is not installed" would be both
 * true and useless.
 */
function clientOnly(ctx: K8sDockside.Context, classes: ClassView[], storageClasses: StorageClass[]): HTMLElement {
    if (!consumesCeph(storageClasses)) {
        return block(
            'No Ceph in this cluster',
            `${ctx.contextName} has no CephCluster and no storage class that provisions from Ceph. The plugin stays out of the way until it has one.`,
            el('p', { class: 'links' }, button('How to install Rook Ceph', () => void k8sdockside.openUrl('https://rook.io/docs/rook/latest/Getting-Started/quickstart/'))),
        );
    }

    const drivers = [...new Set(classes.map((view) => view.provisioner))].sort();
    const namespaces = [...new Set(classes.map((view) => view.backing.clusterID || view.driverNamespace).filter((n) => n !== ''))].sort();
    const claims = classes.reduce((n, view) => n + view.claims, 0);

    return el(
        'div',
        {},
        el(
            'div',
            { class: 'banner' },
            el('h2', {}, 'This cluster is a Ceph client'),
            el(
                'p',
                { class: 'note', style: 'margin-bottom:0' },
                `${ctx.contextName} has no CephCluster, so Ceph itself is not managed from here. What it does have is ${drivers.length === 1 ? 'a CSI driver' : `${drivers.length} CSI drivers`} and ${classes.length} storage class${classes.length === 1 ? '' : 'es'} pointing at a Ceph elsewhere` +
                    (namespaces.length ? `, under cluster id ${namespaces.join(', ')}.` : '.') +
                    ' Everything about the volumes is here; nothing about the OSDs is.',
            ),
        ),
        el(
            'div',
            { class: 'stats' },
            stat('Storage classes', String(classes.length), 'provisioning from Ceph'),
            stat('Claims', String(claims), `${classes.reduce((n, view) => n + view.pending, 0)} pending`, classes.some((view) => view.pending > 0) ? 'warn' : ''),
            stat('CSI drivers', String(drivers.length), drivers.join(', ')),
        ),
        classBlock(classes),
        block(
            'What is missing, and why',
            'Health, capacity, pools and OSDs all come from a CephCluster resource. Without one, Rook is not running here and there is nothing in this cluster to read them from — they live wherever Ceph itself does.',
            el(
                'div',
                { class: 'links' },
                button('Open the storage class map', () => void k8sdockside.openView('classes')),
                button('Connecting Rook to an external Ceph', () => void k8sdockside.openUrl('https://rook.io/docs/rook/latest/CRDs/Cluster/external-cluster/external-cluster/')),
            ),
        ),
    );
}

/** The theme token behind a tone, for the one border that has to be set by hand. */
function toneVar(tone: Tone): string {
    return tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'error' ? 'error' : tone === 'info' ? 'accent' : 'border';
}
