import Foundation

@objc(ThemedStyler)
class ThemedStyler: NSObject {
  
  @objc
  func renderCss(_ usageJson: String, themesJson: String) -> String {
    return callRenderCss(usageJson, themesJson: themesJson) ?? ""
  }
  
  @objc
  func getRnStyles(_ selector: String, classesJson: String, themesJson: String) -> String {
    return callGetRnStyles(selector, classesJson: classesJson, themesJson: themesJson) ?? "{}"
  }
  
  @objc
  func getDefaultState() -> String {
    return callGetDefaultState() ?? "{}"
  }
  
  @objc
  func getVersion() -> String {
    return callGetVersion() ?? "unknown"
  }
  
  private func callRenderCss(_ usageJson: String, themesJson: String) -> String? {
    let usageData = usageJson.data(using: .utf8)!
    let themesData = themesJson.data(using: .utf8)!
    
    let resultPtr = usageData.withUnsafeBytes { usageBytes in
      themesData.withUnsafeBytes { themesBytes in
        themed_styler_render_css(
          usageBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
          usageData.count,
          themesBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
          themesData.count
        )
      }
    }
    
    guard let ptr = resultPtr else {
      return nil
    }
    
    let result = String(cString: ptr)
    themed_styler_free_string(UnsafeMutablePointer(mutating: ptr))
    return result
  }
  
  private func callGetRnStyles(_ selector: String, classesJson: String, themesJson: String) -> String? {
    let selectorData = selector.data(using: .utf8)!
    let classesData = classesJson.data(using: .utf8)!
    let themesData = themesJson.data(using: .utf8)!
    
    let resultPtr = selectorData.withUnsafeBytes { selectorBytes in
      classesData.withUnsafeBytes { classesBytes in
        themesData.withUnsafeBytes { themesBytes in
          themed_styler_get_rn_styles(
            selectorBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
            selectorData.count,
            classesBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
            classesData.count,
            themesBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
            themesData.count
          )
        }
      }
    }
    
    guard let ptr = resultPtr else {
      return nil
    }
    
    let result = String(cString: ptr)
    themed_styler_free_string(UnsafeMutablePointer(mutating: ptr))
    return result
  }
  
  private func callGetDefaultState() -> String? {
    guard let ptr = themed_styler_get_default_state() else {
      return nil
    }
    let result = String(cString: ptr)
    themed_styler_free_string(UnsafeMutablePointer(mutating: ptr))
    return result
  }
  
  private func callGetVersion() -> String? {
    guard let ptr = themed_styler_version() else {
      return nil
    }
    let version = String(cString: ptr)
    themed_styler_free_string(UnsafeMutablePointer(mutating: ptr))
    return version
  }
}

// C FFI declarations
@_silgen_name("themed_styler_render_css")
func themed_styler_render_css(_ usagePtr: UnsafePointer<UInt8>, _ usageLen: Int, _ themesPtr: UnsafePointer<UInt8>, _ themesLen: Int) -> UnsafeMutablePointer<CChar>?

@_silgen_name("themed_styler_get_rn_styles")
func themed_styler_get_rn_styles(_ selectorPtr: UnsafePointer<UInt8>, _ selectorLen: Int, _ classesPtr: UnsafePointer<UInt8>, _ classesLen: Int, _ themesPtr: UnsafePointer<UInt8>, _ themesLen: Int) -> UnsafeMutablePointer<CChar>?

@_silgen_name("themed_styler_get_default_state")
func themed_styler_get_default_state() -> UnsafeMutablePointer<CChar>?

@_silgen_name("themed_styler_version")
func themed_styler_version() -> UnsafeMutablePointer<CChar>?

@_silgen_name("themed_styler_free_string")
func themed_styler_free_string(_ ptr: UnsafeMutablePointer<CChar>)
