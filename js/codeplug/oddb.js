// OpenDMR's own DMR ID database: callsign, name, city, state and country of each ID, about 3.5 MB for RadioID's whole
// list (OpenDMR tools/ids/id_db.py builds the same bytes; the firmware reads it in src/services/dmr_ids.c, from 0.4.0).
//
// At the end of the firmware's 9 MB flash window: the header in the last sector, the rest below it from its base (a
// 4 KB boundary). Little endian.
//
//   header: "ODID", version, 3 reserved, records, blocks, countries, base, size (from base to the header), then the
//           offsets from the base of: the block index, the blocks, the prefix map, the country names, the country
//           directory, the names, the places of other countries; then the field classes (5 x 4 widths), the CRC-32
//           of the body
//   block index: the first ID of each block (u32)
//   block (4 KB): 0xD1, 0, record count (u16), then the records, bit packed (most significant bit first)
//   prefix map: 1000 bytes, the country of each ID's first 3 digits (0xFF: none)
//   country directory: per country, the offsets of its lists: callsign prefixes, states, places
//   list: count (u32), the offset of each 16th entry from the list (u32), then the entries: shared bytes with the one
//         before (u8, 0 for every 16th), length (u8), the bytes
//   places of a country: state number (u16 big endian, 0xFFFF none) + city, sorted
//   other places: country (u8) << 24 | its place number
//
//   record: [id - previous id] [callsign] [name] [place]
//     callsign: 0 the previous record's, 1 a literal (length u8 + bytes), 2+ that prefix of the country's (by use)
//               then the letters after it: count (3 bits) + base 26 (0 / 5 / 10 / 15 / 19 bits)
//     name:     0 a literal, 1+ a name of the names list (by use)
//     place:    0 the previous record's, 1 another country's (then its number in the other places), 2+ the country's
//   A number is a class (2 bits) and that class's width of bits, the classes of each field in the header.
//   The country of a record: the prefix map of its ID.

export const WINDOW_SIZE = 0x900000;           // OpenDMR src/drivers/flash.h FLASH_WINDOW_SIZE
export const SECTOR = 0x1000;
export const HEADER_AT = WINDOW_SIZE - SECTOR; // dmr_ids.c NEW_HEADER
export const MAX_SIZE = 0x400000;              // below: the OpenGD77 database
const BLOCK = 0x1000;
const CHUNK = 16;
const SUFFIX_BITS = [0, 5, 10, 15, 19];
const FIELDS = ['delta', 'call', 'name', 'place', 'other'];
const CALL = /^([A-Z0-9]*[0-9])([A-Z]{0,4})$/;
const UTF8 = new TextEncoder();
const PLAIN = /^[\x20-\x7E]*$/;

/* ---- the entries as the database keeps them ---- */

// The characters of a non-zero combining class (Python's unicodedata.combining(), Unicode 16.0.0; made by a script):
// the accents id_db.py takes off. Not \p{Mn}: that also takes Thai vowel signs, which id_db.py keeps
const COMBINING = /[\u{300}-\u{34E}\u{350}-\u{36F}\u{483}-\u{487}\u{591}-\u{5BD}\u{5BF}\u{5C1}-\u{5C2}\u{5C4}-\u{5C5}\u{5C7}\u{610}-\u{61A}\u{64B}-\u{65F}\u{670}\u{6D6}-\u{6DC}\u{6DF}-\u{6E4}\u{6E7}-\u{6E8}\u{6EA}-\u{6ED}\u{711}\u{730}-\u{74A}\u{7EB}-\u{7F3}\u{7FD}\u{816}-\u{819}\u{81B}-\u{823}\u{825}-\u{827}\u{829}-\u{82D}\u{859}-\u{85B}\u{897}-\u{89F}\u{8CA}-\u{8E1}\u{8E3}-\u{8FF}\u{93C}\u{94D}\u{951}-\u{954}\u{9BC}\u{9CD}\u{9FE}\u{A3C}\u{A4D}\u{ABC}\u{ACD}\u{B3C}\u{B4D}\u{BCD}\u{C3C}\u{C4D}\u{C55}-\u{C56}\u{CBC}\u{CCD}\u{D3B}-\u{D3C}\u{D4D}\u{DCA}\u{E38}-\u{E3A}\u{E48}-\u{E4B}\u{EB8}-\u{EBA}\u{EC8}-\u{ECB}\u{F18}-\u{F19}\u{F35}\u{F37}\u{F39}\u{F71}-\u{F72}\u{F74}\u{F7A}-\u{F7D}\u{F80}\u{F82}-\u{F84}\u{F86}-\u{F87}\u{FC6}\u{1037}\u{1039}-\u{103A}\u{108D}\u{135D}-\u{135F}\u{1714}-\u{1715}\u{1734}\u{17D2}\u{17DD}\u{18A9}\u{1939}-\u{193B}\u{1A17}-\u{1A18}\u{1A60}\u{1A75}-\u{1A7C}\u{1A7F}\u{1AB0}-\u{1ABD}\u{1ABF}-\u{1ACE}\u{1B34}\u{1B44}\u{1B6B}-\u{1B73}\u{1BAA}-\u{1BAB}\u{1BE6}\u{1BF2}-\u{1BF3}\u{1C37}\u{1CD0}-\u{1CD2}\u{1CD4}-\u{1CE0}\u{1CE2}-\u{1CE8}\u{1CED}\u{1CF4}\u{1CF8}-\u{1CF9}\u{1DC0}-\u{1DFF}\u{20D0}-\u{20DC}\u{20E1}\u{20E5}-\u{20F0}\u{2CEF}-\u{2CF1}\u{2D7F}\u{2DE0}-\u{2DFF}\u{302A}-\u{302F}\u{3099}-\u{309A}\u{A66F}\u{A674}-\u{A67D}\u{A69E}-\u{A69F}\u{A6F0}-\u{A6F1}\u{A806}\u{A82C}\u{A8C4}\u{A8E0}-\u{A8F1}\u{A92B}-\u{A92D}\u{A953}\u{A9B3}\u{A9C0}\u{AAB0}\u{AAB2}-\u{AAB4}\u{AAB7}-\u{AAB8}\u{AABE}-\u{AABF}\u{AAC1}\u{AAF6}\u{ABED}\u{FB1E}\u{FE20}-\u{FE2F}\u{101FD}\u{102E0}\u{10376}-\u{1037A}\u{10A0D}\u{10A0F}\u{10A38}-\u{10A3A}\u{10A3F}\u{10AE5}-\u{10AE6}\u{10D24}-\u{10D27}\u{10D69}-\u{10D6D}\u{10EAB}-\u{10EAC}\u{10EFD}-\u{10EFF}\u{10F46}-\u{10F50}\u{10F82}-\u{10F85}\u{11046}\u{11070}\u{1107F}\u{110B9}-\u{110BA}\u{11100}-\u{11102}\u{11133}-\u{11134}\u{11173}\u{111C0}\u{111CA}\u{11235}-\u{11236}\u{112E9}-\u{112EA}\u{1133B}-\u{1133C}\u{1134D}\u{11366}-\u{1136C}\u{11370}-\u{11374}\u{113CE}-\u{113D0}\u{11442}\u{11446}\u{1145E}\u{114C2}-\u{114C3}\u{115BF}-\u{115C0}\u{1163F}\u{116B6}-\u{116B7}\u{1172B}\u{11839}-\u{1183A}\u{1193D}-\u{1193E}\u{11943}\u{119E0}\u{11A34}\u{11A47}\u{11A99}\u{11C3F}\u{11D42}\u{11D44}-\u{11D45}\u{11D97}\u{11F41}-\u{11F42}\u{1612F}\u{16AF0}-\u{16AF4}\u{16B30}-\u{16B36}\u{16FF0}-\u{16FF1}\u{1BC9E}\u{1D165}-\u{1D169}\u{1D16D}-\u{1D172}\u{1D17B}-\u{1D182}\u{1D185}-\u{1D18B}\u{1D1AA}-\u{1D1AD}\u{1D242}-\u{1D244}\u{1E000}-\u{1E006}\u{1E008}-\u{1E018}\u{1E01B}-\u{1E021}\u{1E023}-\u{1E024}\u{1E026}-\u{1E02A}\u{1E08F}\u{1E130}-\u{1E136}\u{1E2AE}\u{1E2EC}-\u{1E2EF}\u{1E4EC}-\u{1E4EF}\u{1E5EE}-\u{1E5EF}\u{1E8D0}-\u{1E8D6}\u{1E944}-\u{1E94A}]/gu;

// Latin letters without their accents (the radio's fonts have printable ASCII; its flash font CJK, Greek, Cyrillic)
export function asciiFold(text) {
    if (PLAIN.test(text)) { // nearly every field: nothing to take off
        return text.split(/\s+/).filter((w) => w).join(' ');
    }
    const s = text.replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/ł/g, 'l').replace(/Ł/g, 'L')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/ı/g, 'i')
        .normalize('NFKD').replace(COMBINING, '');
    return s.split(/\s+/).filter((w) => w).join(' ');
}

// At most limit bytes of UTF-8, whole characters
function clip(text, limit = 60) {
    if (text.length * 3 <= limit) { // a UTF-16 unit is 3 bytes of UTF-8 at most
        return text;
    }
    const chars = Array.from(text);
    while (UTF8.encode(chars.join('')).length > limit) {
        chars.pop();
    }
    return chars.join('');
}

// The records from parseCsv() entries: IDs of 7 digits, the last entry of an ID, sorted by ID; [id, callsign, name,
// city, state, country] with the texts as the radio shows them
export function records(entries) {
    const byId = new Map();
    for (const e of entries) {
        if (!Number.isInteger(e.id) || e.id < 1000000 || e.id > 9999999) {
            continue;
        }
        const [name, city, state, country] = [e.given ?? e.name, e.city, e.state, e.country]
            .map((t) => clip(asciiFold((t ?? '').trim())));
        byId.set(e.id, [e.id, (e.callsign ?? '').trim().toUpperCase(), name,
            (city.toLowerCase() === 'none') ? '' : city, state, country]);
    }
    return [...byId.keys()].sort((a, b) => a - b).map((id) => byId.get(id));
}

/* ---- helpers ---- */

// Python's Counter.most_common(): by count, the first seen first among equals
function mostCommon(counts) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function count(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
}

function compareBytes(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return a.length - b.length;
}

const compareText = (a, b) => compareBytes(UTF8.encode(a), UTF8.encode(b));

class Bytes {
    constructor() {
        this.data = new Uint8Array(1 << 16);
        this.length = 0;
    }

    push(bytes) {
        while (this.length + bytes.length > this.data.length) {
            const bigger = new Uint8Array(this.data.length * 2);
            bigger.set(this.data);
            this.data = bigger;
        }
        this.data.set(bytes, this.length);
        this.length += bytes.length;
    }

    u32(...values) {
        const b = new Uint8Array(4 * values.length);
        const v = new DataView(b.buffer);
        values.forEach((x, i) => v.setUint32(4 * i, x >>> 0, true));
        this.push(b);
    }

    bytes() {
        return this.data.subarray(0, this.length);
    }
}

// The bits of a block, most significant first
class Bits {
    constructor(size) {
        this.data = new Uint8Array(size);
        this.n = 0;
    }

    put(value, width) {
        for (let k = width - 1; k >= 0; k--) {
            if (Math.floor(value / 2 ** k) % 2) {
                this.data[this.n >> 3] |= 0x80 >> (this.n & 7);
            }
            this.n++;
        }
    }
}

// A record's bits first as a list ([value, width] ...), to see whether it still fits in the block
class BitList {
    constructor() {
        this.items = [];
        this.n = 0;
    }

    put(value, width) {
        this.items.push(value, width);
        this.n += width;
    }
}

// The 4 widths of a field's classes: the fewest bits for all its values
function bestClasses(values) {
    const vs = values.length ? Float64Array.from(values).sort() : [0];
    const last = vs[vs.length - 1];
    const lowerBound = (x) => {
        let lo = 0;
        let hi = vs.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (vs[mid] < x) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    };
    let best = null;
    for (let a = 0; a < 25; a++) {
        for (let b = a + 1; b < 25; b++) {
            for (let c = b + 1; c < 25; c++) {
                for (let d = c + 1; d < 25; d++) {
                    const ws = [a, b, c, d];
                    if (ws.reduce((s, w) => s + 2 ** w, 0) <= last) {
                        continue;
                    }
                    let cost = 0;
                    let base = 0;
                    let lo = 0;
                    for (const w of ws) {
                        const hi = lowerBound(base + 2 ** w);
                        cost += (hi - lo) * (2 + w);
                        lo = hi;
                        base += 2 ** w;
                    }
                    if (!best || cost < best.cost) {
                        best = {cost, ws};
                    }
                }
            }
        }
    }
    return best.ws;
}

function putNumber(b, classes, value) {
    let base = 0;
    for (let i = 0; i < classes.length; i++) {
        const w = classes[i];
        if (value < base + 2 ** w) {
            b.put(i, 2);
            b.put(value - base, w);
            return;
        }
        base += 2 ** w;
    }
    throw new Error(`value ${value} has no class`);
}

function putText(b, text) {
    const data = UTF8.encode(text);
    b.put(data.length, 8);
    for (const ch of data) {
        b.put(ch, 8);
    }
}

// count, the offsets of each CHUNK-th entry, the front coded entries (Uint8Arrays)
function stringList(entries) {
    const body = new Bytes();
    const offsets = [];
    let prev = new Uint8Array(0);
    entries.forEach((e, i) => {
        let shared = 0;
        if (i % CHUNK === 0) {
            offsets.push(body.length);
        } else {
            while (shared < Math.min(prev.length, e.length, 255) && prev[shared] === e[shared]) {
                shared++;
            }
        }
        const rest = e.subarray(shared);
        if (rest.length > 255) {
            throw new Error('a list entry is too long');
        }
        body.push(Uint8Array.of(shared, rest.length));
        body.push(rest);
        prev = e;
    });
    const out = new Bytes();
    const start = 4 + (4 * offsets.length);
    out.u32(entries.length, ...offsets.map((o) => start + o));
    out.push(body.bytes());
    return out.bytes();
}

/* ---- the database ---- */

// The database of the records: {base, body, header, records, countries, blocks}; throws when it doesn't fit (fewer
// countries then)
export function build(rows) {
    // countries: by number of records; a prefix's country: the one most of its IDs have
    const byCountry = new Map();
    rows.forEach((x) => count(byCountry, x[5]));
    const countries = mostCommon(byCountry).map(([c]) => c);
    if (countries.length >= 255) {
        throw new Error('too many countries');
    }
    const number = new Map(countries.map((c, i) => [c, i]));
    const votes = new Map();
    for (const x of rows) {
        const p = Math.floor(x[0] / 10000);
        if (!votes.has(p)) {
            votes.set(p, new Map());
        }
        count(votes.get(p), x[5]);
    }
    const prefixMap = new Uint8Array(1000).fill(0xFF);
    for (const [p, c] of votes) {
        prefixMap[p] = number.get(mostCommon(c)[0][0]);
    }
    const countryOf = (id) => countries[prefixMap[Math.floor(id / 10000)]];

    // per country: callsign prefixes (by use), states (sorted), places (sorted by their bytes)
    const prefixes = new Map(countries.map((c) => [c, new Map()]));
    const states = new Map();
    const places = new Map(countries.map((c) => [c, new Map()]));
    for (const x of rows) {
        const m = CALL.exec(x[1]);
        if (m) {
            count(prefixes.get(countryOf(x[0])), m[1]);
        }
        if (x[4]) {
            if (!states.has(x[5])) {
                states.set(x[5], new Set());
            }
            states.get(x[5]).add(x[4]);
        }
        places.get(x[5]).set(`${x[4]}\0${x[3]}`, [x[4], x[3]]);
    }
    const stateList = new Map([...states].map(([c, s]) => [c, [...s].sort(compareText)]));
    const stateNo = new Map([...stateList].map(([c, l]) => [c, new Map(l.map((s, i) => [s, i]))]));
    const placeBytes = (c, state, city) => {
        const cityBytes = UTF8.encode(city);
        const out = new Uint8Array(2 + cityBytes.length);
        const n = state ? stateNo.get(c).get(state) : 0xFFFF;
        out[0] = n >> 8;
        out[1] = n & 0xFF;
        out.set(cityBytes, 2);
        return out;
    };
    const placeList = new Map();
    const placeNo = new Map();
    for (const c of countries) {
        const list = [...places.get(c).values()].map(([s, city]) => ({key: `${s}\0${city}`, bytes: placeBytes(c, s, city)}))
            .sort((a, b) => compareBytes(a.bytes, b.bytes));
        placeList.set(c, list);
        placeNo.set(c, new Map(list.map((p, i) => [p.key, i])));
    }
    const prefixList = new Map(countries.map((c) => [c, mostCommon(prefixes.get(c)).map(([p]) => p)]));
    const prefixNo = new Map([...prefixList].map(([c, l]) => [c, new Map(l.map((p, i) => [p, i]))]));

    const nameCount = new Map();
    rows.forEach((x) => count(nameCount, x[2]));
    const names = mostCommon(nameCount).filter(([, k]) => k > 1).map(([n]) => n);
    const nameNo = new Map(names.map((n, i) => [n, i]));

    const others = new Map();
    for (const x of rows) {
        if (x[5] !== countryOf(x[0])) {
            count(others, `${x[5]}\0${x[4]}\0${x[3]}`);
        }
    }
    const otherList = mostCommon(others).map(([k]) => k);
    const otherNo = new Map(otherList.map((k, i) => [k, i]));

    function fields(x, prev) {
        const c = countryOf(x[0]);
        const f = {delta: prev ? x[0] - prev[0] : null};
        const m = CALL.exec(x[1]);
        if (prev && prev[1] === x[1]) {
            f.call = 0;
        } else if (m) {
            f.call = 2 + prefixNo.get(c).get(m[1]);
            f.suffix = m[2];
        } else {
            f.call = 1;
            f.callText = x[1];
        }
        if (nameNo.has(x[2])) {
            f.name = 1 + nameNo.get(x[2]);
        } else {
            f.name = 0;
            f.nameText = x[2];
        }
        if (prev && prev[3] === x[3] && prev[4] === x[4] && prev[5] === x[5]) {
            f.place = 0;
        } else if (x[5] === c) {
            f.place = 2 + placeNo.get(c).get(`${x[4]}\0${x[3]}`);
        } else {
            f.place = 1;
            f.other = otherNo.get(`${x[5]}\0${x[4]}\0${x[3]}`);
        }
        return f;
    }

    const allFields = rows.map((x, i) => fields(x, i ? rows[i - 1] : null));
    const classes = {};
    for (const k of FIELDS) {
        classes[k] = bestClasses(allFields.map((f) => f[k]).filter((v) => v !== null && v !== undefined));
    }

    function putRecord(b, f, first) {
        if (!first) {
            putNumber(b, classes.delta, f.delta);
        }
        putNumber(b, classes.call, f.call);
        if (f.call === 1) {
            putText(b, f.callText);
        } else if (f.call >= 2) {
            const s = f.suffix;
            b.put(s.length, 3);
            let v = 0;
            for (const ch of s) {
                v = (v * 26) + ch.charCodeAt(0) - 65;
            }
            b.put(v, SUFFIX_BITS[s.length]);
        }
        putNumber(b, classes.name, f.name);
        if (f.name === 0) {
            putText(b, f.nameText);
        }
        putNumber(b, classes.place, f.place);
        if (f.place === 1) {
            putNumber(b, classes.other, f.other);
        }
    }

    // the blocks: as many records as fit, each block's first record coded against nothing before it
    const blocks = [];
    const index = [];
    let i = 0;
    while (i < rows.length) {
        const bits = new Bits(BLOCK - 4);
        const first = i;
        while (i < rows.length) {
            const f = (i === first) ? fields(rows[i], null) : allFields[i];
            const trial = new BitList();
            putRecord(trial, f, i === first);
            if (Math.ceil((bits.n + trial.n) / 8) + 4 > BLOCK) {
                break;
            }
            for (let k = 0; k < trial.items.length; k += 2) {
                bits.put(trial.items[k], trial.items[k + 1]);
            }
            i++;
        }
        if (i === first) {
            throw new Error(`the record of ${rows[i][0]} does not fit in a block`);
        }
        const block = new Uint8Array(BLOCK).fill(0xFF);
        block.set([0xD1, 0, (i - first) & 0xFF, (i - first) >> 8]);
        block.set(bits.data.subarray(0, Math.ceil(bits.n / 8)), 4);
        blocks.push(block);
        index.push(rows[first][0]);
    }

    // the tables after the blocks
    const tables = new Bytes();
    const add = (data) => {
        const at = (BLOCK * blocks.length) + tables.length;
        tables.push(data);
        while (tables.length % 4) {
            tables.push(Uint8Array.of(0));
        }
        return at;
    };
    const u32s = (values) => {
        const b = new Bytes();
        b.u32(...values);
        return b.bytes();
    };
    const offIndex = add(u32s(index));
    const offPrefix = add(prefixMap);
    const offCountries = add(stringList(countries.map((c) => UTF8.encode(c))));
    const directory = [];
    for (const c of countries) {
        const a = add(stringList(prefixList.get(c).map((p) => UTF8.encode(p))));
        const s = add(stringList((stateList.get(c) ?? []).map((t) => UTF8.encode(t))));
        const p = add(stringList(placeList.get(c).map((pl) => pl.bytes)));
        directory.push(a, s, p);
    }
    const offDirectory = add(u32s(directory));
    const offNames = add(stringList(names.map((n) => UTF8.encode(n))));
    const offOther = add(u32s(otherList.map((k) => {
        const [c, state, city] = k.split('\0');
        return (number.get(c) * 0x1000000) + placeNo.get(c).get(`${state}\0${city}`);
    })));

    const size = (BLOCK * blocks.length) + tables.length;
    const padded = Math.ceil(size / SECTOR) * SECTOR;
    if (padded > MAX_SIZE) {
        throw new Error(`${(padded / 1e6).toFixed(2)} MB: more than the ${MAX_SIZE >> 20} MB the database may take`);
    }
    const body = new Uint8Array(padded).fill(0xFF);
    blocks.forEach((b, k) => body.set(b, k * BLOCK));
    body.set(tables.bytes(), BLOCK * blocks.length);
    const base = HEADER_AT - padded;

    const header = new Uint8Array(SECTOR).fill(0xFF);
    const h = new DataView(header.buffer);
    header.set([0x4F, 0x44, 0x49, 0x44, 1, 0, 0, 0]); // "ODID", version 1
    [rows.length, blocks.length, countries.length, base, padded, 0, offIndex, offPrefix, offCountries, offDirectory,
        offNames, offOther].forEach((v, k) => h.setUint32(8 + (4 * k), v >>> 0, true));
    header.set(FIELDS.flatMap((k) => classes[k]), 56);
    h.setUint32(76, crc32(body), true);
    return {base, body, header, records: rows.length, countries: countries.length, blocks: blocks.length};
}

// The sectors to write: [{sector, data}], the body from its base, the header last
export function sectors(db) {
    const out = [];
    for (let at = 0; at < db.body.length; at += SECTOR) {
        out.push({sector: (db.base + at) / SECTOR, data: db.body.subarray(at, at + SECTOR)});
    }
    out.push({sector: HEADER_AT / SECTOR, data: db.header});
    return out;
}

/* ---- CRC-32 (zlib's; the radio's 'D' 'K' answers it for a sector) ---- */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}
