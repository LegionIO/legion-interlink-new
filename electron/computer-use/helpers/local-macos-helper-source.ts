export const LOCAL_MACOS_HELPER_SOURCE = String.raw`
import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit

let syntheticEventTag: Int64 = 0x4C47494F
let syntheticSource = CGEventSource(stateID: .privateState)

func printJson(_ value: Any) {
  if let data = try? JSONSerialization.data(withJSONObject: value, options: []),
     let string = String(data: data, encoding: .utf8) {
    print(string)
    fflush(stdout)
  }
}

func primaryDisplayID() -> CGDirectDisplayID {
  CGMainDisplayID()
}

/// Get all active displays sorted left-to-right by their global X position.
func allDisplaysSorted() -> [CGDirectDisplayID] {
  var displayCount: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &displayCount)
  guard displayCount > 0 else { return [primaryDisplayID()] }
  var displays = [CGDirectDisplayID](repeating: 0, count: Int(displayCount))
  CGGetActiveDisplayList(displayCount, &displays, &displayCount)
  displays = Array(displays.prefix(Int(displayCount)))
  displays.sort { CGDisplayBounds($0).origin.x < CGDisplayBounds($1).origin.x }
  return displays
}

/// Build display info dictionary for a given display.
func displayInfoDict(_ displayId: CGDirectDisplayID) -> [String: Any] {
  let bounds = CGDisplayBounds(displayId)
  let pixelWidth = Int(CGDisplayPixelsWide(displayId))
  let pixelHeight = Int(CGDisplayPixelsHigh(displayId))
  let logicalWidth = Int(bounds.width.rounded())
  let logicalHeight = Int(bounds.height.rounded())
  let globalX = Int(bounds.origin.x.rounded())
  let globalY = Int(bounds.origin.y.rounded())
  let scaleFactor = pixelWidth > 0 && logicalWidth > 0 ? Double(pixelWidth) / Double(logicalWidth) : 1.0

  var name = "Display \(displayId)"
  for screen in NSScreen.screens {
    if let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID,
       screenNumber == displayId {
      name = screen.localizedName
      break
    }
  }

  return [
    "displayId": String(displayId),
    "name": name,
    "pixelWidth": pixelWidth,
    "pixelHeight": pixelHeight,
    "logicalWidth": logicalWidth,
    "logicalHeight": logicalHeight,
    "globalX": globalX,
    "globalY": globalY,
    "scaleFactor": scaleFactor,
    "isPrimary": displayId == CGMainDisplayID(),
  ]
}

func buildDisplayLayoutArray() -> [[String: Any]] {
  return allDisplaysSorted().map { displayInfoDict($0) }
}

func desktopBounds() -> CGRect {
  CGDisplayBounds(primaryDisplayID())
}

func desktopCoordinateWidth() -> Int {
  Int(desktopBounds().width.rounded())
}

func desktopCoordinateHeight() -> Int {
  Int(desktopBounds().height.rounded())
}

func desktopPixelWidth() -> Int {
  Int(CGDisplayPixelsWide(primaryDisplayID()))
}

func desktopPixelHeight() -> Int {
  Int(CGDisplayPixelsHigh(primaryDisplayID()))
}

func convertTopLeftToQuartz(_ x: Double, _ y: Double) -> CGPoint {
  let bounds = desktopBounds()
  return CGPoint(x: bounds.minX + x, y: bounds.minY + y)
}

func convertQuartzToTopLeft(_ x: Double, _ y: Double) -> CGPoint {
  let bounds = desktopBounds()
  return CGPoint(x: x - bounds.minX, y: y - bounds.minY)
}

func currentPointerTopLeft() -> CGPoint {
  guard let event = CGEvent(source: nil) else {
    return CGPoint(x: 0, y: 0)
  }
  let location = event.location
  return convertQuartzToTopLeft(location.x, location.y)
}

@discardableResult
func sleepMillis(_ ms: Int) -> Bool {
  if ms <= 0 { return true }
  usleep(useconds_t(ms * 1000))
  return true
}

func parseIntArg(_ args: [String], _ index: Int, default value: Int) -> Int {
  guard args.count > index, let parsed = Int(args[index]) else {
    return value
  }
  return parsed
}

enum PointerMovementPath: String {
  case teleport = "teleport"
  case direct = "direct"
  case horizontalFirst = "horizontal-first"
  case verticalFirst = "vertical-first"
}

func parseMovementPathArg(_ args: [String], _ index: Int, default value: PointerMovementPath = .teleport) -> PointerMovementPath {
  guard args.count > index else {
    return value
  }
  return PointerMovementPath(rawValue: args[index]) ?? value
}

func makeMouseEvent(_ type: CGEventType, x: Double, y: Double, button: CGMouseButton = .left, clickState: Int64? = nil) -> CGEvent? {
  let point = convertTopLeftToQuartz(x, y)
  let event = CGEvent(mouseEventSource: syntheticSource, mouseType: type, mouseCursorPosition: point, mouseButton: button)
  event?.setIntegerValueField(.eventSourceUserData, value: syntheticEventTag)
  if let clickState {
    event?.setIntegerValueField(.mouseEventClickState, value: clickState)
  }
  return event
}

func postMouse(_ type: CGEventType, x: Double, y: Double, button: CGMouseButton = .left, clickState: Int64? = nil) {
  guard let event = makeMouseEvent(type, x: x, y: y, button: button, clickState: clickState) else {
    return
  }
  event.post(tap: .cghidEventTap)
}

func warpPointer(to point: CGPoint) {
  CGWarpMouseCursorPosition(convertTopLeftToQuartz(point.x, point.y))
}

func animatePointerSegment(from start: CGPoint, to end: CGPoint, durationMs: Int, steps: Int, dragMode: Bool = false) {
  let effectiveSteps = max(1, steps)
  let totalDuration = max(0, durationMs)
  let pauseMs = effectiveSteps > 0 ? max(1, totalDuration / effectiveSteps) : 0
  for step in 1...effectiveSteps {
    let progress = Double(step) / Double(effectiveSteps)
    let x = start.x + ((end.x - start.x) * progress)
    let y = start.y + ((end.y - start.y) * progress)
    postMouse(dragMode ? .leftMouseDragged : .mouseMoved, x: x, y: y)
    _ = sleepMillis(pauseMs)
  }
}

func animatePointerMove(from start: CGPoint, to end: CGPoint, durationMs: Int, steps: Int, path: PointerMovementPath = .teleport, dragMode: Bool = false) {
  if path == .teleport {
    if dragMode {
      postMouse(.leftMouseDragged, x: end.x, y: end.y)
      return
    }
    warpPointer(to: end)
    return
  }

  let dx = end.x - start.x
  let dy = end.y - start.y
  let absX = abs(dx)
  let absY = abs(dy)

  if path == .direct || absX < 2 || absY < 2 {
    animatePointerSegment(from: start, to: end, durationMs: durationMs, steps: steps, dragMode: dragMode)
    return
  }

  let corner = path == .horizontalFirst
    ? CGPoint(x: end.x, y: start.y)
    : CGPoint(x: start.x, y: end.y)
  let totalDistance = max(1, absX + absY)
  let firstDistance = path == .horizontalFirst ? absX : absY
  let firstRatio = firstDistance / totalDistance
  let totalDuration = max(2, durationMs)
  let totalSteps = max(2, steps)
  let firstDuration = max(1, Int(Double(totalDuration) * firstRatio))
  let secondDuration = max(1, totalDuration - firstDuration)
  let firstSteps = max(1, Int(Double(totalSteps) * firstRatio))
  let secondSteps = max(1, totalSteps - firstSteps)

  animatePointerSegment(from: start, to: corner, durationMs: firstDuration, steps: firstSteps, dragMode: dragMode)
  animatePointerSegment(from: corner, to: end, durationMs: secondDuration, steps: secondSteps, dragMode: dragMode)
}

func dragPointer(from start: CGPoint, to end: CGPoint, durationMs: Int, steps: Int, path: PointerMovementPath = .teleport) {
  if path == .teleport {
    warpPointer(to: start)
  } else {
    postMouse(.mouseMoved, x: start.x, y: start.y)
  }
  postMouse(.leftMouseDown, x: start.x, y: start.y)
  animatePointerMove(from: start, to: end, durationMs: durationMs, steps: steps, path: path, dragMode: true)
  postMouse(.leftMouseUp, x: end.x, y: end.y)
}

func postKeyboardEvent(keyCode: CGKeyCode, keyDown: Bool, flags: CGEventFlags = []) {
  guard let event = CGEvent(keyboardEventSource: syntheticSource, virtualKey: keyCode, keyDown: keyDown) else {
    return
  }
  event.flags = flags
  event.setIntegerValueField(.eventSourceUserData, value: syntheticEventTag)
  event.post(tap: .cghidEventTap)
}

func postUnicodeText(_ text: String, flags: CGEventFlags = []) {
  let utf16View = Array(text.utf16)
  guard !utf16View.isEmpty,
        let keyDown = CGEvent(keyboardEventSource: syntheticSource, virtualKey: 0, keyDown: true),
        let keyUp = CGEvent(keyboardEventSource: syntheticSource, virtualKey: 0, keyDown: false) else {
    return
  }
  keyDown.flags = flags
  keyUp.flags = flags
  keyDown.keyboardSetUnicodeString(stringLength: utf16View.count, unicodeString: utf16View)
  keyUp.keyboardSetUnicodeString(stringLength: utf16View.count, unicodeString: utf16View)
  keyDown.setIntegerValueField(.eventSourceUserData, value: syntheticEventTag)
  keyUp.setIntegerValueField(.eventSourceUserData, value: syntheticEventTag)
  keyDown.post(tap: .cghidEventTap)
  keyUp.post(tap: .cghidEventTap)
}

func typeCharacterByCharacter(_ text: String, delayMs: Int) {
  let pause = max(0, delayMs)
  for character in text {
    if character == "\n" || character == "\r" {
      postKeyboardEvent(keyCode: 36, keyDown: true)
      postKeyboardEvent(keyCode: 36, keyDown: false)
    } else if character == "\t" {
      postKeyboardEvent(keyCode: 48, keyDown: true)
      postKeyboardEvent(keyCode: 48, keyDown: false)
    } else {
      postUnicodeText(String(character))
    }
    _ = sleepMillis(pause)
  }
}

func modifierFlags(for key: String) -> CGEventFlags? {
  switch key.lowercased() {
  case "command", "cmd": return .maskCommand
  case "shift": return .maskShift
  case "option", "alt": return .maskAlternate
  case "control", "ctrl": return .maskControl
  default: return nil
  }
}

func keyCode(for key: String) -> CGKeyCode? {
  switch key.lowercased() {
  case "a": return 0
  case "s": return 1
  case "d": return 2
  case "f": return 3
  case "h": return 4
  case "g": return 5
  case "z": return 6
  case "x": return 7
  case "c": return 8
  case "v": return 9
  case "b": return 11
  case "q": return 12
  case "w": return 13
  case "e": return 14
  case "r": return 15
  case "y": return 16
  case "t": return 17
  case "1": return 18
  case "2": return 19
  case "3": return 20
  case "4": return 21
  case "6": return 22
  case "5": return 23
  case "=", "plus": return 24
  case "9": return 25
  case "7": return 26
  case "-", "minus": return 27
  case "8": return 28
  case "0": return 29
  case "]": return 30
  case "o": return 31
  case "u": return 32
  case "[": return 33
  case "i": return 34
  case "p": return 35
  case "enter", "return": return 36
  case "l": return 37
  case "j": return 38
  case "quote": return 39
  case "k": return 40
  case "semicolon": return 41
  case "backslash": return 42
  case "comma": return 43
  case "slash": return 44
  case "n": return 45
  case "m": return 46
  case "period": return 47
  case "tab": return 48
  case "space": return 49
  case "grave", "backtick": return 50
  case "delete", "backspace": return 51
  case "escape", "esc": return 53
  case "command", "cmd": return 55
  case "shift": return 56
  case "capslock": return 57
  case "option", "alt": return 58
  case "control", "ctrl": return 59
  case "rightshift": return 60
  case "rightoption": return 61
  case "rightcontrol": return 62
  case "function", "fn": return 63
  case "home": return 115
  case "pageup": return 116
  case "forwarddelete": return 117
  case "end": return 119
  case "pagedown": return 121
  case "left": return 123
  case "right": return 124
  case "down": return 125
  case "up": return 126
  default: return nil
  }
}

func pressKeyCombo(_ keys: [String], delayMs: Int) {
  let lowered = keys.map { $0.lowercased() }
  let modifiers = lowered.dropLast().compactMap(modifierFlags)
  let flags = modifiers.reduce(CGEventFlags()) { partial, flag in
    partial.union(flag)
  }
  let primary = lowered.last ?? "enter"

  if let code = keyCode(for: primary) {
    postKeyboardEvent(keyCode: code, keyDown: true, flags: flags)
    _ = sleepMillis(max(12, delayMs / 2))
    postKeyboardEvent(keyCode: code, keyDown: false, flags: flags)
    return
  }

  if primary.count == 1 {
    postUnicodeText(primary, flags: flags)
  }
}

func decodeBase64String(_ value: String) -> String? {
  guard let data = Data(base64Encoded: value) else {
    return nil
  }
  return String(data: data, encoding: .utf8)
}

func eventTypeName(_ type: CGEventType) -> String {
  switch type {
  case .leftMouseDown: return "leftMouseDown"
  case .leftMouseUp: return "leftMouseUp"
  case .rightMouseDown: return "rightMouseDown"
  case .rightMouseUp: return "rightMouseUp"
  case .mouseMoved: return "mouseMoved"
  case .leftMouseDragged: return "leftMouseDragged"
  case .rightMouseDragged: return "rightMouseDragged"
  case .scrollWheel: return "scrollWheel"
  case .keyDown: return "keyDown"
  case .keyUp: return "keyUp"
  case .flagsChanged: return "flagsChanged"
  default: return "other"
  }
}

func eventKind(_ type: CGEventType) -> String {
  switch type {
  case .keyDown, .keyUp, .flagsChanged:
    return "keyboard"
  case .mouseMoved, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .leftMouseDragged, .rightMouseDragged, .scrollWheel:
    return "mouse"
  default:
    return "other"
  }
}

let args = CommandLine.arguments
guard args.count >= 2 else {
  printJson(["ok": false, "error": "Missing command"])
  exit(1)
}

switch args[1] {
case "permissions":
  let result: [String: Any] = [
    "ok": true,
    "accessibilityTrusted": AXIsProcessTrusted(),
    "screenRecordingGranted": CGPreflightScreenCaptureAccess(),
    "automationGranted": true,
    "desktopCoordinateWidth": desktopCoordinateWidth(),
    "desktopCoordinateHeight": desktopCoordinateHeight(),
    "desktopWidth": desktopPixelWidth(),
    "desktopHeight": desktopPixelHeight(),
  ]
  printJson(result)

case "requestScreenRecording":
  var granted = CGPreflightScreenCaptureAccess()
  if !granted {
    granted = CGRequestScreenCaptureAccess()
  }
  printJson([
    "ok": true,
    "screenRecordingGranted": granted,
    "desktopCoordinateWidth": desktopCoordinateWidth(),
    "desktopCoordinateHeight": desktopCoordinateHeight(),
    "desktopWidth": desktopPixelWidth(),
    "desktopHeight": desktopPixelHeight(),
  ])

case "move":
  guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    printJson(["ok": false, "error": "Expected x y [durationMs] [steps] [movementPath]"])
    exit(1)
  }
  let durationMs = parseIntArg(args, 4, default: 140)
  let steps = parseIntArg(args, 5, default: 14)
  let movementPath = parseMovementPathArg(args, 6)
  let start = currentPointerTopLeft()
  animatePointerMove(from: start, to: CGPoint(x: x, y: y), durationMs: durationMs, steps: steps, path: movementPath)
  printJson(["ok": true])

case "drag":
  guard args.count >= 6,
        let startX = Double(args[2]),
        let startY = Double(args[3]),
        let endX = Double(args[4]),
        let endY = Double(args[5]) else {
    printJson(["ok": false, "error": "Expected startX startY endX endY [durationMs] [steps] [movementPath]"])
    exit(1)
  }
  let durationMs = parseIntArg(args, 6, default: 260)
  let steps = parseIntArg(args, 7, default: 24)
  let movementPath = parseMovementPathArg(args, 8)
  dragPointer(from: CGPoint(x: startX, y: startY), to: CGPoint(x: endX, y: endY), durationMs: durationMs, steps: steps, path: movementPath)
  printJson(["ok": true])

case "click":
  guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    printJson(["ok": false, "error": "Expected x y [durationMs] [movementPath]"])
    exit(1)
  }
  let durationMs = parseIntArg(args, 4, default: 110)
  let movementPath = parseMovementPathArg(args, 5)
  let start = currentPointerTopLeft()
  animatePointerMove(from: start, to: CGPoint(x: x, y: y), durationMs: durationMs, steps: 10, path: movementPath)
  postMouse(.leftMouseDown, x: x, y: y)
  postMouse(.leftMouseUp, x: x, y: y)
  printJson(["ok": true])

case "doubleClick":
  guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    printJson(["ok": false, "error": "Expected x y [durationMs] [movementPath]"])
    exit(1)
  }
  let durationMs = parseIntArg(args, 4, default: 120)
  let movementPath = parseMovementPathArg(args, 5)
  let start = currentPointerTopLeft()
  animatePointerMove(from: start, to: CGPoint(x: x, y: y), durationMs: durationMs, steps: 12, path: movementPath)
  postMouse(.leftMouseDown, x: x, y: y, clickState: 1)
  postMouse(.leftMouseUp, x: x, y: y, clickState: 1)
  _ = sleepMillis(55)
  postMouse(.leftMouseDown, x: x, y: y, clickState: 2)
  postMouse(.leftMouseUp, x: x, y: y, clickState: 2)
  printJson(["ok": true])

case "scroll":
  guard args.count >= 4, let dx = Int32(args[2]), let dy = Int32(args[3]) else {
    printJson(["ok": false, "error": "Expected dx dy"])
    exit(1)
  }
  let event = CGEvent(scrollWheelEvent2Source: syntheticSource, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)
  event?.setIntegerValueField(.eventSourceUserData, value: syntheticEventTag)
  event?.post(tap: .cghidEventTap)
  printJson(["ok": true])

case "typeText":
  guard args.count >= 3 else {
    printJson(["ok": false, "error": "Expected base64Text [delayMs]"])
    exit(1)
  }
  guard let decoded = decodeBase64String(args[2]) else {
    printJson(["ok": false, "error": "Invalid base64 text"])
    exit(1)
  }
  let delayMs = parseIntArg(args, 3, default: 45)
  typeCharacterByCharacter(decoded, delayMs: delayMs)
  printJson(["ok": true])

case "pressKeys":
  guard args.count >= 3 else {
    printJson(["ok": false, "error": "Expected base64 JSON key list [delayMs]"])
    exit(1)
  }
  guard let decoded = decodeBase64String(args[2]),
        let data = decoded.data(using: .utf8),
        let keys = try? JSONSerialization.jsonObject(with: data) as? [String],
        !keys.isEmpty else {
    printJson(["ok": false, "error": "Invalid key list"])
    exit(1)
  }
  let delayMs = parseIntArg(args, 3, default: 50)
  pressKeyCombo(keys, delayMs: delayMs)
  printJson(["ok": true])

case "pointer":
  let pointer = currentPointerTopLeft()
  printJson(["ok": true, "pointerX": pointer.x, "pointerY": pointer.y])

case "monitor":
  let mask = (
    (1 << CGEventType.mouseMoved.rawValue)
    | (1 << CGEventType.leftMouseDown.rawValue)
    | (1 << CGEventType.leftMouseUp.rawValue)
    | (1 << CGEventType.rightMouseDown.rawValue)
    | (1 << CGEventType.rightMouseUp.rawValue)
    | (1 << CGEventType.leftMouseDragged.rawValue)
    | (1 << CGEventType.rightMouseDragged.rawValue)
    | (1 << CGEventType.scrollWheel.rawValue)
    | (1 << CGEventType.keyDown.rawValue)
    | (1 << CGEventType.keyUp.rawValue)
    | (1 << CGEventType.flagsChanged.rawValue)
  )

  guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(mask),
    callback: { _, type, event, _ in
      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        printJson([
          "ok": false,
          "event": "monitor-disabled",
          "reason": type == .tapDisabledByTimeout ? "timeout" : "user-input",
        ])
        fflush(stdout)
        exit(75)
      }

      let sourcePid = event.getIntegerValueField(.eventSourceUnixProcessID)
      let sourceState = event.getIntegerValueField(.eventSourceStateID)
      let sourceTag = event.getIntegerValueField(.eventSourceUserData)
      if sourcePid == Int64(getpid())
        || sourceTag == syntheticEventTag
        || sourceState == Int64(CGEventSourceStateID.privateState.rawValue) {
        return Unmanaged.passUnretained(event)
      }

      let location = event.location
      let topLeft = convertQuartzToTopLeft(location.x, location.y)
      var payload: [String: Any] = [
        "ok": true,
        "event": "takeover",
        "eventType": eventTypeName(type),
        "kind": eventKind(type),
        "x": topLeft.x,
        "y": topLeft.y,
        "timestampMs": Int(Date().timeIntervalSince1970 * 1000),
      ]

      if type == .keyDown || type == .keyUp || type == .flagsChanged {
        payload["keyCode"] = event.getIntegerValueField(.keyboardEventKeycode)
      }
      if type == .scrollWheel {
        payload["deltaX"] = event.getIntegerValueField(.scrollWheelEventDeltaAxis2)
        payload["deltaY"] = event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
      }

      printJson(payload)
      return Unmanaged.passUnretained(event)
    },
    userInfo: nil
  ) else {
    printJson(["ok": false, "error": "Unable to start monitor tap. Grant Accessibility permissions and retry."])
    exit(1)
  }

  let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  printJson(["ok": true, "event": "monitor-started"])
  CFRunLoopRun()

case "screenshot":
  // args: screenshot <base64ExcludeApps> <jpegQuality> [displayIndex] [excludePid]
  // When displayIndex is provided, capture only that display (0-indexed from allDisplaysSorted).
  // When excludePid is provided, exclude all windows owned by that process (and its children).
  if #available(macOS 12.3, *) {
    let excludeAppNames: [String]
    if args.count >= 3, let decoded = decodeBase64String(args[2]),
       let data = decoded.data(using: .utf8),
       let names = try? JSONSerialization.jsonObject(with: data) as? [String] {
      excludeAppNames = names
    } else {
      excludeAppNames = []
    }
    let jpegQuality: Double
    if args.count >= 4, let q = Double(args[3]) {
      jpegQuality = max(0.1, min(q, 1.0))
    } else {
      jpegQuality = 0.8
    }
    let requestedDisplayIndex: Int? = args.count >= 5 ? Int(args[4]) : nil
    let excludePid: pid_t? = args.count >= 6 ? pid_t(args[5]) : nil

    let sem = DispatchSemaphore(value: 0)
    var captureResult: [String: Any] = ["ok": false, "error": "timeout"]

    Task {
      do {
        let content = try await SCShareableContent.current
        let allDisplays = content.displays.sorted { $0.frame.origin.x < $1.frame.origin.x }
        guard !allDisplays.isEmpty else {
          captureResult = ["ok": false, "error": "No displays found"]
          sem.signal()
          return
        }

        // Select the target display
        let targetDisplay: SCDisplay
        if let idx = requestedDisplayIndex, idx >= 0 && idx < allDisplays.count {
          targetDisplay = allDisplays[idx]
        } else {
          targetDisplay = allDisplays.first!
        }

        let excludeSet = Set(excludeAppNames.map { $0.lowercased() })
        let excludedWindows = content.windows.filter { window in
          guard let app = window.owningApplication else { return false }
          let layer = window.windowLayer
          // Only exclude normal application windows (layer 0) and our own
          // overlay windows (layer >= 1000, i.e. screen-saver level).
          // Everything else — menu bar (24), status items (25), dropdown
          // menus (3/101), dock (20), etc. — must be preserved, because
          // ScreenCaptureKit suppresses the entire composited contribution
          // of excluded windows, which hides system menus the AI needs.
          let isNormalWindow = layer == 0
          let isHighOverlay = layer >= 1000 && layer < 2_000_000_000
          if !isNormalWindow && !isHighOverlay { return false }
          // Exclude by PID (our own process's normal + overlay windows)
          if let pid = excludePid, app.processID == pid {
            return true
          }
          // Exclude other apps only at normal window level
          if isNormalWindow {
            return excludeSet.contains(app.applicationName.lowercased())
          }
          return false
        }

        let filter = SCContentFilter(display: targetDisplay, excludingWindows: excludedWindows)

        let config = SCStreamConfiguration()
        config.width = targetDisplay.width
        config.height = targetDisplay.height
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false

        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

        let bitmapRep = NSBitmapImageRep(cgImage: image)
        guard let jpegData = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: NSNumber(value: jpegQuality)]) else {
          captureResult = ["ok": false, "error": "JPEG encoding failed"]
          sem.signal()
          return
        }

        let base64 = jpegData.base64EncodedString()
        // Find which index this display is in our sorted list
        let actualIndex = allDisplays.firstIndex(where: { $0.displayID == targetDisplay.displayID }) ?? 0
        let displayInfo = buildDisplayLayoutArray()
        let thisDisplayInfo = actualIndex < displayInfo.count ? displayInfo[actualIndex] : [:]

        captureResult = [
          "ok": true,
          "imageBase64": base64,
          "width": targetDisplay.width,
          "height": targetDisplay.height,
          "displayIndex": actualIndex,
          "displayInfo": thisDisplayInfo,
          "displays": displayInfo,
        ]
      } catch {
        captureResult = ["ok": false, "error": error.localizedDescription]
      }
      sem.signal()
    }

    sem.wait()
    printJson(captureResult)
  } else {
    printJson(["ok": false, "error": "ScreenCaptureKit requires macOS 12.3+"])
    exit(1)
  }

case "displays":
  let layout = buildDisplayLayoutArray()
  printJson([
    "ok": true,
    "displays": layout,
    "displayCount": layout.count,
  ])

default:
  printJson(["ok": false, "error": "Unknown command"])
  exit(1)
}
`;
