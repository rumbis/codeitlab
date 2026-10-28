#import "CilSourceTextRun.h"
#import <React/RCTFabricComponentsPlugins.h>
#import "CilSourceTextRunComponentDescriptor.h"
#import <react/renderer/components/CilSourceTextSpec/Props.h>
#import <react/renderer/components/CilSourceTextSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface CilSourceTextRun () <RCTCilSourceTextRunViewProtocol>

@end

@implementation CilSourceTextRun {
  NSString *_text;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<
      CilSourceTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps =
        std::make_shared<const CilSourceTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps {
  const auto &oldViewProps =
      *std::static_pointer_cast<CilSourceTextRunProps const>(_props);
  const auto &newViewProps =
      *std::static_pointer_cast<CilSourceTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> CilSourceTextRunCls(void) {
  return CilSourceTextRun.class;
}

@end
