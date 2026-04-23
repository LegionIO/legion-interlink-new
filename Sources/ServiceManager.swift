import Foundation
import SwiftUI

// MARK: - Service Definitions

enum ServiceName: String, CaseIterable, Identifiable {
    case legionio
    case redis
    case memcached
    case ollama

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .legionio:  return "LegionIO Daemon"
        case .redis:     return "Redis"
        case .memcached: return "Memcached"
        case .ollama:    return "Ollama"
        }
    }

    var brewName: String { rawValue }
}

enum ServiceStatus: String {
    case running  = "Running"
    case stopped  = "Stopped"
    case starting = "Starting..."
    case stopping = "Stopping..."
    case unknown  = "Checking..."
}

struct ServiceState: Identifiable {
    let name: ServiceName
    var status: ServiceStatus
    var pid: Int?

    var id: String { name.rawValue }
}

// MARK: - Daemon Readiness

struct DaemonReadiness {
    var ready: Bool = false
    var components: [String: Bool] = [:]
}

// MARK: - Overall Status

enum OverallStatus {
    case online
    case offline
    case setupNeeded
    case checking
}

// MARK: - ServiceManager

@MainActor
class ServiceManager: ObservableObject {
    static let shared = ServiceManager()

    @Published var services: [ServiceState] = ServiceName.allCases.map {
        ServiceState(name: $0, status: .unknown)
    }
    @Published var daemonReadiness = DaemonReadiness()
    @Published var overallStatus: OverallStatus = .checking
    @Published var lastChecked: Date?
    @Published var logContents: String = ""
    @Published var errorLogContents: String = ""
    @Published var setupNeeded: Bool = false

    /// When true, background polling skips checkAllServices to avoid overwriting transition states.
    private var suppressPolling = false

    static let daemonPort = 4567
    private let daemonHealthURL = URL(string: "http://localhost:\(daemonPort)/api/ready")!
    private let legionHome: String
    private let logPath: String
    private let agenticMarkerPath: String
    private var timer: Timer?
    private var logTimer: Timer?

    /// Resolved once at init — no repeated filesystem checks.
    private let resolvedBrewPath: String
    private let resolvedLegionioPath: String

    private static func findBrewPath() -> String {
        if FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/brew") {
            return "/opt/homebrew/bin/brew"
        }
        return "/usr/local/bin/brew"
    }

    private static func findLegionioPath() -> String {
        if FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/legionio") {
            return "/opt/homebrew/bin/legionio"
        }
        return "/usr/local/bin/legionio"
    }

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        self.legionHome = "\(home)/.legionio"
        self.logPath = "\(home)/.legionio/legionio/logs/legion.log"
        self.agenticMarkerPath = "\(home)/.legionio/.packs/agentic"
        self.resolvedBrewPath = Self.findBrewPath()
        self.resolvedLegionioPath = Self.findLegionioPath()
        checkSetupNeeded()
        startPolling()
    }

    // MARK: - Setup Detection

    func checkSetupNeeded() {
        setupNeeded = !FileManager.default.fileExists(atPath: agenticMarkerPath)
    }

    // MARK: - Service Control (all async, off main thread)

    func startAll() {
        for service in ServiceName.allCases {
            startService(service)
        }
    }

    func stopAll() {
        // Stop legionio first, then infrastructure
        stopService(.legionio)
        for service in ServiceName.allCases where service != .legionio {
            stopService(service)
        }
    }

    func startService(_ service: ServiceName) {
        updateServiceStatus(service, .starting)
        suppressPolling = true
        let brew = resolvedBrewPath
        let legionio = resolvedLegionioPath
        let home = legionHome
        let name = service.brewName
        let healthURL = daemonHealthURL
        Task.detached {
            if service == .legionio {
                Self.runProcessAsync(brew, arguments: ["services", "stop", "legionio"])
                try? await Task.sleep(nanoseconds: 500_000_000)
                // legionio start blocks (runs in foreground), so fire-and-forget
                // Start from ~/.legionio so relative log paths resolve correctly
                Self.runProcessAsync(legionio, arguments: ["start"], workingDirectory: home)
                await Self.waitForServiceReady(service: service, brew: brew, healthURL: healthURL, target: true, timeout: 60)
            } else {
                Self.runProcess(brew, arguments: ["services", "start", name])
                await Self.waitForServiceReady(service: service, brew: brew, healthURL: healthURL, target: true, timeout: 60)
            }
            await MainActor.run {
                self.updateServiceStatus(service, .running)
                self.suppressPolling = false
                self.recalculateOverallStatus()
            }
        }
    }

    func stopService(_ service: ServiceName) {
        updateServiceStatus(service, .stopping)
        if service == .legionio { daemonReadiness = DaemonReadiness() }
        suppressPolling = true
        let brew = resolvedBrewPath
        let legionio = resolvedLegionioPath
        let name = service.brewName
        let healthURL = daemonHealthURL
        Task.detached {
            if service == .legionio {
                Self.runProcess(legionio, arguments: ["stop"])
                Self.runProcessAsync(brew, arguments: ["services", "stop", "legionio"])
                Self.killProcessOnPort(Self.daemonPort)
            } else {
                Self.runProcess(brew, arguments: ["services", "stop", name])
            }
            // Wait until health check confirms the service is actually down
            await Self.waitForServiceReady(service: service, brew: brew, healthURL: healthURL, target: false, timeout: 60)
            await MainActor.run {
                self.updateServiceStatus(service, .stopped)
                self.suppressPolling = false
                self.recalculateOverallStatus()
            }
        }
    }

    func restartDaemon() {
        updateServiceStatus(.legionio, .stopping)
        suppressPolling = true
        let brew = resolvedBrewPath
        let legionio = resolvedLegionioPath
        let home = legionHome
        let healthURL = daemonHealthURL
        Task.detached {
            // Stop
            Self.runProcess(legionio, arguments: ["stop"])
            Self.runProcessAsync(brew, arguments: ["services", "stop", "legionio"])
            Self.killProcessOnPort(4567)
            await Self.waitForServiceReady(service: .legionio, brew: brew, healthURL: healthURL, target: false, timeout: 60)
            // Start from ~/.legionio so relative log paths resolve correctly
            await self.updateServiceStatus(.legionio, .starting)
            Self.runProcess(legionio, arguments: ["start"], workingDirectory: home)
            await Self.waitForServiceReady(service: .legionio, brew: brew, healthURL: healthURL, target: true, timeout: 60)
            await MainActor.run { self.suppressPolling = false }
            await self.checkAllServices()
        }
    }

    // MARK: - Health Checks

    func checkAllServices() async {
        let brew = resolvedBrewPath

        // Run all health checks concurrently off the main thread
        async let redisResult = Self.checkBrewService(brew: brew, name: ServiceName.redis.brewName)
        async let memcachedResult = Self.checkBrewService(brew: brew, name: ServiceName.memcached.brewName)
        async let ollamaResult = Self.checkBrewService(brew: brew, name: ServiceName.ollama.brewName)
        async let daemonResult = Self.checkDaemonHealth(url: daemonHealthURL)

        let redis = await redisResult
        let memcached = await memcachedResult
        let ollama = await ollamaResult
        let daemon = await daemonResult

        // Update UI on main actor — skip services in transition states
        updateServiceIfStable(.redis, redis.running ? .running : .stopped, pid: redis.pid)
        updateServiceIfStable(.memcached, memcached.running ? .running : .stopped, pid: memcached.pid)
        updateServiceIfStable(.ollama, ollama.running ? .running : .stopped, pid: ollama.pid)

        daemonReadiness = daemon.readiness
        if daemon.responding {
            let daemonPid = await Self.pidOnPort(Self.daemonPort)
            updateServiceIfStable(.legionio, .running, pid: daemonPid)
        } else {
            updateServiceIfStable(.legionio, .stopped)
        }

        lastChecked = Date()
        recalculateOverallStatus()
    }

    func refreshLogs() {
        let path = logPath
        Task.detached {
            let content = Self.tailFile(path: path, lines: 200)
            await MainActor.run { self.logContents = content }
        }
    }

    func clearLogs() {
        logContents = ""
        let path = logPath
        Task.detached {
            // Truncate rather than delete so the daemon's open file handle stays valid
            if let fh = FileHandle(forWritingAtPath: path) {
                fh.truncateFile(atOffset: 0)
                fh.closeFile()
            }
        }
    }

    /// Start fast 1-second log polling (call when Logs tab is visible).
    func startFastLogPolling() {
        guard logTimer == nil else { return }
        logTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.refreshLogs() }
        }
    }

    /// Stop fast log polling, revert to normal 5-second cycle.
    func stopFastLogPolling() {
        logTimer?.invalidate()
        logTimer = nil
    }

    // MARK: - Process Execution (for onboarding)

    nonisolated func runCommand(_ executable: String, arguments: [String]) async -> (output: String, success: Bool) {
        await withCheckedContinuation { continuation in
            let process = Process()
            let pipe = Pipe()

            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            process.standardOutput = pipe
            process.standardError = pipe

            do {
                try process.run()
                process.waitUntilExit()

                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""
                continuation.resume(returning: (output, process.terminationStatus == 0))
            } catch {
                continuation.resume(returning: (error.localizedDescription, false))
            }
        }
    }

    /// Run a command and stream output line-by-line to a callback.
    nonisolated func runCommandStreaming(_ executable: String, arguments: [String], onLine: @escaping @Sendable (String) -> Void) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            let pipe = Pipe()

            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = arguments
            process.standardOutput = pipe
            process.standardError = pipe

            pipe.fileHandleForReading.readabilityHandler = { handle in
                let data = handle.availableData
                guard !data.isEmpty else { return }
                if let line = String(data: data, encoding: .utf8) {
                    onLine(line)
                }
            }

            do {
                try process.run()
                process.waitUntilExit()
                pipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(returning: process.terminationStatus == 0)
            } catch {
                pipe.fileHandleForReading.readabilityHandler = nil
                continuation.resume(returning: false)
            }
        }
    }

    // MARK: - Static helpers (run off main thread)

    /// Run a command synchronously. Call from Task.detached only.
    private nonisolated static func runProcess(_ executable: String, arguments: [String], workingDirectory: String? = nil) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let workingDirectory {
            process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
    }

    /// Fire-and-forget: launch a process without waiting for it to finish.
    /// Use for commands that may hang (e.g. `brew services stop legionio`).
    private nonisolated static func runProcessAsync(_ executable: String, arguments: [String], workingDirectory: String? = nil) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let workingDirectory {
            process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }

    /// Poll a service until it reaches the target state (running or stopped), up to `timeout` seconds.
    /// Checks every 2 seconds. For legionio, checks the HTTP health endpoint; for others, checks brew services.
    private nonisolated static func waitForServiceReady(
        service: ServiceName, brew: String, healthURL: URL, target: Bool, timeout: Int
    ) async {
        let interval: UInt64 = 1_000_000_000  // 1 second
        let maxAttempts = timeout

        for _ in 0..<maxAttempts {
            try? await Task.sleep(nanoseconds: interval)

            let isRunning: Bool
            if service == .legionio {
                let result = await checkDaemonHealth(url: healthURL)
                isRunning = result.responding
            } else {
                let result = await checkBrewService(brew: brew, name: service.brewName)
                isRunning = result.running
            }

            if isRunning == target {
                return
            }
        }
    }

    /// Simple check: is the daemon responding with HTTP 200? Doesn't care about ready state.
    private nonisolated static func checkDaemonResponding(url: URL) async -> Bool {
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            if let httpResponse = response as? HTTPURLResponse {
                return httpResponse.statusCode == 200
            }
        } catch {
            // Connection refused / timeout — daemon is down
        }
        return false
    }

    /// Kill processes listening on a given port. Fallback for when `legionio stop` can't find its PID file.
    /// Uses -sTCP:LISTEN to only target servers, not clients (avoids killing ourselves).
    private nonisolated static func killProcessOnPort(_ port: Int) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-ti:\(port)", "-sTCP:LISTEN"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            guard let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !output.isEmpty else { return }

            let myPid = ProcessInfo.processInfo.processIdentifier

            for pidStr in output.components(separatedBy: "\n") {
                if let pid = Int32(pidStr.trimmingCharacters(in: .whitespaces)),
                   pid != myPid {
                    kill(pid, SIGTERM)
                }
            }
        } catch {
            // lsof not available or failed — nothing to do
        }
    }

    /// Check a brew service status. Runs entirely off main thread.
    private nonisolated static func checkBrewService(brew: String, name: String) async -> (running: Bool, pid: Int?) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: brew)
        process.arguments = ["services", "info", name, "--json"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return (false, nil)
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let first = json.first else {
            return (false, nil)
        }

        let running = first["running"] as? Bool ?? false
        let pid = first["pid"] as? Int
        return (running, pid)
    }

    /// Check daemon health via HTTP. Runs entirely off main thread.
    private nonisolated static func checkDaemonHealth(url: URL) async -> (readiness: DaemonReadiness, responding: Bool) {
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode == 200,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let payload = json["data"] as? [String: Any] ?? json
                let ready = payload["ready"] as? Bool ?? false
                var components: [String: Bool] = [:]
                if let comps = payload["components"] as? [String: Bool] {
                    components = comps
                }
                return (DaemonReadiness(ready: ready, components: components), ready)
            }
        } catch {
            // Connection refused / timeout — daemon is down
        }
        return (DaemonReadiness(), false)
    }

    /// Get the PID of the process listening on a given port.
    private nonisolated static func pidOnPort(_ port: Int) async -> Int? {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-ti:\(port)", "-sTCP:LISTEN"]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let output = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               let pid = Int(output.components(separatedBy: "\n").first ?? "") {
                return pid
            }
        } catch {}
        return nil
    }

    /// Read the tail of a log file. Runs off main thread.
    private nonisolated static func tailFile(path: String, lines: Int) -> String {
        // Use the tail command for efficiency — avoids reading entire file into memory
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/tail")
        process.arguments = ["-n", "\(lines)", path]
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? "(unable to read log)"
        } catch {
            return "(no log file found at \(path))"
        }
    }

    // MARK: - Private Helpers

    private func updateServiceStatus(_ service: ServiceName, _ status: ServiceStatus, pid: Int? = nil) {
        if let idx = services.firstIndex(where: { $0.name == service }) {
            services[idx].status = status
            if let pid { services[idx].pid = pid }
        }
    }

    /// Like updateServiceStatus, but skips if the service is in a transition state (.stopping/.starting).
    /// This prevents health-check results from flickering the UI during start/stop operations.
    private func updateServiceIfStable(_ service: ServiceName, _ status: ServiceStatus, pid: Int? = nil) {
        if let idx = services.firstIndex(where: { $0.name == service }) {
            let current = services[idx].status
            if current == .stopping || current == .starting {
                return  // Don't overwrite transition states
            }
            services[idx].status = status
            if let pid { services[idx].pid = pid }
        }
    }

    private func recalculateOverallStatus() {
        if setupNeeded {
            overallStatus = .setupNeeded
            return
        }

        let legionService = services.first(where: { $0.name == .legionio })
        if legionService?.status == .running {
            overallStatus = .online
        } else if services.map(\.status).contains(.unknown) {
            overallStatus = .checking
        } else {
            overallStatus = .offline
        }
    }

    private func startPolling() {
        Task { await checkAllServices() }
        refreshLogs()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                if !self.suppressPolling {
                    await self.checkAllServices()
                }
                self.refreshLogs()
            }
        }
    }

    deinit {
        timer?.invalidate()
        logTimer?.invalidate()
    }
}
