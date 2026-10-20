import XCTest

/// Real UI only. No JS evaluation, injected auth, demo, or fixture mutation API.
final class StageSmoke: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "dev.tasknotes.app")
    private var env: [String: String] { ProcessInfo.processInfo.environment }

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    private func required(_ key: String) throws -> String {
        guard let value = env[key], !value.isEmpty else {
            XCTFail("Missing approved staging smoke input: \(key)")
            throw SmokeFailure.missingInput
        }
        return value
    }

    private func phase(_ value: String) { print("TN_STAGE_PHASE:\(value)") }
    private enum SmokeFailure: Error { case missingInput, unavailable }

    private func button(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func authenticate(legacy: Bool) throws {
        let start = button(legacy ? "Choose a collection" : "Sign in")
        XCTAssertTrue(start.waitForExistence(timeout: 60), "Sign-in action unavailable")
        start.tap()
        // Capacitor Browser uses SFSafariViewController in the app, not a fake
        // callback. A redirect out to Safari is also supported.
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        let browser = safari.state == .runningForeground ? safari : app
        let email = browser.webViews.textFields["Email"]
        XCTAssertTrue(email.waitForExistence(timeout: 60), "Staging credential form unavailable")
        // Only type once the native browser exposes the exact staging host.
        // A missing host label stops before credential entry, never relaxes it.
        let host = NSPredicate(format: "label == %@ OR value == %@ OR value BEGINSWITH %@", "connect-staging.mdbase.dev", "connect-staging.mdbase.dev", "https://connect-staging.mdbase.dev/")
        let navigationHost = browser.navigationBars.descendants(matching: .any).matching(host).firstMatch
        let toolbarHost = browser.toolbars.descendants(matching: .any).matching(host).firstMatch
        let address = browser.textFields["URL"].value as? String
        let addressHost = address.flatMap { URL(string: $0)?.host }
        XCTAssertTrue(navigationHost.exists || toolbarHost.exists || addressHost == "connect-staging.mdbase.dev", "Cannot establish the staging browser origin")
        email.tap()
        email.typeText(try required("SMOKE_EMAIL"))
        let password = browser.webViews.secureTextFields["Password"]
        if !password.exists {
            let next = browser.webViews.buttons["Continue"]
            XCTAssertTrue(next.exists, "Password sign-in action unavailable")
            next.tap()
        }
        XCTAssertTrue(password.waitForExistence(timeout: 20), "Password form unavailable")
        password.tap()
        password.typeText(try required("SMOKE_PASSWORD"))
        browser.webViews.buttons["Sign in"].tap()
        // Select only the designated account and existing collection. Never
        // choose New collection, extra access, reminders, or setup/type writes.
        let account = browser.webViews.buttons["Use this account"]
        if account.waitForExistence(timeout: 15) {
            let identity = browser.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", try required("SMOKE_EMAIL"))).firstMatch
            XCTAssertTrue(identity.exists, "Account identity does not match approved role")
            account.tap()
        }
        let selector = browser.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Open in TaskNotes")).firstMatch
        let hasSelector = selector.waitForExistence(timeout: 20)
        if !legacy { XCTAssertTrue(hasSelector, "Designated collection picker unavailable; no approval attempted") }
        if hasSelector {
            selector.tap()
            let name = try required("SMOKE_COLLECTION_NAME")
            if browser.pickerWheels.firstMatch.waitForExistence(timeout: 5) {
                browser.pickerWheels.firstMatch.adjust(toPickerWheelValue: name)
                if browser.buttons["Done"].exists { browser.buttons["Done"].tap() }
            } else {
                let option = browser.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", name)).firstMatch
                XCTAssertTrue(option.waitForExistence(timeout: 10), "Designated existing collection missing")
                option.tap()
            }
        }
        // Real CP approval and return, never injected grants or URL codes.
        let approve = browser.webViews.buttons["Approve"]
        if approve.waitForExistence(timeout: 15) { approve.tap() }
        else if legacy && browser.webViews.buttons["Allow"].exists { browser.webViews.buttons["Allow"].tap() }
        let returned = browser.webViews.links["Return to TaskNotes"]
        if returned.waitForExistence(timeout: 10) { returned.tap() }
        if browser.buttons["Open"].exists { browser.buttons["Open"].tap() }
        app.activate()
    }

    private func openDesignatedCollection() throws {
        let name = try required("SMOKE_COLLECTION_NAME")
        let collection = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(collection.waitForExistence(timeout: 60), "Designated collection unavailable")
        collection.tap()
        // Never apply setup/type-pack changes to the seeded fixtures.
        XCTAssertFalse(button("Apply reviewed setup").exists, "Seeded account requires setup outside smoke scope")
    }

    private func search(_ title: String) {
        if button("Back").exists { button("Back").tap() }
        let searchButton = button("Search")
        XCTAssertTrue(searchButton.waitForExistence(timeout: 20), "Search navigation unavailable")
        searchButton.tap()
        let field = app.webViews.searchFields["Search tasks"]
        XCTAssertTrue(field.waitForExistence(timeout: 20), "Search field unavailable")
        field.tap()
        if let previous = field.value as? String, !previous.isEmpty, previous != "Search tasks" {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count))
        }
        field.typeText(title)
    }

    func testStageFlow() throws {
        let scenario = try required("SMOKE_SCENARIO")
        try authenticate(legacy: scenario == "legacy")
        if scenario == "legacy" {
            // Fresh post-wave login/open only; retained pre-wave session NOT_RUN.
            if let name = env["SMOKE_COLLECTION_NAME"] {
                let collection = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
                if collection.waitForExistence(timeout: 20) { collection.tap() }
            }
            let technical = app.buttons["Technical details"]
            if technical.waitForExistence(timeout: 20) { technical.tap() }
            let text = app.webViews.staticTexts
            let update = text.matching(NSPredicate(format: "label CONTAINS[c] 'mdbase has been updated' OR label CONTAINS[c] 'moved_to_next_runtime'")).firstMatch
            let generic = text.matching(NSPredicate(format: "label CONTAINS[c] 'couldn’t open' OR label CONTAINS[c] 'could not open' OR label CONTAINS[c] 'unavailable' OR label CONTAINS[c] 'expired'")).firstMatch
            if update.waitForExistence(timeout: 20) { phase("legacy_update_refusal") }
            else {
                XCTAssertTrue(generic.waitForExistence(timeout: 20), "Legacy outcome not classified; inspect privately, do not retry writes")
                phase("legacy_generic_refusal")
            }
            return
        }
        // The same original SDK owner must complete pairing and expose its list.
        let chooser = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Choose a collection' OR label CONTAINS[c] 'Your collections'")).firstMatch
        let opened = button("Search")
        let returned = NSPredicate { _, _ in chooser.exists || opened.exists }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: returned, object: nil)], timeout: 60), .completed, "Native return did not finish sign-in")
        phase("native_return")
        if scenario == "standalone" {
            phase("standalone_signed_in")
            return // No writes or fixture setup in the standalone control.
        }
        XCTAssertEqual(scenario, "seeded")
        if !opened.exists { try openDesignatedCollection() }
        let known = try required("SMOKE_EXISTING_TASK")
        search(known)
        XCTAssertTrue(button(known).waitForExistence(timeout: 60), "Known migrated task unavailable")
        phase("known_task")
        let title = try required("SMOKE_TASK_TITLE")
        let create = button("New task")
        XCTAssertTrue(create.exists, "Capture action unavailable")
        create.tap()
        let capture = app.webViews.textViews["New task title"]
        XCTAssertTrue(capture.waitForExistence(timeout: 10))
        capture.tap()
        capture.typeText(title)
        button("Add").tap() // The ONE permitted create; no retry on uncertain outcome.
        phase("created")
        search(title)
        XCTAssertTrue(button(title).waitForExistence(timeout: 60))
        button(title).tap()
        let editor = app.webViews.textViews["Task title"]
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        editor.tap()
        editor.typeText(" edited")
        let edited = title + " edited"
        button("Back").tap() // Normal save path.
        search(edited)
        XCTAssertTrue(button(edited).waitForExistence(timeout: 60))
        phase("edited")
        button(edited).tap()
        let complete = button("Complete task")
        XCTAssertTrue(complete.waitForExistence(timeout: 20))
        complete.tap() // The ONE permitted completion; never touch another row.
        XCTAssertTrue(button("Reopen task").waitForExistence(timeout: 30))
        XCTAssertTrue(button("Saved").waitForExistence(timeout: 60), "Completion still waiting for save")
        phase("completed")
        app.terminate()
        app.launch()
        search(edited)
        // Web may already have read the committed completion and performed its
        // one permitted title edit. Either exact title identifies our task;
        // its completed state must survive regardless of that valid timing.
        let persisted = app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", edited, edited + " web")).firstMatch
        XCTAssertTrue(persisted.waitForExistence(timeout: 60), "Saved smoke task missing after relaunch")
        persisted.tap()
        let reopen = button("Reopen task")
        XCTAssertTrue(reopen.waitForExistence(timeout: 20), "Completion did not persist")
        phase("reopened")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(reopen.waitForExistence(timeout: 20))
        phase("foreground")
        // Uiopen edits ONLY this smoke task's title after independent readback.
        button("Back").tap()
        search(title)
        XCTAssertTrue(button(edited + " web").waitForExistence(timeout: 600), "Web-to-iOS round trip not observed in the single run")
        phase("web_roundtrip")
    }
}
