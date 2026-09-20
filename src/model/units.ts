// Sizes, percentages, and the four words this plugin colours things by.
//
// Kept apart from the Rook types because the drawing helpers in src/ui need
// them and should not have to import a page's worth of Ceph knowledge to get
// a byte count formatted.

/** The tones the app's theme has: '' is "no opinion", drawn in the faint colour. */
export type Tone = 'ok' | 'warn' | 'error' | 'info' | '';

/** Bytes in the shorthand Ceph and Kubernetes both use: 1.5 Gi, 940 Mi, 12 Ti. */
export function size(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei'];
    let n = value;
    let unit = 0;
    while (n >= 1024 && unit < units.length - 1) {
        n /= 1024;
        unit++;
    }
    const digits = n >= 100 || unit === 0 ? 0 : n >= 10 ? 1 : 2;
    return `${n.toFixed(digits)} ${units[unit]}`;
}

/** A fraction as a percentage, clamped to 0-100 and safe when the whole is zero. */
export function percent(part: number, whole: number): number {
    if (!(whole > 0)) return 0;
    return Math.max(0, Math.min(100, (part / whole) * 100));
}

/**
 * A Kubernetes quantity -- "10Gi", "500M", "1.5Ti", "1000" -- as bytes.
 *
 * PersistentVolumeClaims write their size this way, and a storage class page
 * that adds them up must not read "10Gi" as 10. Both the binary suffixes
 * (Ki, Mi, Gi ...) and the decimal ones (k, M, G ...) are understood, because
 * Kubernetes accepts both and users write both.
 */
export function quantity(value: string | number | undefined | null): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (!value) return 0;
    const match = /^\s*([0-9.]+)\s*([EPTGMk]i?|m)?\s*$/.exec(value);
    if (!match) {
        const plain = Number(value);
        return Number.isFinite(plain) ? plain : 0;
    }
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return 0;
    const suffix = match[2] ?? '';
    const binary: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6 };
    const decimal: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18, m: 1e-3 };
    return n * (binary[suffix] ?? decimal[suffix] ?? 1);
}

/** A number of things, with the noun made plural when it needs to be. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
    return `${n} ${n === 1 ? noun : plural}`;
}
