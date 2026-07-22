# TaskNotes app

Read `PRODUCT.md` and `DESIGN.md` before changing user-facing behaviour or
visuals. The application is web-first and packaged for Android and iOS through
Capacitor. Keep browser and native storage behaviour behind the `Vault`
boundary; UI code must not branch on platform storage details.

Device-local collections use Markdown as their durable source of truth and a
disposable IndexedDB projection for fast startup and search. Cloud collections
use the hosted mdbase collection as their authority and a durable IndexedDB
replica for offline work.
