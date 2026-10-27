# Πώς δημοσιεύεις το `codeitlab` στο npm

Οδηγός για το δικό μας package **`codeitlab`** (αντί για το upstream `codeitlab`), με
όλα τα paths και τα βήματα. Το package είναι launcher: δεν περιέχει τον server,
κατεβάζει/τρέχει το CLI της εγκατεστημένης εφαρμογής (βλ.
`release/verification/npm-package.md`).

## 0. Τι χρειάζεσαι

- npm account με **verified email** και **2FA** ενεργό.
- Node `^24.13.1` και pnpm `11.10.0` (ή `corepack enable`).
- Το repo: `/Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab`
- **Git remote**: `origin` = `https://github.com/rumbis/codeitlab.git` (το
  upstream `rumbis/codeitlab` μένει στο remote `upstream`). Για άλλο repo:
  `git remote set-url origin https://github.com/<user>/<repo>.git`.
  Το clone είναι **shallow**, οπότε το push γίνεται ως parentless snapshot
  (`git commit-tree` + `--force-with-lease`), όχι ως κανονικό fast-forward· το
  `main` είναι κάθε φορά ένα root commit με το τρέχον tree.

- Ο launcher κατεβάζει τα archives από
  `https://github.com/rumbis/codeitlab/releases/download` (default,
  `scripts/npm-launcher/codeitlab.mjs:98`). Αν το repo σου δεν είναι
  `rumbis/codeitlab`, όρισέ το:

  ```bash
  export CIL_RELEASE_BASE_URL=https://github.com/<user>/<repo>/releases/download
  ```

## 0.5 Ένα command (build → dry-run → publish)

```bash
cd /Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab

./scripts/publish-codeitlab-cli.sh --dry-run    # build + dry-run, δεν δημοσιεύει
./scripts/publish-codeitlab-cli.sh              # build + dry-run + confirm + publish
./scripts/publish-codeitlab-cli.sh --yes --otp 123456   # χωρίς prompt, με 2FA
./scripts/publish-codeitlab-cli.sh --tag nightly --version 0.2.0-nightly.1
```

Για το `0.2.0` αυτό είναι το επιβεβαιωμένο fallback: το `--dry-run` χτίζει
`codeitlab@0.2.0` (`7 files`) και τυπώνει `+ codeitlab@0.2.0` χωρίς auth. Θέλει
μόνο `npm login` (ή automation token) πριν το σκέτο `--yes`.

Ή `pnpm publish:cli -- --dry-run`. Flags: `--version`, `--tag`, `--otp`,
`--provenance` (μόνο CI), `--dry-run`, `--yes`, `--skip-build`, `--output-dir`.
Το script χτίζει με `scripts/build-npm-launcher.ts`, ελέγχει `npm whoami`,
κάνει πάντα dry-run πρώτα, ζητά confirmation και μετά `npm publish` +
`npm view` verification.

## 1. Πρώτο publish (χειροκίνητα — μία φορά)

Το trusted publishing χρειάζεται υπάρχον package, οπότε το πρώτο publish γίνεται
από το laptop σου.

```bash
cd /Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab

# 1) Χτίσε το package tree + tarball
node scripts/build-npm-launcher.ts build-codeitlab-cli-package \
  --version 0.1.0 \
  --output-dir /tmp/npm-packages
# → /tmp/npm-packages/codeitlab/  και  /tmp/npm-packages/codeitlab.tgz

# 2) Login (ανοίγει browser, 2FA)
npm login
npm whoami

# 3) Είναι ελεύθερο το όνομα;
npm view codeitlab version || echo "free (404)"
```

Dry-run (δεν δημοσιεύει):

```bash
node apps/server/scripts/cli.ts publish \
  --package-name codeitlab \
  --packages-dir /tmp/npm-packages \
  --dry-run --verbose
```

Κανονικό publish:

```bash
node apps/server/scripts/cli.ts publish \
  --package-name codeitlab \
  --packages-dir /tmp/npm-packages \
  --tag latest
```

Ισοδύναμα, απευθείας με npm (αν προτιμάς):

```bash
npm publish --access public --tag latest /tmp/npm-packages/codeitlab.tgz
# αν ζητήσει 2FA: --otp=123456
```

> Τοπικά **μην** βάλεις `--provenance` — το provenance απαιτεί OIDC (GitHub
> Actions). Το CI το προσθέτει μόνο του.

Έλεγχος μετά το publish:

```bash
npm view codeitlab version dist-tags
npm view codeitlab@latest dist.tarball
npm owner ls codeitlab

# από καθαρό φάκελο:
cd /tmp && npx --yes codeitlab --version
# codeitlab v0.2.0  (αν υπάρχει release archive· αλλιώς βλ. §4)
```

## 1.5 Πρώτα το GitHub repo (GitHub Desktop)

Η §1.5–§1.7 καταγράφουν το **πρώτο** publish (`0.1.0`, 2026-10-23) και τα tags
του (`v0.1.0`) που σήμερα έχουν διαγραφεί — για νέα version ακολούθησε το §3.

Το npm package δεν χρειάζεται repo, αλλά το trusted publishing, τα release
archives (`npx codeitlab` εκτός checkout) και το CI publish χρειάζονται ένα
GitHub repo. Το τοπικό repo είναι έτοιμο (branch `main`, commit, tag `v0.1.0`).

> Το org `codeitlab` στο GitHub ανήκει σε άλλον (`CodeITLab`) — μη το
> χρησιμοποιήσεις. Το δικό μας repo είναι **`rumbis/codeitlab`**.

1. GitHub Desktop → **File → Add Local Repository** →
   `/Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab`
2. **Publish repository** (πάνω δεξιά):
   - Name: `codeitlab`
   - Owner: `rumbis` (προσωπικό account)
   - «Keep this code private» όπως θέλεις — το trusted publishing δουλεύει και
     με private repo
3. **Push origin** (το GitHub Desktop δημιουργεί το `origin` μόνο του· το παλιό
   upstream remote έχει μετονομαστεί σε `upstream`).
4. Στείλε το tag (το GitHub Desktop δεν push-άρει tags) — από terminal:

   ```bash
   cd /Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab
   git push origin main v0.1.0
   ```

   ή φτιάξε Release στο GitHub UI με tag `v0.1.0`.

## 1.7 Τι έγινε στο πρώτο publish (2026-10-23)

- Το npm δημιουργεί αυτόματα ένα **placeholder** `0.0.0-stage` (stub, όχι
  installable) όταν γίνεται πρώτο publish νέου ονόματος με web-2FA· το
  πραγματικό `0.1.0` εμφανίστηκε στο registry ~3 λεπτά μετά.
- Καθάρισέ το προαιρετικά (θέλει 2FA):
  `npm unpublish codeitlab@0.0.0-stage`
- Αν το `npm view` δείχνει παλιά δεδομένα: `npm view codeitlab version --prefer-online`
  ή καθάρισε cache (`npm cache clean --force`).

## 2. Trusted publisher (για να δημοσιεύει το CI χωρίς token)

1. Άνοιξε `https://www.npmjs.com/package/codeitlab` → **Settings** →
   **Trusted publishing**.
2. Πρόσθεσε **GitHub Actions**:
   - Repository: `rumbis/codeitlab`
   - Workflow file: **`.github/workflows/publish-cli.yml`** (όχι `release.yml` —
     το job `publish_cli` του `release.yml` είναι gated σε
     `github.repository == 'rumbis/codeitlab'` και δεν τρέχει σε fork)
   - Environment: κενό
3. Αποθήκευσε. Το `publish-cli.yml` έχει ήδη `permissions: id-token: write` και
   τρέχει `cli.ts publish --package-name codeitlab --provenance`, οπότε μετά από
   αυτό το βήμα το publish γίνεται **χωρίς token** (`npm login` δεν χρειάζεται).

## 3. Κανονικό release από το CI

Το trigger του fork είναι tag **`cli-v<version>`** — το σκέτο `v<version>` είναι
το release/archives tag, όχι το build signal. Για νέα version:

```bash
cd /Users/rumbis/Documents/deepseek-harness/default-workspace/codeitlab
node scripts/update-release-package-versions.ts 0.3.0   # apps/server, apps/desktop, apps/web, packages/contracts
# + τα defaults του release-cli-archives.yml στο ίδιο νούμερο
git commit -am "chore(release): cut 0.3.0"
git push origin HEAD
git tag cli-v0.3.0 && git push origin cli-v0.3.0
```

Από το ίδιο tag ξεκινούν δύο workflows:

1. **`publish-cli.yml`** — `build-npm-launcher.ts build-codeitlab-cli-package
--version <version>` και μετά `cli.ts publish --package-name codeitlab --tag
latest --provenance`. Χωρίς trusted publisher (§2) ή token το job κοκκινίζει
   με `ENEEDAUTH`/`401` — το ξανατρέχεις όταν στήσεις το §2, χωρίς νέο tag.
2. **`release-cli-archives.yml`** — 4 native builds και attach στο release
   `v<version>` (το δημιουργεί με `gh release create` αν λείπει). Δεν θέλει
   κανένα secret.

**Τρέχουσα κατάσταση (2026-10-27):** η σελίδα Releases έχει **μία** release, την
**`v0.2.0`** — 5 assets (4 archives + 4-line `SHA256SUMS`), run **40430388529**
πράσινο (4/4 build legs + attach). Το `Publish CLI to npm` run **40430388743**
έφτιαξε το `codeitlab@0.2.0` tarball (step 6 πράσινο) και σταμάτησε στο
`ENEEDAUTH` (step 7). Άρα **δεν χρειάζεται νέο tag**: στήσε το §2 και κάνε
Re-run failed jobs στο 40430388743. Το npm `latest` δείχνει ακόμα `0.1.0`· μόλις
ανέβει το `0.2.0` κλείνει η μόνη εκκρεμότητα.

Οι releases **`v0.1.0` και `v0.1.1` διαγράφηκαν** μαζί με τα tags τους
(`v0.1.0`, `v0.1.1`, `cli-v0.1.0`, `cli-v0.1.1`), ώστε το "τι κατεβάζω" να έχει
μία απάντηση. Κόστος: το δημοσιευμένο `codeitlab@0.1.0` καρφιτσώνει
`.../releases/download/v0.1.0/cil-0.1.0-*`, οπότε το `npx codeitlab@0.1.0` βγάζει
404 μέχρι να ανέβει το `0.2.0` στο npm — και το σκέτο `npx codeitlab` αποτυγχάνει
στον ίδιο 404, γιατί το npm `latest` δείχνει ακόμα `0.1.0`. Το `install.sh`
παίρνει πάντα τη νεότερη release και δουλεύει κανονικά (δοκιμασμένο μετά τη
διαγραφή: εγκατέστησε `0.2.0`).

Για nightly / preview τρέξε το `publish-cli.yml` χειροκίνητα (Actions → Run
workflow) με `version` = `0.2.0-nightly.1` και `dist_tag` = `nightly`.

## 4. Release archives — για να δουλεύει `npx codeitlab` εκτός repo

Ο launcher ψάχνει με αυτή τη σειρά:

1. `CIL_CLI_PATH` (π.χ. `apps/server/dist/bin.mjs`),
2. `<CodeItLab home>/runtime/versions/<version>`,
3. download από `CIL_RELEASE_BASE_URL` + `SHA256SUMS`,
4. το checkout από όπου τρέχει (`apps/server/dist/bin.mjs`).

### Τι υπάρχει στα Releases

Το τρέχον release είναι το **`v0.2.0`** (5 assets, μόνο τα ονόματα του launcher):

| Asset (v0.2.0)                        | Πλατφόρμα                   | Bytes      |
| ------------------------------------- | --------------------------- | ---------- |
| `codeitlab-0.2.0-darwin-arm64.tar.gz` | macOS Apple Silicon         | 83,251,361 |
| `codeitlab-0.2.0-linux-x64.tar.gz`    | Linux x86_64 (glibc)        | 95,347,040 |
| `codeitlab-0.2.0-linux-arm64.tar.gz`  | Linux arm64 (glibc)         | 91,049,819 |
| `codeitlab-0.2.0-win32-x64.zip`       | Windows x86_64              | 86,210,688 |
| `SHA256SUMS`                          | 4 γραμμές, μόνο τα παραπάνω | 398        |

Κάθε release έχει **μία** γενιά ονομάτων: το δημοσιευμένο npm package και τα
archives συμφωνούν. Το `v0.1.0` ήταν η εξαίρεση — κρατούσε και legacy
`cil-0.1.0-*` assets για το `codeitlab@0.1.0` που ψάχνει ακόμα
`cil-<version>-...` — και διαγράφηκε μαζί με το `v0.1.1` (βλ. §3).

Τα ονόματα ακολουθούν το `process.platform`-`process.arch` του launcher, γι'
αυτό Windows = `win32-x64` (όχι `win-x64`).

### Πώς ξαναχτίζονται (χωρίς secrets)

`.github/workflows/release-cli-archives.yml` — native build σε 4 runners
(`macos-14`, `ubuntu-24.04`, `ubuntu-24.04-arm`, `windows-2025`):

- Node 26 + `pnpm install --frozen-lockfile`,
- `cargo build --release` για το resource monitor,
- web build + `cli.ts build` + `cli.ts build-exe` (SEA),
- `scripts/build-cli-archive.ts` → archive,
- hash **των πραγματικών αρχείων** που ανεβαίνουν → `SHA256SUMS`,
- `gh release upload --clobber`.

Τρέξιμο: Actions → **Release CLI archives** → Run workflow (`version`,
`release_tag`) ή push tag `cli-v*`. Δεν χρειάζεται κανένα signing secret· το
macOS παίρνει ad-hoc υπογραφή.

Παγίδες που λύθηκαν μία φορά:

- Το staged runtime install δεν έχει lockfile, οπότε το `^1.2.0-beta.15` του
  `node-pty` τραβούσε νεότερη version και το pnpm έσκαγε με
  `ERR_PNPM_UNUSED_PATCH`. Το `apps/server/package.json` το καρφώνει πλέον στο
  `1.2.0-beta.15`.
- Το `SHA256SUMS` υπολογίζεται στο publish job από τα αρχεία (όχι από
  per-job checksums), ώστε να μη διαφωνεί ποτέ με το ανεβασμένο archive.
- Ένα **tracked** archive μέσα στο `release-cli/` μολύνει κάθε leg: το
  `upload-artifact` σηκώνει ό,τι υπάρχει στον φάκελο, οπότε το `SHA256SUMS`
  αποκτά γραμμή για αρχείο που κανένα build δεν έφτιαξε. Το `release-cli/`
  και το `cli-resource-monitor/` είναι πλέον στο `.gitignore`, το
  `upload-artifact`/`gh release upload` παίρνουν μόνο `release-cli/codeitlab-*`,
  και το checksum step σκάει με `::error::` αν δει άλλο όνομα.

### Τοπικό build (μόνο macOS arm64)

```bash
# 1) official Node 26 (το Homebrew Node δεν έχει --build-sea)
# 2) web + server bundle
pnpm --filter @codeitlab/web build && node apps/server/scripts/cli.ts build
# 3) SEA executable
node apps/server/scripts/cli.ts build-exe --target darwin-arm64
cp apps/server/dist-exe/cil-darwin-arm64 apps/server/dist-exe/codeitlab
# 4) archive (το resource monitor πρέπει να υπάρχει)
node scripts/build-cli-archive.ts --platform mac --arch arm64 --version 0.2.0 \
  --resource-monitor-dir /tmp/cli-resource-monitor/mac-arm64 --output-dir release-cli
shasum -a 256 release-cli/*.tar.gz
```

## 5. Troubleshooting

| Σφάλμα                                       | Αιτία / λύση                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E403 You do not have permission to publish` | Το όνομα ανήκει σε άλλον ή λάθος account. `npm whoami`, `npm owner ls codeitlab`.                                                                              |
| `E402 Payment Required`                      | Λάθος access. Βάλε `--access public`.                                                                                                                          |
| `EOTP`                                       | `--otp=123456` (ή `npm publish --otp …`).                                                                                                                      |
| `E403 Two-factor authentication required`    | Ενεργοποίησε 2FA ή automation token με publish permission.                                                                                                     |
| `EPUBLISHCONFLICT` / version exists          | Η version υπάρχει. Χτίσε με νέο `--version` (ίδιο με το release tag).                                                                                          |
| `provenance` error τοπικά                    | Μην το βάζεις τοπικά· μόνο στο CI.                                                                                                                             |
| `npx codeitlab` → 404 + hint                 | Λείπουν release archives ή λάθος `CIL_RELEASE_BASE_URL`.                                                                                                       |
| `ENEEDAUTH` / `401` στο `publish-cli.yml`    | Δεν έχει στηθεί trusted publisher (§2) και δεν υπάρχει token. Στήσε το §2 και ξανατρέξε το run.                                                                |
| `checksum mismatch` στο `npx codeitlab`      | Το `SHA256SUMS` δεν ταιριάζει με το asset. Ξανατρέξε το workflow (το hash γίνεται από τα αρχεία).                                                              |
| `ERR_PNPM_UNUSED_PATCH` στο archive build    | Το staged install τράβηξε νεότερο `node-pty`. Κράτα το pinned `1.2.0-beta.15`.                                                                                 |
| Το `codeitlab` είναι πιασμένο                | `npm view codeitlab` → 404 σημαίνει ελεύθερο. Το `codeitlab` είναι **δικό μας** (0.1.0, 2026-10-23)· αν το όνομα ανήκε σε άλλον, εναλλακτικά `@codeitlab/cli`. |

## 6. Αρχεία αναφοράς

| Τι                      | Path                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| Builder package/tarball | `scripts/build-npm-launcher.ts`                                                |
| Launcher                | `scripts/npm-launcher/codeitlab.mjs`, `scripts/npm-launcher/codeitlab-bin.mjs` |
| Publish subcommand      | `apps/server/scripts/cli.ts` (`publish`)                                       |
| Workflow job            | `.github/workflows/publish-cli.yml` (`publish`)                                |
| Docs release            | `docs/operations/release.md` §0                                                |
| Έτοιμο tarball          | `release/codeitlab-cli-0.1.0.tgz`                                              |
| Evidence                | `release/verification/npm-package.md`                                          |
