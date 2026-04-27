import SwiftUI

// MARK: - Extensions Tab

struct ExtensionsTab: View {
    @StateObject private var cache = DaemonCache.shared
    @State private var searchText = ""

    private var filtered: [CachedExtension] {
        if searchText.isEmpty { return cache.extensions }
        let q = searchText.lowercased()
        return cache.extensions.filter {
            $0.name.lowercased().contains(q) ||
            $0.namespace.lowercased().contains(q)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            header

            // Content
            if cache.extensionsLoading && !cache.extensionsLoaded {
                Spacer()
                ProgressView()
                    .controlSize(.small)
                    .tint(TerminalTheme.accent)
                Spacer()
            } else if let error = cache.extensionsError {
                errorView(error)
            } else if filtered.isEmpty {
                emptyView
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filtered) { ext in
                            extensionCard(ext)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
        .background(TerminalTheme.bg)
        .task { await cache.loadExtensions() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 11))
                .foregroundColor(TerminalTheme.accent)

            Text("EXTENSIONS")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(TerminalTheme.textDim)

            if !cache.extensions.isEmpty {
                Text("\(cache.extensions.count)")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(TerminalTheme.accent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(TerminalTheme.accent.opacity(0.1))
                    .cornerRadius(3)
            }

            Spacer()

            // Search
            TerminalSearchBox(text: $searchText)

            // Refresh
            Button(action: { Task { await cache.loadExtensions(force: true) } }) {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10))
                    Text("refresh")
                        .font(.system(size: 9, weight: .medium, design: .monospaced))
                }
                .foregroundColor(TerminalTheme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(TerminalTheme.accent.opacity(0.1))
                .overlay(
                    RoundedRectangle(cornerRadius: 3)
                        .stroke(TerminalTheme.accent.opacity(0.2), lineWidth: 1)
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
    }

    // MARK: - Extension Card

    private func extensionCard(_ ext: CachedExtension) -> some View {
        let color = ext.isReady ? TerminalTheme.green : TerminalTheme.gray
        return HoverCard {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    // State dot
                    Circle()
                        .fill(color)
                        .frame(width: 7, height: 7)
                        .shadow(color: color.opacity(0.5), radius: 3)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(ext.name)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundColor(TerminalTheme.text)

                        HStack(spacing: 8) {
                            Text(ext.namespace)
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(TerminalTheme.textDim)

                            Text("v\(ext.version)")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(TerminalTheme.accent.opacity(0.7))

                            Text(ext.displayState)
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundColor(color)
                        }
                    }

                    Spacer()

                    Text(ext.displayState)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(color)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(color.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(color.opacity(0.3), lineWidth: 1)
                        )
                        .cornerRadius(4)
                }
                .padding(10)

                // Runners
                if !ext.runners.isEmpty {
                    Rectangle()
                        .fill(TerminalTheme.border)
                        .frame(height: 1)
                        .padding(.horizontal, 10)

                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(ext.runners, id: \.name) { runner in
                            HStack(spacing: 6) {
                                Image(systemName: "play.circle")
                                    .font(.system(size: 8))
                                    .foregroundColor(TerminalTheme.accent.opacity(0.6))
                                Text(runner.name)
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(TerminalTheme.textDim)
                                Text("\(runner.methodCount) methods")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundColor(TerminalTheme.textDim.opacity(0.6))
                            }
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                }
            }
        }
    }

    // MARK: - Empty / Error

    private var emptyView: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 28))
                .foregroundColor(TerminalTheme.textDim.opacity(0.3))
            Text("No extensions found")
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(TerminalTheme.textDim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundColor(TerminalTheme.yellow)
            Text(message)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(TerminalTheme.textDim)
                .multilineTextAlignment(.center)
            Button("Retry") { Task { await cache.loadExtensions(force: true) } }
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(TerminalTheme.accent)
                .pointerCursor()
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}
