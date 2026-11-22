// Display names: short, readable app names on the battlecard instead of long store titles.
import { describe, expect, it } from 'vitest';

import { displayName } from '../src/apple.js';

describe('displayName', () => {
    it('keeps the typed name when the store title starts with it', () => {
        expect(displayName('PhonePe UPI Payments, Loan App', 'phonepe')).toBe('PhonePe');
        expect(displayName('Swiggy: Food Instamart Dineout', 'Swiggy')).toBe('Swiggy');
        expect(displayName('Google Pay', 'Google Pay')).toBe('Google Pay');
    });

    it('does not cut a word in half', () => {
        expect(displayName('Paytm: Secure UPI Payments', 'Pay')).toBe('Paytm');
    });

    it('cuts long titles at the first separator when there is no typed name', () => {
        expect(displayName('Amazon India Shop, Pay, miniTV', 'Amazon Shopping')).toBe('Amazon India Shop');
        expect(displayName('Myntra - Fashion Shopping App', null)).toBe('Myntra');
        expect(displayName('Flipkart Online Shopping App', null)).toBe('Flipkart Online Shopping App');
        expect(displayName('Wi-Fi Analyzer', null)).toBe('Wi-Fi Analyzer');
    });
});
