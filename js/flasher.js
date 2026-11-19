// The flasher page: firmware update over the programming cable, and the three backups of the radio (the codeplug, the
// program flash, the whole data flash). The update is tools/debug/fw_update.py in the browser; the backups are
// tools/backup/dm32_dump.py, through the chip bootloader (radio off, then switched on).

import {t} from './i18n.js';
import {icon} from './icons.js';
import {RawPort} from './radio/serial.js';
import {Updater, prepareImage} from './radio/updater.js';
import {Bootloader, CHIP_DATA, CHIP_PROGRAM} from './radio/bootloader.js';
import {sources, updaterImage, dumperImage} from './radio/assets.js';
import * as L from './codeplug/layout.js';

const PROGRAM_SIZE = 1 << 20;          // the GD25Q80
const DATA_SIZE = 16 << 20;            // the 25Q128
const FIRMWARE_BASE = 0xC000;          // where opendmr.bin starts in the program flash

// The firmware the package's page carries (make_package.py puts it before the page's own script): {name, b64}. The
// repo's page has none, and the flasher asks for a file as before.
function packageFirmware() {
    try {
        const fw = typeof window !== 'undefined' ? window.__OPENDMR_FIRMWARE : null;
        if (!fw?.b64) {
            return null;
        }
        const bin = atob(fw.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }
        return {name: fw.name || 'opendmr.bin', size: bytes.length, image: prepareImage(bytes)};
    } catch (e) {
        console.warn('the packaged firmware is not usable:', e);
        return null;
    }
}

// The firmware in the page's own folder (a web server, py serve.py, tools/web/make_folder.py): firmware/index.json
// lists it. Nothing to look for either: it is loaded and offered as the one to write.
async function folderFirmware() {
    try {
        const root = (typeof document !== 'undefined' && document.baseURI) ? document.baseURI : null;
        if (!root || typeof fetch !== 'function') {
            return null;
        }
        const index = await fetch(new URL('firmware/index.json', root), {cache: 'no-store'});
        if (!index.ok) {
            return null;
        }
        const list = await index.json();
        const first = list?.[0];
        if (!first?.name) {
            return null;
        }
        const reply = await fetch(new URL('firmware/' + encodeURIComponent(first.name), root), {cache: 'no-store'});
        if (!reply.ok) {
            return null;
        }
        const bytes = new Uint8Array(await reply.arrayBuffer());
        return {name: first.name, size: bytes.length, image: prepareImage(bytes)};
    } catch (e) {
        return null;
    }
}

// deps: {el, pageHead, toast, status, progress, getLink, getRadio, disconnect, rerender}
export function createFlasher(deps) {
    const {el, pageHead, toast, status, progress, getLink, getRadio, disconnect, rerender} = deps;
    const state = {
        busy: false,
        firmware: null,      // {name, size, image}
        fromPackage: false,  // the firmware comes inside the page (the package's): no file to look for
        assetSource: null,   // 'assets' or 'embedded', once the page knows
        assetLoading: false,
        firmwareTried: false,
    };

    // The package's page (tools/web/make_package.py) carries the firmware in window.__OPENDMR_FIRMWARE
    const included = packageFirmware();
    if (included) {
        state.firmware = included;
        state.fromPackage = true;
    }

    function download(name, data) {
        const blob = new Blob([data], {type: 'application/octet-stream'});
        const url = (typeof URL.createObjectURL === 'function') ? URL.createObjectURL(blob) : dataUrl(data);
        const a = el('a', {href: url, download: name});
        document.body.append(a);
        a.click();
        setTimeout(() => {
            if (typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(url);
            }
            a.remove();
        }, 1000);
    }

    // A browser without createObjectURL (an old one, or a test): the bytes as a data URL
    function dataUrl(data) {
        let text = '';
        for (let i = 0; i < data.length; i += 0x8000) {
            text += String.fromCharCode(...data.subarray(i, i + 0x8000));
        }
        return 'data:application/octet-stream;base64,' + btoa(text);
    }

    // the two radio-side programs, whichever copy the page has (assets/ or embedded): the file to keep or to put in assets/
    async function downloadBin(name, loader) {
        try {
            const data = await loader();
            download(name, data);
            toast(`${name}: ${data.length} bytes`, 4000);
        } catch (e) {
            toast(t('error') + ': ' + (e?.message || e), 8000);
        }
    }

    function radioName() {
        const info = getRadio();
        return (info?.git || 'opendmr').replace(/[^\w.-]+/g, '_');
    }

    function card(title, intro, ...body) {
        return el('div', {class: 'card form-card'},
            el('h3', {class: 'card-title'}, title),
            intro ? el('p', {class: 'muted'}, intro) : null,
            ...body);
    }

    function busyGuard(fn) {
        return async (...args) => {
            if (state.busy) {
                toast(t('flBusy'));
                return;
            }
            state.busy = true;
            progress(0, 0);
            try {
                await fn(...args);
            } catch (e) {
                toast(t('error') + ': ' + (e?.message || e), 8000);
                status(t('error'));
            } finally {
                state.busy = false;
                progress(0, 0);
            }
        };
    }

    // The cable port for an update or a bootloader read, without a prompt when the CPS already has it. Called in the
    // click itself: the port chooser needs the user's gesture, which waiting first may have used up
    function portForAction() {
        if (!RawPort.supported()) {
            throw new Error(t(window.isSecureContext ? 'noSerial' : 'serialNeedsLocal'));
        }
        const link = getLink();
        if (link?.connected) {
            const port = link.port;
            return (async () => {
                await link.close().catch(() => {});
                disconnect?.();
                return port;
            })();
        }
        return navigator.serial.requestPort();
    }

    function withPort(action) {
        if (state.busy) {
            toast(t('flBusy'));
            return;
        }
        let port;
        try {
            port = portForAction();
        } catch (e) {
            toast(t('error') + ': ' + e.message, 8000);
            return;
        }
        action(port);
    }

    /* ---- firmware update ---- */

    async function pickFirmware(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const image = prepareImage(bytes); // throws when not an OpenDMR firmware with the loader
        state.firmware = {name: file.name, size: bytes.length, image};
    }

    const doUpdate = busyGuard(async (portPromise, force) => {
        if (!state.firmware) {
            toast(t('flPickFirmware'));
            return;
        }
        const updater = new Updater(await portPromise);
        try {
            status(t('flUpdating'));
            await updater.open();
            const written = await updater.writeImage(state.firmware.image, (done, total) => {
                status(`${t('flUpdating')} ${done} / ${total}`);
                progress(done, total);
            }, force);
            disconnect?.();
            status(`${t('flUpdateDone')} (${written} × 4 KB)`);
            toast(t('flUpdateDone'), 6000);
        } finally {
            await updater.close().catch(() => {});
        }
    });

    /* ---- backups ---- */

    const doCodeplug = busyGuard(async () => {
        const link = getLink();
        if (!link?.connected) {
            throw new Error(t('flConnectFirst'));
        }
        const img = new Uint8Array(L.IMAGE_SIZE).fill(0xFF);
        const total = L.REGIONS.reduce((n, r) => n + (r.end - r.start), 0);
        let done = 0;
        status(t('reading'));
        for (const r of L.REGIONS) {
            await link.readRegion(img, r.start, r.end, progress, done, total);
            done += r.end - r.start;
        }
        download(`${radioName()}-codeplug.bin`, img);
        status(t('flBackupDone'));
        toast(t('flBackupDone'), 5000);
    });

    async function bootloaderBackup(portPromise, chip, name) {
        const boot = new Bootloader(await portPromise);
        try {
            await boot.open();
            status(t('flSwitchOffOn'));
            const result = await boot.dump(chip, (done, total) => {
                status(`${t('flReading')} ${done} / ${total} (${Math.round(100 * done / total)}%)`);
                progress(done, total);
            }, null, () => status(t('flSwitchOffOn')));
            download(name, result.data);
            status(t('flBackupDone'));
            toast(t('flBackupDone'), 5000);
        } finally {
            await boot.close().catch(() => {});
        }
    }

    const doProgram = busyGuard(async (portPromise) => {
        await bootloaderBackup(portPromise, CHIP_PROGRAM, `${radioName()}-programa.bin`);
    });

    const doData = busyGuard(async (portPromise) => {
        await bootloaderBackup(portPromise, CHIP_DATA, `${radioName()}-datos-25q128.bin`);
    });

    const doRestore = busyGuard(async (portPromise, file, chip, expect) => {
        const boot = new Bootloader(await portPromise);
        try {
            await boot.open();
            status(t('flSwitchOffOn'));
            await boot.prepare(() => status(t('flSwitchOffOn')));
            const data = new Uint8Array(await file.arrayBuffer());
            if (!data.length || (data.length % 4096)) {
                throw new Error(t('flBadBackup'));
            }
            if (chip === CHIP_PROGRAM && expect === 'image' && data.length === PROGRAM_SIZE) {
                throw new Error(t('flWrongFileImage'));
            }
            if (chip === CHIP_PROGRAM && expect === 'backup' && data.length !== PROGRAM_SIZE) {
                throw new Error(t('flWrongFileFactory'));
            }
            const offset = (chip === CHIP_PROGRAM && data.length !== PROGRAM_SIZE) ? FIRMWARE_BASE : 0;
            const written = await boot.restore(chip, data, {
                offset,
                onBlock: (done, total) => {
                    status(`${t('flWriting')} ${done} / ${total}`);
                    progress(done, total);
                },
            });
            status(`${t('flRestoreDone')} (${written})`);
            toast(t('flRestoreDone'), 6000);
        } finally {
            await boot.close().catch(() => {});
        }
    });

    /* ---- the page ---- */

    function view(main) {
        const fwInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        fwInput.addEventListener('change', async () => {
            const file = fwInput.files[0];
            fwInput.value = '';
            if (!file) {
                return;
            }
            try {
                await pickFirmware(file);
                state.fromPackage = false;
                toast(`${state.firmware.name}: ${(state.firmware.size / 1024).toFixed(0)} KB`, 4000);
                rerender();
            } catch (e) {
                toast(t('error') + ': ' + e.message, 8000);
            }
        });
        let progExpect = 'image'; // what the program flash picker is for: the firmware, or the 1 MB backup
        const progInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        progInput.addEventListener('change', () => {
            const file = progInput.files[0];
            progInput.value = '';
            if (file) {
                withPort((port) => doRestore(port, file, CHIP_PROGRAM, progExpect));
            }
        });
        const dataInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        dataInput.addEventListener('change', () => {
            const file = dataInput.files[0];
            dataInput.value = '';
            if (file) {
                withPort((port) => doRestore(port, file, CHIP_DATA, 'backup'));
            }
        });

        // the firmware of the folder (served): offered without picking a file, as the package's page does
        if (!state.firmware && !state.firmwareTried) {
            state.firmwareTried = true;
            folderFirmware().then((found) => {
                if (found) {
                    state.firmware = found;
                    state.fromPackage = true;
                    rerender();
                }
            });
        }

        // the radio-side program: the file in assets/ when the page is served from a folder, the embedded copy from disk
        if (!state.assetSource && !state.assetLoading) {
            state.assetLoading = true;
            updaterImage().then(() => {
                state.assetLoading = false;
                state.assetSource = sources['assets/updater.bin'] ?? null;
                rerender();
            }).catch(() => {
                state.assetLoading = false;
            });
        }

        main.append(pageHead(t('flasher')),
            el('div', {class: 'general-cards'},
                card(t('flUpdateCard'), t('flUpdateIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {class: 'primary', disabled: !state.firmware,
                            onclick: () => withPort((p) => doUpdate(p, false))}, icon('upload'), t('flUpdate')),
                        el('button', {disabled: !state.firmware, onclick: () => withPort((p) => doUpdate(p, true))},
                            icon('upload'), t('flInstallAll')),
                        el('button', {class: 'ghost', onclick: () => fwInput.click()}, icon('open'), t('flUseOther'))),
                    el('p', {class: 'muted'}, state.firmware
                        ? (state.fromPackage ? `${t('flFirmwareIncluded')}: ` : '') +
                          `${state.firmware.name} · ${(state.firmware.size / 1024).toFixed(0)} KB`
                        : t('flNoFirmware')),
                    state.fromPackage ? el('p', {class: 'muted id-hint'}, t('flFirmwareIncludedHint')) : null,
                    el('p', {class: 'muted id-hint'}, t('flUpdateHint')),
                    el('p', {class: 'muted id-hint'}, t('flFirmwareInFolder')),
                    state.assetSource ? el('p', {class: 'muted id-hint'},
                        t(state.assetSource === 'assets' ? 'flProgramsFiles' : 'flProgramsEmbedded')) : null),
                card(t('flBackupCard'), t('flBackupIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: doCodeplug}, icon('download'), t('flBackupCodeplug')),
                        el('button', {onclick: () => withPort(doProgram)}, icon('download'), t('flBackupProgram')),
                        el('button', {onclick: () => withPort(doData)}, icon('download'), t('flBackupData'))),
                    el('p', {class: 'muted id-hint'}, t('flBackupHint')),
                    el('dl', {class: 'info'},
                        el('dt', {}, t('flBackupCodeplug')), el('dd', {}, t('flBackupCodeplugWhat')),
                        el('dt', {}, t('flBackupProgram')), el('dd', {}, t('flBackupProgramWhat')),
                        el('dt', {}, t('flBackupData')), el('dd', {}, t('flBackupDataWhat')))),
                card(t('flBootCard'), t('flBootIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: () => {
                            progExpect = 'image';
                            progInput.click();
                        }}, icon('upload'), t('flInstallStock')),
                        el('button', {onclick: () => {
                            progExpect = 'backup';
                            progInput.click();
                        }}, icon('upload'), t('flFactoryProgram')),
                        el('button', {onclick: () => dataInput.click()}, icon('upload'), t('flFactoryData'))),
                    el('p', {class: 'muted id-hint'}, t('flFactoryFile')),
                    el('p', {class: 'muted id-hint'}, t('flFactoryHint'))),
                card(t('flProgramsCard'), t('flProgramsIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: () => downloadBin('updater.bin', updaterImage)}, icon('download'),
                            `updater.bin · ${t('flDownload')}`),
                        el('button', {onclick: () => downloadBin('dumper.bin', dumperImage)}, icon('download'),
                            `dumper.bin · ${t('flDownload')}`)),
                    el('p', {class: 'muted'}, state.assetSource === 'assets'
                        ? t('flProgramsFiles') : state.assetSource === 'embedded' ? t('flProgramsEmbedded') : ''),
                    el('p', {class: 'muted'},
                        el('a', {href: 'https://github.com/va3bpf/OpenDMR/releases', target: '_blank', rel: 'noopener'},
                            t('flFirmwareLink'))),
                    el('p', {class: 'muted id-hint'}, t('flFirmwareLinkHint')),
                    el('p', {class: 'muted id-hint'}, t('flProgramsHint'))),
                card(t('flNotesCard'),
                    el('ul', {class: 'fl-notes'},
                        el('li', {}, t('flNote1')),
                        el('li', {}, t('flNote2')),
                        el('li', {}, t('flNote3')),
                        el('li', {}, t('flNote4'))))),
            fwInput, progInput, dataInput);
    }

    return {view};
}
