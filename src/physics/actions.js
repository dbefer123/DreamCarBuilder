// Value (0..1) of a named driver action in a controls object. Part settings refer to
// actions by name (rod keys, wheel hand brake, jet throttle, gear keys).
export function actionValue(c, name) {
  if (!name || name === 'none') return 0;
  const raw = c.steerRaw ?? c.steer ?? 0;
  switch (name) {
    case 'steerLeft': return raw < 0 ? -raw : 0;
    case 'steerRight': return raw > 0 ? raw : 0;
    case 'handbrake': return c.handbrake ? +c.handbrake : 0;
    case 'boost': return c.boostActive ? 1 : 0;
    case 'accelerate': return c.actions?.accelerate ?? (c.throttle > 0 && !c.reverse ? c.throttle : 0);
    case 'brake': return c.actions?.brake ?? Math.max(c.brake || 0, c.reverse ? c.throttle || 0 : 0);
    default: return c.actions?.[name] ? +c.actions[name] : 0;
  }
}
