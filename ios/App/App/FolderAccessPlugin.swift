import Capacitor
import Foundation
import UniformTypeIdentifiers
import UIKit

@objc(FolderAccessPlugin)
public class FolderAccessPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderAccessPlugin"
    public let jsName = "FolderAccess"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readBinary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeBinary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rename", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exists", returnType: CAPPluginReturnPromise)
    ]

    private static let bookmarkKey = "tasknotes.folderAccess.bookmark"
    private static let selectionIdKey = "tasknotes.folderAccess.selectionId"
    private static let selectionNameKey = "tasknotes.folderAccess.selectionName"
    private static let excludedDirectories = Set(["node_modules"])
    private var pickerCall: CAPPluginCall?

    @objc public func pickFolder(_ call: CAPPluginCall) {
        guard pickerCall == nil else {
            call.reject("A folder picker is already open.")
            return
        }
        DispatchQueue.main.async {
            guard let viewController = self.bridge?.viewController else {
                call.reject("TaskNotes could not open the folder picker.")
                return
            }
            self.pickerCall = call
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: [.folder],
                asCopy: false
            )
            picker.delegate = self
            picker.allowsMultipleSelection = false
            viewController.present(picker, animated: true)
        }
    }

    public func documentPicker(
        _ controller: UIDocumentPickerViewController,
        didPickDocumentsAt urls: [URL]
    ) {
        guard let call = pickerCall else { return }
        pickerCall = nil
        guard let url = urls.first else {
            call.resolve(["cancelled": true])
            return
        }
        guard url.startAccessingSecurityScopedResource() else {
            call.reject("TaskNotes could not retain access to the selected folder.")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let defaults = UserDefaults.standard
            let existingId = defaults.string(forKey: Self.selectionIdKey)
            let existingRoot = try? storedRoot(expectedId: existingId)
            let existingURL = existingRoot?.url
            let id = existingURL?.standardizedFileURL == url.standardizedFileURL
                ? existingId ?? UUID().uuidString
                : UUID().uuidString
            let bookmark = try url.bookmarkData(
                options: [],
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            let name = url.lastPathComponent.isEmpty
                ? "Selected folder"
                : url.lastPathComponent
            defaults.set(bookmark, forKey: Self.bookmarkKey)
            defaults.set(id, forKey: Self.selectionIdKey)
            defaults.set(name, forKey: Self.selectionNameKey)
            call.resolve([
                "cancelled": false,
                "selection": selection(id: id, name: name)
            ])
        } catch {
            call.reject(error.localizedDescription, nil, error)
        }
    }

    public func documentPickerWasCancelled(
        _ controller: UIDocumentPickerViewController
    ) {
        pickerCall?.resolve(["cancelled": true])
        pickerCall = nil
    }

    @objc public func currentFolder(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let defaults = UserDefaults.standard
                guard
                    let id = defaults.string(forKey: Self.selectionIdKey),
                    let name = defaults.string(forKey: Self.selectionNameKey)
                else {
                    self.resolve(call, [:])
                    return
                }
                let resolved = try self.storedRoot(expectedId: id)
                let root = resolved.url
                guard root.startAccessingSecurityScopedResource() else {
                    self.resolve(call, [:])
                    return
                }
                defer { root.stopAccessingSecurityScopedResource() }
                if resolved.stale {
                    try self.refreshBookmark(for: root)
                }
                self.resolve(call, ["selection": self.selection(id: id, name: name)])
            } catch {
                self.resolve(call, [:])
            }
        }
    }

    @objc public func clearFolder(_ call: CAPPluginCall) {
        let expectedId = call.getString("selectionId")
        let defaults = UserDefaults.standard
        let currentId = defaults.string(forKey: Self.selectionIdKey)
        if let currentId, currentId != expectedId {
            call.reject("The selected collection changed.")
            return
        }
        defaults.removeObject(forKey: Self.bookmarkKey)
        defaults.removeObject(forKey: Self.selectionIdKey)
        defaults.removeObject(forKey: Self.selectionNameKey)
        call.resolve()
    }

    @objc public func ensureDirectory(_ call: CAPPluginCall) {
        perform(call, writing: true) { root in
            let path = try self.requiredPath(call, key: "path")
            let directory = try self.url(root: root, path: path)
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            return [:]
        }
    }

    @objc public func listFiles(_ call: CAPPluginCall) {
        perform(call, writing: false) { root in
            let path = try self.safePath(call.getString("path") ?? "", allowEmpty: true)
            let extensions = Set(
                (call.getArray("extensions", String.self) ?? []).map {
                    $0.lowercased()
                }
            )
            let recursive = call.getBool("recursive") ?? true
            let start = try self.url(root: root, path: path, allowEmpty: true)
            var isDirectory: ObjCBool = false
            guard
                FileManager.default.fileExists(
                    atPath: start.path,
                    isDirectory: &isDirectory
                ),
                isDirectory.boolValue
            else {
                throw FolderAccessError.notFound("Directory not found: \(path)")
            }

            let keys: [URLResourceKey] = [
                .isDirectoryKey,
                .contentModificationDateKey,
                .fileSizeKey
            ]
            var pending: [(path: String, url: URL)] = [(path, start)]
            var files: [PluginCallResultData] = []
            while !pending.isEmpty {
                let current = pending.removeFirst()
                let children = try FileManager.default.contentsOfDirectory(
                    at: current.url,
                    includingPropertiesForKeys: keys,
                    options: []
                )
                for child in children {
                    let name = child.lastPathComponent
                    if Self.isExcludedCollectionComponent(name) {
                        continue
                    }
                    let childPath = current.path.isEmpty
                        ? name
                        : "\(current.path)/\(name)"
                    let values = try child.resourceValues(
                        forKeys: Set(keys)
                    )
                    if values.isDirectory == true {
                        if recursive {
                            pending.append((childPath, child))
                        }
                        continue
                    }
                    guard
                        extensions.contains(where: {
                            name.lowercased().hasSuffix($0)
                        })
                    else { continue }
                    files.append(
                        self.entry(
                            path: childPath,
                            modified: values.contentModificationDate,
                            size: values.fileSize
                        )
                    )
                }
            }
            return ["files": files]
        }
    }

    private static func isExcludedCollectionComponent(_ name: String) -> Bool {
        name.hasPrefix(".") || excludedDirectories.contains(name)
    }

    @objc public func readText(_ call: CAPPluginCall) {
        perform(call, writing: false) { root in
            let path = try self.requiredPath(call, key: "path")
            let file = try self.url(root: root, path: path)
            guard FileManager.default.fileExists(atPath: file.path) else {
                throw FolderAccessError.notFound("File not found: \(path)")
            }
            let data = try Data(contentsOf: file)
            guard let contents = String(data: data, encoding: .utf8) else {
                throw FolderAccessError.invalidText(path)
            }
            return ["data": contents]
        }
    }

    @objc public func writeText(_ call: CAPPluginCall) {
        perform(call, writing: true) { root in
            let path = try self.requiredPath(call, key: "path")
            guard let contents = call.getString("data") else {
                throw FolderAccessError.invalidInput("data is required.")
            }
            let file = try self.url(root: root, path: path)
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try Data(contents.utf8).write(to: file, options: .atomic)
            return ["entry": try self.entry(path: path, url: file)]
        }
    }

    @objc public func readBinary(_ call: CAPPluginCall) {
        perform(call, writing: false) { root in
            let path = try self.requiredPath(call, key: "path")
            let file = try self.url(root: root, path: path)
            guard FileManager.default.fileExists(atPath: file.path) else {
                throw FolderAccessError.notFound("File not found: \(path)")
            }
            return ["data": try Data(contentsOf: file).base64EncodedString()]
        }
    }

    @objc public func writeBinary(_ call: CAPPluginCall) {
        perform(call, writing: true) { root in
            let path = try self.requiredPath(call, key: "path")
            guard
                let encoded = call.getString("data"),
                let contents = Data(base64Encoded: encoded)
            else {
                throw FolderAccessError.invalidInput("data must be valid base64.")
            }
            let file = try self.url(root: root, path: path)
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try contents.write(to: file, options: [.atomic, .withoutOverwriting])
            return ["entry": try self.entry(path: path, url: file)]
        }
    }

    @objc public func rename(_ call: CAPPluginCall) {
        perform(call, writing: true) { root in
            let from = try self.requiredPath(call, key: "from")
            let to = try self.requiredPath(call, key: "to")
            let source = try self.url(root: root, path: from)
            let destination = try self.url(root: root, path: to)
            guard FileManager.default.fileExists(atPath: source.path) else {
                throw FolderAccessError.notFound("File not found: \(from)")
            }
            guard !FileManager.default.fileExists(atPath: destination.path) else {
                throw FolderAccessError.invalidInput(
                    "A record already exists at \(to)."
                )
            }
            try FileManager.default.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try FileManager.default.moveItem(at: source, to: destination)
            return ["entry": try self.entry(path: to, url: destination)]
        }
    }

    @objc public func deleteFile(_ call: CAPPluginCall) {
        perform(call, writing: true) { root in
            let path = try self.requiredPath(call, key: "path")
            let file = try self.url(root: root, path: path)
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.removeItem(at: file)
            }
            return [:]
        }
    }

    @objc public func exists(_ call: CAPPluginCall) {
        perform(call, writing: false) { root in
            let path = try self.requiredPath(call, key: "path")
            let file = try self.url(root: root, path: path)
            return [
                "exists": FileManager.default.fileExists(atPath: file.path)
            ]
        }
    }

    private func perform(
        _ call: CAPPluginCall,
        writing: Bool,
        operation: @escaping (URL) throws -> PluginCallResultData
    ) {
        guard let id = call.getString("selectionId") else {
            call.reject("selectionId is required.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let resolved = try self.storedRoot(expectedId: id)
                let root = resolved.url
                guard root.startAccessingSecurityScopedResource() else {
                    throw FolderAccessError.accessUnavailable
                }
                defer { root.stopAccessingSecurityScopedResource() }
                if resolved.stale {
                    try self.refreshBookmark(for: root)
                }

                var result: PluginCallResultData?
                var operationError: Error?
                var coordinationError: NSError?
                let coordinator = NSFileCoordinator()
                let accessor: (URL) -> Void = { coordinatedRoot in
                    do {
                        result = try operation(coordinatedRoot)
                    } catch {
                        operationError = error
                    }
                }
                if writing {
                    coordinator.coordinate(
                        writingItemAt: root,
                        options: .forMerging,
                        error: &coordinationError,
                        byAccessor: accessor
                    )
                } else {
                    coordinator.coordinate(
                        readingItemAt: root,
                        options: .withoutChanges,
                        error: &coordinationError,
                        byAccessor: accessor
                    )
                }
                if let error = operationError {
                    throw error
                }
                if let error = coordinationError {
                    throw error
                }
                self.resolve(call, result ?? [:])
            } catch {
                self.reject(call, error)
            }
        }
    }

    private func storedRoot(
        expectedId: String?
    ) throws -> (url: URL, stale: Bool) {
        let defaults = UserDefaults.standard
        guard
            let expectedId,
            defaults.string(forKey: Self.selectionIdKey) == expectedId,
            let bookmark = defaults.data(forKey: Self.bookmarkKey)
        else {
            throw FolderAccessError.selectionChanged
        }
        var stale = false
        let root = try URL(
            resolvingBookmarkData: bookmark,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        )
        return (root, stale)
    }

    private func refreshBookmark(for root: URL) throws {
        let refreshed = try root.bookmarkData(
            options: [],
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
        UserDefaults.standard.set(refreshed, forKey: Self.bookmarkKey)
    }

    private func requiredPath(
        _ call: CAPPluginCall,
        key: String
    ) throws -> String {
        guard let path = call.getString(key) else {
            throw FolderAccessError.invalidInput("\(key) is required.")
        }
        return try safePath(path)
    }

    private func safePath(
        _ path: String,
        allowEmpty: Bool = false
    ) throws -> String {
        if allowEmpty && path.isEmpty { return "" }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        guard
            !path.isEmpty,
            !path.hasPrefix("/"),
            !path.hasSuffix("/"),
            !path.contains("\\"),
            segments.allSatisfy({
                !$0.isEmpty && $0 != "." && $0 != ".."
            })
        else {
            throw FolderAccessError.invalidInput(
                "Unsafe collection path: \(path)"
            )
        }
        return path
    }

    private func url(
        root: URL,
        path: String,
        allowEmpty: Bool = false
    ) throws -> URL {
        let safe = try safePath(path, allowEmpty: allowEmpty)
        if safe.isEmpty { return root }
        var resolved = root
        for segment in safe.split(separator: "/") {
            resolved = resolved.appendingPathComponent(String(segment))
            if FileManager.default.fileExists(atPath: resolved.path) {
                let values = try resolved.resourceValues(
                    forKeys: [.isSymbolicLinkKey]
                )
                if values.isSymbolicLink == true {
                    throw FolderAccessError.invalidInput(
                        "Collection paths may not pass through symbolic links."
                    )
                }
            }
        }
        return resolved
    }

    private func entry(path: String, url: URL) throws -> PluginCallResultData {
        let values = try url.resourceValues(
            forKeys: [.contentModificationDateKey, .fileSizeKey]
        )
        return entry(
            path: path,
            modified: values.contentModificationDate,
            size: values.fileSize
        )
    }

    private func entry(
        path: String,
        modified: Date?,
        size: Int?
    ) -> PluginCallResultData {
        return [
            "path": path,
            "lastModified": (modified?.timeIntervalSince1970 ?? 0) * 1_000,
            "size": size ?? 0
        ]
    }

    private func selection(id: String, name: String) -> PluginCallResultData {
        return ["id": id, "name": name]
    }

    private func resolve(
        _ call: CAPPluginCall,
        _ data: PluginCallResultData
    ) {
        DispatchQueue.main.async { call.resolve(data) }
    }

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        DispatchQueue.main.async {
            call.reject(error.localizedDescription, nil, error)
        }
    }
}

private enum FolderAccessError: LocalizedError {
    case accessUnavailable
    case invalidInput(String)
    case invalidText(String)
    case notFound(String)
    case selectionChanged

    var errorDescription: String? {
        switch self {
        case .accessUnavailable:
            return "TaskNotes no longer has access to the selected folder."
        case .invalidInput(let message), .notFound(let message):
            return message
        case .invalidText(let path):
            return "\(path) is not a UTF-8 text file."
        case .selectionChanged:
            return "The selected collection changed or is no longer available."
        }
    }
}
