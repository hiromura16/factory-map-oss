# Third-party libraries

The browser assets are bundled locally for self-hosting without CDN requests.

| Library | Version | License | Bundled license |
| --- | --- | --- | --- |
| Leaflet | 1.9.4 | BSD-2-Clause | vendor/LICENSE-leaflet.txt |
| Leaflet-Geoman Free | 2.18.3 | MIT | vendor/LICENSE-geoman.txt |
| dxf-parser | 1.1.2 | MIT | vendor/LICENSE-dxf-parser.txt |

Upstream sources:

- https://github.com/Leaflet/Leaflet
- https://github.com/geoman-io/leaflet-geoman
- https://github.com/gdsestimating/dxf-parser

Only the Free edition of Geoman is bundled. This project does not include or activate Geoman Pro.

Additional bundled components:

- React / React DOM / Scheduler: MIT; vendor/LICENSE-react.txt, LICENSE-react-dom.txt, LICENSE-scheduler.txt.
- Mozilla PDF.js 6.5.438: Apache-2.0; vendor/pdfjs/LICENSE.
- Swagger UI: Apache-2.0; vendor/LICENSE-swagger-ui.txt.

The project MIT license does not replace these upstream notices. Rust dependencies are enumerated in server/Cargo.lock; review their licenses when redistributing binaries.
