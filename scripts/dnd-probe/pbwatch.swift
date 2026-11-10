// Logs every new drag's macOS pasteboard contents (all items, all types) to stdout.
import AppKit
let pb = NSPasteboard(name: .drag)
var last = pb.changeCount
let df = ISO8601DateFormatter(); df.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
func dump() {
  print("=== drag pasteboard changed \(df.string(from: Date())) changeCount=\(pb.changeCount)")
  for (i, item) in (pb.pasteboardItems ?? []).enumerated() {
    print(" item \(i):")
    for t in item.types {
      if let s = item.string(forType: t) { print("   \(t.rawValue) = \(s.prefix(300).replacingOccurrences(of: "\n", with: "\\n"))") }
      else if let d = item.data(forType: t) {
        let plist = (try? PropertyListSerialization.propertyList(from: d, format: nil)).map { "\($0)".prefix(300).replacingOccurrences(of: "\n", with: " ") }
        print("   \(t.rawValue) = <\(d.count) bytes> \(plist ?? "")")
      } else { print("   \(t.rawValue) = <no data / promised>") }
    }
  }
  fflush(stdout)
}
dump()
while true { usleep(100_000); if pb.changeCount != last { last = pb.changeCount; usleep(300_000); dump() } }
