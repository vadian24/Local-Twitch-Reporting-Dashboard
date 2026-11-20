# Local Twitch Reporting Dashboard

A standalone desktop app for reporting on public Twitch chat archives. It reuses the report parser and export format from Twitch Subscriber & Cheer Report v1.4.0.

## Download

| Platform | Latest version |
| --- | --- |
| Windows (64-bit) | [Download ZIP](https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/releases/latest/download/Local-Twitch-Reporting-Dashboard-Windows-x64.zip) |
| Linux (64-bit, including Nobara) | [Download TAR.GZ](https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/releases/latest/download/Local-Twitch-Reporting-Dashboard-Linux-x64.tar.gz) |

Extract the archive and keep its files together. Open `Local-Twitch-Reporting-Dashboard.exe` on Windows or `Local-Twitch-Reporting-Dashboard` on Linux. The Windows build is unsigned. You can download earlier versions from the [release archive](https://github.com/vadian24/Local-Twitch-Reporting-Dashboard/releases).

### Linux systems that restrict user namespaces

If Linux reports that the Chromium SUID sandbox helper is misconfigured, use a root-owned installation directory for the extracted app. Run these commands from the extracted Linux bundle directory:

```sh
sudo install -d -m 0755 /opt/local-twitch-reporting-dashboard
sudo cp -a . /opt/local-twitch-reporting-dashboard/
sudo chown -R root:root /opt/local-twitch-reporting-dashboard
sudo chmod -R a+rX /opt/local-twitch-reporting-dashboard
sudo chmod 4755 /opt/local-twitch-reporting-dashboard/chrome-sandbox
```

Open `/opt/local-twitch-reporting-dashboard/Local-Twitch-Reporting-Dashboard` from your file manager as your normal user.

## Run from source

Install Node.js 22.12 or newer (Node.js 24 recommended), then open a terminal in the project folder:

```sh
npm install
npm start
```

The app opens in its own window. On Nobara, run these commands in Konsole from the project folder. An internet connection is required to install dependencies and fetch archived chat.

## Build a launchable desktop app

On the OS where you want to run the app, install the dependencies as above and run:

```sh
npm run package
```

Find the resulting platform-specific folder under `dist/`. Keep all its files together. On Windows, open `Local-Twitch-Reporting-Dashboard.exe`. On Linux, open the `Local-Twitch-Reporting-Dashboard` executable or point a desktop shortcut to it. The packaged app bundles Electron, so running that copy does not require a separate Node.js setup.

## Generate a report

1. Enter a Twitch channel username.
2. Choose a calendar month or a seven-day period starting on a date of your choice. Periods can cross month and year boundaries. For a period in progress, the app checks through today.
3. Select the sections to include, then click **Generate report**. The preview shows totals and expandable detail tables.
4. Choose **TXT** or **CSV** and click **Save report** or **Copy**. You can change the export format without fetching the logs again.

| Section | Contents |
| --- | --- |
| Subscriptions | Subscription events by timestamp, with username and tier or Prime |
| Cheers | One row per cheerer, with summed bits for the period |
| Gifted subs | One row per gifter, with gift totals, number of gifters, and number of gift announcements |
| Unique users | Deduplicated subscribers, cheerers, and gifters, with their activity types |
| Raids | Distinct raiding streamer names |
| Watch streaks | Highest observed streak per user, longest first |
| Archive diagnostics | Dates checked, dates without logs, and request failures |

The dashboard requests one archive day at a time, with delays and retries for temporary errors. A day marked **No archived logs** means the provider returned no daily archive. Other errors are shown separately. Reports reflect the events present in the available archives and use the same notice-matching rules as the extension.

## Data and privacy

The app requests public chat archives from [logs.zonian.dev](https://logs.zonian.dev). Those requests include the channel and requested dates. Reports are generated on your computer, with no Twitch login, app backend, or telemetry. The app remembers the date-range mode, weekly start date, and section selection locally. Reports remain in memory until you close the app, unless you save or copy them.

## Publish a version

Update `version` in `package.json` on `main`, then run **Build and release → Run workflow** in GitHub Actions. The workflow builds and checks the app on both platforms before publishing a release tagged with that version. Each release keeps its own Windows and Linux downloads. Use a new version number for each release.

## Test

```sh
npm test
```
