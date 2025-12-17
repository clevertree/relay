#import <React/RCTBridgeModule.h>
#if __has_include("FBReactNativeSpec/FBReactNativeSpec.h")
#import "FBReactNativeSpec/FBReactNativeSpec.h"
#else
#import <FBReactNativeSpec/FBReactNativeSpec.h>
#endif

@interface RCT_EXTERN_REMAP_MODULE(ThemedStyler, ThemedStyler, NSObject<NativeThemedStylerSpec>)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(renderCss:(NSString *)usageJson themesJson:(NSString *)themesJson)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getRnStyles:(NSString *)selector classesJson:(NSString *)classesJson themesJson:(NSString *)themesJson)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getDefaultState)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getVersion)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
