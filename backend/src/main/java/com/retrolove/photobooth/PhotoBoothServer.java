package com.retrolove.photobooth;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Retro Love Photobooth server.
 *
 * A single, dependency-light Java 17+ class built on com.sun.net.httpserver.HttpServer.
 * Serves the static frontend/ folder and exposes a small photo-saving API.
 *
 * Routes:
 *   GET  /api/health
 *   GET  /api/photos
 *   POST /api/photos        (raw image/jpeg body)
 *   GET  /captured/{name}
 *   GET  /  and static assets under frontend/
 */
public final class PhotoBoothServer {

    private static final int DEFAULT_PORT = 8080;
    private static final long MAX_UPLOAD_BYTES = 20L * 1024 * 1024; // 20 MB
    private static final Pattern SAFE_FILENAME = Pattern.compile("^[A-Za-z0-9._-]+$");
    private static final DateTimeFormatter TIMESTAMP_FMT =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS");

    private final Path projectRoot;
    private final Path frontendDir;
    private final Path captureDir;
    private final int port;

    private PhotoBoothServer(Path projectRoot, Path frontendDir, Path captureDir, int port) {
        this.projectRoot = projectRoot;
        this.frontendDir = frontendDir;
        this.captureDir = captureDir;
        this.port = port;
    }

    public static void main(String[] args) throws IOException {
        Path projectRoot = resolveProjectRoot();
        Path frontendDir = projectRoot.resolve("frontend");
        Path captureDir = resolveCaptureDir(projectRoot);
        Files.createDirectories(captureDir);

        if (!Files.isDirectory(frontendDir) || !Files.exists(frontendDir.resolve("index.html"))) {
            System.err.println("Could not locate the frontend/ folder (looked in: " + frontendDir + ").");
            System.err.println("If you're running this from an unusual IntelliJ working directory,");
            System.err.println("add this VM option to your Run Configuration:");
            System.err.println("    -Dphotobooth.root=" + projectRoot.toAbsolutePath());
            System.err.println("(use the correct path to the RetroLovePhotoBooth folder on your machine)");
            System.exit(1);
        }

        int port = resolvePort();
        PhotoBoothServer server = new PhotoBoothServer(projectRoot, frontendDir, captureDir, port);
        server.start();
    }

    private void start() throws IOException {
        HttpServer httpServer = HttpServer.create(new InetSocketAddress("localhost", port), 0);
        httpServer.createContext("/api/health", this::handleHealth);
        httpServer.createContext("/api/photos", this::handlePhotos);
        httpServer.createContext("/captured/", this::handleCaptured);
        httpServer.createContext("/", this::handleStatic);
        httpServer.setExecutor(Executors.newFixedThreadPool(8));
        httpServer.start();

        System.out.println("Retro Love Photobooth is running.");
        System.out.println("Open: http://localhost:" + port);
        System.out.println("Frontend root:  " + frontendDir.toAbsolutePath());
        System.out.println("Capture folder: " + captureDir.toAbsolutePath());
    }

    // ------------------------------------------------------------------
    // Config resolution
    // ------------------------------------------------------------------

    private static int resolvePort() {
        String env = System.getenv("PHOTOBOOTH_PORT");
        if (env != null && !env.isBlank()) {
            try {
                return Integer.parseInt(env.trim());
            } catch (NumberFormatException e) {
                System.err.println("Ignoring invalid PHOTOBOOTH_PORT='" + env + "', using default " + DEFAULT_PORT);
            }
        }
        return DEFAULT_PORT;
    }

    private static Path resolveCaptureDir(Path projectRoot) {
        String env = System.getenv("PHOTOBOOTH_CAPTURE_DIR");
        if (env != null && !env.isBlank()) {
            return Paths.get(env.trim()).toAbsolutePath().normalize();
        }
        return projectRoot.resolve("captured-photos");
    }

    /**
     * Finds the RetroLovePhotoBooth project root so the server can serve frontend/
     * and write to captured-photos/ regardless of the IDE's working directory.
     *
     * Resolution order:
     *   1. -Dphotobooth.root=... system property (explicit override)
     *   2. Walk up from the current working directory looking for frontend/index.html
     *   3. Walk up from the compiled class location looking for the same marker
     */
    private static Path resolveProjectRoot() {
        String override = System.getProperty("photobooth.root");
        if (override != null && !override.isBlank()) {
            return Paths.get(override.trim()).toAbsolutePath().normalize();
        }

        Path fromCwd = searchUpwardsForFrontend(Paths.get("").toAbsolutePath());
        if (fromCwd != null) {
            return fromCwd;
        }

        try {
            Path codeSource = Paths.get(
                    PhotoBoothServer.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            Path fromClasses = searchUpwardsForFrontend(codeSource.toAbsolutePath());
            if (fromClasses != null) {
                return fromClasses;
            }
        } catch (Exception ignored) {
            // fall through to default below
        }

        // Last resort: assume the current working directory is the project root.
        return Paths.get("").toAbsolutePath();
    }

    private static Path searchUpwardsForFrontend(Path start) {
        Path current = start;
        for (int i = 0; i < 8 && current != null; i++) {
            Path candidate = current.resolve("frontend").resolve("index.html");
            if (Files.exists(candidate)) {
                return current;
            }
            current = current.getParent();
        }
        return null;
    }

    // ------------------------------------------------------------------
    // API handlers
    // ------------------------------------------------------------------

    private void handleHealth(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        String body = "{\"status\":\"ok\",\"service\":\"retro-love-photobooth\"}";
        sendJson(exchange, 200, body);
    }

    private void handlePhotos(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        if ("GET".equalsIgnoreCase(method)) {
            listPhotos(exchange);
        } else if ("POST".equalsIgnoreCase(method)) {
            savePhoto(exchange);
        } else {
            sendJson(exchange, 405, "{\"error\":\"method not allowed\"}");
        }
    }

    private void listPhotos(HttpExchange exchange) throws IOException {
        List<Path> files = new ArrayList<>();
        if (Files.isDirectory(captureDir)) {
            try (var stream = Files.list(captureDir)) {
                stream.filter(p -> !Files.isDirectory(p))
                        .filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jpg")
                                || p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jpeg"))
                        .forEach(files::add);
            }
        }
        files.sort(Comparator.comparing(Path::getFileName).reversed());

        StringBuilder json = new StringBuilder();
        json.append("{\"count\":").append(files.size()).append(",\"photos\":[");
        for (int i = 0; i < files.size(); i++) {
            String name = files.get(i).getFileName().toString();
            if (i > 0) json.append(',');
            json.append("{\"filename\":\"").append(jsonEscape(name)).append("\",")
                    .append("\"url\":\"/captured/").append(jsonEscape(name)).append("\"}");
        }
        json.append("]}");
        sendJson(exchange, 200, json.toString());
    }

    private void savePhoto(HttpExchange exchange) throws IOException {
        Headers requestHeaders = exchange.getRequestHeaders();
        String contentType = requestHeaders.getFirst("Content-Type");
        if (contentType != null && !contentType.toLowerCase(Locale.ROOT).contains("image/jpeg")) {
            sendJson(exchange, 415, "{\"error\":\"expected Content-Type: image/jpeg\"}");
            return;
        }

        String lengthHeader = requestHeaders.getFirst("Content-Length");
        if (lengthHeader != null) {
            try {
                long declared = Long.parseLong(lengthHeader.trim());
                if (declared > MAX_UPLOAD_BYTES) {
                    sendJson(exchange, 413, "{\"error\":\"upload exceeds 20MB limit\"}");
                    exchange.getRequestBody().readAllBytes(); // drain
                    return;
                }
            } catch (NumberFormatException ignored) {
                // fall through and enforce the limit while streaming instead
            }
        }

        byte[] body = readLimited(exchange.getRequestBody(), MAX_UPLOAD_BYTES);
        if (body == null) {
            sendJson(exchange, 413, "{\"error\":\"upload exceeds 20MB limit\"}");
            return;
        }
        if (body.length < 4 || !isJpegSignature(body)) {
            sendJson(exchange, 400, "{\"error\":\"not a valid JPEG image\"}");
            return;
        }

        Files.createDirectories(captureDir);
        String filename = "retro-love-" + LocalDateTime.now().format(TIMESTAMP_FMT) + ".jpg";
        Path target = captureDir.resolve(filename);
        Files.write(target, body);

        String json = "{\"filename\":\"" + jsonEscape(filename) + "\","
                + "\"url\":\"/captured/" + jsonEscape(filename) + "\","
                + "\"bytes\":" + body.length + "}";
        sendJson(exchange, 201, json);
    }

    private boolean isJpegSignature(byte[] body) {
        // JPEG files start with FF D8 FF (SOI marker + first segment marker).
        return (body[0] & 0xFF) == 0xFF
                && (body[1] & 0xFF) == 0xD8
                && (body[2] & 0xFF) == 0xFF;
    }

    /** Reads the stream into memory, aborting and returning null if it exceeds {@code limit} bytes. */
    private byte[] readLimited(InputStream in, long limit) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(64 * 1024);
        byte[] chunk = new byte[8192];
        long total = 0;
        int read;
        while ((read = in.read(chunk)) != -1) {
            total += read;
            if (total > limit) {
                return null;
            }
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private void handleCaptured(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendPlainText(exchange, 405, "Method not allowed");
            return;
        }

        String rawPath = exchange.getRequestURI().getPath(); // e.g. /captured/retro-love-....jpg
        String prefix = "/captured/";
        String encodedName = rawPath.startsWith(prefix) ? rawPath.substring(prefix.length()) : "";
        String name = URLDecoder.decode(encodedName, StandardCharsets.UTF_8);

        if (name.isBlank() || !SAFE_FILENAME.matcher(name).matches()) {
            sendPlainText(exchange, 400, "Invalid photo filename.");
            return;
        }

        Path target = captureDir.resolve(name).normalize();
        if (!target.startsWith(captureDir.normalize()) || !Files.exists(target) || Files.isDirectory(target)) {
            sendPlainText(exchange, 404, "Photo not found.");
            return;
        }

        Headers headers = exchange.getResponseHeaders();
        headers.add("Content-Type", "image/jpeg");
        headers.add("Cache-Control", "public, max-age=31536000, immutable");
        addSecurityHeaders(headers);

        byte[] data = Files.readAllBytes(target);
        exchange.sendResponseHeaders(200, data.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(data);
        }
    }

    // ------------------------------------------------------------------
    // Static frontend serving
    // ------------------------------------------------------------------

    private void handleStatic(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod()) && !"HEAD".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendPlainText(exchange, 405, "Method not allowed");
            return;
        }

        String rawPath = exchange.getRequestURI().getPath();
        String decoded = URLDecoder.decode(rawPath, StandardCharsets.UTF_8);
        if (decoded.equals("/") || decoded.isBlank()) {
            decoded = "/index.html";
        }

        // Strip the leading slash and reject traversal attempts before resolving.
        String relative = decoded.startsWith("/") ? decoded.substring(1) : decoded;
        if (relative.contains("..")) {
            sendPlainText(exchange, 400, "Invalid path.");
            return;
        }

        Path target = frontendDir.resolve(relative).normalize();
        if (!target.startsWith(frontendDir.normalize()) || !Files.exists(target) || Files.isDirectory(target)) {
            sendPlainText(exchange, 404, "Not found: " + decoded);
            return;
        }

        String contentType = contentTypeFor(target.getFileName().toString());
        Headers headers = exchange.getResponseHeaders();
        headers.add("Content-Type", contentType);
        if (contentType.startsWith("text/html")
                || contentType.equals("application/javascript; charset=utf-8")
                || contentType.equals("text/css; charset=utf-8")) {
            headers.add("Cache-Control", "no-cache");
        } else {
            headers.add("Cache-Control", "public, max-age=3600");
        }
        addSecurityHeaders(headers);

        byte[] data = Files.readAllBytes(target);
        if ("HEAD".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
            return;
        }
        exchange.sendResponseHeaders(200, data.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(data);
        }
    }

    private static String contentTypeFor(String filename) {
        String lower = filename.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------------
    // Shared response helpers
    // ------------------------------------------------------------------

    private static void addSecurityHeaders(Headers headers) {
        headers.add("Permissions-Policy", "camera=(self)");
        headers.add("X-Content-Type-Options", "nosniff");
    }

    private void sendJson(HttpExchange exchange, int status, String json) throws IOException {
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.add("Content-Type", "application/json; charset=utf-8");
        headers.add("Cache-Control", "no-store");
        addSecurityHeaders(headers);
        exchange.sendResponseHeaders(status, data.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(data);
        }
    }

    private void sendPlainText(HttpExchange exchange, int status, String message) throws IOException {
        byte[] data = message.getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.add("Content-Type", "text/plain; charset=utf-8");
        addSecurityHeaders(headers);
        exchange.sendResponseHeaders(status, data.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(data);
        }
    }

    private static String jsonEscape(String value) {
        StringBuilder sb = new StringBuilder(value.length());
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                default: sb.append(c);
            }
        }
        return sb.toString();
    }
}
