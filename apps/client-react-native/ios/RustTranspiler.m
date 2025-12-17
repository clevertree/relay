#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#if __has_include("FBReactNativeSpec/FBReactNativeSpec.h")
#import "FBReactNativeSpec/FBReactNativeSpec.h"
#else
#import <FBReactNativeSpec/FBReactNativeSpec.h>
#endif

@interface RCT_EXTERN_REMAP_MODULE(RustTranspiler, RustTranspiler, NSObject<NativeHookTranspilerSpec>)

RCT_EXTERN_METHOD(transpile:(NSString *)code
                  filename:(NSString *)filename
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getVersion)

RCT_EXTERN_METHOD(initialize:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
