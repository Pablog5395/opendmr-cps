// The programming cable link to an OpenDMR radio (OpenDMR src/services/cable_link.c), over Web Serial (Chrome, Edge).
//   'R' area(1) address(4 BE) length(2 BE)   -> 'R' length(2 BE) data, or '-'. Area 1: the data flash window,
//                                               9: the radio info
//   'X' 1 sector(3 BE)                       -> 'X' 1: the sector into the radio's buffer
//   'X' 2 address(4 BE) length(2 BE) data    -> 'X' 2: bytes into it
//   'X' 3                                    -> 'X' 3: the buffer to the flash
//   'C' 5 / 'C' 6 n                          -> '-': close the radio's CPS screen / 6 2: save the settings,
//                                               6 1: save them (if changed) and restart
//   'D' 'K' address(4 BE)                    -> 'D' 'K' CRC-32(4 BE) of the window's sector there (firmware 0.4.0)
//   'D' 'S' divisor(2 BE)                    -> 'D' 'S' 1: the radio's UART at 84 MHz / 16 / divisor; 'D' 'Y' at
//                                               it confirms, or it goes back to 115200 after 2 s, and after 5 s
//                                               without a request

import {SECTOR, IGNORED_SECTORS} from '../codeplug/layout.js';

const BAUD = 115200;
const READ_CHUNK = 1024;  // the radio answers up to 1533 bytes a read
const WRITE_CHUNK = 1024; // and takes up to 1528 bytes a write
const TIMEOUT_MS = 2000;
const UART_CLOCK = 84000000 / 16;      // the radio's UART: baud = UART_CLOCK / divisor
const SPEED_DIVISORS = [7, 14, 21];    // 750000, 375000, 250000 baud (12 MHz / n for a CH340 too)
const SPEED_BACK_MS = 2500;            // an unconfirmed speed: the radio is back at 115200 after 2 s
const QUIET_BACK_MS = 5500;            // and after 5 s without a request
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const AREA_FLASH = 1;
const AREA_RADIO_INFO = 9;

export class RadioLink {
    constructor() {
        this.port = null;
        this.reader = null;
        this.buffer = [];
        this.waiter = null;
    }

    static supported() {
        return 'serial' in navigator;
    }

    async open() {
        this.port = await navigator.serial.requestPort();
        await this.port.open({baudRate: BAUD, bufferSize: 8192});
        this.baud = BAUD;
        this.reading = this.readLoop();
    }

    // The same port at another speed (Web Serial sets it only when a port opens)
    async reopen(baud) {
        const port = this.port;
        try {
            await this.reader?.cancel();
            await this.reading;
        } catch (e) {
            // the reader was done
        }
        await port.close().catch(() => {});
        await port.open({baudRate: baud, bufferSize: 8192});
        this.port = port;
        this.baud = baud;
        this.buffer = [];
        this.reading = this.readLoop();
    }

    async close() {
        if (!this.port) {
            return;
        }
        try {
            await this.reader?.cancel();
            await this.reading;
        } catch (e) {
            // the port went away
        }
        await this.port.close().catch(() => {});
        this.port = null;
    }

    get connected() {
        return this.port !== null;
    }

    async readLoop() {
        while (this.port?.readable) {
            this.reader = this.port.readable.getReader();
            try {
                for (;;) {
                    const {value, done} = await this.reader.read();
                    if (done) {
                        return;
                    }
                    for (const b of value) {
                        this.buffer.push(b);
                    }
                    this.waiter?.();
                }
            } catch (e) {
                return;
            } finally {
                this.reader.releaseLock();
            }
        }
    }

    // n bytes of reply; refusable: the start of a reply, where a '-' means the radio refused the request
    async receive(n, refusable = true, timeout = TIMEOUT_MS) {
        const deadline = Date.now() + timeout;
        while ((this.buffer.length < n) && !(refusable && (this.buffer.length > 0) && (this.buffer[0] === 0x2D))) {
            const left = deadline - Date.now();
            if (left <= 0) {
                throw new Error('timeout');
            }
            await new Promise((resolve) => {
                this.waiter = resolve;
                setTimeout(resolve, Math.min(left, 100));
            });
            this.waiter = null;
        }
        if (refusable && (this.buffer[0] === 0x2D) && (n > 1)) {
            this.buffer.splice(0, 1);
            throw new Error('refused');
        }
        return Uint8Array.from(this.buffer.splice(0, n));
    }

    async send(bytes) {
        this.buffer = [];
        const writer = this.port.writable.getWriter();
        try {
            await writer.write(Uint8Array.from(bytes));
        } finally {
            writer.releaseLock();
        }
    }

    async read(area, address, length) {
        await this.send([0x52, area, (address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF,
            address & 0xFF, (length >> 8) & 0xFF, length & 0xFF]);
        const head = await this.receive(3);
        if (head[0] !== 0x52) {
            throw new Error('bad reply');
        }
        const got = (head[1] << 8) | head[2];
        return this.receive(got, false);
    }

    async radioInfo() {
        const d = await this.read(AREA_RADIO_INFO, 0, 0);
        const text = (from, to) => new TextDecoder().decode(d.subarray(from, to)).replace(/\0.*$/, '');
        return {
            structVersion: d[0] | (d[1] << 8),
            radioType: d[4] | (d[5] << 8),
            git: text(8, 24),
            build: text(24, 40),
            flashId: d[40] | (d[41] << 8) | (d[42] << 16),
        };
    }

    // Window bytes [start, end) into img; progress(done, total)
    async readRegion(img, start, end, progress, doneBefore, total) {
        for (let at = start; at < end; at += READ_CHUNK) {
            const n = Math.min(READ_CHUNK, end - at);
            let data;
            for (let attempt = 0; ; attempt++) {
                try {
                    data = await this.read(AREA_FLASH, at, n);
                    break;
                } catch (e) {
                    if (attempt >= 2) {
                        throw e;
                    }
                }
            }
            img.set(data, at);
            progress?.(doneBefore + (at + n - start), total);
        }
    }

    async expect(request, ack) {
        for (let attempt = 0; ; attempt++) {
            await this.send(request);
            try {
                const r = await this.receive(2);
                if (r[0] === ack[0] && r[1] === ack[1]) {
                    return;
                }
                throw new Error('bad reply');
            } catch (e) {
                if (attempt >= 2) {
                    throw e;
                }
            }
        }
    }

    // One 4 KB sector of the window
    async writeSector(sector, data) {
        if (IGNORED_SECTORS.includes(sector)) {
            return;
        }
        await this.expect([0x58, 1, (sector >> 16) & 0xFF, (sector >> 8) & 0xFF, sector & 0xFF], [0x58, 1]);
        for (let off = 0; off < SECTOR; off += WRITE_CHUNK) {
            const address = (sector * SECTOR) + off;
            const n = Math.min(WRITE_CHUNK, SECTOR - off);
            await this.expect([0x58, 2, (address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF,
                address & 0xFF, (n >> 8) & 0xFF, n & 0xFF, ...data.subarray(off, off + n)], [0x58, 2]);
        }
        await this.expect([0x58, 3], [0x58, 3]);
    }

    // The radio's CRC-32 of the window's sector at address ('D' 'K'); null: no answer (a firmware before 0.4.0)
    async sectorCrc(address, attempts = 3) {
        for (let i = 0; i < attempts; i++) {
            try {
                await this.send([0x44, 0x4B, (address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF,
                    address & 0xFF]);
                const r = await this.receive(6, true, 500);
                if (r[0] === 0x44 && r[1] === 0x4B) {
                    return ((r[2] << 24) | (r[3] << 16) | (r[4] << 8) | r[5]) >>> 0;
                }
            } catch (e) {
                if (e.message === 'refused') {
                    return null;
                }
            }
            await sleep(100);
        }
        return null;
    }

    // The fastest speed both ends keep ('D' 'S', confirmed by 'D' 'Y' and four CRCs of probe); 115200 when none
    async speedUp(probe) {
        for (const divisor of SPEED_DIVISORS) {
            const baud = Math.floor(UART_CLOCK / divisor);
            try {
                await this.send([0x44, 0x53, divisor >> 8, divisor & 0xFF]);
                const r = await this.receive(3, true, 500);
                if (r[0] !== 0x44 || r[1] !== 0x53 || r[2] !== 1) {
                    return BAUD;
                }
            } catch (e) {
                return BAUD; // a firmware without it
            }
            await sleep(20);
            await this.reopen(baud);
            await sleep(300);
            let ok = false;
            try {
                await this.send([0x44, 0x59]);
                const r = await this.receive(2, true, 500);
                ok = (r[0] === 0x44 && r[1] === 0x59);
            } catch (e) {
                ok = false;
            }
            for (let i = 0; ok && i < 4; i++) {
                ok = (await this.sectorCrc(probe, 1)) !== null;
            }
            if (ok) {
                return baud;
            }
            await this.reopen(BAUD);
            await sleep(SPEED_BACK_MS);
        }
        return BAUD;
    }

    // Back to 115200: the radio goes back by itself after 5 s without a request
    async speedDown() {
        if (this.baud !== BAUD) {
            await this.reopen(BAUD);
            await sleep(QUIET_BACK_MS);
        }
    }

    async command(...bytes) {
        await this.send([0x43, ...bytes]);
        await this.receive(1).catch(() => {});
    }

    closeScreen() {
        return this.command(5);
    }

    // The radio's settings from its RAM to the flash (they are saved there only when changed in the menus, at power
    // off and before a restart): read after this, the flash has them as the radio uses them; written after this, the
    // restart does not save the old ones over them
    saveSettings() {
        return this.command(6, 2);
    }

    restart() {
        return this.command(6, 1);
    }
}
