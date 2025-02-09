import { app, BrowserWindow, dialog, ipcMain, Notification, autoUpdater as nativeUpdater } from "electron";
import { autoUpdater, UpdateCheckResult } from "electron-updater";
import * as semver from "semver";
import { Server } from "@server";
import { SERVER_UPDATE, SERVER_UPDATE_DOWNLOADING, SERVER_UPDATE_INSTALLING } from "@server/events";

export class UpdateService {
    window: BrowserWindow;

    timer: NodeJS.Timeout;

    currentVersion: string;

    isOpen: boolean;

    hasUpdate = false;

    updateInfo: UpdateCheckResult;

    constructor(window: BrowserWindow) {
        // This won't work in dev-mode because it checks Electron's Version
        this.currentVersion = app.getVersion();
        this.isOpen = false;
        this.window = window;

        // Correct current version if needed
        if (this.currentVersion.split(".").length > 3) {
            this.currentVersion = semver.coerce(this.currentVersion).format();
        }

        const autoUpdate = Server().repo.getConfig("auto_install_updates") as boolean;
        if (autoUpdate) {
            autoUpdater.autoDownload = true;
            autoUpdater.autoInstallOnAppQuit = true;
        } else {
            autoUpdater.autoDownload = false;
            autoUpdater.autoInstallOnAppQuit = false;
        }

        autoUpdater.on("update-downloaded", async (_) => {
            Server().log("Installing update...");
            await Server().emitMessage(SERVER_UPDATE_INSTALLING, null);
            autoUpdater.quitAndInstall();
        });

        ipcMain.handle("install-update", async (_, __) => {
            Server().log("Downloading update...");
            await Server().emitMessage(SERVER_UPDATE_DOWNLOADING, null);
            autoUpdater.downloadUpdate().then(() => {
                Server().log("Finished downloading update...");    
            });
        });
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(async () => {
            if (this.hasUpdate) return;

            await this.checkForUpdate();
        }, 1000 * 60 * 60 * 12); // Default 12 hours
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
    }

    async checkForUpdate({ showNoUpdateDialog = false, showUpdateDialog = true } = {}): Promise<boolean> {
        const res = await autoUpdater.checkForUpdates();
        this.hasUpdate = !!res?.updateInfo && semver.lt(this.currentVersion, res.updateInfo.version);
        this.updateInfo = res;

        if (this.hasUpdate) {
            Server().emitMessage(SERVER_UPDATE, res.updateInfo.version);
            Server().emitToUI("update-available", res.updateInfo.version);
            Server().emit("update-available", res.updateInfo.version)

            if (showUpdateDialog) {
                const notification = {
                    title: "BlueBubbles Update Available!",
                    body: `BlueBubbles macOS Server v${res.updateInfo.version} is now available to be installed!`
                };
                new Notification(notification).show();
            }
        }

        if (!this.hasUpdate && showNoUpdateDialog) {
            const dialogOpts = {
                type: "info",
                title: "BlueBubbles Update",
                message: "You have the latest version installed!",
                detail: `You are running the latest version of BlueBubbles! v${this.currentVersion}`
            };

            dialog.showMessageBox(this.window, dialogOpts);
        }

        return this.hasUpdate;
    }
}
