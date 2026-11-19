// The flasher page: firmware update over the programming cable, and the three backups of the radio (the codeplug, the
// program flash, the whole data flash). The update is tools/debug/fw_update.py in the browser; the backups are
// tools/backup/dm32_dump.py, through the chip bootloader (radio off, then switched on).

import {t} from './i18n.js';
import {icon} from './icons.js';
import {RawPort} from './radio/serial.js';
import {Updater, prepareImage} from './radio/updater.js';
import {Bootloader, CHIP_DATA, CHIP_PROGRAM} from './radio/bootloader.js';
import * as L from './codeplug/layout.js';

const PROGRAM_SIZE = 1 << 20;          // the GD25Q80
const DATA_SIZE = 16 << 20;            // the 25Q128
const FIRMWARE_BASE = 0xC000;          // where opendmr.bin starts in the program flash

// deps: {el, pageHead, toast, status, progress, getLink, getRadio, disconnect, rerender}
export function createFlasher(deps) {
    const {el, pageHead, toast, status, progress, getLink, getRadio, disconnect, rerender} = deps;
    const state = {
        busy: false,
        firmware: null,      // {name, size, image}
    };

    function download(name, data) {
        const blob = new Blob([data], {type: 'application/octet-stream'});
        const a = el('a', {href: URL.createObjectURL(blob), download: name});
        document.body.append(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 1000);
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

    const doRestore = busyGuard(async (portPromise, file, chip) => {
        const boot = new Bootloader(await portPromise);
        try {
            await boot.open();
            status(t('flSwitchOffOn'));
            await boot.prepare(() => status(t('flSwitchOffOn')));
            const data = new Uint8Array(await file.arrayBuffer());
            if (!data.length || (data.length % 4096)) {
                throw new Error(t('flBadBackup'));
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
                toast(`${state.firmware.name}: ${(state.firmware.size / 1024).toFixed(0)} KB`, 4000);
                rerender();
            } catch (e) {
                toast(t('error') + ': ' + e.message, 8000);
            }
        });
        const progInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        progInput.addEventListener('change', () => {
            const file = progInput.files[0];
            progInput.value = '';
            if (file) {
                withPort((port) => doRestore(port, file, CHIP_PROGRAM));
            }
        });
        const dataInput = el('input', {type: 'file', accept: '.bin,application/octet-stream', hidden: true});
        dataInput.addEventListener('change', () => {
            const file = dataInput.files[0];
            dataInput.value = '';
            if (file) {
                withPort((port) => doRestore(port, file, CHIP_DATA));
            }
        });

        main.append(pageHead(t('flasher')),
            el('div', {class: 'general-cards'},
                card(t('flUpdateCard'), t('flUpdateIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: () => fwInput.click()}, icon('open'), t('flChooseFile')),
                        el('button', {class: 'primary', disabled: !state.firmware, onclick: () => withPort((p) => doUpdate(p, false))},
                            icon('upload'), t('flUpdate')),
                        el('button', {disabled: !state.firmware, onclick: () => withPort((p) => doUpdate(p, true))},
                            icon('upload'), t('flUpdateAll'))),
                    el('p', {class: 'muted'}, state.firmware
                        ? `${state.firmware.name} · ${(state.firmware.size / 1024).toFixed(0)} KB`
                        : t('flNoFirmware')),
                    el('p', {class: 'muted id-hint'}, t('flUpdateHint'))),
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
                card(t('flRestoreCard'), t('flRestoreIntro'),
                    el('div', {class: 'id-sources'},
                        el('button', {onclick: () => progInput.click()}, icon('upload'), t('flRestoreProgram')),
                        el('button', {onclick: () => dataInput.click()}, icon('upload'), t('flRestoreData'))),
                    el('p', {class: 'muted id-hint'}, t('flRestoreHint'))),
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
