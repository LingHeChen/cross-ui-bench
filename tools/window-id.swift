import Foundation
import CoreGraphics
let pid=Int(CommandLine.arguments[1])!
let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as! [[String:Any]]
for window in windows {
 if window[kCGWindowOwnerPID as String] as? Int == pid,
    let bounds=window[kCGWindowBounds as String] as? [String:Any],
    (bounds["Width"] as? Double ?? 0)>500 {
  print(window[kCGWindowNumber as String]!);exit(0)
 }
}
exit(1)
