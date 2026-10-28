#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>

@interface CilSourceTextManager : RCTViewManager
@end

@implementation CilSourceTextManager

RCT_EXPORT_MODULE(CilSourceText)

- (UIView *)view {
  return [[UIView alloc] init];
}

@end

@interface CilSourceTextRunManager : RCTViewManager
@end

@implementation CilSourceTextRunManager

RCT_EXPORT_MODULE(CilSourceTextRun)

- (UIView *)view {
  return nil;
}

@end
