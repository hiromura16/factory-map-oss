# サードパーティーライブラリ

ブラウザーで使用するファイルはローカルに同梱しているため、セルフホスト時にCDNへアクセスせず利用できます。

| ライブラリ          | バージョン | ライセンス   | 同梱ライセンスファイル        |
| ------------------- | ---------- | ------------ | ----------------------------- |
| Leaflet             | 1.9.4      | BSD-2-Clause | vendor/LICENSE-leaflet.txt    |
| Leaflet-Geoman Free | 2.18.3     | MIT          | vendor/LICENSE-geoman.txt     |
| dxf-parser          | 1.1.2      | MIT          | vendor/LICENSE-dxf-parser.txt |

配布元のソース：

- https://github.com/Leaflet/Leaflet
- https://github.com/geoman-io/leaflet-geoman
- https://github.com/gdsestimating/dxf-parser

GeomanはFree版のみを同梱しています。このプロジェクトはGeoman Proを含まず、有効化もしていません。

その他の同梱コンポーネント：

- React / React DOM / Scheduler: MIT; vendor/LICENSE-react.txt, LICENSE-react-dom.txt, LICENSE-scheduler.txt.
- Mozilla PDF.js 6.5.438: Apache-2.0; vendor/pdfjs/LICENSE.
- Swagger UI: Apache-2.0; vendor/LICENSE-swagger-ui.txt.

このプロジェクトのMITライセンスは、各配布元のライセンス表記を置き換えるものではありません。Rustの依存関係は `server/Cargo.lock` に記載しています。バイナリを再配布する場合は、各依存関係のライセンスを確認してください。
