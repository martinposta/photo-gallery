# Third-party notices

This project's own code is MIT-licensed (see `LICENSE`). It includes or installs the following
third-party components, which keep their own licenses.

## Included in this repository and in the generated site

| Component | Version | License | Where |
|---|---|---|---|
| [Inter](https://github.com/rsms/inter) typeface, © 2016 The Inter Project Authors | 4.001 | SIL Open Font License 1.1 | `site/fonts/` (copied to `docs/assets/fonts/`); full text in `site/fonts/OFL.txt` |

## Installed by npm (not part of this repository)

`npm install` downloads these for the local admin. None of them is shipped with the public site.

| Package | Version | License |
|---|---|---|
| [sharp](https://github.com/lovell/sharp) | 0.35.5 | Apache-2.0 |
| @img/sharp-&lt;platform&gt; (sharp's prebuilt binding) | 0.35.5 | Apache-2.0 |
| @img/sharp-libvips-&lt;platform&gt; ([libvips](https://www.libvips.org) and the libraries it bundles) | 1.3.4 | LGPL-3.0-or-later |
| [@img/colour](https://github.com/lovell/colour) | 1.1.0 | MIT |
| [detect-libc](https://github.com/lovell/detect-libc) | 2.1.2 | Apache-2.0 |
| [semver](https://github.com/npm/node-semver) | 7.8.5 | ISC |
| [exifr](https://github.com/MikeKovarik/exifr) | 7.1.3 | MIT |

npm picks the `<platform>` packages for your OS and CPU; the licenses are the same on every platform.

**About libvips (LGPL-3.0-or-later):** sharp loads libvips as a separate shared library, unmodified,
from the npm package. This project does not include, modify or statically link it, which is the use
the LGPL permits under any license, MIT included. If you redistribute a bundle that contains
`node_modules`, include the libvips license and keep the library replaceable.

## Optional external service

If you enable visitor analytics in the admin, the public site loads the Cloudflare Web Analytics
beacon from Cloudflare, under Cloudflare's own terms. It is off by default.
