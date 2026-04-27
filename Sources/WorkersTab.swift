import SwiftUI

// MARK: - Workers Tab

struct WorkersTab: View {
    @StateObject private var cache = DaemonCache.shared
    @State private var searchText = ""

    private var filtered: [CachedWorker] {
        if searchText.isEmpty { return cache.workers }
        let q = searchText.lowercased()
        return cache.workers.filter {
            $0.className.lowercased().contains(q) ||
            $0.id.lowercased().contains(q) ||
            $0.state.lowercased().contains(q)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if cache.workersLoading && !cache.workersLoaded {
                Spacer()
                ProgressView()
                    .controlSize(.small)
                    .tint(TerminalTheme.accent)
                Spacer()
            } else if let error = cache.workersError {
                errorView(error)
            } else if filtered.isEmpty {
                emptyView
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filtered) { worker in
                            workerCard(worker)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
            }
        }
        .background(TerminalTheme.bg)
        .task { await cache.loadWorkers() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "gearshape.2")
                .font(.system(size: 11))
                .foregroundColor(TerminalTheme.accent)

            Text("WORKERS")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(TerminalTheme.textDim)

            if !cache.workers.isEmpty {
                Text("\(cache.workers.count)")
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

            Button(action: { Task { await cache.loadWorkers(force: true) } }) {
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

    // MARK: - Worker Card

    private func workerCard(_ worker: CachedWorker) -> some View {
        HoverCard {
            HStack(spacing: 10) {
                // State dot
                Circle()
                    .fill(stateColor(worker.state))
                    .frame(width: 7, height: 7)
                    .shadow(color: stateColor(worker.state).opacity(0.5), radius: 3)

                VStack(alignment: .leading, spacing: 2) {
                    Text(worker.className)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundColor(TerminalTheme.text)

                    HStack(spacing: 8) {
                        Text("id:\(worker.id)")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(TerminalTheme.textDim)
                            .lineLimit(1)

                        Text(worker.state)
                            .font(.system(size: 9, weight: .semibold, design: .monospaced))
                            .foregroundColor(stateColor(worker.state))

                        if worker.taskCount > 0 {
                            Text("\(worker.taskCount) tasks")
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundColor(TerminalTheme.textDim.opacity(0.6))
                        }
                    }
                }

                Spacer()

                Text(worker.state)
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundColor(stateColor(worker.state))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(stateColor(worker.state).opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(stateColor(worker.state).opacity(0.3), lineWidth: 1)
                    )
                    .cornerRadius(4)
            }
            .padding(10)
        }
    }

    private func stateColor(_ state: String) -> Color {
        switch state {
        case "active", "running": return TerminalTheme.green
        case "paused":            return TerminalTheme.yellow
        case "stopped", "retired": return TerminalTheme.red
        default:                  return TerminalTheme.gray
        }
    }

    // MARK: - Empty / Error

    private var emptyView: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: "gearshape.2")
                .font(.system(size: 28))
                .foregroundColor(TerminalTheme.textDim.opacity(0.3))
            Text("No workers found")
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
            Button("Retry") { Task { await cache.loadWorkers(force: true) } }
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(TerminalTheme.accent)
                .pointerCursor()
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}
