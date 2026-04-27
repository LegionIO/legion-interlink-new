import SwiftUI

// MARK: - Onboarding Step Model

enum OnboardingStepStatus {
    case pending
    case running
    case succeeded
    case failed
}

struct OnboardingStep: Identifiable {
    let id: String
    let title: String
    let description: String
    var status: OnboardingStepStatus = .pending
    var output: String = ""
}

// MARK: - Spinning Loader

private struct SpinnerView: View {
    @State private var rotation: Double = 0

    var body: some View {
        Circle()
            .trim(from: 0.15, to: 0.85)
            .stroke(TerminalTheme.accent, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            .frame(width: 12, height: 12)
            .rotationEffect(.degrees(rotation))
            .onAppear {
                withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) {
                    rotation = 360
                }
            }
    }
}

// MARK: - OnboardingView

struct OnboardingView: View {
    @EnvironmentObject var manager: ServiceManager
    let onComplete: () -> Void

    @State private var steps: [OnboardingStep] = [
        OnboardingStep(
            id: "redis",
            title: "Start Redis",
            description: "In-memory data store for caching and tracing"
        ),
        OnboardingStep(
            id: "memcached",
            title: "Start Memcached",
            description: "Distributed memory caching system"
        ),
        OnboardingStep(
            id: "ollama",
            title: "Start Ollama",
            description: "Local LLM inference server"
        ),
        OnboardingStep(
            id: "agentic",
            title: "Install Agentic Pack",
            description: "Cognitive stack: ~60 gems for AI reasoning, memory, and coordination"
        ),
        OnboardingStep(
            id: "update",
            title: "Update Legion",
            description: "Update all installed Legion gems to latest versions"
        ),
        OnboardingStep(
            id: "daemon",
            title: "Start LegionIO Daemon",
            description: "Boot the daemon with all extensions"
        ),
    ]

    @State private var isRunning = false
    @State private var isDone = false
    @State private var currentOutput: String = ""
    @State private var hasAppeared = false

    private var completedCount: Int {
        steps.filter { $0.status == .succeeded }.count
    }

    private var progress: Double {
        guard !steps.isEmpty else { return 0 }
        return Double(completedCount) / Double(steps.count)
    }

    var body: some View {
        VStack(spacing: 0) {
            headerSection
            separator
            stepListSection
            separator
            outputSection
            separator
            footerSection
        }
        .background(TerminalTheme.bg)
        .frame(minWidth: 550, minHeight: 480)
        .preferredColorScheme(.dark)
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) {
                hasAppeared = true
            }
        }
    }

    private var separator: some View {
        Rectangle()
            .fill(TerminalTheme.border)
            .frame(height: 1)
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 12) {
            // Grid icon matching the app identity
            ZStack {
                // Outer glow
                Circle()
                    .fill(TerminalTheme.accent.opacity(0.06))
                    .frame(width: 64, height: 64)

                Image(nsImage: onboardingGridIcon())
            }
            .opacity(hasAppeared ? 1 : 0)
            .offset(y: hasAppeared ? 0 : 8)
            .animation(.easeOut(duration: 0.6).delay(0.1), value: hasAppeared)

            VStack(spacing: 4) {
                (Text("Legion")
                    .foregroundColor(TerminalTheme.accent)
                + Text(" Interlink")
                    .foregroundColor(TerminalTheme.text))
                    .font(.system(size: 18, weight: .bold, design: .monospaced))
                    .opacity(hasAppeared ? 1 : 0)
                    .animation(.easeOut(duration: 0.5).delay(0.2), value: hasAppeared)

                Text("initializing environment")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(TerminalTheme.textDim)
                    .opacity(hasAppeared ? 1 : 0)
                    .animation(.easeOut(duration: 0.5).delay(0.3), value: hasAppeared)
            }

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(TerminalTheme.cardBg)
                        .frame(height: 4)

                    RoundedRectangle(cornerRadius: 2)
                        .fill(
                            LinearGradient(
                                colors: [TerminalTheme.accent.opacity(0.7), TerminalTheme.accent],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(0, geo.size.width * progress), height: 4)
                        .shadow(color: TerminalTheme.accent.opacity(0.4), radius: 6, y: 0)
                        .animation(.easeInOut(duration: 0.4), value: progress)
                }
            }
            .frame(height: 4)
            .padding(.horizontal, 40)
            .padding(.top, 4)

            // Fraction label
            Text("\(completedCount)/\(steps.count) complete")
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(TerminalTheme.textDim.opacity(0.5))
        }
        .padding(.vertical, 16)
        .padding(.horizontal, 20)
        .background(TerminalTheme.surfaceBg)
    }

    // MARK: - Grid Icon for Onboarding

    private func onboardingGridIcon() -> NSImage {
        let s: CGFloat = 36
        let image = NSImage(size: NSSize(width: s, height: s), flipped: false) { rect in
            let padding: CGFloat = s * 0.1
            let gridSize = s - padding * 2
            let step = gridSize / 2

            var points: [NSPoint] = []
            for row in 0..<3 {
                for col in 0..<3 {
                    points.append(NSPoint(
                        x: padding + CGFloat(col) * step,
                        y: padding + CGFloat(row) * step
                    ))
                }
            }

            let connections: [(Int, Int)] = [
                (0, 1), (1, 2), (3, 4), (4, 5), (6, 7), (7, 8),
                (0, 3), (3, 6), (1, 4), (4, 7), (2, 5), (5, 8),
                (1, 3), (1, 5), (3, 7), (5, 7),
            ]

            let accentColor = NSColor(TerminalTheme.accent)
            accentColor.withAlphaComponent(0.35).setStroke()
            for (a, b) in connections {
                let path = NSBezierPath()
                path.move(to: points[a])
                path.line(to: points[b])
                path.lineWidth = s * 0.04
                path.stroke()
            }

            let nodeRadius = s * 0.07
            for (i, p) in points.enumerated() {
                let isCenter = (i == 4)
                let r = isCenter ? nodeRadius * 1.5 : nodeRadius
                accentColor.withAlphaComponent(isCenter ? 1.0 : 0.7).setFill()
                NSBezierPath(ovalIn: NSRect(
                    x: p.x - r, y: p.y - r,
                    width: r * 2, height: r * 2
                )).fill()
            }
            return true
        }
        return image
    }

    // MARK: - Step List

    private var stepListSection: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    stepRow(step, index: index)
                        .opacity(hasAppeared ? 1 : 0)
                        .offset(x: hasAppeared ? 0 : -12)
                        .animation(.easeOut(duration: 0.35).delay(0.15 + Double(index) * 0.05), value: hasAppeared)
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
        }
        .frame(maxHeight: 220)
        .background(TerminalTheme.bg)
    }

    private func stepRow(_ step: OnboardingStep, index: Int) -> some View {
        let isActive = step.status == .running

        return HStack(spacing: 10) {
            // Step indicator
            ZStack {
                stepIcon(step.status)
            }
            .frame(width: 18, height: 18)

            // Step text
            VStack(alignment: .leading, spacing: 1) {
                Text(step.title)
                    .font(.system(size: 12, weight: isActive ? .semibold : .regular, design: .monospaced))
                    .foregroundColor(
                        step.status == .succeeded ? TerminalTheme.green :
                        step.status == .failed ? TerminalTheme.red :
                        isActive ? TerminalTheme.text :
                        TerminalTheme.textDim
                    )

                Text(step.description)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(TerminalTheme.textDim.opacity(isActive ? 0.7 : 0.4))
                    .lineLimit(1)
            }

            Spacer()

            // Status badge
            if step.status == .succeeded {
                Text("done")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundColor(TerminalTheme.green)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(TerminalTheme.green.opacity(0.1))
                    .cornerRadius(3)
            } else if step.status == .failed {
                Text("fail")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .foregroundColor(TerminalTheme.red)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(TerminalTheme.red.opacity(0.1))
                    .cornerRadius(3)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            isActive
                ? TerminalTheme.accent.opacity(0.05)
                : Color.clear
        )
        .overlay(
            RoundedRectangle(cornerRadius: 5)
                .stroke(
                    isActive ? TerminalTheme.accent.opacity(0.15) : Color.clear,
                    lineWidth: 1
                )
        )
        .cornerRadius(5)
        .animation(.easeInOut(duration: 0.25), value: step.status)
    }

    @ViewBuilder
    private func stepIcon(_ status: OnboardingStepStatus) -> some View {
        switch status {
        case .pending:
            Circle()
                .stroke(TerminalTheme.textDim.opacity(0.25), lineWidth: 1)
                .frame(width: 12, height: 12)
        case .running:
            SpinnerView()
        case .succeeded:
            ZStack {
                Circle()
                    .fill(TerminalTheme.green)
                    .frame(width: 12, height: 12)
                Image(systemName: "checkmark")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundColor(TerminalTheme.bg)
            }
        case .failed:
            ZStack {
                Circle()
                    .fill(TerminalTheme.red)
                    .frame(width: 12, height: 12)
                Image(systemName: "xmark")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundColor(TerminalTheme.bg)
            }
        }
    }

    // MARK: - Output

    private var outputSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "terminal")
                    .font(.system(size: 9))
                    .foregroundColor(TerminalTheme.accent.opacity(0.6))

                Text("OUTPUT")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(TerminalTheme.textDim.opacity(0.5))

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 6)

            ScrollViewReader { proxy in
                ScrollView {
                    Text(currentOutput.isEmpty ? "$ awaiting setup..." : currentOutput)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(
                            currentOutput.isEmpty
                                ? TerminalTheme.textDim.opacity(0.3)
                                : TerminalTheme.green.opacity(0.8)
                        )
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 4)

                    Color.clear
                        .frame(height: 1)
                        .id("outputBottom")
                }
                .frame(maxHeight: 110)
                .onChange(of: currentOutput) { _ in
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo("outputBottom", anchor: .bottom)
                    }
                }
            }
        }
        .background(TerminalTheme.bg)
    }

    // MARK: - Footer

    private var footerSection: some View {
        HStack(spacing: 12) {
            if isDone {
                HStack(spacing: 6) {
                    Circle()
                        .fill(TerminalTheme.green)
                        .frame(width: 6, height: 6)
                        .shadow(color: TerminalTheme.green.opacity(0.5), radius: 4)

                    Text("setup complete")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(TerminalTheme.green)
                }
            } else if steps.contains(where: { $0.status == .failed }) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(TerminalTheme.yellow)
                        .frame(width: 6, height: 6)

                    Text("errors encountered — retry or continue")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(TerminalTheme.yellow.opacity(0.8))
                }
            }

            Spacer()

            if isDone {
                Button(action: {
                    manager.checkSetupNeeded()
                    Task { await manager.checkAllServices() }
                    onComplete()
                }) {
                    Text("launch")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(TerminalTheme.bg)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 7)
                        .background(TerminalTheme.green)
                        .cornerRadius(5)
                        .shadow(color: TerminalTheme.green.opacity(0.3), radius: 8, y: 2)
                }
                .buttonStyle(.plain)
                .pointerCursor()
            } else {
                Button(action: { Task { await runSetup() } }) {
                    Text(isRunning ? "setting up..." : "begin setup")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundColor(isRunning ? TerminalTheme.textDim : TerminalTheme.bg)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 7)
                        .background(isRunning ? TerminalTheme.cardBg : TerminalTheme.accent)
                        .cornerRadius(5)
                        .shadow(color: isRunning ? Color.clear : TerminalTheme.accent.opacity(0.3), radius: 8, y: 2)
                }
                .buttonStyle(.plain)
                .disabled(isRunning)
                .pointerCursor()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(TerminalTheme.surfaceBg)
    }

    // MARK: - Setup Execution

    @MainActor
    private func runSetup() async {
        isRunning = true
        currentOutput = ""

        let brewPath = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/brew")
            ? "/opt/homebrew/bin/brew"
            : "/usr/local/bin/brew"

        let legionioPath = FileManager.default.isExecutableFile(atPath: "/opt/homebrew/bin/legionio")
            ? "/opt/homebrew/bin/legionio"
            : "/usr/local/bin/legionio"

        // Step 1-3: Start brew services
        for serviceName in ["redis", "memcached", "ollama"] {
            setStepStatus(serviceName, .running)
            appendOutput("Starting \(serviceName)...\n")

            let (output, success) = await manager.runCommand(brewPath, arguments: ["services", "start", serviceName])
            appendOutput(output)

            setStepStatus(serviceName, success ? .succeeded : .failed)
            if !success {
                appendOutput("Warning: \(serviceName) failed to start, continuing...\n")
            }
        }

        // Step 4: legionio setup agentic
        setStepStatus("agentic", .running)
        appendOutput("\nInstalling agentic pack (this may take a few minutes)...\n")

        let agenticSuccess = await manager.runCommandStreaming(
            legionioPath,
            arguments: ["setup", "agentic"]
        ) { line in
            Task { @MainActor in
                self.appendOutput(line)
            }
        }
        setStepStatus("agentic", agenticSuccess ? .succeeded : .failed)

        // Step 5: legionio update
        setStepStatus("update", .running)
        appendOutput("\nUpdating Legion gems...\n")

        let updateSuccess = await manager.runCommandStreaming(
            legionioPath,
            arguments: ["update"]
        ) { line in
            Task { @MainActor in
                self.appendOutput(line)
            }
        }
        setStepStatus("update", updateSuccess ? .succeeded : .failed)

        // Step 6: Start daemon via legionio CLI (not brew services — that gets stuck)
        setStepStatus("daemon", .running)
        appendOutput("\nStarting LegionIO daemon...\n")

        // Ensure brew services isn't managing legionio
        let (_, _) = await manager.runCommand(brewPath, arguments: ["services", "stop", "legionio"])

        let (daemonOutput, daemonSuccess) = await manager.runCommand(
            legionioPath,
            arguments: ["start"]
        )
        appendOutput(daemonOutput)
        setStepStatus("daemon", daemonSuccess ? .succeeded : .failed)

        // Refresh service states
        await manager.checkAllServices()
        manager.checkSetupNeeded()

        appendOutput("\nSetup complete.\n")
        isDone = true
        isRunning = false
    }

    private func setStepStatus(_ id: String, _ status: OnboardingStepStatus) {
        if let idx = steps.firstIndex(where: { $0.id == id }) {
            steps[idx].status = status
        }
    }

    private func appendOutput(_ text: String) {
        currentOutput += text
    }
}
