#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ThemedStyler, NSObject)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(renderCss:(NSString *)usageJson themesJson:(NSString *)themesJson)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getRnStyles:(NSString *)selector classesJson:(NSString *)classesJson themesJson:(NSString *)themesJson)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getDefaultState)

RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getVersion)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
