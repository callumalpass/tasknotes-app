# Captured mdbase upgrades

- `app-custom/task.md`: unchanged type from the live v4.13.7 → v5.0.0-beta.5 custom-profile migration captured by tester `app` (`mig/app/vault-custom/_types/task.md`). `record.json` retains the first CLI query result's path and effective frontmatter; body is a test sentinel, not the original note body.
- `matrix-userfields/task.md`: unchanged type from tester `matrix`'s live v4.13.7 userfields migration (`mig/matrix/evidence/4.13.7-userfields/after-metadata/_types/task.md`), covering text, number, date, boolean and list coercion schemas.
- `older-app-setup-error.txt`: engine setup diagnostic quoted in tester `app`'s APP-01 report. It targets contract rc.5 while the deployed App supports rc.3.

Sources are disposable tester collections, not user vaults. Tests read these documents through the real App type/configuration/model resolver without narrowing the collection schema.
