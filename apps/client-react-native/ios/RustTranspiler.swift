import Foundation

@objc(RustTranspiler)
class RustTranspiler: NSObject {
  
  @objc
  func transpile(_ code: String, filename: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let result = transpileCode(code, filename: filename) else {
      reject("TRANSPILE_ERROR", "Failed to transpile code", nil)
      return
    }
    resolve(result)
  }
  
  @objc
  func getVersion() -> String {
    return getTranspilerVersion() ?? "unknown"
  }
  
  @objc
  func initialize(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(true)
  }
  
  private func transpileCode(_ code: String, filename: String) -> String? {
    let codeData = code.data(using: .utf8)!
    let filenameData = filename.data(using: .utf8)!
    
    let resultPtr = codeData.withUnsafeBytes { codeBytes in
      filenameData.withUnsafeBytes { filenameBytes in
        hook_transpiler_transpile(
          codeBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
          codeData.count,
          filenameBytes.baseAddress!.assumingMemoryBound(to: UInt8.self),
          filenameData.count
        )
      }
    }
    
    guard let ptr = resultPtr else {
      return nil
    }
    
    let result = String(cString: ptr)
    hook_transpiler_free_string(UnsafeMutablePointer(mutating: ptr))
    return result
  }
  
  private func getTranspilerVersion() -> String? {
    guard let ptr = hook_transpiler_version() else {
      return nil
    }
    let version = String(cString: ptr)
    hook_transpiler_free_string(UnsafeMutablePointer(mutating: ptr))
    return version
  }
}

// C FFI declarations
@_silgen_name("hook_transpiler_transpile")
func hook_transpiler_transpile(_ codePtr: UnsafePointer<UInt8>, _ codeLen: Int, _ filenamePtr: UnsafePointer<UInt8>, _ filenameLen: Int) -> UnsafeMutablePointer<CChar>?

@_silgen_name("hook_transpiler_version")
func hook_transpiler_version() -> UnsafeMutablePointer<CChar>?

@_silgen_name("hook_transpiler_free_string")
func hook_transpiler_free_string(_ ptr: UnsafeMutablePointer<CChar>)
