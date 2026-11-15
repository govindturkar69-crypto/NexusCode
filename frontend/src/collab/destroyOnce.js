/**
 * Makes `target.destroy()` safe to call more than once.
 *
 * y-monaco's MonacoBinding destroys itself when its Monaco model is disposed
 * (model.onWillDispose → this.destroy()), and the editor's effect cleanup
 * destroys it again. The second call unobserves the Y.Text a second time, which
 * Yjs reports as "[yjs] Tried to remove event handler that doesn't exist."
 * Replacing the instance's method also covers the binding's own internal call,
 * since it goes through `this.destroy`.
 */
export function destroyOnce(target) {
  const destroy = target.destroy.bind(target);
  let destroyed = false;
  target.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    destroy();
  };
  return target;
}
