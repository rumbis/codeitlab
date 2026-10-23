/**
 * Keeps the dynamic `import("three")` expression out of component bodies so the
 * React Compiler does not bail out on an unsupported Import expression.
 */
export function loadAmbientSceneModule() {
  return import("./ambientScene");
}
