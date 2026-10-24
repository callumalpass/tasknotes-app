import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

// Independent expected copy, not computed with the application's translator.
const copy = {
  ja: {
    setup: "復元を設定",
    newPassword: "新しい復元用パスワード",
    confirm: "新しい復元用パスワードを確認",
    dismiss: "復元キーを保存しました",
    password: "復元用パスワード",
    unlock: "プライベートコレクションのロックを解除",
    review: "厳格モードを確認",
    strict: "厳格モードを有効にする",
    setupNotice: (n: number) =>
      n
        ? `復元が設定されました。${n}件のプライベートコレクションでキーへのアクセスがまだ完了していません。`
        : "復元が設定されています。画面を離れる前に復元キーを保存してください。",
    unlockNotice: (n: number) =>
      n
        ? `アカウントのロックが解除されました。${n}件のプライベートコレクションでキーへのアクセスがまだ完了していません。それぞれのコレクションを選択した状態で、もう一度ロックを解除してください。`
        : "アカウントのロックが解除されました。このデバイスでプライベートコレクションのキーを利用できます。",
    strictNotice: (n: number) =>
      `${n}件の復元対象で厳格モードの適用が保留中です。mdbaseが完了を確認するまで、復元キーはこのデバイスに残ります。`,
    daily: (n: number) => (n <= 1 ? "毎日" : `${n}日ごと`),
    monthEnd: (n: number) =>
      `毎月（対象日：${n === 1 ? "最終日" : `月末から${n}番目の日`}）`,
  },
  de: {
    setup: "Kontowiederherstellung einrichten",
    newPassword: "Neues Wiederherstellungspasswort",
    confirm: "Neues Wiederherstellungspasswort bestätigen",
    dismiss: "Ich habe meinen Wiederherstellungsschlüssel gespeichert",
    password: "Wiederherstellungspasswort",
    unlock: "Private Sammlungen entsperren",
    review: "Strikten Modus überprüfen",
    strict: "Strikten Modus aktivieren",
    setupNotice: (n: number) =>
      n
        ? `Die Kontowiederherstellung ist eingerichtet. Für ${n} private ${n === 1 ? "Sammlung" : "Sammlungen"} muss der Schlüsselzugriff noch abgeschlossen werden.`
        : "Die Kontowiederherstellung ist eingerichtet. Sichern Sie Ihren Wiederherstellungsschlüssel, bevor Sie diesen Bildschirm verlassen.",
    unlockNotice: (n: number) =>
      n
        ? `Konto entsperrt. Für ${n} private ${n === 1 ? "Sammlung" : "Sammlungen"} muss der Schlüsselzugriff noch abgeschlossen werden; entsperren Sie das Konto erneut, wenn ${n === 1 ? "diese Sammlung" : "die jeweilige Sammlung"} ausgewählt ist.`
        : "Konto entsperrt. Die Schlüssel für private Sammlungen sind auf diesem Gerät verfügbar.",
    strictNotice: (n: number) =>
      `Der strikte Modus ist für ${n} ${n === 1 ? "Wiederherstellungsziel" : "Wiederherstellungsziele"} noch ausstehend. Der Wiederherstellungsschlüssel bleibt auf diesem Gerät, bis mdbase den Abschluss bestätigt.`,
    daily: (n: number) => (n <= 1 ? "Jeden Tag" : `Alle ${n} Tage`),
    monthEnd: (n: number) =>
      `Jeden Monat am ${n === 1 ? "letzten Tag" : `${n}. Tag des Monats, vom Monatsende an gezählt`}`,
  },
  ru: {
    setup: "Настроить восстановление",
    newPassword: "Новый пароль восстановления",
    confirm: "Подтвердите новый пароль восстановления",
    dismiss: "Ключ восстановления сохранён",
    password: "Пароль восстановления",
    unlock: "Разблокировать закрытые коллекции",
    review: "Проверить настройки строгого режима",
    strict: "Включить строгий режим",
    setupNotice: (n: number) =>
      n
        ? `Восстановление настроено. Для ${n} ${n % 10 === 1 && n % 100 !== 11 ? "закрытой коллекции" : "закрытых коллекций"} доступ к ключам ещё не завершён.`
        : "Восстановление настроено. Сохраните ключ восстановления, прежде чем закрыть этот экран.",
    unlockNotice: (n: number) =>
      n
        ? `Учётная запись разблокирована. Для ${n} ${n % 10 === 1 && n % 100 !== 11 ? "закрытой коллекции доступ к ключам ещё не завершён; повторите разблокировку, когда эта коллекция будет выбрана." : "закрытых коллекций доступ к ключам ещё не завершён; повторите разблокировку, когда будет выбрана каждая из них."}`
        : "Учётная запись разблокирована. Ключи закрытых коллекций доступны на этом устройстве.",
    strictNotice: (n: number) =>
      `Для ${n} ${n % 10 === 1 && n % 100 !== 11 ? "цели" : "целей"} восстановления применение строгого режима ещё не завершено. Ключ восстановления останется на этом устройстве, пока mdbase не подтвердит завершение.`,
    daily: (n: number) =>
      n <= 1
        ? "Каждый день"
        : `Раз в ${n} ${n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? "дня" : "дней"}`,
    monthEnd: (n: number) =>
      `Каждый месяц: ${n === 1 ? "последний день" : `${n}-й день с конца месяца`}`,
  },
};

for (const [locale, titleLabel, saved, back] of [
  ["ja", "タスク名", "保存済み", "戻る"],
  ["de", "Aufgabentitel", "Gespeichert", "Zurück"],
  ["ru", "Название задачи", "Сохранено", "Назад"],
]) {
  test(`${locale} workspace editing preserves user data and explicit locale`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("tasknotes:locale", value),
      locale,
    );
    await page.goto("?demo=12");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Prepare quarterly planning session",
        exact: true,
      })
      .click();
    const title = page.getByRole("textbox", { name: titleLabel, exact: true });
    await expect(title).toHaveValue("Prepare quarterly planning session");
    const userContent = "Personal task — 日本語 Deutsch Русский";
    await title.fill(userContent);
    await expect(page.locator(".save-state")).toHaveText(saved);
    expect(
      (await new AxeBuilder({ page }).include(".task-screen").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/i18n-final-workspace-${locale}-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: back, exact: true }).click();
    await expect(
      page.getByRole("button", { name: userContent, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem("tasknotes:locale")),
    ).toBe(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  });
}

for (const locale of ["ja", "de", "ru"] as const) {
  for (const count of [0, 1, 2, 5, 11, 21, 22, 101]) {
    test(`${locale} account notices and recurrence plurals at ${count}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        (value) => localStorage.setItem("tasknotes:locale", value),
        locale,
      );
      // The fixture mocks account ports, NOT the real translator or UI component.
      await page.goto(
        `e2e/private-account.fixture.html?count=${count}&summaries=1`,
      );
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const labels = copy[locale];
      await expect(page.getByTestId("daily-summary")).toHaveText(
        labels.daily(count),
      );
      for (const day of [1, 2, 3, 5, 11, 21, 22, 31]) {
        await expect(page.getByTestId(`month-end-${day}`)).toHaveText(
          labels.monthEnd(day),
        );
      }
      const password = "correct horse battery staple";
      await page.getByLabel(labels.newPassword, { exact: true }).fill(password);
      await page.getByLabel(labels.confirm, { exact: true }).fill(password);
      await page
        .getByRole("button", { name: labels.setup, exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: labels.setupNotice(count) }),
      ).toHaveText(labels.setupNotice(count));
      await expect(page.locator("textarea")).toHaveValue(
        "MDB1-PUBLIC-TEST-FIXTURE-ONLY",
      );
      await page
        .getByRole("button", { name: labels.dismiss, exact: true })
        .click();
      await expect(page.locator("textarea")).toHaveCount(0);
      await page.getByLabel(labels.password, { exact: true }).fill(password);
      await page
        .getByRole("button", { name: labels.unlock, exact: true })
        .click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: labels.unlockNotice(count) }),
      ).toHaveText(labels.unlockNotice(count));
      await expect(
        page.getByLabel(labels.password, { exact: true }),
      ).toHaveValue("");
      await page
        .getByRole("button", { name: labels.review, exact: true })
        .click();
      const strict = page.getByRole("button", {
        name: labels.strict,
        exact: true,
      });
      await expect(strict).toBeDisabled();
      await page.getByRole("checkbox").check();
      await strict.click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: labels.strictNotice(count) }),
      ).toHaveText(labels.strictNotice(count));
      expect(errors).toEqual([]);
      if (count === 2) {
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        await page.setViewportSize({ width: 320, height: 900 });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await page.screenshot({
          path: `test-results/i18n-final-${locale}-${test.info().project.name}.png`,
          fullPage: true,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(320);
      }
    });
  }
}
