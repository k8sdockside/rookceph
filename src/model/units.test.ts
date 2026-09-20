import { describe, expect, it } from 'vitest';
import { count, percent, quantity, size } from './units.js';

describe('size', () => {
    it('writes bytes the way Ceph and Kubernetes do', () => {
        expect(size(0)).toBe('0');
        expect(size(512)).toBe('512 B');
        expect(size(1024)).toBe('1.00 Ki');
        expect(size(1.5 * 1024 ** 3)).toBe('1.50 Gi');
        expect(size(12 * 1024 ** 4)).toBe('12.0 Ti');
    });

    it('does not write NaN or a negative size', () => {
        expect(size(Number.NaN)).toBe('0');
        expect(size(-1)).toBe('0');
        expect(size(Number.POSITIVE_INFINITY)).toBe('0');
    });
});

describe('percent', () => {
    it('is safe when nothing has reported a total', () => {
        expect(percent(5, 0)).toBe(0);
    });

    it('never goes past the ends of a bar', () => {
        expect(percent(-5, 10)).toBe(0);
        expect(percent(50, 10)).toBe(100);
    });
});

describe('quantity', () => {
    // A claim's size is "10Gi", not 10. Reading it as 10 is how a storage
    // class page ends up saying a hundred claims add up to a kilobyte.
    it('reads the binary suffixes Kubernetes writes', () => {
        expect(quantity('10Gi')).toBe(10 * 1024 ** 3);
        expect(quantity('1.5Ti')).toBe(1.5 * 1024 ** 4);
        expect(quantity('512Mi')).toBe(512 * 1024 ** 2);
    });

    it('reads the decimal ones too, because users write both', () => {
        expect(quantity('1G')).toBe(1e9);
        expect(quantity('500M')).toBe(5e8);
    });

    it('reads a plain byte count', () => {
        expect(quantity('1000')).toBe(1000);
        expect(quantity(2048)).toBe(2048);
    });

    it('reads nothing as nothing rather than as NaN', () => {
        expect(quantity(undefined)).toBe(0);
        expect(quantity(null)).toBe(0);
        expect(quantity('')).toBe(0);
        expect(quantity('not a size')).toBe(0);
    });
});

describe('count', () => {
    it('makes the noun plural only when it should', () => {
        expect(count(1, 'OSD')).toBe('1 OSD');
        expect(count(2, 'OSD')).toBe('2 OSDs');
        expect(count(0, 'OSD')).toBe('0 OSDs');
        expect(count(1, 'copy', 'copies')).toBe('1 copy');
        expect(count(3, 'copy', 'copies')).toBe('3 copies');
    });
});
