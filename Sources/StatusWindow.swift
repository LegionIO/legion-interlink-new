import SwiftUI
import AppKit

// MARK: - Dark Terminal Theme

enum TerminalTheme {
    static let bg = Color(red: 0.08, green: 0.08, blue: 0.10)
    static let surfaceBg = Color(red: 0.11, green: 0.11, blue: 0.14)
    static let cardBg = Color(red: 0.14, green: 0.14, blue: 0.17)
    static let border = Color.white.opacity(0.08)
    static let text = Color(red: 0.88, green: 0.88, blue: 0.90)
    static let textDim = Color(red: 0.55, green: 0.55, blue: 0.58)
    static let accent = Color(red: 0.56, green: 0.50, blue: 0.92)
    static let green = Color(red: 0.30, green: 0.85, blue: 0.45)
    static let red = Color(red: 0.95, green: 0.35, blue: 0.35)
    static let yellow = Color(red: 0.95, green: 0.80, blue: 0.25)
    static let gray = Color(red: 0.45, green: 0.45, blue: 0.48)
}

// MARK: - Hover Card

/// A card container that subtly lifts and brightens its border on hover.
struct HoverCard<Content: View>: View {
    @State private var isHovered = false
    let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .background(isHovered ? TerminalTheme.cardBg.opacity(1.15) : TerminalTheme.cardBg)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(
                        isHovered ? TerminalTheme.accent.opacity(0.2) : TerminalTheme.border,
                        lineWidth: 1
                    )
            )
            .cornerRadius(6)
            .shadow(
                color: isHovered ? TerminalTheme.accent.opacity(0.06) : Color.clear,
                radius: 8, y: 2
            )
            .animation(.easeOut(duration: 0.15), value: isHovered)
            .onHover { hovering in
                isHovered = hovering
            }
    }
}

// MARK: - Breathing Status Pill

/// A status pill with a subtle breathing glow animation when online.
private struct BreathingStatusPill: View {
    let color: Color
    let text: String
    let isOnline: Bool
    @State private var breathe = false

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
                .shadow(color: color.opacity(breathe ? 0.8 : 0.3), radius: breathe ? 5 : 2)

            Text(text.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(color)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(breathe ? 0.12 : 0.08))
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(color.opacity(0.3), lineWidth: 1)
        )
        .cornerRadius(4)
        .animation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true), value: breathe)
        .onAppear {
            if isOnline { breathe = true }
        }
        .onChange(of: isOnline) { online in
            breathe = online
        }
    }
}

// MARK: - Pulsing Status Text

private struct PulsingStatusText: View {
    let status: ServiceStatus
    @State private var pulse = false

    private var isTransitioning: Bool {
        status == .starting || status == .stopping
    }

    private var color: Color {
        switch status {
        case .running:  return TerminalTheme.green
        case .stopped:  return TerminalTheme.red
        case .starting: return TerminalTheme.yellow
        case .stopping: return TerminalTheme.yellow
        case .unknown:  return TerminalTheme.gray
        }
    }

    var body: some View {
        Text(status.rawValue.lowercased())
            .font(.system(size: 10, design: .monospaced))
            .foregroundColor(color)
            .opacity(isTransitioning && pulse ? 0.3 : 1.0)
            .onAppear {
                if isTransitioning {
                    withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                        pulse = true
                    }
                }
            }
            .onChange(of: status) { newStatus in
                let transitioning = newStatus == .starting || newStatus == .stopping
                if transitioning {
                    pulse = false
                    withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                        pulse = true
                    }
                } else {
                    withAnimation(.default) {
                        pulse = false
                    }
                }
            }
    }
}

// MARK: - Status Window View

struct StatusWindowView: View {
    @EnvironmentObject var manager: ServiceManager
    @State private var selectedTab = 0
    @State private var hasAppeared = false

    private static let tabServices = 0
    private static let tabLogs = 1
    private static let tabExtensions = 2
    private static let tabWorkers = 3
    private static let tabSettings = 4

    var body: some View {
        VStack(spacing: 0) {
            // Title bar area
            titleBar

            // Tab bar
            tabBar

            // Tab content
            Group {
                switch selectedTab {
                case Self.tabServices: ServicesTab()
                case Self.tabLogs: LogsTab()
                case Self.tabExtensions: ExtensionsTab()
                case Self.tabWorkers: WorkersTab()
                case Self.tabSettings: DaemonSettingsTab()
                default: ServicesTab()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.opacity)
            .id(selectedTab)
            .animation(.easeInOut(duration: 0.15), value: selectedTab)
        }
        .background(TerminalTheme.bg)
        .frame(minWidth: 700, minHeight: 520)
        .preferredColorScheme(.dark)
        .onAppear {
            if !hasAppeared {
                hasAppeared = true
                selectedTab = Self.tabServices
            }
        }
    }

    // MARK: - Grid Icon (matches menu bar icon)

    private static func gridIcon(size: CGFloat, color: NSColor) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            let s = rect.width
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

            color.withAlphaComponent(0.45).setStroke()
            for (a, b) in connections {
                let path = NSBezierPath()
                path.move(to: points[a])
                path.line(to: points[b])
                path.lineWidth = s * 0.045
                path.stroke()
            }

            let nodeRadius = s * 0.095
            for (i, p) in points.enumerated() {
                let isCenter = (i == 4)
                let r = isCenter ? nodeRadius * 1.4 : nodeRadius
                color.setFill()
                NSBezierPath(ovalIn: NSRect(
                    x: p.x - r, y: p.y - r,
                    width: r * 2, height: r * 2
                )).fill()
            }
            return true
        }
        return image
    }

    // MARK: - Title Bar

    private var titleBar: some View {
        HStack(spacing: 10) {
            Image(nsImage: Self.gridIcon(
                size: 18,
                color: NSColor(TerminalTheme.accent)
            ))

            ZStack {
                // Glow layer behind the brand text
                (Text("Legion")
                    .foregroundColor(TerminalTheme.accent)
                + Text("IO")
                    .foregroundColor(TerminalTheme.text))
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .blur(radius: 6)
                    .opacity(0.3)

                // Crisp brand text
                (Text("Legion")
                    .foregroundColor(TerminalTheme.accent)
                + Text("IO")
                    .foregroundColor(TerminalTheme.text))
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
            }

            statusPill

            Spacer()

            if let lastChecked = manager.lastChecked {
                Text(lastChecked, style: .time)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(TerminalTheme.textDim)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            ZStack {
                TerminalTheme.surfaceBg
                // Subtle gradient adding depth
                LinearGradient(
                    colors: [TerminalTheme.accent.opacity(0.03), Color.clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        )
    }

    private var statusPill: some View {
        let color: Color = {
            switch manager.overallStatus {
            case .online: return TerminalTheme.green
            case .offline: return TerminalTheme.red
            case .setupNeeded: return TerminalTheme.yellow
            case .checking: return TerminalTheme.gray
            }
        }()

        return BreathingStatusPill(color: color, text: manager.overallStatus.displayText, isOnline: manager.overallStatus == .online)
    }

    // MARK: - Tab Bar

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                tabButton(title: "Services", icon: "server.rack", index: Self.tabServices)
                tabButton(title: "Logs", icon: "terminal", index: Self.tabLogs)
                tabButton(title: "Extensions", icon: "puzzlepiece.extension", index: Self.tabExtensions)
                tabButton(title: "Workers", icon: "gearshape.2", index: Self.tabWorkers)
                tabButton(title: "Settings", icon: "gearshape", index: Self.tabSettings)
            }
        }
        .background(TerminalTheme.bg)
        .overlay(
            Rectangle()
                .fill(TerminalTheme.border)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private func tabButton(title: String, icon: String, index: Int) -> some View {
        let isSelected = selectedTab == index
        return Button(action: { withAnimation(.easeInOut(duration: 0.15)) { selectedTab = index } }) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                Text(title)
                    .font(.system(size: 12, weight: isSelected ? .semibold : .regular, design: .monospaced))
            }
            .foregroundColor(isSelected ? TerminalTheme.accent : TerminalTheme.textDim)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .background(isSelected ? TerminalTheme.surfaceBg : Color.clear)
            .overlay(
                Rectangle()
                    .fill(isSelected ? TerminalTheme.accent : Color.clear)
                    .frame(height: 2),
                alignment: .bottom
            )
        }
        .buttonStyle(.plain)
        .pointerCursor()
    }
}

// MARK: - Services Tab

struct ServicesTab: View {
    @EnvironmentObject var manager: ServiceManager

    private var anyTransitioning: Bool {
        manager.services.contains { $0.status == .starting || $0.status == .stopping }
    }

    private var allRunning: Bool {
        manager.services.allSatisfy { $0.status == .running }
    }

    private var allStopped: Bool {
        manager.services.allSatisfy { $0.status == .stopped || $0.status == .unknown }
    }

    var body: some View {
        VStack(spacing: 0) {
            servicesHeader

            ScrollView {
                VStack(spacing: 12) {
                    // Service Cards
                    ForEach(manager.services) { service in
                        if service.name == .legionio {
                            daemonCard(service)
                        } else {
                            serviceCard(service)
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(TerminalTheme.bg)
    }

    // MARK: - Header

    private var servicesHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: "server.rack")
                .font(.system(size: 11))
                .foregroundColor(TerminalTheme.accent)

            Text("SERVICES")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(TerminalTheme.textDim)

            Spacer()

            HStack(spacing: 6) {
                terminalButton("start all", color: TerminalTheme.green) {
                    manager.startAll()
                }
                .disabled(anyTransitioning || allRunning)
                .opacity(anyTransitioning || allRunning ? 0.4 : 1)

                terminalButton("stop all", color: TerminalTheme.red) {
                    manager.stopAll()
                }
                .disabled(anyTransitioning || allStopped)
                .opacity(anyTransitioning || allStopped ? 0.4 : 1)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 36)
        .background(TerminalTheme.surfaceBg)
        .overlay(
            Rectangle()
                .fill(TerminalTheme.border)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Daemon Card (LegionIO with components)

    private func daemonCard(_ service: ServiceState) -> some View {
        HoverCard {
            VStack(spacing: 0) {
                // Main service row
                HStack(spacing: 12) {
                    statusDot(service.status)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(service.name.displayName)
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .foregroundColor(TerminalTheme.text)

                        HStack(spacing: 8) {
                            statusText(service.status)

                            if let pid = service.pid {
                                Text("pid:\(String(pid))")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(TerminalTheme.textDim)
                            }
                        }
                    }

                    Spacer()

                    // Control buttons: start/stop
                    HStack(spacing: 6) {
                        if service.status == .stopping || service.status == .starting {
                            // No button while transitioning
                        } else if service.status == .running {
                            terminalButton("stop", color: TerminalTheme.red) {
                                manager.stopService(service.name)
                            }
                        } else {
                            terminalButton("start", color: TerminalTheme.green) {
                                manager.startService(service.name)
                            }
                        }
                    }
                }
                .padding(12)

                // Daemon Components (inline)
                if service.status == .running && !manager.daemonReadiness.components.isEmpty {
                    Rectangle()
                        .fill(TerminalTheme.border)
                        .frame(height: 1)
                        .padding(.horizontal, 12)

                    VStack(alignment: .leading, spacing: 6) {
                        LazyVGrid(columns: [
                            GridItem(.adaptive(minimum: 120), spacing: 4)
                        ], spacing: 4) {
                            ForEach(
                                manager.daemonReadiness.components.sorted(by: { $0.key < $1.key }),
                                id: \.key
                            ) { component, ready in
                                HStack(spacing: 4) {
                                    Circle()
                                        .fill(ready ? TerminalTheme.green : TerminalTheme.yellow)
                                        .frame(width: 5, height: 5)
                                    Text(component)
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundColor(TerminalTheme.textDim)
                                    Spacer()
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
            }
        }
    }

    // MARK: - Standard Service Card

    private func serviceCard(_ service: ServiceState) -> some View {
        HoverCard {
            HStack(spacing: 12) {
                // Status indicator
                statusDot(service.status)

                // Service info
                VStack(alignment: .leading, spacing: 2) {
                    Text(service.name.displayName)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(TerminalTheme.text)

                    HStack(spacing: 8) {
                        statusText(service.status)

                        if let pid = service.pid {
                            Text("pid:\(String(pid))")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(TerminalTheme.textDim)
                        }
                    }
                }

                Spacer()

                // Control button
                if service.status == .stopping || service.status == .starting {
                    // No button while transitioning
                } else if service.status == .running {
                    terminalButton("stop", color: TerminalTheme.red) {
                        manager.stopService(service.name)
                    }
                } else {
                    terminalButton("start", color: TerminalTheme.green) {
                        manager.startService(service.name)
                    }
                }
            }
            .padding(12)
        }
    }

    private func statusDot(_ status: ServiceStatus) -> some View {
        let color = statusColor(status)
        return ZStack {
            Circle()
                .fill(color.opacity(0.2))
                .frame(width: 20, height: 20)
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
                .shadow(color: color.opacity(0.5), radius: 4)
        }
    }

    private func statusColor(_ status: ServiceStatus) -> Color {
        switch status {
        case .running:  return TerminalTheme.green
        case .stopped:  return TerminalTheme.red
        case .starting: return TerminalTheme.yellow
        case .stopping: return TerminalTheme.yellow
        case .unknown:  return TerminalTheme.gray
        }
    }

    private func statusText(_ status: ServiceStatus) -> some View {
        PulsingStatusText(status: status)
    }

    private func terminalButton(_ label: String, color: Color, action: @escaping () -> Void) -> some View {
        TerminalActionButton(label: label, color: color, action: action)
    }

}

// MARK: - Terminal Action Button (with hover)

private struct TerminalActionButton: View {
    let label: String
    let color: Color
    let action: () -> Void
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundColor(isHovered ? TerminalTheme.bg : color)
                .frame(minWidth: 40)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(isHovered ? color : color.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(color.opacity(isHovered ? 0.6 : 0.3), lineWidth: 1)
                )
                .cornerRadius(4)
        }
        .buttonStyle(.plain)
        .pointerCursor()
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.12)) {
                isHovered = hovering
            }
        }
    }
}

// MARK: - Terminal Checkbox Style

struct TerminalCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            ZStack {
                RoundedRectangle(cornerRadius: 3.5)
                    .fill(configuration.isOn ? TerminalTheme.accent : TerminalTheme.cardBg)
                    .frame(width: 14, height: 14)

                RoundedRectangle(cornerRadius: 3.5)
                    .stroke(
                        configuration.isOn ? TerminalTheme.accent : TerminalTheme.textDim.opacity(0.3),
                        lineWidth: 1
                    )
                    .frame(width: 14, height: 14)

                if configuration.isOn {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundColor(.white)
                }
            }
            .contentShape(Rectangle())
            .animation(.easeInOut(duration: 0.15), value: configuration.isOn)

            configuration.label
        }
        .onTapGesture {
            configuration.isOn.toggle()
        }
    }
}

// MARK: - Logs Tab

struct LogsTab: View {
    @EnvironmentObject var manager: ServiceManager
    @State private var autoScroll = true

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack(spacing: 12) {
                Image(systemName: "terminal")
                    .font(.system(size: 11))
                    .foregroundColor(TerminalTheme.accent)

                Text("LOGS")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundColor(TerminalTheme.textDim)

                Text("— ~/.legionio/legionio/logs/legion.log")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(TerminalTheme.textDim.opacity(0.5))

                Spacer()

                Toggle(isOn: $autoScroll) {
                    Text("auto-scroll")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundColor(TerminalTheme.textDim)
                }
                .toggleStyle(TerminalCheckboxStyle())

                Button(action: { manager.clearLogs() }) {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark.circle")
                            .font(.system(size: 10))
                        Text("clear logs")
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                    }
                    .foregroundColor(TerminalTheme.textDim)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(TerminalTheme.textDim.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 3)
                            .stroke(TerminalTheme.textDim.opacity(0.2), lineWidth: 1)
                    )
                    .cornerRadius(3)
                }
                .buttonStyle(.plain)
                .pointerCursor()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(height: 36)
            .background(TerminalTheme.surfaceBg)
            .overlay(
                Rectangle()
                    .fill(TerminalTheme.border)
                    .frame(height: 1),
                alignment: .bottom
            )

            // Log content
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    Text(manager.logContents.isEmpty ? "waiting for log output..." : manager.logContents)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(
                            manager.logContents.isEmpty
                                ? TerminalTheme.textDim
                                : TerminalTheme.green.opacity(0.85)
                        )
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(12)

                    Color.clear
                        .frame(height: 1)
                        .id("logEnd")
                }
                .background(TerminalTheme.bg)
                .onChange(of: manager.logContents) { _ in
                    if autoScroll {
                        withAnimation(.easeOut(duration: 0.1)) {
                            proxy.scrollTo("logEnd", anchor: .bottom)
                        }
                    }
                }
            }
        }
        .onAppear { manager.startFastLogPolling() }
        .onDisappear { manager.stopFastLogPolling() }
    }
}

// NOTE: Tab views (ExtensionsTab, WorkersTab, DaemonSettingsTab)
// are defined in their own dedicated files.

