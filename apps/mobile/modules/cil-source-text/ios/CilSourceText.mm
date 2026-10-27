#import "CilSourceText.h"
#import <React/RCTFabricComponentsPlugins.h>
#import "CilSourceTextComponentDescriptor.h"
#import "CilSourceTextShadowNode.h"
#import <React/RCTConversions.h>
#import <objc/runtime.h>
#import <react/renderer/components/CilSourceTextSpec/EventEmitters.h>
#import <react/renderer/components/CilSourceTextSpec/Props.h>
#import <react/renderer/components/CilSourceTextSpec/RCTComponentViewHelpers.h>
#import <react/renderer/textlayoutmanager/RCTAttributedTextUtils.h>

using namespace facebook::react;

@interface CilSourceTextView : UITextView
@end

@implementation CilSourceTextView
- (BOOL)canPerformAction:(SEL)action withSender:(id)sender {
  // Read-only UITextViews must still allow selecting the whole file.
  if (action == @selector(selectAll:)) {
    return self.selectable && self.text.length > 0 &&
           self.selectedRange.length < self.text.length;
  }
  return [super canPerformAction:action withSender:sender];
}
@end

@protocol CilSourceTextOutsideTapTarget <NSObject>
- (void)clearSelectionForOutsideTapWithHitView:(UIView *)hitView;
@end

@interface CilSourceTextOutsideTapCoordinator
    : NSObject <UIGestureRecognizerDelegate>

- (instancetype)initWithWindow:(UIWindow *)window;
- (void)addTarget:(id<CilSourceTextOutsideTapTarget>)target;
- (void)removeTarget:(id<CilSourceTextOutsideTapTarget>)target;

@end

static const void *CilSourceTextOutsideTapCoordinatorKey =
    &CilSourceTextOutsideTapCoordinatorKey;

@implementation CilSourceTextOutsideTapCoordinator {
  __weak UIWindow *_window;
  UITapGestureRecognizer *_recognizer;
  NSHashTable<id<CilSourceTextOutsideTapTarget>> *_targets;
}

- (instancetype)initWithWindow:(UIWindow *)window {
  if (self = [super init]) {
    _window = window;
    _targets = [NSHashTable weakObjectsHashTable];
    _recognizer =
        [[UITapGestureRecognizer alloc] initWithTarget:self
                                                action:@selector(handleTap:)];
    _recognizer.cancelsTouchesInView = NO;
    _recognizer.delegate = self;
    [window addGestureRecognizer:_recognizer];
  }
  return self;
}

- (void)addTarget:(id<CilSourceTextOutsideTapTarget>)target {
  [_targets addObject:target];
}

- (void)removeTarget:(id<CilSourceTextOutsideTapTarget>)target {
  [_targets removeObject:target];
  if (_targets.count > 0) {
    return;
  }

  UIWindow *window = _window;
  [window removeGestureRecognizer:_recognizer];
  if (objc_getAssociatedObject(window, CilSourceTextOutsideTapCoordinatorKey) ==
      self) {
    objc_setAssociatedObject(window, CilSourceTextOutsideTapCoordinatorKey, nil,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
}

- (void)handleTap:(UITapGestureRecognizer *)sender {
  UIWindow *window = _window;
  if (window == nil) {
    return;
  }

  UIView *hitView = [window hitTest:[sender locationInView:window]
                          withEvent:nil];
  if (hitView == nil) {
    return;
  }
  for (id<CilSourceTextOutsideTapTarget> target in _targets.allObjects) {
    [target clearSelectionForOutsideTapWithHitView:hitView];
  }
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:
        (UIGestureRecognizer *)otherGestureRecognizer {
  return YES;
}

@end

static CilSourceTextOutsideTapCoordinator *
CilSourceTextOutsideTapCoordinatorForWindow(UIWindow *window) {
  CilSourceTextOutsideTapCoordinator *coordinator =
      objc_getAssociatedObject(window, CilSourceTextOutsideTapCoordinatorKey);
  if (coordinator == nil) {
    coordinator =
        [[CilSourceTextOutsideTapCoordinator alloc] initWithWindow:window];
    objc_setAssociatedObject(window, CilSourceTextOutsideTapCoordinatorKey,
                             coordinator, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return coordinator;
}

@interface CilSourceText () <RCTCilSourceTextViewProtocol, UITextViewDelegate,
                            CilSourceTextOutsideTapTarget>
@end

@implementation CilSourceText {
  UIView *_view;
  CilSourceTextView *_textView;
  BOOL _textLayoutNeedsUpdate;
  CilSourceTextShadowNode::ConcreteState::Shared _state;
  __weak UIWindow *_outsideTapWindow;
  BOOL _suppressSelectionChange;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<CilSourceTextComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps =
        std::make_shared<const CilSourceTextProps>();
    _props = defaultProps;
    _view = [[UIView alloc] init];
    self.contentView = _view;
    self.clipsToBounds = YES;
    _textView = [[CilSourceTextView alloc] init];
    _textView.scrollEnabled = NO;
    _textView.editable = NO;
    _textView.textContainerInset = UIEdgeInsetsZero;
    _textView.textContainer.lineFragmentPadding = 0;
    _textView.textContainer.lineBreakMode = NSLineBreakByTruncatingTail;
    _textView.textContainer.widthTracksTextView = NO;
    _textView.textContainer.heightTracksTextView = NO;
    _textView.delegate = self;
    _textView.textDragInteraction.enabled = NO;
    _textView.layoutManager.usesFontLeading = NO;
    [self addSubview:_textView];
  }
  return self;
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (_outsideTapWindow == self.window)
    return;
  CilSourceTextOutsideTapCoordinator *coordinator = objc_getAssociatedObject(
      _outsideTapWindow, CilSourceTextOutsideTapCoordinatorKey);
  [coordinator removeTarget:self];
  _outsideTapWindow = self.window;
  if (_outsideTapWindow != nil) {
    [CilSourceTextOutsideTapCoordinatorForWindow(_outsideTapWindow)
        addTarget:self];
  }
}

- (void)dealloc {
  CilSourceTextOutsideTapCoordinator *coordinator = objc_getAssociatedObject(
      _outsideTapWindow, CilSourceTextOutsideTapCoordinatorKey);
  [coordinator removeTarget:self];
}

- (void)prepareForRecycle {
  [super prepareForRecycle];
  CilSourceTextOutsideTapCoordinator *coordinator = objc_getAssociatedObject(
      _outsideTapWindow, CilSourceTextOutsideTapCoordinatorKey);
  [coordinator removeTarget:self];
  _outsideTapWindow = nil;
  _state.reset();
  _textView.frame = CGRectZero;
  _textView.attributedText = nil;
  _textLayoutNeedsUpdate = YES;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  if (!CGRectEqualToRect(_textView.frame, _view.frame)) {
    _textView.frame = _view.frame;
    _textLayoutNeedsUpdate = YES;
    [self setNeedsDisplay];
  }
}

- (void)drawRect:(CGRect)rect {
  if (!_state)
    return;
  NSMutableAttributedString *text = [RCTNSAttributedStringFromAttributedString(
      _state->getData().attributedString) mutableCopy];
  RCTApplyBaselineOffset(text);
  const BOOL textChanged =
      ![_textView.attributedText isEqualToAttributedString:text];
  const BOOL frameChanged = _textLayoutNeedsUpdate;
  if (!textChanged && !frameChanged)
    return;
  if (textChanged) {
    const NSRange savedRange = _textView.selectedRange;
    _suppressSelectionChange = YES;
    _textView.attributedText = text;
    if (savedRange.location != NSNotFound && savedRange.length > 0 &&
        NSMaxRange(savedRange) <= text.length) {
      _textView.selectedRange = savedRange;
    }
    _suppressSelectionChange = NO;
  }
  if (frameChanged)
    _textView.textContainer.size = CGSizeMake(CGRectGetWidth(_view.frame), CGFLOAT_MAX);
  _textLayoutNeedsUpdate = NO;
}

- (void)updateProps:(Props::Shared const &)props
           oldProps:(Props::Shared const &)oldProps {
  const auto &oldViewProps =
      *std::static_pointer_cast<CilSourceTextProps const>(_props);
  const auto &newViewProps =
      *std::static_pointer_cast<CilSourceTextProps const>(props);
  if (oldViewProps.numberOfLines != newViewProps.numberOfLines) {
    _textView.textContainer.maximumNumberOfLines = newViewProps.numberOfLines;
  }
  if (oldViewProps.selectable != newViewProps.selectable)
    _textView.selectable = newViewProps.selectable;
  if (oldViewProps.allowFontScaling != newViewProps.allowFontScaling) {
    _textView.adjustsFontForContentSizeCategory = newViewProps.allowFontScaling;
  }
  if (oldViewProps.ellipsizeMode != newViewProps.ellipsizeMode) {
    switch (newViewProps.ellipsizeMode) {
    case CilSourceTextEllipsizeMode::Head:
      _textView.textContainer.lineBreakMode = NSLineBreakByTruncatingHead;
      break;
    case CilSourceTextEllipsizeMode::Middle:
      _textView.textContainer.lineBreakMode = NSLineBreakByTruncatingMiddle;
      break;
    case CilSourceTextEllipsizeMode::Tail:
      _textView.textContainer.lineBreakMode = NSLineBreakByTruncatingTail;
      break;
    case CilSourceTextEllipsizeMode::Clip:
      _textView.textContainer.lineBreakMode = NSLineBreakByClipping;
      break;
    }
  }
  if (oldViewProps.backgroundColor != newViewProps.backgroundColor) {
    _textView.backgroundColor =
        RCTUIColorFromSharedColor(newViewProps.backgroundColor);
  }
  [super updateProps:props oldProps:oldProps];
}

- (void)updateState:(const facebook::react::State::Shared &)state
           oldState:(const facebook::react::State::Shared &)oldState {
  _state =
      std::static_pointer_cast<const CilSourceTextShadowNode::ConcreteState>(
          state);
  [self setNeedsDisplay];
}

- (void)clearSelectionForOutsideTapWithHitView:(UIView *)hitView {
  if ([hitView isDescendantOfView:self])
    return;
  UITextView *textView = _textView;
  // Allow a pending native Copy action to consume its selection first.
  dispatch_async(dispatch_get_main_queue(), ^{
    UITextRange *range = textView.selectedTextRange;
    if (range != nil && !range.isEmpty)
      textView.selectedTextRange = nil;
  });
}

- (void)textViewDidChangeSelection:(UITextView *)textView {
  if (_suppressSelectionChange || _eventEmitter == nullptr)
    return;
  const NSRange range = textView.selectedRange;
  if (range.location == NSNotFound)
    return;
  std::dynamic_pointer_cast<const facebook::react::CilSourceTextEventEmitter>(
      _eventEmitter)
      ->onSelectionChange(
          facebook::react::CilSourceTextEventEmitter::OnSelectionChange{
              static_cast<int>(self.tag), static_cast<int>(range.location),
              static_cast<int>(NSMaxRange(range))});
}

Class<RCTComponentViewProtocol> CilSourceTextCls(void) {
  return CilSourceText.class;
}
@end
