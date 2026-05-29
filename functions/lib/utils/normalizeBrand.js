"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandKey = brandKey;
exports.brandDisplay = brandDisplay;
const BRAND_EXCEPTIONS = {
    cos: 'COS',
    apc: 'A.P.C.',
    'a.p.c.': 'A.P.C.',
    'h&m': 'H&M',
    asos: 'ASOS',
    'ba&sh': 'ba&sh',
    bash: 'ba&sh',
    '& other stories': '& Other Stories',
    zara: 'Zara',
    uniqlo: 'Uniqlo',
    sezane: 'Sézane',
    sézane: 'Sézane',
    'the kooples': 'The Kooples',
    'agnes b': 'agnès b.',
    'agnès b.': 'agnès b.',
    ysl: 'YSL',
    levis: "Levi's",
    "levi's": "Levi's",
    nike: 'Nike',
    adidas: 'Adidas',
};
function brandKey(brand) {
    if (!brand)
        return '';
    return brand.trim().toLowerCase();
}
function titleCaseWord(word) {
    if (word.length === 0)
        return word;
    // Capitalize after spaces and hyphens, but never after an apostrophe.
    return word
        .split('-')
        .map((segment) => {
        if (segment.length === 0)
            return segment;
        return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
    })
        .join('-');
}
function brandDisplay(brand) {
    if (!brand)
        return '';
    const trimmed = brand.trim();
    if (trimmed.length === 0)
        return '';
    const exception = BRAND_EXCEPTIONS[trimmed.toLowerCase()];
    if (exception)
        return exception;
    return trimmed
        .split(' ')
        .map((word) => titleCaseWord(word))
        .join(' ');
}
//# sourceMappingURL=normalizeBrand.js.map