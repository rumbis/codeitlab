#pragma once

#include "CilSourceTextShadowNode.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace facebook::react {
using CilSourceTextComponentDescriptor =
    ConcreteComponentDescriptor<CilSourceTextShadowNode>;

void CilSourceTextSpec_registerComponentDescriptorsFromCodegen(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
} // namespace facebook::react
