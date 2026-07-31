package dev.tasknotes.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FolderAccess")
public class FolderAccessPlugin extends Plugin {
    private static final String PREFERENCES = "tasknotes-folder-access";
    private static final String TREE_URI = "treeUri";
    private static final String SELECTION_ID = "selectionId";
    private static final String SELECTION_NAME = "selectionName";
    private static final Set<String> EXCLUDED_DIRECTORIES = new HashSet<>(
        Arrays.asList("node_modules")
    );

    private final ConcurrentHashMap<String, DocumentFile> pathCache = new ConcurrentHashMap<>();
    private final ExecutorService operations = Executors.newFixedThreadPool(4);

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderSelected");
    }

    @ActivityCallback
    private void folderSelected(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            resolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );

            DocumentFile root = DocumentFile.fromTreeUri(getContext(), uri);
            if (root == null || !root.isDirectory() || !root.canRead() || !root.canWrite()) {
                throw new IOException("The selected folder must allow reading and writing.");
            }

            SharedPreferences preferences = preferences();
            String previousUri = preferences.getString(TREE_URI, null);
            String id = uri.toString().equals(previousUri)
                ? preferences.getString(SELECTION_ID, UUID.randomUUID().toString())
                : UUID.randomUUID().toString();
            String name = root.getName();
            if (name == null || name.trim().isEmpty()) {
                name = "Selected folder";
            }

            preferences.edit()
                .putString(TREE_URI, uri.toString())
                .putString(SELECTION_ID, id)
                .putString(SELECTION_NAME, name)
                .apply();
            pathCache.clear();
            pathCache.put("", root);

            if (previousUri != null && !previousUri.equals(uri.toString())) {
                releasePermission(Uri.parse(previousUri));
            }

            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("selection", selection(id, name));
            call.resolve(response);
        } catch (Exception error) {
            call.reject(message(error), error);
        }
    }

    @PluginMethod
    public void currentFolder(PluginCall call) {
        run(call, () -> {
            JSObject response = new JSObject();
            SharedPreferences preferences = preferences();
            String id = preferences.getString(SELECTION_ID, null);
            String name = preferences.getString(SELECTION_NAME, null);
            if (id == null || name == null) {
                return response;
            }
            DocumentFile root = requireRoot(id);
            if (root.canRead() && root.canWrite()) {
                response.put("selection", selection(id, name));
            }
            return response;
        });
    }

    @PluginMethod
    public void clearFolder(PluginCall call) {
        run(call, () -> {
            String expectedId = requiredString(call, "selectionId");
            SharedPreferences preferences = preferences();
            String currentId = preferences.getString(SELECTION_ID, null);
            if (currentId != null && !currentId.equals(expectedId)) {
                throw new IOException("The selected collection changed.");
            }
            String uri = preferences.getString(TREE_URI, null);
            preferences.edit().clear().apply();
            pathCache.clear();
            if (uri != null) {
                releasePermission(Uri.parse(uri));
            }
            return new JSObject();
        });
    }

    @PluginMethod
    public void ensureDirectory(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String path = safePath(requiredString(call, "path"), false);
            ensureDirectory(id, path);
            return new JSObject();
        });
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String path = safePath(call.getString("path", ""), true);
            boolean recursive = call.getBoolean("recursive", true);
            Set<String> extensions = extensions(call.getArray("extensions", new JSArray()));
            DocumentFile start = resolve(id, path);
            if (start == null || !start.isDirectory()) {
                throw new FileNotFoundException("Directory not found: " + path);
            }

            JSArray files = new JSArray();
            ArrayDeque<DirectoryNode> pending = new ArrayDeque<>();
            pending.add(new DirectoryNode(path, start));
            while (!pending.isEmpty()) {
                DirectoryNode current = pending.removeFirst();
                for (DocumentFile child : current.directory.listFiles()) {
                    String name = child.getName();
                    if (name == null || name.trim().isEmpty()) {
                        continue;
                    }
                    if (isExcludedCollectionComponent(name)) {
                        continue;
                    }
                    String childPath = current.path.isEmpty() ? name : current.path + "/" + name;
                    pathCache.put(childPath, child);
                    if (child.isDirectory()) {
                        if (recursive) {
                            pending.addLast(new DirectoryNode(childPath, child));
                        }
                        continue;
                    }
                    if (!matchesExtension(name, extensions)) {
                        continue;
                    }
                    files.put(entry(childPath, child));
                }
            }
            JSObject response = new JSObject();
            response.put("files", files);
            return response;
        });
    }

    private static boolean isExcludedCollectionComponent(String name) {
        return name.startsWith(".") || EXCLUDED_DIRECTORIES.contains(name);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String path = safePath(requiredString(call, "path"), false);
            DocumentFile file = requireFile(id, path);
            try (
                InputStream raw = getContext().getContentResolver().openInputStream(file.getUri());
                BufferedInputStream input = raw == null ? null : new BufferedInputStream(raw)
            ) {
                if (input == null) {
                    throw new IOException("Could not open " + path + ".");
                }
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                copy(input, output);
                JSObject response = new JSObject();
                response.put("data", new String(output.toByteArray(), StandardCharsets.UTF_8));
                return response;
            }
        });
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String path = safePath(requiredString(call, "path"), false);
            String data = call.getString("data");
            if (data == null) {
                throw new IllegalArgumentException("data is required.");
            }
            DocumentFile file = fileForWrite(id, path);
            try (
                OutputStream raw = getContext().getContentResolver().openOutputStream(file.getUri(), "wt");
                BufferedOutputStream output = raw == null ? null : new BufferedOutputStream(raw)
            ) {
                if (output == null) {
                    throw new IOException("Could not open " + path + " for writing.");
                }
                output.write(data.getBytes(StandardCharsets.UTF_8));
            }
            JSObject response = new JSObject();
            response.put("entry", entry(path, file));
            return response;
        });
    }

    @PluginMethod
    public void rename(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String from = safePath(requiredString(call, "from"), false);
            String to = safePath(requiredString(call, "to"), false);
            DocumentFile existingDestination = resolve(id, to);
            if (existingDestination != null && existingDestination.exists()) {
                throw new IOException("A record already exists at " + to + ".");
            }
            DocumentFile source = requireFile(id, from);
            String sourceParent = parentPath(from);
            String destinationParent = parentPath(to);
            String destinationName = fileName(to);
            DocumentFile moved;

            if (sourceParent.equals(destinationParent)) {
                if (!source.renameTo(destinationName)) {
                    throw new IOException("Could not rename " + from + ".");
                }
                pathCache.remove(from);
                moved = resolve(id, to);
                if (moved == null) {
                    throw new IOException("Renamed file not found: " + to);
                }
            } else {
                DocumentFile destination = fileForWrite(id, to);
                try {
                    copyDocument(source, destination);
                } catch (Exception error) {
                    destination.delete();
                    pathCache.remove(to);
                    throw error;
                }
                if (!source.delete()) {
                    destination.delete();
                    pathCache.remove(to);
                    throw new IOException("Could not remove " + from + " after moving it.");
                }
                pathCache.remove(from);
                moved = destination;
            }

            pathCache.put(to, moved);
            JSObject response = new JSObject();
            response.put("entry", entry(to, moved));
            return response;
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String path = safePath(requiredString(call, "path"), false);
            DocumentFile file = resolve(id, path);
            if (file != null && file.exists() && !file.delete()) {
                throw new IOException("Could not delete " + path + ".");
            }
            pathCache.remove(path);
            return new JSObject();
        });
    }

    @PluginMethod
    public void exists(PluginCall call) {
        run(call, () -> {
            String id = requiredString(call, "selectionId");
            String path = safePath(requiredString(call, "path"), false);
            DocumentFile file = resolve(id, path);
            JSObject response = new JSObject();
            response.put("exists", file != null && file.exists());
            return response;
        });
    }

    @Override
    protected void handleOnDestroy() {
        operations.shutdownNow();
        super.handleOnDestroy();
    }

    private void run(PluginCall call, NativeOperation operation) {
        operations.submit(() -> {
            try {
                call.resolve(operation.run());
            } catch (Exception error) {
                call.reject(message(error), error);
            }
        });
    }

    private DocumentFile requireRoot(String expectedId) throws IOException {
        SharedPreferences preferences = preferences();
        String id = preferences.getString(SELECTION_ID, null);
        String uri = preferences.getString(TREE_URI, null);
        if (id == null || uri == null || !id.equals(expectedId)) {
            throw new IOException("The selected collection changed or is no longer available.");
        }
        DocumentFile cached = pathCache.get("");
        if (cached != null) {
            return cached;
        }
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
        if (root == null || !root.exists() || !root.canRead() || !root.canWrite()) {
            throw new IOException("TaskNotes no longer has access to the selected folder.");
        }
        pathCache.put("", root);
        return root;
    }

    private DocumentFile resolve(String id, String path) throws IOException {
        DocumentFile current = requireRoot(id);
        if (path.isEmpty()) {
            return current;
        }
        String partial = "";
        for (String segment : path.split("/")) {
            partial = partial.isEmpty() ? segment : partial + "/" + segment;
            DocumentFile cached = pathCache.get(partial);
            if (cached != null) {
                current = cached;
                continue;
            }
            current = current.findFile(segment);
            if (current == null) {
                return null;
            }
            pathCache.put(partial, current);
        }
        return current;
    }

    private DocumentFile ensureDirectory(String id, String path) throws IOException {
        DocumentFile current = requireRoot(id);
        String partial = "";
        for (String segment : path.split("/")) {
            partial = partial.isEmpty() ? segment : partial + "/" + segment;
            DocumentFile next = pathCache.get(partial);
            if (next == null) {
                next = current.findFile(segment);
            }
            if (next == null) {
                next = current.createDirectory(segment);
            }
            if (next == null || !next.isDirectory()) {
                throw new IOException("Could not create directory " + partial + ".");
            }
            pathCache.put(partial, next);
            current = next;
        }
        return current;
    }

    private DocumentFile requireFile(String id, String path) throws IOException {
        DocumentFile file = resolve(id, path);
        if (file == null || !file.isFile()) {
            throw new FileNotFoundException("File not found: " + path);
        }
        return file;
    }

    private DocumentFile fileForWrite(String id, String path) throws IOException {
        DocumentFile existing = resolve(id, path);
        if (existing != null) {
            if (!existing.exists()) {
                pathCache.remove(path);
            } else if (!existing.isFile()) {
                throw new IOException(path + " is not a file.");
            } else {
                return existing;
            }
        }
        String parent = parentPath(path);
        DocumentFile directory = parent.isEmpty() ? requireRoot(id) : ensureDirectory(id, parent);
        DocumentFile created = directory.createFile(mimeType(path), fileName(path));
        if (created == null) {
            throw new IOException("Could not create " + path + ".");
        }
        pathCache.put(path, created);
        return created;
    }

    private void copyDocument(DocumentFile source, DocumentFile destination) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        try (
            InputStream rawInput = resolver.openInputStream(source.getUri());
            OutputStream rawOutput = resolver.openOutputStream(destination.getUri(), "wt");
            BufferedInputStream input = rawInput == null ? null : new BufferedInputStream(rawInput);
            BufferedOutputStream output = rawOutput == null ? null : new BufferedOutputStream(rawOutput)
        ) {
            if (input == null || output == null) {
                throw new IOException("Could not move the selected record.");
            }
            copy(input, output);
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
    }

    private static JSObject entry(String path, DocumentFile file) {
        JSObject entry = new JSObject();
        entry.put("path", path);
        entry.put("lastModified", file.lastModified());
        entry.put("size", file.length());
        return entry;
    }

    private static JSObject selection(String id, String name) {
        JSObject selection = new JSObject();
        selection.put("id", id);
        selection.put("name", name);
        return selection;
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Activity.MODE_PRIVATE);
    }

    private void releasePermission(Uri uri) {
        try {
            getContext().getContentResolver().releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // The grant may already have been revoked in system settings.
        }
    }

    private static String requiredString(PluginCall call, String name) {
        String value = call.getString(name);
        if (value == null) {
            throw new IllegalArgumentException(name + " is required.");
        }
        return value;
    }

    private static String safePath(String value, boolean allowEmpty) {
        if (allowEmpty && value.isEmpty()) {
            return "";
        }
        if (value.isEmpty() || value.startsWith("/") || value.contains("\\") || value.endsWith("/")) {
            throw new IllegalArgumentException("Unsafe collection path: " + value);
        }
        for (String segment : value.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                throw new IllegalArgumentException("Unsafe collection path: " + value);
            }
        }
        return value;
    }

    private static String parentPath(String path) {
        int separator = path.lastIndexOf('/');
        return separator < 0 ? "" : path.substring(0, separator);
    }

    private static String fileName(String path) {
        int separator = path.lastIndexOf('/');
        return separator < 0 ? path : path.substring(separator + 1);
    }

    private static String mimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".md")) {
            return "text/markdown";
        }
        if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
            return "application/yaml";
        }
        if (lower.endsWith(".base")) {
            // Android's external-storage provider appends ".txt" when an
            // unknown extension is created as text/plain.
            return "application/octet-stream";
        }
        return "text/plain";
    }

    private static Set<String> extensions(JSArray values) throws Exception {
        Set<String> extensions = new HashSet<>();
        for (Object value : values.toList()) {
            if (value instanceof String) {
                extensions.add(((String) value).toLowerCase(Locale.ROOT));
            }
        }
        return extensions;
    }

    private static boolean matchesExtension(String name, Set<String> extensions) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String extension : extensions) {
            if (lower.endsWith(extension)) {
                return true;
            }
        }
        return false;
    }

    private static String message(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? "Folder operation failed." : message;
    }

    private interface NativeOperation {
        JSObject run() throws Exception;
    }

    private static final class DirectoryNode {
        final String path;
        final DocumentFile directory;

        DirectoryNode(String path, DocumentFile directory) {
            this.path = path;
            this.directory = directory;
        }
    }
}
