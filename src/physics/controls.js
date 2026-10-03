// Converts raw driver input (keys / pads) into smoothed simulation controls.
export class ArcadeControls {
  constructor() {
    this.steer = 0;
    this.steerAssist = true;
  }

  reset() {
    this.steer = 0;
  }

  /**
   * @param input { up, down, left, right, handbrake, boost } values 0..1
   * @param sim   CarSim (reads speed)
   */
  update(dt, input, sim) {
    const speed = sim.speed;
    let throttle = 0, brake = 0, reverse = false;
    const up = input.up || 0, down = input.down || 0;
    if (up > 0) {
      if (speed < -1) brake = up;
      else throttle = up;
    }
    if (down > 0) {
      if (speed > 1) brake = Math.max(brake, down);
      else if (!up) {
        reverse = true;
        throttle = down;
      }
    }
    // hold the car when stopped with no input
    if (!up && !down && Math.abs(speed) < 0.4) brake = 0.6;

    const target = (input.right || 0) - (input.left || 0);
    const rate = Math.sign(target) !== Math.sign(this.steer) || target === 0 ? 6 : 3.5;
    const diff = target - this.steer;
    const stepMax = rate * dt;
    this.steer += Math.abs(diff) < stepMax ? diff : Math.sign(diff) * stepMax;
    let scale = 1;
    if (this.steerAssist) scale = 1 / (1 + 0.6 * Math.pow(Math.abs(speed) / 25, 1.5));
    const actions = {};
    for (const k of PASS_THROUGH) if (input[k]) actions[k] = +input[k];
    actions.accelerate = up;
    actions.brake = down;
    return {
      throttle,
      brake,
      reverse,
      // virtual steering wheels use the speed-scaled value; rods apply their own car speed factor
      steer: this.steer * scale,
      steerRaw: this.steer,
      assist: this.steerAssist,
      handbrake: input.handbrake ? 1 : 0,
      boost: input.boost ? 1 : 0,
      actions,
    };
  }
}

// Input actions handed to parts as-is (rod / jet / gear / horn keys).
const PASS_THROUGH = ['gearUp', 'gearDown', 'jetUp', 'jetDown', 'horn', 'action1', 'action2', 'action3', 'action4'];
