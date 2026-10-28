#pragma once

#include <react/renderer/components/CilSourceTextSpec/EventEmitters.h>
#include <react/renderer/components/CilSourceTextSpec/Props.h>
#include <react/renderer/components/CilSourceTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char CilSourceTextRunComponentName[];

using CilSourceTextRunShadowNode =
    ConcreteViewShadowNode<CilSourceTextRunComponentName, CilSourceTextRunProps,
                           CilSourceTextRunEventEmitter, CilSourceTextRunState>;
} // namespace facebook::react
