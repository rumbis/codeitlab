# Building the mobile Screens dependency

The mobile v5 stack uses a committed tarball from the
[CodeItLab Screens fork](https://github.com/pingdotgg/react-native-screens/tree/cil-v5.0.0-cil.30).
The fork owns the integration changes; the app does not patch this package.
Each archive includes compiled JavaScript, declarations, native source and
`cil-fork.json` recording its version, source commit and upstream base.

To reproduce an archive, use Node 24 and the repository's pinned Yarn from a
clean fork checkout at the source commit recorded in its `cil-fork.json`:

```sh
yarn --cwd /tmp/cil-screens-fork pack:codeitlab /absolute/path/to/codeitlab/apps/mobile/deps
```

For an update, sync the fork's `main` with upstream, merge it and the required
proposal branches into `codeitlab/main`, increment the `5.0.0-cil.N` version, pin `CilFork.upstreamCommit` to the
integrated upstream SHA and commit.
Run `pack:codeitlab` from that clean checkout and tag the source as `cil-v<version>`.
Publish the source commit and tag to the fork before submitting the app change.
Replace the old archive, update `apps/mobile/package.json` and run `vp i` to
regenerate the lockfile. Verify mobile types and affected navigation tests.
Changes to native source also require rebuilding and testing the native client.

The same iOS binary supports iPhone, iPad, and Duo. UIKit hinge updates enable
phone workspace columns at runtime; regular phones retain portrait rotation.
Use the normal EAS build profiles and update channels. Duo support requires a
binary built with the iOS 27.1 SDK; an OTA cannot add the native APIs.
